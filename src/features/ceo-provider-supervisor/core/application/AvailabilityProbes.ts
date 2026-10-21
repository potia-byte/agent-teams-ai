import { recordCeoEvent } from '../domain/policy';
import { DEFAULT_PROBE_POLICY, probeDecision, reserveProbe } from '../domain/probePolicy';
import { confirmProvider } from '../domain/providerRegistry';

import type { CeoProvider, CeoState, ExecutorAvailability } from '../../contracts';
import type { ProbePolicy } from '../domain/probePolicy';
import type { CeoRepository, CeoRuntime } from './CeoSupervisor';

export interface AvailabilityEvidence {
  availability: Exclude<ExecutorAvailability, 'BUSY'>;
  /** Authenticated/installed alone does not prove capacity to execute work. */
  explicitCapacity: boolean;
  cooldownUntil?: string;
}
export interface AvailabilityProbePort {
  /** Cheap bounded check only. Never send a prompt or make an LLM request. */
  check(provider: CeoProvider): Promise<AvailabilityEvidence>;
}

export class AvailabilityProbes {
  constructor(
    private readonly ports: {
      repository: CeoRepository;
      runtime: CeoRuntime;
      probe: AvailabilityProbePort;
      now(): string;
      policy?: ProbePolicy;
    }
  ) {}

  /** Caller-driven tick; no background timer, launch, retry or fail-back. */
  run(teamName: string, provider: CeoProvider): Promise<CeoState> {
    const { repository, runtime, probe, now } = this.ports;
    return repository.exclusive(teamName, (state, save) =>
      runtime.exclusive(teamName, async () => {
        const at = now();
        if (!probeDecision(state, provider, at, this.ports.policy ?? DEFAULT_PROBE_POLICY).allowed)
          return structuredClone(state);
        // Also fence unregistered/stale persisted ownership against the real runtime.
        if ((await runtime.inspect(teamName))?.provider === provider) return structuredClone(state);
        const health = state.providers[provider];
        reserveProbe(health, at);
        await save();
        let evidence: AvailabilityEvidence;
        try {
          evidence = await probe.check(provider);
        } catch {
          evidence = { availability: 'UNKNOWN', explicitCapacity: false };
        }
        if (evidence.availability === 'AVAILABLE' && evidence.explicitCapacity === true) {
          confirmProvider(health, now());
        } else {
          // Inconclusive CLI auth/version evidence cannot clear a known limit.
          if (['RATE_LIMITED', 'AUTH_REQUIRED', 'UNAVAILABLE'].includes(evidence.availability)) {
            health.availability = evidence.availability;
            health.verifiedAt = now();
          } else if (health.availability === 'AVAILABLE') {
            health.availability = 'UNKNOWN';
          }
          health.consecutiveFailures++;
          health.totalFailures++;
          if (evidence.cooldownUntil && Number.isFinite(Date.parse(evidence.cooldownUntil))) {
            health.cooldownUntil = evidence.cooldownUntil;
          }
        }
        recordCeoEvent(state, now(), 'availability_probed', provider);
        await save();
        return structuredClone(state);
      })
    );
  }
}
