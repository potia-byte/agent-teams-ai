export type PublicationState =
  | 'draft'
  | 'awaiting_qa'
  | 'awaiting_owner_approval'
  | 'approved'
  | 'publishing'
  | 'published'
  | 'failed_known'
  | 'outcome_unknown'
  | 'cancelled';

export interface PublicationInput {
  videoId: string;
  platform: string;
  channelId: string | null;
  version: number;
  nicheId: string;
}

export interface QaVerdict {
  verdict: 'PASS' | 'PASS_WITH_NOTES' | 'BLOCK';
  unverifiedCriteria: string[];
}

export interface PublicationResult {
  externalId: string;
  url: string;
  at: number;
}

export interface PublicationApproval {
  id: string;
  operationId: string;
  ttl: number;
  scopeText: string;
  expiresAt: number;
  decidedAt: number;
}

export interface PublicationRecord extends PublicationInput {
  operationId: string;
  nicheVideoOrdinal: number;
  state: PublicationState;
  qaVerdict: QaVerdict | null;
  approval: PublicationApproval | null;
  result: PublicationResult | null;
  attempts: number;
  history: { state: PublicationState; at: number; detail: string; evidenceRef: string | null }[];
}

export interface ApprovalRequest {
  id: string;
  type: 'publication' | 'spending' | 'contract';
  operationId: string | null;
  actionText: string;
  createdAt: number;
  ttl: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded';
  decidedAt: number | null;
  delivery: 'pending' | 'sent';
}

export type LeadStatus = 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export interface Contact {
  id: string;
  name: string;
  source: string;
  status: LeadStatus;
  dealProbability: number | null;
  probabilitySource: 'manual';
  followUpDueAt: number | null;
  interactions: { at: number; text: string; recordedBy: string }[];
}

export type LedgerKind = 'forecast' | 'accrued' | 'received' | 'expense';
export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  /** Integer minor currency units; one currency per repository. */
  amount: number;
  currency: string;
  recordedBy: string;
  at: number;
  evidenceRef: string | null;
  platformConfirmationRef: string | null;
  audited: boolean;
  auditedBy: string | null;
  auditedAt: number | null;
}

export interface FinanceReport {
  currency: string;
  forecast: number;
  accrued: number;
  received: number;
  expense: number;
  netProfit: number;
  zeroRevenue: boolean;
}

export interface MetricSnapshot {
  id: string;
  videoId: string;
  source: string;
  collectedAt: number;
  views: number | null;
  /** Percentage, 0 through 100; null means unmeasured. */
  retention: number | null;
  likes: number | null;
  subscribers: number | null;
  /** Minor units in the repository currency; never used as ledger receipts. */
  revenue: number | null;
}

export type ProductionTaskState = 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export interface ProductionTask {
  key: string;
  videoId: string;
  stage: string;
  state: ProductionTaskState;
  artifacts: string[];
  history: { state: ProductionTaskState; at: number; detail: string }[];
}

export interface MediaOperationsState {
  schemaVersion: 1;
  ownerId: string;
  currency: string;
  publications: PublicationRecord[];
  approvals: ApprovalRequest[];
  contacts: Contact[];
  ledger: LedgerEntry[];
  metrics: MetricSnapshot[];
  tasks: ProductionTask[];
}
