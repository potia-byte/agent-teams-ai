import type { CeoProvider, CeoProviderHealth, CeoState } from '../../contracts';

export interface ProbePolicy {
  minIntervalMs: number;
  backoffMs: number;
  maxBackoffMs: number;
  maxProbesPerDay: number;
}
export const DEFAULT_PROBE_POLICY: Readonly<ProbePolicy> = {
  minIntervalMs: 5 * 60_000,
  backoffMs: 15 * 60_000,
  maxBackoffMs: 6 * 60 * 60_000,
  maxProbesPerDay: 8,
};

export function probeBackoff(failures: number, policy = DEFAULT_PROBE_POLICY): number {
  return Math.min(
    policy.maxBackoffMs,
    policy.backoffMs * 2 ** Math.min(30, Math.max(0, failures - 1))
  );
}

function nextProbeAt(health: CeoProviderHealth, policy: ProbePolicy): number {
  const lastProbe = health.lastProbeAt === null ? null : Date.parse(health.lastProbeAt);
  const failed = health.probeFailures > 0 || health.availability === 'RATE_LIMITED';
  const failureAt = health.verifiedAt === null ? null : Date.parse(health.verifiedAt);
  return Math.max(
    health.cooldownUntil === null ? 0 : Date.parse(health.cooldownUntil),
    lastProbe === null ? 0 : lastProbe + policy.minIntervalMs,
    !failed
      ? 0
      : Math.max(lastProbe ?? 0, failureAt ?? 0) + probeBackoff(health.probeFailures, policy)
  );
}

function sharedCooldown(health: CeoProviderHealth, policy: ProbePolicy): number {
  // A probe's own retry budget must not starve the other limited provider.
  return Math.max(
    health.cooldownUntil === null ? 0 : Date.parse(health.cooldownUntil),
    health.verifiedAt === null ? 0 : Date.parse(health.verifiedAt) + policy.backoffMs
  );
}

export function probeDecision(
  state: CeoState,
  provider: CeoProvider,
  at: string,
  policy: ProbePolicy = DEFAULT_PROBE_POLICY
): { allowed: boolean; reason: string } {
  const health = state.providers[provider];
  if (state.owner?.provider === provider || health.availability === 'BUSY')
    return { allowed: false, reason: 'busy_owner' };
  const now = Date.parse(at);
  if (
    !Number.isFinite(now) ||
    !Object.values(policy).every((value) => Number.isFinite(value) && value > 0)
  )
    return { allowed: false, reason: 'invalid_policy_or_time' };
  if (
    health.probeDay === new Date(now).toISOString().slice(0, 10) &&
    health.probesToday >= policy.maxProbesPerDay
  )
    return { allowed: false, reason: 'daily_limit' };
  if (
    state.providers.codex.availability === 'RATE_LIMITED' &&
    state.providers.anthropic.availability === 'RATE_LIMITED' &&
    [state.providers.codex, state.providers.anthropic].some(
      (item) => now < sharedCooldown(item, policy)
    )
  )
    return { allowed: false, reason: 'both_rate_limited_backoff' };
  return now >= nextProbeAt(health, policy)
    ? { allowed: true, reason: 'due' }
    : { allowed: false, reason: 'backoff_or_cooldown' };
}

/** Persist before invoking the port, so a crash still consumes the budget. */
export function reserveProbe(health: CeoProviderHealth, at: string): void {
  const day = new Date(at).toISOString().slice(0, 10);
  health.probesToday = health.probeDay === day ? health.probesToday + 1 : 1;
  health.probeDay = day;
  health.lastProbeAt = at;
  // An interrupted probe counts as unsuccessful until explicit evidence arrives.
  health.probeFailures++;
}
