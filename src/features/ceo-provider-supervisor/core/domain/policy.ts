import type { CeoProvider, CeoProviderRoles, CeoState } from '../../contracts';

export const DEFAULT_CEO_PROVIDER_ROLES: Readonly<CeoProviderRoles> = {
  primary: 'codex',
  reserve: 'anthropic',
};

export interface CeoFailure {
  teamName: string;
  runId: string;
  /** Optional for legacy runtime signals; when present it must match the fence. */
  epoch?: number;
  providerId?: string;
  providerBackendId?: string;
  phase: 'sdk_retrying' | 'terminal';
  detail: string;
  statusCode?: number;
}

/** Intentionally narrow: a transport 429/retry-after is not subscription exhaustion. */
export function isConfirmedSubscriptionQuota(failure: CeoFailure): boolean {
  if (failure.phase !== 'terminal') return false;
  if (failure.providerId !== 'anthropic' && failure.providerId !== 'codex') return false;
  if (
    failure.providerBackendId &&
    !['auto', failure.providerId === 'codex' ? 'codex-native' : 'cli-sdk'].includes(
      failure.providerBackendId
    )
  )
    return false;
  const text = failure.detail.toLowerCase();
  return failure.providerId === 'codex'
    ? /\busage_limit_reached\b|\byou(?:'|’)ve hit your usage limit\b/.test(text)
    : /\byou(?:'|’)ve hit your limit\b|\b(?:weekly|session) (?:usage )?limit reached\b/.test(text);
}

export function emptyCeoState(teamName: string, contextId: string): CeoState {
  return {
    version: 1,
    roleId: 'ceo',
    teamName,
    contextId,
    epoch: 0,
    status: 'disabled',
    owner: null,
    roles: { ...DEFAULT_CEO_PROVIDER_ROLES },
    providers: {
      anthropic: { availability: 'UNKNOWN', verifiedAt: null },
      codex: { availability: 'UNKNOWN', verifiedAt: null },
    },
    checkpoint: null,
    handledRuns: [],
    history: [],
    reason: null,
  };
}

export function selectReserve(state: CeoState): CeoProvider | null {
  const previousProvider = state.owner?.provider ?? state.checkpoint?.provider;
  const provider = state.roles.reserve;
  return previousProvider &&
    provider !== previousProvider &&
    state.providers[provider].availability === 'AVAILABLE'
    ? provider
    : null;
}

export function recordCeoEvent(
  state: CeoState,
  at: string,
  event: string,
  provider?: CeoProvider
): void {
  state.history.push({ at, epoch: state.epoch, event, ...(provider ? { provider } : {}) });
  state.history = state.history.slice(-200);
}
