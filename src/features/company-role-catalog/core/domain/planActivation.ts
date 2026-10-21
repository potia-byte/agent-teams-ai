import { CATALOG_PROVIDERS, DEFAULT_CONCURRENCY_CAP, MAX_CONCURRENCY_CAP } from './catalogPolicy';
import { validateCompanyRoleCatalog } from './validateCatalog';

import type {
  ActivationPlan,
  ActivationRequest,
  CatalogProvider,
  CompanyRoleProfile,
  ProviderCapacity,
} from '../../contracts';

function validQuota(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}
function canActivate(capacity: ProviderCapacity | undefined, used: number, added: number): boolean {
  if (!capacity || capacity.configured !== true || capacity.availability !== 'AVAILABLE')
    return false;
  const quota = capacity.quota;
  if (!quota) return true;
  return (
    validQuota(quota.remainingActivations) &&
    validQuota(quota.maxConcurrentRoles) &&
    added < (quota.remainingActivations ?? Infinity) &&
    used < (quota.maxConcurrentRoles ?? Infinity)
  );
}

/** Deterministic recommendation only. Callers must acquire runtime leases before launch.
 * Invalid existing ownership fails closed rather than recommending a second executor.
 * Cap counts retained roles (including CEO); 16 GB baseline defaults to three total.
 */
export function planRoleActivation(
  catalog: readonly CompanyRoleProfile[],
  request: ActivationRequest
): ActivationPlan {
  if (!validateCompanyRoleCatalog(catalog).valid) throw new Error('Invalid company role catalog');
  const requestedCap = request.concurrencyCap ?? DEFAULT_CONCURRENCY_CAP;
  if (!Number.isSafeInteger(requestedCap) || requestedCap < 0)
    throw new RangeError('Invalid concurrency cap');
  const concurrencyCap = Math.min(requestedCap, MAX_CONCURRENCY_CAP);
  const roles = new Map(catalog.map((role) => [role.id, role]));
  const retained = (request.activeExecutors ?? []).map((executor) => ({ ...executor }));
  const assigned = new Set<string>();
  const used: Record<CatalogProvider, number> = { codex: 0, anthropic: 0 };
  const added: Record<CatalogProvider, number> = { codex: 0, anthropic: 0 };
  if (retained.length > concurrencyCap) throw new RangeError('Active roles exceed concurrency cap');
  for (const executor of retained) {
    const role = roles.get(executor.roleId);
    if (
      !role ||
      assigned.has(executor.roleId) ||
      !(CATALOG_PROVIDERS as readonly string[]).includes(executor.provider) ||
      ![role.executors.primary, ...role.executors.reserves].includes(executor.provider)
    ) {
      throw new Error('Invalid or duplicate active role ownership');
    }
    assigned.add(executor.roleId);
    used[executor.provider]++;
  }
  const activations: ActivationPlan['activations'][number][] = [];
  const deferred: ActivationPlan['deferred'][number][] = [];
  const pending = request.tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.status === 'pending')
    .sort((a, b) => (b.task.priority ?? 0) - (a.task.priority ?? 0) || a.index - b.index);
  const taskIds = new Set<string>();
  for (const { task } of pending) {
    if (!task.id.trim() || taskIds.has(task.id) || !Number.isFinite(task.priority ?? 0)) {
      throw new Error('Invalid or duplicate pending task');
    }
    taskIds.add(task.id);
    const defer = (reason: ActivationPlan['deferred'][number]['reason']) =>
      deferred.push({ taskId: task.id, reason });
    const role = roles.get(task.roleId);
    if (!role) {
      defer('unknown-role');
      continue;
    }
    if (
      (role.kind === 'reviewer' || role.kind === 'auditor') &&
      task.producerRoleIds?.includes(role.id)
    ) {
      defer('review-conflict');
      continue;
    }
    if (assigned.has(role.id)) {
      defer('already-active');
      continue;
    }
    if (retained.length + activations.length >= concurrencyCap) {
      defer('concurrency-cap');
      continue;
    }
    const provider = [role.executors.primary, ...role.executors.reserves].find((candidate) =>
      canActivate(request.providers[candidate], used[candidate], added[candidate])
    );
    if (!provider) {
      defer('no-available-executor');
      continue;
    }
    activations.push({ roleId: role.id, provider, taskId: task.id });
    assigned.add(role.id);
    used[provider]++;
    added[provider]++;
  }
  return { concurrencyCap, retained, activations, deferred };
}
