import type { MediaOperationsState, PublicationRecord } from '../../contracts';

export interface MediaOperationsRepository {
  read(): Promise<MediaOperationsState>;
  /** Serialized transaction. Callback is synchronous; commit finishes before return. */
  transact<T>(operation: (state: MediaOperationsState) => T): Promise<T>;
}

export type PublisherOutcome =
  | { status: 'published'; externalId: string; url: string }
  | { status: 'failed_known'; reason: string; evidenceRef: string };

export interface PublisherPort {
  /** One call per persisted attempt. Throw/timeout means unknown, never safe to retry. */
  publish(record: Readonly<PublicationRecord>): Promise<PublisherOutcome>;
}

export interface TelegramPort {
  sendMessage(chatId: string, text: string): Promise<void>;
  sendVideo(chatId: string, artifactPath: string, caption: string): Promise<void>;
}

export interface MediaOperationsDependencies {
  repository: MediaOperationsRepository;
  ownerId: string;
  ownerChatId: string;
  now: () => number;
  nextId: () => string;
  publisher?: PublisherPort;
  telegram?: TelegramPort;
  publicationTimeoutMs?: number;
}
