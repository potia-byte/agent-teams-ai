/** Catalog identities describe employees, never provider sessions or physical teammates. */
export type CatalogProvider = 'codex' | 'anthropic';
export type ProviderAvailability =
  | 'AVAILABLE'
  | 'BUSY'
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export type OwnerApprovalAction =
  | 'publish-content'
  | 'sensitive-content'
  | 'spend-money'
  | 'financial-transaction'
  | 'sign-contract'
  | 'send-commercial-message'
  | 'change-channel-access'
  | 'install-dependency'
  | 'expand-permissions'
  | 'deploy-production';

/** These are scoped capabilities, not tool credentials or executable grants. */
export type CatalogCapability =
  | 'read-assigned-artifacts'
  | 'write-own-drafts'
  | 'read-public-sources'
  | 'read-redacted-metrics'
  | 'read-redacted-ledger'
  | 'read-redacted-crm'
  | 'run-local-media-tools'
  | 'edit-sandbox-code'
  | 'run-sandbox-tests'
  | 'write-review-findings'
  | 'block-release';

export interface CompanyRoleProfile {
  readonly id: string;
  /** Original section 5 numbering, including leading zero. */
  readonly number: string;
  readonly name: string;
  /** File grouping only; never a management layer. */
  readonly department: string;
  readonly reportsTo: 'ceo' | null;
  readonly kind: 'coordinator' | 'producer' | 'reviewer' | 'auditor';
  readonly responsibilities: readonly string[];
  readonly systemInstructions: readonly string[];
  readonly requiredTools: readonly string[];
  readonly permissions: {
    readonly allowed: readonly CatalogCapability[];
    readonly requiresOwnerApproval: readonly OwnerApprovalAction[];
    readonly prohibited: readonly string[];
  };
  readonly executors: {
    readonly primary: CatalogProvider;
    readonly reserves: readonly CatalogProvider[];
  };
  readonly memoryRules: readonly string[];
  readonly inputArtifacts: readonly string[];
  readonly outputArtifacts: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly ceoInteractionRules: readonly string[];
  readonly activationConditions: readonly string[];
  readonly deactivationConditions: readonly string[];
  /** Logical producers this independent role may check; empty for producers. */
  readonly checksRoles: readonly string[];
}

export interface CatalogValidationIssue {
  readonly path: string;
  readonly code: string;
}
export interface CatalogValidationResult {
  readonly valid: boolean;
  /** Never contains input values, so diagnostics cannot echo credentials. */
  readonly issues: readonly CatalogValidationIssue[];
}

export interface RoleTask {
  readonly id: string;
  readonly roleId: string;
  readonly status: 'pending' | 'running' | 'blocked' | 'completed';
  /** Larger values go first; equal priorities preserve input order. */
  readonly priority?: number;
  readonly producerRoleIds?: readonly string[];
}
export interface ProviderCapacity {
  readonly configured: boolean;
  readonly availability: ProviderAvailability;
  readonly quota?: {
    /** Number of NEW role activations allowed in this planning batch. */
    readonly remainingActivations?: number;
    /** Total simultaneous roles, including retained executors. */
    readonly maxConcurrentRoles?: number;
  };
}
export interface RoleExecutor {
  readonly roleId: string;
  readonly provider: CatalogProvider;
}
export interface ActivationRequest {
  readonly tasks: readonly RoleTask[];
  readonly concurrencyCap?: number;
  readonly providers: Readonly<Partial<Record<CatalogProvider, ProviderCapacity>>>;
  /** Includes the CEO if it is already running. Never interrupt or replace these. */
  readonly activeExecutors?: readonly RoleExecutor[];
}
export type DeferralReason =
  | 'unknown-role'
  | 'review-conflict'
  | 'already-active'
  | 'concurrency-cap'
  | 'no-available-executor';
export interface ActivationPlan {
  readonly concurrencyCap: number;
  readonly retained: readonly RoleExecutor[];
  readonly activations: readonly (RoleExecutor & { readonly taskId: string })[];
  readonly deferred: readonly { readonly taskId: string; readonly reason: DeferralReason }[];
}

/** Read-only data and recommendations: no launches, approvals, IPC or persistence. */
export interface CompanyRoleCatalogApi {
  list(): readonly CompanyRoleProfile[];
  get(id: string): CompanyRoleProfile | undefined;
  plan(request: ActivationRequest): ActivationPlan;
}
