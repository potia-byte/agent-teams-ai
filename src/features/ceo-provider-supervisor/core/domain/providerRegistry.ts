import type { CeoProvider, CeoProviderHealth, CeoState, KnownCeoProvider } from '../../contracts';

export const PROVIDER_CATALOG = {
  codex: { label: 'Codex', usage: 'selectable' },
  anthropic: { label: 'Claude', usage: 'selectable' },
  opencode: { label: 'OpenCode', usage: 'research-only' },
} as const;

export function emptyProviderHealth(): CeoProviderHealth {
  return {
    availability: 'UNKNOWN',
    verifiedAt: null,
    cooldownUntil: null,
    consecutiveFailures: 0,
    totalFailures: 0,
    lastProbeAt: null,
    probeDay: null,
    probesToday: 0,
    probeFailures: 0,
  };
}

export function isSelectableProvider(
  state: CeoState,
  provider: KnownCeoProvider,
  at?: string
): provider is CeoProvider {
  const health = state.providers[provider];
  return (
    PROVIDER_CATALOG[provider].usage === 'selectable' &&
    health.availability === 'AVAILABLE' &&
    state.owner?.provider !== provider &&
    (health.cooldownUntil === null ||
      (at !== undefined && Date.parse(health.cooldownUntil) <= Date.parse(at)))
  );
}

export function confirmProvider(health: CeoProviderHealth, at: string, busy = false): void {
  health.availability = busy ? 'BUSY' : 'AVAILABLE';
  health.verifiedAt = at;
  health.cooldownUntil = null;
  health.consecutiveFailures = 0;
  health.probeFailures = 0;
}
