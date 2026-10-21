import {
  CATALOG_CAPABILITIES,
  CATALOG_PROVIDERS,
  INDEPENDENT_ROLE_IDS,
  OWNER_APPROVAL_ACTIONS,
  ROLE_IDS,
} from './catalogPolicy';

import type { CatalogValidationIssue, CatalogValidationResult } from '../../contracts';

const TEXT_LIST_FIELDS = [
  'responsibilities',
  'systemInstructions',
  'requiredTools',
  'memoryRules',
  'inputArtifacts',
  'outputArtifacts',
  'acceptanceCriteria',
  'ceoInteractionRules',
  'activationConditions',
  'deactivationConditions',
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function textList(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(nonempty);
}

/** Detect credential-shaped literals without reading env, auth stores, or files.
 * This is a conservative catalog lint, not a general-purpose secret scanner.
 */
function containsCredential(text: string): boolean {
  return [
    /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/,
    /\b(?:sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_)[a-z\d_-]{12,}/i,
    /\bBearer\s+[a-z\d._~+/-]{12,}/i,
    /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*["']?[^\s"';,]{4,}/i,
    /\b\d{7,}:[a-z\d_-]{25,}/i,
    /\bAKIA[A-Z\d]{16}\b/,
  ].some((pattern) => pattern.test(text));
}

/** Accept unknown so broken bundled data fails with redacted diagnostics, not a crash. */
export function validateCompanyRoleCatalog(input: unknown): CatalogValidationResult {
  const issues: CatalogValidationIssue[] = [];
  const issue = (path: string, code: string) => issues.push({ path, code });
  if (!Array.isArray(input))
    return { valid: false, issues: [{ path: 'catalog', code: 'not-array' }] };
  if (input.length !== ROLE_IDS.length) issue('catalog', 'role-count');
  const seen = new Set<string>();
  input.forEach((value: unknown, index) => {
    const path = `catalog[${index}]`;
    const role = record(value);
    if (!role) {
      issue(path, 'invalid-profile');
      return;
    }
    for (const field of ['id', 'number', 'name', 'department']) {
      if (!nonempty(role[field])) issue(`${path}.${field}`, 'required-text');
    }
    const id = typeof role.id === 'string' ? role.id : '';
    const canonicalIndex = (ROLE_IDS as readonly string[]).indexOf(id);
    if (canonicalIndex < 0 || !/^[a-z]+(?:-[a-z\d]+)*$/.test(id))
      issue(`${path}.id`, 'unknown-role-id');
    if (seen.has(id)) issue(`${path}.id`, 'duplicate-id');
    seen.add(id);
    if (role.number !== String(canonicalIndex + 1).padStart(2, '0'))
      issue(`${path}.number`, 'stable-number');
    if (role.reportsTo !== (id === 'ceo' ? null : 'ceo'))
      issue(`${path}.reportsTo`, 'flat-hierarchy');
    if (!['coordinator', 'producer', 'reviewer', 'auditor'].includes(String(role.kind))) {
      issue(`${path}.kind`, 'invalid-kind');
    }
    if (id === 'ceo' && role.kind !== 'coordinator') issue(`${path}.kind`, 'ceo-coordinator');
    for (const field of TEXT_LIST_FIELDS) {
      if (!textList(role[field])) issue(`${path}.${field}`, 'required-text-list');
    }
    // Scan all profile text, including instruction-like memory and interaction rules.
    const texts = Object.values(role).flatMap((field) =>
      typeof field === 'string' ? [field] : Array.isArray(field) ? field.filter(nonempty) : []
    );
    if (texts.some(containsCredential)) issue(path, 'credential-literal');

    const permissions = record(role.permissions);
    if (!permissions) issue(`${path}.permissions`, 'required-permissions');
    else {
      if (
        !textList(permissions.allowed) ||
        permissions.allowed.some(
          (action) => !(CATALOG_CAPABILITIES as readonly string[]).includes(action)
        )
      )
        issue(`${path}.permissions.allowed`, 'unsafe-capability');
      if (
        !textList(permissions.requiresOwnerApproval) ||
        OWNER_APPROVAL_ACTIONS.some(
          (action) => !(permissions.requiresOwnerApproval as unknown[]).includes(action)
        ) ||
        permissions.requiresOwnerApproval.some(
          (action) => !(OWNER_APPROVAL_ACTIONS as readonly string[]).includes(action)
        )
      )
        issue(`${path}.permissions.requiresOwnerApproval`, 'owner-approval-required');
      if (!textList(permissions.prohibited))
        issue(`${path}.permissions.prohibited`, 'required-text-list');
    }
    const executors = record(role.executors);
    if (!executors) issue(`${path}.executors`, 'required-executors');
    else {
      const known = (provider: unknown) =>
        (CATALOG_PROVIDERS as readonly unknown[]).includes(provider);
      if (
        !known(executors.primary) ||
        !textList(executors.reserves) ||
        !executors.reserves.every(known)
      ) {
        issue(`${path}.executors`, 'unknown-provider');
      } else if (
        new Set([executors.primary, ...executors.reserves]).size !==
        executors.reserves.length + 1
      ) {
        issue(`${path}.executors`, 'duplicate-executor');
      }
      if (
        id === 'ceo' &&
        (executors.primary !== 'codex' ||
          !Array.isArray(executors.reserves) ||
          executors.reserves.length !== 1 ||
          executors.reserves[0] !== 'anthropic')
      ) {
        issue(`${path}.executors`, 'ceo-executors');
      }
    }
    const independent = role.kind === 'reviewer' || role.kind === 'auditor';
    if ((INDEPENDENT_ROLE_IDS as readonly string[]).includes(id) && !independent) {
      issue(`${path}.kind`, 'independence-required');
    }
    if (!textList(role.checksRoles, !independent))
      issue(`${path}.checksRoles`, 'review-targets-required');
    else if (
      role.checksRoles.some(
        (target) => target === id || !(ROLE_IDS as readonly string[]).includes(target)
      )
    ) {
      issue(`${path}.checksRoles`, 'review-conflict');
    } else if (!independent && role.checksRoles.length > 0)
      issue(`${path}.checksRoles`, 'independence-required');
  });
  if (ROLE_IDS.some((id) => !seen.has(id))) issue('catalog', 'missing-role');
  return { valid: issues.length === 0, issues };
}
