import { randomUUID } from 'node:crypto';

import { OperationsRecords } from '../../core/application/OperationsRecords';
import { OwnerApprovals } from '../../core/application/OwnerApprovals';
import { PublicationQueue } from '../../core/application/PublicationQueue';
import { text, timestamp } from '../../core/domain/validation';
import { JsonMediaOperationsRepository } from '../infrastructure/JsonMediaOperationsRepository';

import type { MediaOperationsDependencies } from '../../core/application/ports';

/** Explicit composition only: no Electron registration, network clients or background jobs. */
export async function createMediaOperationsFeature(
  options: {
    directory: string;
    ownerId: string;
    ownerChatId: string;
    currency?: string;
  } & Partial<Omit<MediaOperationsDependencies, 'ownerId' | 'ownerChatId'>>
): Promise<{
  publications: PublicationQueue;
  approvals: OwnerApprovals;
  records: OperationsRecords;
  read: MediaOperationsDependencies['repository']['read'];
}> {
  const ownerId = text.parse(options.ownerId);
  const ownerChatId = text.parse(options.ownerChatId);
  text.parse(options.directory);
  const publicationTimeoutMs = timestamp
    .positive()
    .max(2_147_483_647)
    .parse(options.publicationTimeoutMs ?? 30_000);
  const deps: MediaOperationsDependencies = {
    ...options,
    ownerId,
    ownerChatId,
    publicationTimeoutMs,
    now: options.now ?? Date.now,
    nextId: options.nextId ?? randomUUID,
    repository:
      options.repository ??
      new JsonMediaOperationsRepository(options.directory, ownerId, options.currency),
  };
  const state = await deps.repository.read();
  if (state.ownerId !== ownerId) throw new Error('Owner mismatch');
  const publications = new PublicationQueue(deps);
  await publications.recoverPublishing();
  return {
    publications,
    approvals: new OwnerApprovals(deps),
    records: new OperationsRecords(deps),
    read: () => deps.repository.read(),
  };
}
