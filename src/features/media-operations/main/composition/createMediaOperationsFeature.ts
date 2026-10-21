import { randomUUID } from 'node:crypto';

import { OperationsRecords } from '../../core/application/OperationsRecords';
import { OwnerApprovals } from '../../core/application/OwnerApprovals';
import { ProductionCycle } from '../../core/application/ProductionCycle';
import { PublicationQueue } from '../../core/application/PublicationQueue';
import { text, timestamp } from '../../core/domain/validation';
import { JsonMediaOperationsRepository } from '../infrastructure/JsonMediaOperationsRepository';

import type { MediaOperationsDependencies } from '../../core/application/ports';
import type { ProductionDependencies } from '../../core/application/productionPorts';

/** Explicit composition only: no Electron registration, network clients or background jobs. */
export async function createMediaOperationsFeature(
  options: {
    directory: string;
    ownerId: string;
    ownerChatId: string;
    currency?: string;
    production?: ProductionDependencies;
  } & Partial<Omit<MediaOperationsDependencies, 'ownerId' | 'ownerChatId'>>
): Promise<{
  publications: PublicationQueue;
  approvals: OwnerApprovals;
  records: OperationsRecords;
  read: MediaOperationsDependencies['repository']['read'];
  production: ProductionCycle | null;
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
  const approvals = new OwnerApprovals(deps);
  const records = new OperationsRecords(deps);
  const production = options.production
    ? new ProductionCycle(deps, options.production, publications, approvals, records)
    : null;
  await production?.recover();
  return {
    publications,
    approvals,
    records,
    production,
    read: () => deps.repository.read(),
  };
}
