import type { MediaOperationsState, PublicationRecord } from '../../contracts';

export function replacePublication(
  state: MediaOperationsState,
  record: PublicationRecord
): PublicationRecord {
  const index = state.publications.findIndex((item) => item.operationId === record.operationId);
  if (index === -1) throw new Error('Publication not found');
  state.publications[index] = record;
  return record;
}
