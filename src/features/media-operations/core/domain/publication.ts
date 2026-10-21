import { publicationInput, qaVerdict, timestamp } from './validation';

import type {
  MediaOperationsState,
  PublicationInput,
  PublicationRecord,
  PublicationState,
} from '../../contracts';

export function operationIdFor(input: PublicationInput): string {
  const value = publicationInput.parse({
    videoId: input.videoId,
    platform: input.platform,
    channelId: input.channelId,
    version: input.version,
    nicheId: input.nicheId,
  });
  return `publication:${JSON.stringify([value.videoId, value.platform, value.channelId, value.version])}`;
}

export function createPublication(
  state: MediaOperationsState,
  input: PublicationInput,
  at: number
): PublicationRecord {
  const value = publicationInput.parse(input);
  timestamp.parse(at);
  const nicheVideos = [
    ...new Set(
      state.publications
        .filter((item) => item.nicheId === value.nicheId)
        .map((item) => item.videoId)
    ),
  ];
  const ordinal = nicheVideos.indexOf(value.videoId);
  return {
    ...value,
    operationId: operationIdFor(value),
    nicheVideoOrdinal: ordinal === -1 ? nicheVideos.length + 1 : ordinal + 1,
    state: 'draft',
    qaVerdict: null,
    approval: null,
    result: null,
    attempts: 0,
    history: [{ state: 'draft', at, detail: 'Enqueued', evidenceRef: null }],
  };
}

export function transition(
  record: PublicationRecord,
  state: PublicationState,
  at: number,
  detail: string,
  evidenceRef: string | null = null
): PublicationRecord {
  return { ...record, state, history: [...record.history, { state, at, detail, evidenceRef }] };
}

export function qaAllowsPublication(record: PublicationRecord): boolean {
  return (
    record.qaVerdict !== null &&
    qaVerdict.safeParse(record.qaVerdict).success &&
    ['PASS', 'PASS_WITH_NOTES'].includes(record.qaVerdict.verdict)
  );
}

/** All videos require explicit approval; the first three niche videos have no bypass. */
export function assertMayPublish(
  state: MediaOperationsState,
  record: PublicationRecord,
  at: number
): void {
  timestamp.parse(at);
  if (record.state !== 'approved') throw new Error(`Cannot publish from ${record.state}`);
  if (!qaAllowsPublication(record)) throw new Error('QA does not allow publication');
  const approval = record.approval;
  const request = state.approvals.find((item) => item.id === approval?.id);
  if (
    !approval ||
    approval.operationId !== record.operationId ||
    approval.expiresAt <= at ||
    approval.decidedAt > at ||
    !request ||
    request.type !== 'publication' ||
    request.status !== 'approved' ||
    request.operationId !== record.operationId ||
    request.expiresAt !== approval.expiresAt ||
    request.actionText !== approval.scopeText ||
    request.decidedAt !== approval.decidedAt ||
    request.createdAt > approval.decidedAt
  )
    throw new Error('Unexpired explicit owner approval for this operation is required');
}

export function findPublication(
  state: MediaOperationsState,
  operationId: string
): PublicationRecord {
  const record = state.publications.find((item) => item.operationId === operationId);
  if (!record) throw new Error('Publication not found');
  return record;
}
