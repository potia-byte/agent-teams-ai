import { z } from 'zod';

import { financeReport } from './finance';
import { validatePublicationHistory, validateTaskHistory } from './journalPolicy';
import { assertMayPublish, operationIdFor } from './publication';
import {
  approvalRequest,
  contact,
  currency,
  ledgerEntry,
  metricSnapshot,
  productionTask,
  publicationRecord,
  text,
} from './validation';

import type { MediaOperationsState } from '../../contracts';

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ownerId: text,
  currency,
  publications: z.array(publicationRecord),
  approvals: z.array(approvalRequest),
  contacts: z.array(contact),
  ledger: z.array(ledgerEntry),
  metrics: z.array(metricSnapshot),
  tasks: z.array(productionTask),
});

export function emptyMediaState(ownerId: string, currencyCode: string): MediaOperationsState {
  return stateSchema.parse({
    schemaVersion: 1,
    ownerId,
    currency: currencyCode,
    publications: [],
    approvals: [],
    contacts: [],
    ledger: [],
    metrics: [],
    tasks: [],
  });
}

function unique(values: string[]): void {
  if (new Set(values).size !== values.length) throw new Error('Duplicate persisted key');
}

export function validateMediaState(value: unknown): asserts value is MediaOperationsState {
  const state = stateSchema.parse(value);
  unique(state.publications.map((item) => item.operationId));
  unique(state.approvals.map((item) => item.id));
  unique(state.contacts.map((item) => item.id));
  unique(state.ledger.map((item) => item.id));
  unique(state.metrics.map((item) => item.id));
  unique(state.tasks.map((item) => item.key));
  financeReport(state.ledger, state.currency);
  for (const request of state.approvals) {
    if (
      request.createdAt + request.ttl !== request.expiresAt ||
      (request.type === 'publication') !== (request.operationId !== null) ||
      (request.type === 'publication' &&
        !state.publications.some((item) => item.operationId === request.operationId)) ||
      (['approved', 'rejected'].includes(request.status) &&
        (request.decidedAt === null ||
          request.decidedAt < request.createdAt ||
          request.decidedAt >= request.expiresAt))
    )
      throw new Error('Invalid approval scope or decision');
  }
  const videos = new Map<string, string>();
  const niches = new Map<string, string[]>();
  for (const record of state.publications) {
    validatePublicationHistory(record);
    const previousNiche = videos.get(record.videoId);
    if (previousNiche && previousNiche !== record.nicheId)
      throw new Error('Video niche cannot change');
    videos.set(record.videoId, record.nicheId);
    const niche = niches.get(record.nicheId) ?? [];
    if (!niche.includes(record.videoId)) niche.push(record.videoId);
    niches.set(record.nicheId, niche);
    const last = record.history.at(-1)!;
    if (
      record.operationId !== operationIdFor(record) ||
      last.state !== record.state ||
      record.nicheVideoOrdinal !== niche.indexOf(record.videoId) + 1 ||
      (record.state === 'published') !== (record.result !== null) ||
      (['publishing', 'published', 'failed_known', 'outcome_unknown'].includes(record.state) &&
        record.attempts === 0)
    )
      throw new Error('Invalid publication identity or state');
    if (record.approval) {
      const request = state.approvals.find((item) => item.id === record.approval?.id);
      if (
        !request ||
        request.status !== 'approved' ||
        request.type !== 'publication' ||
        request.operationId !== record.operationId ||
        record.approval.operationId !== record.operationId ||
        request.ttl !== record.approval.ttl ||
        request.actionText !== record.approval.scopeText ||
        request.decidedAt !== record.approval.decidedAt ||
        request.expiresAt !== record.approval.expiresAt
      )
        throw new Error('Invalid publication approval');
    }
    if (record.state === 'publishing')
      assertMayPublish(state, { ...record, state: 'approved' }, last.at);
    if (record.state === 'approved' && !record.approval) throw new Error('Missing approval');
  }
  for (const task of state.tasks) {
    validateTaskHistory(task);
    if (task.pipeline) {
      const pipeline = task.pipeline;
      const current = pipeline.stages.find((stage) => stage.status !== 'completed');
      if (
        task.stage !== (current?.id ?? 'publication_queue') ||
        (task.state === 'completed') !== !current ||
        (task.state === 'blocked') !== (current?.status === 'blocked')
      )
        throw new Error('Invalid production task projection');
      for (const stage of pipeline.stages) {
        if (
          stage.status === 'completed' &&
          stage.id !== 'owner_approval' &&
          !stage.artifacts.length
        )
          throw new Error('Completed production stage requires evidence');
        if (
          stage.id === 'qa' &&
          stage.status === 'completed' &&
          (!stage.artifacts[0]?.qa || stage.artifacts[0].qa.verdict === 'BLOCK')
        )
          throw new Error('Completed QA must pass');
      }
      if (
        pipeline.operationId &&
        !state.publications.some(
          (record) => record.operationId === pipeline.operationId && record.videoId === task.videoId
        )
      )
        throw new Error('Invalid production publication reference');
      if (
        pipeline.approvalId &&
        !state.approvals.some(
          (request) =>
            request.id === pipeline.approvalId && request.operationId === pipeline.operationId
        )
      )
        throw new Error('Invalid production approval reference');
      for (let index = 1; index < pipeline.history.length; index++) {
        if (pipeline.history[index].at < pipeline.history[index - 1].at)
          throw new Error('Production journal clock moved backwards');
      }
    }
  }
}
