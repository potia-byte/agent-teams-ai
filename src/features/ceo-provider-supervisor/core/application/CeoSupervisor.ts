import { isConfirmedSubscriptionQuota, recordCeoEvent, selectReserve } from '../domain/policy';

import type { CeoCommand, CeoProbeResult, CeoProvider, CeoState } from '../../contracts';
import type { CeoFailure } from '../domain/policy';

export interface CeoRepository {
  read(teamName: string): Promise<CeoState>;
  /** Cross-process exclusion, held until physical completion of the operation. */
  exclusive<T>(
    teamName: string,
    operation: (state: CeoState, save: () => Promise<void>) => Promise<T>
  ): Promise<T>;
}
export interface CeoRuntime {
  exclusive<T>(teamName: string, operation: () => Promise<T>): Promise<T>;
  inspect(teamName: string): Promise<{
    runId: string;
    provider: CeoProvider;
    safe: boolean;
    effectsRevision: number;
  } | null>;
  stop(teamName: string, expectedRunId: string): Promise<void>;
  /** Resolves only after alive ownership and subscription are proven. Fresh session only. */
  start(teamName: string, provider: CeoProvider, prompt: string, model?: string): Promise<string>;
}

export class CeoSupervisor {
  constructor(
    private readonly ports: {
      repository: CeoRepository;
      runtime: CeoRuntime;
      now(): string;
      newId(): string;
    }
  ) {}

  read(teamName: string): Promise<CeoState> {
    const { repository, runtime, now } = this.ports;
    return repository.exclusive(teamName, (state, save) =>
      runtime.exclusive(teamName, async () => {
        if (await this.blockInterruptedHandoff(state, save)) return structuredClone(state);
        const current = await runtime.inspect(teamName);
        if (
          state.status === 'active' &&
          (current?.runId !== state.owner?.runId || current?.provider !== state.owner?.provider)
        ) {
          state.status = 'blocked';
          state.reason = 'runtime_ownership_unknown';
          recordCeoEvent(state, now(), 'runtime_ownership_unknown');
          await save();
        }
        return structuredClone(state);
      })
    );
  }

  async command(command: CeoCommand): Promise<CeoState> {
    const { repository, runtime, now, newId } = this.ports;
    return repository.exclusive(command.teamName, (state, save) =>
      runtime.exclusive(command.teamName, async () => {
        if (await this.blockInterruptedHandoff(state, save)) return structuredClone(state);
        const current = await runtime.inspect(command.teamName);
        if (command.action === 'enable') {
          if (state.status !== 'disabled') throw new Error('CEO is already configured');
          if (!current?.safe) throw new Error('A safe, app-owned solo lead is required');
          state.owner = {
            provider: current.provider,
            runId: current.runId,
            role: current.provider === state.roles.primary ? 'primary' : 'reserve',
          };
          state.status = 'active';
          state.epoch++;
          state.providers[current.provider] = { availability: 'BUSY', verifiedAt: now() };
          recordCeoEvent(state, now(), 'enabled', current.provider);
          if (state.owner.role === 'reserve')
            recordCeoEvent(state, now(), 'running_on_reserve', current.provider);
        } else if (command.action === 'checkpoint') {
          if (
            state.status !== 'active' ||
            !current?.safe ||
            current.runId !== state.owner?.runId ||
            current.provider !== state.owner.provider
          ) {
            throw new Error('Checkpoint requires the exact idle CEO owner');
          }
          state.checkpoint = {
            id: newId(),
            runId: current.runId,
            provider: current.provider,
            runtimeRevision: current.effectsRevision,
            summary: command.summary!,
            effects: command.effects!,
            savedAt: now(),
          };
          recordCeoEvent(state, now(), 'checkpoint_saved');
        } else if (command.action === 'available') {
          const provider = command.provider!;
          // Explicit operator health evidence; installation/auth alone is never evidence.
          state.providers[provider] = {
            availability: state.owner?.provider === provider ? 'BUSY' : 'AVAILABLE',
            verifiedAt: now(),
          };
          recordCeoEvent(state, now(), 'availability_confirmed', provider);
        }
        await save();
        if (
          (command.action === 'retry' ||
            (command.action === 'available' && command.provider === selectReserve(state))) &&
          state.status === 'waiting'
        ) {
          await this.continueHandoff(state, save);
        }
        return structuredClone(state);
      })
    );
  }

  async observeProbe(result: CeoProbeResult): Promise<CeoState> {
    const { repository, now } = this.ports;
    return repository.exclusive(result.teamName, async (state, save) => {
      // Health evidence is deliberately separate from handoff orchestration.
      // Even a successful primary probe leaves an active reserve untouched.
      state.providers[result.provider] = {
        availability: state.owner?.provider === result.provider ? 'BUSY' : result.availability,
        verifiedAt: now(),
      };
      recordCeoEvent(state, now(), 'availability_probed', result.provider);
      await save();
      return structuredClone(state);
    });
  }

  /** Returns true when this role owns recovery, suppressing competing retry/nudge delivery. */
  async observe(failure: CeoFailure): Promise<boolean> {
    const { repository, runtime, now } = this.ports;
    return repository.exclusive(failure.teamName, (state, save) =>
      runtime.exclusive(failure.teamName, async () => {
        if (state.status === 'disabled') return false;
        if (await this.blockInterruptedHandoff(state, save)) return true;
        // This role has one recovery owner. Do not let the legacy nudge scheduler
        // race the supervisor, including during SDK retries preceding terminal quota.
        if (!isConfirmedSubscriptionQuota(failure)) return true;
        if (failure.epoch !== undefined && failure.epoch !== state.epoch) return true;
        if (state.handledRuns.includes(failure.runId)) return true;
        if (
          state.status !== 'active' ||
          state.owner?.runId !== failure.runId ||
          state.owner.provider !== failure.providerId
        )
          return true;
        const current = await runtime.inspect(failure.teamName);
        if (
          !current ||
          current.runId !== failure.runId ||
          current.provider !== state.owner.provider
        )
          return true;
        state.providers[state.owner.provider] = { availability: 'RATE_LIMITED', verifiedAt: now() };
        state.handledRuns.push(failure.runId);
        state.epoch++;
        recordCeoEvent(state, now(), 'quota_confirmed', state.owner.provider);
        // Preserve checkpoint and retire old owner even when no reserve is available.
        state.status = 'stopping';
        await save();
        try {
          await runtime.stop(failure.teamName, failure.runId);
          state.owner = null;
          if (
            !current.safe ||
            !state.checkpoint ||
            state.checkpoint.runId !== failure.runId ||
            state.checkpoint.provider !== failure.providerId ||
            state.checkpoint.runtimeRevision !== current.effectsRevision ||
            state.checkpoint.effects.some((effect) => effect.outcome === 'unknown')
          ) {
            state.status = 'blocked';
            state.reason = 'unsafe_checkpoint_or_unknown_effect';
            recordCeoEvent(state, now(), 'manual_reconciliation_required');
            await save();
            return true;
          }
          state.status = 'waiting';
          await save();
          await this.continueHandoff(state, save);
        } catch {
          state.status = 'blocked';
          state.reason = 'handoff_outcome_unknown';
          recordCeoEvent(state, now(), 'handoff_outcome_unknown');
          await save();
        }
        return true;
      })
    );
  }

  private async blockInterruptedHandoff(
    state: CeoState,
    save: () => Promise<void>
  ): Promise<boolean> {
    if (state.status !== 'starting' && state.status !== 'stopping') return false;
    // A persisted in-flight start/stop has an unknown outcome after restart.
    // Never repeat it or attach to an unproven replacement automatically.
    state.status = 'blocked';
    state.reason = 'interrupted_handoff';
    recordCeoEvent(state, this.ports.now(), 'interrupted_handoff');
    await save();
    return true;
  }

  private async continueHandoff(state: CeoState, save: () => Promise<void>): Promise<void> {
    const { runtime, now } = this.ports;
    if (state.owner) return;
    if (
      !state.checkpoint ||
      !state.checkpoint.provider ||
      state.checkpoint.effects.some((effect) => effect.outcome === 'unknown')
    ) {
      state.status = 'blocked';
      state.reason = 'unsafe_checkpoint_or_unknown_effect';
      recordCeoEvent(state, now(), 'manual_reconciliation_required');
      await save();
      return;
    }
    const provider = selectReserve(state);
    if (!provider) {
      state.reason = 'no_available_executor';
      recordCeoEvent(state, now(), 'waiting_for_executor');
      await save();
      return;
    }
    if (await runtime.inspect(state.teamName)) throw new Error('Another runtime owns the team');
    state.status = 'starting';
    state.reason = null;
    state.providers[provider].availability = 'BUSY';
    recordCeoEvent(state, now(), 'starting_fresh_session', provider);
    await save();
    const prompt = [
      `Logical role: CEO. Fencing epoch: ${state.epoch}. Checkpoint: ${state.checkpoint.id}.`,
      'Continue from this saved checkpoint only. This is a fresh provider session.',
      'Never repeat confirmed external actions. Unknown results require reconciliation; do not retry them.',
      // Only portable application context crosses providers, never session metadata.
      JSON.stringify({
        id: state.checkpoint.id,
        summary: state.checkpoint.summary,
        effects: state.checkpoint.effects.map(({ key, outcome }) => ({ key, outcome })),
      }),
    ].join('\n');
    let startReturned = false;
    try {
      const runId = await runtime.start(state.teamName, provider, prompt);
      startReturned = true;
      const current = await runtime.inspect(state.teamName);
      if (current?.runId !== runId || current.provider !== provider)
        throw new Error('replacement_ownership_unproven');
      state.owner = {
        provider,
        runId,
        role: provider === state.roles.primary ? 'primary' : 'reserve',
      };
      state.status = 'active';
      recordCeoEvent(state, now(), 'owner_committed', provider);
      await save();
    } catch (error) {
      // Launch may have reached the provider. Never launch it a second time blindly.
      state.status = 'blocked';
      // Persist only known machine reasons, never provider errors, prompts or secrets.
      state.reason =
        error instanceof Error &&
        ['replacement_ownership_unproven', 'launch_rejected', 'start_timeout'].includes(
          error.message
        )
          ? error.message
          : startReturned
            ? 'replacement_ownership_unproven'
            : 'start_failed';
      recordCeoEvent(state, now(), 'launch_outcome_unknown', provider);
      await save();
    }
  }
}
