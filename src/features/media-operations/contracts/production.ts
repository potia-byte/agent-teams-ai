import type {
  ApprovalRequest,
  Contact,
  FinanceReport,
  MetricSnapshot,
  ProductionTask,
  PublicationRecord,
  QaVerdict,
} from './index';
import type { ActivationPlan } from '@features/company-role-catalog/contracts';

export const PRODUCTION_STAGES = [
  'research',
  'script',
  'fact_check',
  'visual_plan',
  'licenses',
  'voice',
  'render',
  'qa',
  'owner_approval',
  'publication_queue',
] as const;
export type ProductionStageId = (typeof PRODUCTION_STAGES)[number];
export interface VerifiedArtifact {
  path: string;
  kind: 'file' | 'directory';
  fingerprint: string;
  verifiedAt: number;
  video: { width: number; height: number; duration: number; audio: boolean } | null;
  qa: QaVerdict | null;
}
export interface ProductionStage {
  id: ProductionStageId;
  executor: 'attach_artifact' | 'qa_gate' | 'owner_approval' | 'enqueue_publication';
  status: 'pending' | 'ready' | 'waiting' | 'blocked' | 'completed';
  requiredRoleIds: string[];
  selection: ActivationPlan | null;
  selectionReason: string;
  artifacts: VerifiedArtifact[];
  detail: string;
}
export interface ProductionPipeline {
  template: 'short-video-v1';
  title: string;
  teamName: string | null;
  nicheId: string;
  channelId: string | null;
  stages: ProductionStage[];
  approvalId: string | null;
  operationId: string | null;
  history: { at: number; stage: ProductionStageId; detail: string }[];
}
export interface CreateProductionTask {
  key: string;
  title: string;
  template: 'short-video-v1';
  nicheId: string;
  teamName: string | null;
  channelId: string | null;
}
export interface StageCommand {
  key: string;
  stage: ProductionStageId;
}
export interface ProductionDetail {
  task: ProductionTask;
  suggestions: { stage: ProductionStageId; path: string }[];
  approval: ApprovalRequest | null;
  publication: PublicationRecord | null;
}
export interface ProductionSummary {
  productionRoot: string;
  finance: FinanceReport;
  contacts: Contact[];
  metrics: MetricSnapshot[];
  publications: PublicationRecord[];
}
export interface MediaProductionApi {
  list(): Promise<ProductionTask[]>;
  create(input: CreateProductionTask): Promise<ProductionTask>;
  get(key: string): Promise<ProductionDetail>;
  attach(input: StageCommand & { path: string }): Promise<ProductionTask>;
  advance(input: StageCommand): Promise<ProductionTask>;
  decide(input: {
    key: string;
    approvalId: string;
    decision: 'approve' | 'reject';
  }): Promise<ProductionTask>;
  summary(): Promise<ProductionSummary>;
}
export const MEDIA_PRODUCTION_CHANNELS = {
  list: 'media-production:list',
  create: 'media-production:create',
  get: 'media-production:get',
  attach: 'media-production:attach',
  advance: 'media-production:advance',
  decide: 'media-production:decide',
  summary: 'media-production:summary',
} as const;
