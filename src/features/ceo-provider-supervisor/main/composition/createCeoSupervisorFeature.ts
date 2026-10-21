import { randomUUID } from 'node:crypto';

import { CEO_COMMAND, CEO_READ } from '../../contracts';
import { CeoSupervisor } from '../../core/application/CeoSupervisor';
import { JsonCeoRepository, validateTeamName } from '../infrastructure/JsonCeoRepository';

import type { CeoCommand, CeoProbeResult, CeoSupervisorApi } from '../../contracts';
import type { CeoProvider, CeoTask } from '../../contracts';
import type { AvailabilityProbePort } from '../../core/application/AvailabilityProbes';
import type { CeoRuntime } from '../../core/application/CeoSupervisor';
import type { CeoTaskPort } from '../../core/application/CeoTaskQueue';
import type { CeoFailure } from '../../core/domain/policy';
import type { IpcMain } from 'electron';

function normalizeCommand(value: unknown): CeoCommand {
  if (!value || typeof value !== 'object') throw new Error('Invalid CEO command');
  const command = value as CeoCommand;
  validateTeamName(command.teamName);
  if (!['enable', 'checkpoint', 'available', 'retry'].includes(command.action))
    throw new Error('Invalid CEO action');
  if (
    command.action === 'available' &&
    command.provider !== 'anthropic' &&
    command.provider !== 'codex'
  )
    throw new Error('Invalid CEO provider');
  if (command.action === 'checkpoint') {
    if (
      typeof command.summary !== 'string' ||
      !command.summary.trim() ||
      command.summary.length > 16000 ||
      !Array.isArray(command.effects) ||
      command.effects.length > 200 ||
      !command.effects.every(
        (effect) =>
          effect &&
          typeof effect.key === 'string' &&
          effect.key.length > 0 &&
          effect.key.length <= 200 &&
          ['confirmed', 'not_started', 'unknown'].includes(effect.outcome)
      ) ||
      new Set(command.effects.map((effect) => effect.key)).size !== command.effects.length
    )
      throw new Error('Invalid CEO checkpoint');
    // Deliberately do not accept arbitrary transcript/session/env fields.
    return {
      teamName: command.teamName,
      action: 'checkpoint',
      summary: command.summary.trim(),
      effects: command.effects.map(({ key, outcome }) => ({ key, outcome })),
    };
  }
  return { teamName: command.teamName, action: command.action, provider: command.provider };
}

export function createCeoSupervisorFeature(deps: {
  ipcMain: IpcMain;
  teamsBasePath: string;
  getContextId(): string;
  runtime: CeoRuntime;
  onError(error: unknown): void;
  quiesceRecovery(teamName: string): Promise<unknown>;
  availabilityProbe?: AvailabilityProbePort;
  taskExecutor?: CeoTaskPort;
}) {
  const contextId = deps.getContextId();
  const repository = new JsonCeoRepository(deps.teamsBasePath, contextId);
  const supervisor = new CeoSupervisor({
    repository,
    runtime: deps.runtime,
    now: () => new Date().toISOString(),
    newId: randomUUID,
    probe: deps.availabilityProbe,
    taskExecutor: deps.taskExecutor,
  });
  const assertContext = (): void => {
    if (deps.getContextId() !== contextId)
      throw new Error('CEO supervisor context changed; restart the isolated app');
  };
  const api: CeoSupervisorApi = {
    read: (teamName) => {
      assertContext();
      validateTeamName(teamName);
      return supervisor.read(teamName);
    },
    command: async (command) => {
      assertContext();
      const normalized = normalizeCommand(command);
      if (normalized.action === 'enable') {
        await repository.bindRole(normalized.teamName);
        await deps.quiesceRecovery(normalized.teamName);
      }
      return supervisor.command(normalized);
    },
  };
  deps.ipcMain.handle(CEO_READ, (_event, teamName: unknown) => {
    validateTeamName(teamName);
    return api.read(teamName);
  });
  deps.ipcMain.handle(CEO_COMMAND, (_event, command: unknown) =>
    api.command(normalizeCommand(command))
  );
  const pending = new Set<Promise<unknown>>();
  let disposed = false;
  return {
    api,
    probeAvailability(teamName: string, provider: CeoProvider) {
      assertContext();
      validateTeamName(teamName);
      if (!['anthropic', 'codex'].includes(provider)) throw new Error('Invalid CEO provider');
      return supervisor.probeAvailability(teamName, provider);
    },
    taskQueue: {
      read(teamName: string) {
        assertContext();
        validateTeamName(teamName);
        return supervisor.tasks.read(teamName);
      },
      enqueue(
        teamName: string,
        task: Pick<CeoTask, 'id' | 'idempotencyKey' | 'kind' | 'lastSafeCheckpointId'>
      ) {
        assertContext();
        validateTeamName(teamName);
        return supervisor.tasks.enqueue(teamName, task);
      },
      dispatchNext(teamName: string) {
        assertContext();
        validateTeamName(teamName);
        return supervisor.tasks.dispatchNext(teamName);
      },
    },
    observeProbe(result: CeoProbeResult) {
      assertContext();
      validateTeamName(result.teamName);
      if (
        !['anthropic', 'codex'].includes(result.provider) ||
        !['AVAILABLE', 'BUSY', 'RATE_LIMITED', 'AUTH_REQUIRED', 'UNAVAILABLE', 'UNKNOWN'].includes(
          result.availability
        )
      ) {
        throw new Error('Invalid CEO probe result');
      }
      return supervisor.observeProbe(result);
    },
    async owns(teamName: string): Promise<boolean> {
      try {
        validateTeamName(teamName);
      } catch {
        return false;
      }
      assertContext();
      return (await repository.read(teamName)).status !== 'disabled';
    },
    observe(failure: CeoFailure, legacyRecovery: () => void): void {
      if (disposed) return;
      try {
        validateTeamName(failure.teamName);
      } catch {
        legacyRecovery();
        return;
      }
      const request = (async () => {
        assertContext();
        if (!(await supervisor.observe(failure))) legacyRecovery();
      })()
        .catch(deps.onError)
        .finally(() => pending.delete(request));
      pending.add(request);
    },
    async dispose(): Promise<void> {
      disposed = true;
      deps.ipcMain.removeHandler(CEO_READ);
      deps.ipcMain.removeHandler(CEO_COMMAND);
      await Promise.allSettled(pending);
    },
  };
}
