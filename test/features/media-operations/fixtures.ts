import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import {
  emptyMediaState,
  validateMediaState,
} from '../../../src/features/media-operations/core/domain/state';
import { createMediaOperationsFeature } from '../../../src/features/media-operations/main';

import type {
  MediaOperationsState,
  PublicationInput,
} from '../../../src/features/media-operations/contracts';
import type {
  MediaOperationsDependencies,
  MediaOperationsRepository,
  PublisherPort,
  TelegramPort,
} from '../../../src/features/media-operations/main';

export type RegisterTest = (name: string, body: () => void | Promise<void>) => unknown;
export const publication: PublicationInput = {
  videoId: 'video-1',
  platform: 'youtube-shorts',
  channelId: 'sandbox-channel',
  version: 1,
  nicheId: 'science',
};
export const pass = { verdict: 'PASS' as const, unverifiedCriteria: [] };
export class FakeTelegram implements TelegramPort {
  messages: { chatId: string; text: string }[] = [];
  videos: { chatId: string; path: string; caption: string }[] = [];
  unavailable = false;
  async sendMessage(chatId: string, text: string): Promise<void> {
    if (this.unavailable) throw new Error('Offline fake');
    this.messages.push({ chatId, text });
  }
  async sendVideo(chatId: string, path: string, caption: string): Promise<void> {
    this.videos.push({ chatId, path, caption });
  }
}
export class MemoryRepository implements MediaOperationsRepository {
  state: MediaOperationsState = emptyMediaState('owner', 'USD');
  failCommit = false;
  async read(): Promise<MediaOperationsState> {
    return structuredClone(this.state);
  }
  async transact<T>(operation: (state: MediaOperationsState) => T): Promise<T> {
    const draft = structuredClone(this.state);
    const result = operation(draft);
    validateMediaState(draft);
    if (this.failCommit) throw new Error('Simulated disk failure');
    this.state = draft;
    return structuredClone(result);
  }
}
const parent = resolve('test/features/media-operations');
export async function fixture(options: Partial<MediaOperationsDependencies> = {}) {
  const directory = await mkdtemp(join(parent, '.store-'));
  let at = 1_000;
  let next = 0;
  const telegram = new FakeTelegram();
  const calls: string[] = [];
  const publisher: PublisherPort = {
    async publish(record) {
      calls.push(record.operationId);
      return {
        status: 'published',
        externalId: 'external-1',
        url: 'https://example.invalid/video/1',
      };
    },
  };
  const args = {
    directory,
    ownerId: 'owner',
    ownerChatId: 'owner-chat',
    now: () => at,
    nextId: () => `approval-${++next}`,
    telegram,
    publisher,
    ...options,
  };
  const feature = await createMediaOperationsFeature(args);
  return {
    ...feature,
    directory,
    telegram,
    calls,
    args,
    setTime: (value: number) => {
      at = value;
    },
    async prepare(input: PublicationInput = publication) {
      const record = await feature.publications.enqueue(input);
      await feature.publications.submitForQa(record.operationId);
      await feature.publications.recordQa(record.operationId, pass);
      return record.operationId;
    },
    async approve(operationId: string, ttl = 1_000) {
      const request = await feature.approvals.request({
        type: 'publication',
        operationId,
        actionText: `Publish exactly ${operationId}`,
        ttl,
      });
      const decision = await feature.approvals.command('owner', `approve ${request.id}`);
      assert.equal(decision?.status, 'approved');
      return request;
    },
    async cleanup() {
      const target = resolve(directory);
      if (dirname(target) !== parent || !basename(target).startsWith('.store-'))
        throw new Error('Cleanup outside test sandbox');
      await rm(target, { recursive: true, force: true });
    },
  };
}
