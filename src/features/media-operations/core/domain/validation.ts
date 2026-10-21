import { z } from 'zod';

import { productionPipelineSchema } from './production';

export const text = z
  .string()
  .min(1)
  .max(8_000)
  .refine((value) => value.trim() === value, 'Text must not have surrounding whitespace');
export const timestamp = z.number().int().nonnegative().safe();
export const money = z.number().int().nonnegative().safe();
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const publicationState = z.enum([
  'draft',
  'awaiting_qa',
  'awaiting_owner_approval',
  'approved',
  'publishing',
  'published',
  'failed_known',
  'outcome_unknown',
  'cancelled',
]);
export const publicationInput = z.strictObject({
  videoId: text,
  platform: text,
  channelId: text.nullable(),
  version: z.number().int().positive().safe(),
  nicheId: text,
});
export const qaVerdict = z
  .strictObject({
    verdict: z.enum(['PASS', 'PASS_WITH_NOTES', 'BLOCK']),
    unverifiedCriteria: z.array(text),
  })
  .refine(
    (qa) => qa.verdict !== 'PASS' || qa.unverifiedCriteria.length === 0,
    'Unverified criteria require PASS_WITH_NOTES or BLOCK'
  );
export const publicationResult = z.strictObject({
  externalId: text,
  url: z.url().refine((url) => /^https?:\/\//.test(url)),
  at: timestamp,
});
export const publicationApproval = z.strictObject({
  id: requestId,
  operationId: text,
  ttl: timestamp.positive(),
  scopeText: text,
  expiresAt: timestamp,
  decidedAt: timestamp,
});
export const publicationRecord = publicationInput.extend({
  operationId: text,
  nicheVideoOrdinal: timestamp.positive(),
  state: publicationState,
  qaVerdict: qaVerdict.nullable(),
  approval: publicationApproval.nullable(),
  result: publicationResult.nullable(),
  attempts: timestamp,
  history: z
    .array(
      z.strictObject({
        state: publicationState,
        at: timestamp,
        detail: text,
        evidenceRef: text.nullable(),
      })
    )
    .min(1),
});
export const approvalRequest = z.strictObject({
  id: requestId,
  type: z.enum(['publication', 'spending', 'contract']),
  operationId: text.nullable(),
  actionText: text,
  createdAt: timestamp,
  ttl: timestamp.positive(),
  expiresAt: timestamp,
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'superseded']),
  decidedAt: timestamp.nullable(),
  delivery: z.enum(['pending', 'sent']),
});
export const leadStatus = z.enum(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']);
export const contact = z.strictObject({
  id: text,
  name: text,
  source: text,
  status: leadStatus,
  dealProbability: z.number().min(0).max(1).nullable(),
  probabilitySource: z.literal('manual'),
  followUpDueAt: timestamp.nullable(),
  interactions: z.array(z.strictObject({ at: timestamp, text, recordedBy: text })),
});
export const ledgerEntry = z
  .strictObject({
    id: text,
    kind: z.enum(['forecast', 'accrued', 'received', 'expense']),
    amount: money,
    currency,
    recordedBy: text,
    at: timestamp,
    evidenceRef: text.nullable(),
    platformConfirmationRef: text.nullable(),
    audited: z.boolean(),
    auditedBy: text.nullable(),
    auditedAt: timestamp.nullable(),
  })
  .superRefine((entry, ctx) => {
    if (entry.kind === 'received' && !entry.evidenceRef)
      ctx.addIssue({ code: 'custom', message: 'Receipt requires evidence' });
    if (entry.kind === 'accrued' && !entry.platformConfirmationRef)
      ctx.addIssue({ code: 'custom', message: 'Accrual requires platform confirmation' });
    if (
      entry.audited !== (entry.auditedBy !== null && entry.auditedAt !== null) ||
      (!entry.audited && (entry.auditedBy !== null || entry.auditedAt !== null)) ||
      entry.auditedBy === entry.recordedBy
    )
      ctx.addIssue({ code: 'custom', message: 'Audit requires an independent auditor' });
  });
const count = timestamp.nullable();
export const metricSnapshot = z.strictObject({
  id: text,
  videoId: text,
  source: text,
  collectedAt: timestamp,
  views: count,
  retention: z.number().min(0).max(100).nullable(),
  likes: count,
  subscribers: count,
  revenue: money.nullable(),
});
export const taskState = z.enum(['planned', 'in_progress', 'blocked', 'completed', 'cancelled']);
export const productionTask = z.strictObject({
  pipeline: productionPipelineSchema.optional(),
  key: text,
  videoId: text,
  stage: text,
  state: taskState,
  artifacts: z.array(text),
  history: z.array(z.strictObject({ state: taskState, at: timestamp, detail: text })).min(1),
});
