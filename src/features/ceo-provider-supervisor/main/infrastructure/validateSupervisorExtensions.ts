import { emptyProviderHealth } from '../../core/domain/providerRegistry';

import type { CeoState } from '../../contracts';

const validCount = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;
const validTime = (value: unknown): boolean =>
  value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));

/** Additive v1 migration only supplies absent fields; malformed data fails closed. */
export function validateSupervisorExtensions(state: CeoState): void {
  if (!Object.hasOwn(state.providers, 'opencode')) state.providers.opencode = emptyProviderHealth();
  for (const provider of ['anthropic', 'codex', 'opencode'] as const) {
    const health = state.providers[provider];
    if (!health || typeof health !== 'object') throw new Error('Invalid CEO registry');
    const defaults = emptyProviderHealth();
    for (const key of [
      'cooldownUntil',
      'lastProbeAt',
      'probeDay',
      'consecutiveFailures',
      'totalFailures',
      'probesToday',
      'probeFailures',
    ] as const) {
      if (!Object.hasOwn(health, key)) Object.assign(health, { [key]: defaults[key] });
    }
    if (
      !['AVAILABLE', 'BUSY', 'RATE_LIMITED', 'AUTH_REQUIRED', 'UNAVAILABLE', 'UNKNOWN'].includes(
        health.availability
      ) ||
      !validTime(health.verifiedAt) ||
      !validTime(health.cooldownUntil) ||
      !validTime(health.lastProbeAt) ||
      !(
        health.probeDay === null ||
        (typeof health.probeDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(health.probeDay))
      ) ||
      ![
        health.consecutiveFailures,
        health.totalFailures,
        health.probesToday,
        health.probeFailures,
      ].every(validCount)
    )
      throw new Error('Invalid CEO registry');
  }
  if (!Object.hasOwn(state, 'tasks')) state.tasks = [];
  if (!Array.isArray(state.tasks)) throw new Error('Invalid CEO task queue');
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const task of state.tasks) {
    if (
      !task ||
      typeof task !== 'object' ||
      typeof task.id !== 'string' ||
      !task.id.trim() ||
      typeof task.idempotencyKey !== 'string' ||
      !task.idempotencyKey.trim() ||
      ids.has(task.id) ||
      keys.has(task.idempotencyKey) ||
      !['pending', 'running', 'blocked', 'done'].includes(task.state) ||
      !['llm', 'non_llm'].includes(task.kind) ||
      !validCount(task.attempts) ||
      !(task.lastSafeCheckpointId === null || typeof task.lastSafeCheckpointId === 'string') ||
      !(task.provider === null || ['anthropic', 'codex'].includes(task.provider)) ||
      (task.kind === 'non_llm' && task.provider !== null) ||
      (task.state === 'running' && task.kind === 'llm' && task.provider === null) ||
      (task.state === 'blocked'
        ? task.blockReason !== 'reconciliation_required'
        : task.blockReason !== null)
    )
      throw new Error('Invalid CEO task queue');
    ids.add(task.id);
    keys.add(task.idempotencyKey);
  }
}
