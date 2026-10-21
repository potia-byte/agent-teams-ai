import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { withFileLock } from '@main/services/team/fileLock';
import { atomicWriteAsync } from '@main/utils/atomicWrite';

import { DEFAULT_CEO_PROVIDER_ROLES, emptyCeoState } from '../../core/domain/policy';

import type { CeoState } from '../../contracts';
import type { CeoRepository } from '../../core/application/CeoSupervisor';

export function validateTeamName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new Error('Invalid CEO team name');
  }
}

function validateState(
  value: unknown,
  teamName: string,
  contextId: string
): asserts value is CeoState {
  // Full structural checks before persisted content can control a process.
  if (!value || typeof value !== 'object') throw new Error('Invalid CEO state');
  const state = value as CeoState;
  const providers = ['anthropic', 'codex'];
  // Version 1 gains additive fields. Only absent legacy fields get defaults;
  // malformed values and unknown schema versions still fail closed.
  if (state.version !== 1) throw new Error('Invalid CEO state version');
  if (!Object.hasOwn(state, 'roles')) state.roles = { ...DEFAULT_CEO_PROVIDER_ROLES };
  if (
    !state.roles ||
    !providers.includes(state.roles.primary) ||
    !providers.includes(state.roles.reserve) ||
    state.roles.primary === state.roles.reserve
  )
    throw new Error('Invalid CEO provider roles');
  if (state.owner && !Object.hasOwn(state.owner, 'role')) {
    state.owner.role = state.owner.provider === state.roles.primary ? 'primary' : 'reserve';
  }
  if (state.checkpoint && !Object.hasOwn(state.checkpoint, 'provider')) {
    state.checkpoint.provider =
      state.owner?.runId === state.checkpoint.runId ? state.owner.provider : null;
  }
  const availability = [
    'AVAILABLE',
    'BUSY',
    'RATE_LIMITED',
    'AUTH_REQUIRED',
    'UNAVAILABLE',
    'UNKNOWN',
  ];
  if (
    state.version !== 1 ||
    state.roleId !== 'ceo' ||
    state.teamName !== teamName ||
    state.contextId !== contextId ||
    !Number.isSafeInteger(state.epoch) ||
    state.epoch < 0 ||
    !['disabled', 'active', 'stopping', 'starting', 'waiting', 'blocked'].includes(state.status) ||
    (state.owner !== null &&
      (!state.owner ||
        !providers.includes(state.owner.provider) ||
        typeof state.owner.runId !== 'string' ||
        state.owner.role !==
          (state.owner.provider === state.roles.primary ? 'primary' : 'reserve'))) ||
    !state.providers ||
    !providers.every((provider) => {
      const item = state.providers[provider as keyof typeof state.providers];
      return (
        item &&
        availability.includes(item.availability) &&
        (item.verifiedAt === null || typeof item.verifiedAt === 'string')
      );
    }) ||
    !Array.isArray(state.handledRuns) ||
    !state.handledRuns.every((id) => typeof id === 'string') ||
    !Array.isArray(state.history) ||
    !state.history.every(
      (event) =>
        event &&
        typeof event.at === 'string' &&
        typeof event.event === 'string' &&
        Number.isSafeInteger(event.epoch)
    ) ||
    (state.reason !== null && typeof state.reason !== 'string')
  )
    throw new Error('Invalid CEO state');
  if (state.checkpoint !== null) {
    const checkpoint = state.checkpoint;
    if (
      !checkpoint ||
      (checkpoint.provider !== null && !providers.includes(checkpoint.provider)) ||
      typeof checkpoint.id !== 'string' ||
      typeof checkpoint.runId !== 'string' ||
      !Number.isSafeInteger(checkpoint.runtimeRevision) ||
      typeof checkpoint.summary !== 'string' ||
      typeof checkpoint.savedAt !== 'string' ||
      !Array.isArray(checkpoint.effects) ||
      !checkpoint.effects.every(
        (effect) =>
          effect &&
          typeof effect.key === 'string' &&
          ['confirmed', 'not_started', 'unknown'].includes(effect.outcome)
      )
    ) {
      throw new Error('Invalid CEO checkpoint');
    }
  }
}

export class JsonCeoRepository implements CeoRepository {
  private readonly directory: string;
  constructor(
    teamsBasePath: string,
    private readonly contextId: string
  ) {
    this.directory = join(
      teamsBasePath,
      '.ceo-supervisor',
      createHash('sha256').update(contextId).digest('hex')
    );
  }
  private file(teamName: string): string {
    validateTeamName(teamName);
    return join(this.directory, `${teamName}.json`);
  }
  async bindRole(teamName: string): Promise<void> {
    validateTeamName(teamName);
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, 'role-binding.json');
    await withFileLock(
      file,
      async () => {
        try {
          const binding: unknown = JSON.parse(await readFile(file, 'utf8'));
          if (
            !binding ||
            typeof binding !== 'object' ||
            (binding as { teamName?: unknown }).teamName !== teamName
          ) {
            throw new Error('One logical CEO already belongs to another team in this context');
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          await atomicWriteAsync(
            file,
            JSON.stringify({ roleId: 'ceo', teamName, contextId: this.contextId })
          );
        }
      },
      { preventLiveOwnerTakeover: true }
    );
  }
  async read(teamName: string): Promise<CeoState> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file(teamName), 'utf8'));
      validateState(value, teamName, this.contextId);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return emptyCeoState(teamName, this.contextId);
      // Corruption is not an empty/disabled role: fail closed, preserve evidence.
      throw error;
    }
  }
  async exclusive<T>(
    teamName: string,
    operation: (state: CeoState, save: () => Promise<void>) => Promise<T>
  ): Promise<T> {
    const file = this.file(teamName);
    await mkdir(this.directory, { recursive: true });
    return withFileLock(
      file,
      async () => {
        const state = await this.read(teamName);
        return operation(state, async () => {
          validateState(state, teamName, this.contextId);
          await atomicWriteAsync(file, `${JSON.stringify(state, null, 2)}\n`);
        });
      },
      { preventLiveOwnerTakeover: true, acquireTimeoutMs: 5_000 }
    );
  }
}
