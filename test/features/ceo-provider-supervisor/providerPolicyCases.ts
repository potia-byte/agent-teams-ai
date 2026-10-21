import assert from 'node:assert/strict';

import { classifyFailure } from '../../../src/features/ceo-provider-supervisor/core/domain/failureClassifier';
import {
  emptyCeoState,
  selectReserve,
} from '../../../src/features/ceo-provider-supervisor/core/domain/policy';
import {
  probeBackoff,
  probeDecision,
  reserveProbe,
} from '../../../src/features/ceo-provider-supervisor/core/domain/probePolicy';
import {
  isSelectableProvider,
  PROVIDER_CATALOG,
} from '../../../src/features/ceo-provider-supervisor/core/domain/providerRegistry';

import { quota } from './supervisorCases';

import type { ClassifiedFailure } from '../../../src/features/ceo-provider-supervisor/core/domain/failureClassifier';
import type { CeoFailure } from '../../../src/features/ceo-provider-supervisor/core/domain/policy';

const at = '2026-10-21T12:00:00.000Z';
const later = (ms: number) => new Date(Date.parse(at) + ms).toISOString();
const policy = { minIntervalMs: 100, backoffMs: 200, maxBackoffMs: 800, maxProbesPerDay: 3 };

export function registerProviderPolicyCases(
  test: (name: string, body: () => void | Promise<void>) => unknown
): void {
  const cases: Array<[string, Partial<CeoFailure>, ClassifiedFailure]> = [
    ['Codex confirmed quota', {}, { kind: 'QUOTA_CONFIRMED', action: 'switch' }],
    [
      'Claude confirmed quota',
      { providerId: 'anthropic', detail: "You've hit your limit" },
      { kind: 'QUOTA_CONFIRMED', action: 'switch' },
    ],
    [
      'generic 429',
      { detail: 'Too Many Requests' },
      { kind: 'RATE_LIMIT_TRANSIENT', action: 'wait-and-retry' },
    ],
    [
      'retry-after',
      { detail: 'retry-after: 10', statusCode: undefined },
      { kind: 'RATE_LIMIT_TRANSIENT', action: 'wait-and-retry' },
    ],
    [
      'retry-after field',
      { detail: '', statusCode: 503, retryAfterMs: 1000 },
      { kind: 'RATE_LIMIT_TRANSIENT', action: 'wait-and-retry' },
    ],
    [
      'SDK retry quota is not terminal',
      { phase: 'sdk_retrying' },
      { kind: 'RATE_LIMIT_TRANSIENT', action: 'wait-and-retry' },
    ],
    [
      'API backend cannot confirm subscription quota',
      { providerBackendId: 'paid-api' },
      { kind: 'RATE_LIMIT_TRANSIENT', action: 'wait-and-retry' },
    ],
    [
      'network reset',
      { detail: 'ECONNRESET', statusCode: undefined },
      { kind: 'NETWORK', action: 'wait-and-retry' },
    ],
    [
      'DNS',
      { detail: 'ENOTFOUND', statusCode: undefined },
      { kind: 'NETWORK', action: 'wait-and-retry' },
    ],
    [
      'auth code',
      { detail: 'denied', statusCode: 401 },
      { kind: 'AUTH_REQUIRED', action: 'block' },
    ],
    [
      'auth text',
      { detail: 'Not logged in', statusCode: undefined },
      { kind: 'AUTH_REQUIRED', action: 'block' },
    ],
    [
      'tool failure',
      { detail: 'tool execution failed', statusCode: undefined },
      { kind: 'TOOL_ERROR', action: 'block' },
    ],
    [
      'timeout',
      { detail: 'ETIMEDOUT', statusCode: undefined },
      { kind: 'HANG/TIMEOUT', action: 'block' },
    ],
    [
      'hang',
      { detail: 'process hung', statusCode: undefined },
      { kind: 'HANG/TIMEOUT', action: 'block' },
    ],
    [
      'unknown',
      { detail: 'something unexpected', statusCode: undefined },
      { kind: 'UNKNOWN_FAILURE', action: 'ignore' },
    ],
    [
      'ambiguous quota',
      { detail: 'insufficient_quota', statusCode: undefined },
      { kind: 'UNKNOWN_FAILURE', action: 'ignore' },
    ],
  ];
  for (const [label, input, expected] of cases) {
    test('failure classifier: ' + label, () => {
      const raw = { ...quota, ...input };
      const before = structuredClone(raw);
      assert.deepEqual(classifyFailure(raw), expected);
      assert.deepEqual(raw, before, 'classification is pure');
      assert.equal(expected.action === 'switch', expected.kind === 'QUOTA_CONFIRMED');
    });
  }

  test('registry lists OpenCode as research-only and never selects UNKNOWN or a busy owner', () => {
    const state = emptyCeoState('sandbox', 'test');
    assert.equal(PROVIDER_CATALOG.opencode.usage, 'research-only');
    assert.equal(isSelectableProvider(state, 'codex', at), false);
    state.providers.opencode.availability = 'AVAILABLE';
    assert.equal(isSelectableProvider(state, 'opencode', at), false);
    state.owner = { provider: 'codex', runId: 'run', role: 'primary' };
    state.providers.codex.availability = 'AVAILABLE';
    assert.equal(isSelectableProvider(state, 'codex', at), false);
    assert.equal(selectReserve(state, at), null);
    state.providers.anthropic.availability = 'AVAILABLE';
    state.providers.anthropic.cooldownUntil = later(1000);
    assert.equal(selectReserve(state, at), null);
    assert.equal(selectReserve(state, later(1000)), 'anthropic');
    for (const availability of [
      'UNKNOWN',
      'BUSY',
      'RATE_LIMITED',
      'AUTH_REQUIRED',
      'UNAVAILABLE',
    ] as const) {
      state.providers.anthropic.availability = availability;
      assert.equal(selectReserve(state, later(1000)), null);
    }
  });

  test('probe scheduler enforces minimum interval, exponential backoff and cap', () => {
    const state = emptyCeoState('sandbox', 'test');
    const health = state.providers.codex;
    assert.equal(probeDecision(state, 'codex', at, policy).allowed, true);
    reserveProbe(health, at);
    assert.equal(probeDecision(state, 'codex', later(199), policy).allowed, false);
    assert.equal(probeDecision(state, 'codex', later(200), policy).allowed, true);
    reserveProbe(health, later(200));
    assert.equal(probeDecision(state, 'codex', later(599), policy).allowed, false);
    assert.equal(probeDecision(state, 'codex', later(600), policy).allowed, true);
    assert.deepEqual(
      [1, 2, 3, 4, 40].map((count) => probeBackoff(count, policy)),
      [200, 400, 800, 800, 800]
    );
    health.probeFailures = 0;
    assert.equal(probeDecision(state, 'codex', later(299), policy).allowed, false);
    assert.equal(probeDecision(state, 'codex', later(300), policy).allowed, true);
  });

  test('probe scheduler budgets per provider per UTC day, retains backoff at midnight', () => {
    const state = emptyCeoState('sandbox', 'test');
    const health = state.providers.codex;
    reserveProbe(health, at);
    reserveProbe(health, later(200));
    reserveProbe(health, later(600));
    assert.equal(probeDecision(state, 'codex', later(2000), policy).reason, 'daily_limit');
    assert.equal(probeDecision(state, 'anthropic', later(2000), policy).allowed, true);
    const tomorrow = '2026-10-22T00:00:00.000Z';
    assert.equal(probeDecision(state, 'codex', tomorrow, policy).allowed, true);
    reserveProbe(health, tomorrow);
    assert.equal(health.probesToday, 1);
    health.lastProbeAt = '2026-10-22T23:59:59.999Z';
    assert.equal(probeDecision(state, 'codex', '2026-10-23T00:00:00.000Z', policy).allowed, false);
  });

  test('both rate limited providers stay quiet until the shared backoff/cooldown expires', () => {
    const state = emptyCeoState('sandbox', 'test');
    for (const health of [state.providers.codex, state.providers.anthropic]) {
      health.availability = 'RATE_LIMITED';
      health.verifiedAt = at;
    }
    state.providers.anthropic.cooldownUntil = later(1000);
    assert.equal(
      probeDecision(state, 'codex', later(999), policy).reason,
      'both_rate_limited_backoff'
    );
    assert.equal(probeDecision(state, 'codex', later(1000), policy).allowed, true);
    assert.equal(probeDecision(state, 'anthropic', later(1000), policy).allowed, true);
  });

  test('probe scheduler rejects busy owners even with stale health, and invalid clocks', () => {
    const state = emptyCeoState('sandbox', 'test');
    state.owner = { provider: 'codex', runId: 'run', role: 'primary' };
    assert.equal(probeDecision(state, 'codex', at, policy).reason, 'busy_owner');
    state.owner = null;
    state.providers.codex.availability = 'BUSY';
    assert.equal(probeDecision(state, 'codex', at, policy).reason, 'busy_owner');
    assert.equal(probeDecision(state, 'anthropic', 'invalid', policy).allowed, false);
    assert.equal(probeDecision(state, 'anthropic', at, { ...policy, backoffMs: 0 }).allowed, false);
  });

  test('an inconclusive probe does not starve the other limited provider after shared cooldown', () => {
    const state = emptyCeoState('sandbox', 'test');
    for (const health of [state.providers.codex, state.providers.anthropic]) {
      health.availability = 'RATE_LIMITED';
      health.verifiedAt = at;
    }
    reserveProbe(state.providers.codex, later(200));
    assert.equal(probeDecision(state, 'codex', later(200), policy).allowed, false);
    assert.equal(probeDecision(state, 'anthropic', later(200), policy).allowed, true);
  });
}
