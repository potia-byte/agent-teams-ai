import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createMediaOperationsFeature } from '../../../src/features/media-operations/main';

import { fixture, MemoryRepository } from './fixtures';

import type { RegisterTest } from './fixtures';

export function registerFailureCases(test: RegisterTest): void {
  test('post-publisher disk failure preserves claim; restart never invokes the publisher again', async () => {
    const repository = new MemoryRepository();
    let calls = 0;
    const f = await fixture({
      repository,
      publisher: {
        async publish() {
          calls++;
          repository.failCommit = true;
          return {
            status: 'published',
            externalId: 'actual',
            url: 'https://example.invalid/actual',
          };
        },
      },
    });
    try {
      const id = await f.prepare();
      await f.approve(id);
      await assert.rejects(() => f.publications.publish(id), /disk failure/);
      assert.equal(repository.state.publications[0].state, 'publishing');
      repository.failCommit = false;
      const restarted = await createMediaOperationsFeature(f.args);
      assert.equal((await restarted.read()).publications[0].state, 'outcome_unknown');
      await assert.rejects(() => restarted.publications.publish(id));
      await assert.rejects(() => restarted.publications.retry(id));
      await assert.rejects(() => restarted.publications.cancel(id));
      assert.equal(calls, 1);
    } finally {
      await f.cleanup();
    }
  });

  test('unknown outcome reconciled absent can be manually retried only with new approval', async () => {
    let calls = 0;
    const f = await fixture({
      publisher: {
        async publish() {
          calls++;
          if (calls === 1) throw new Error('Ambiguous transport failure');
          return {
            status: 'published',
            externalId: 'new-attempt',
            url: 'https://example.invalid/new',
          };
        },
      },
    });
    try {
      const id = await f.prepare();
      await f.approve(id);
      await f.publications.publish(id);
      await f.publications.reconcile(id, {
        evidenceRef: 'platform:final-absence',
        observedAt: 1_000,
        outcome: { status: 'not_published' },
      });
      await f.publications.retry(id);
      await assert.rejects(() => f.publications.publish(id));
      await f.approve(id);
      const record = await f.publications.publish(id);
      assert.equal(record.state, 'published');
      assert.equal(record.attempts, 2);
      assert.equal(calls, 2);
    } finally {
      await f.cleanup();
    }
  });

  test('PASS_WITH_NOTES can publish; granted approval expires exactly at its deadline', async () => {
    const f = await fixture();
    try {
      const id = await f.prepare();
      await f.publications.recordQa(id, {
        verdict: 'PASS_WITH_NOTES',
        unverifiedCriteria: ['manual visual check unavailable'],
      });
      await f.approve(id, 100);
      f.setTime(1_100);
      await assert.rejects(() => f.publications.publish(id), /approval/);
      assert.equal(f.calls.length, 0);
      await f.approve(id, 100);
      const record = await f.publications.publish(id);
      assert.equal(record.state, 'published');
      assert.deepEqual(record.qaVerdict?.unverifiedCriteria, ['manual visual check unavailable']);
    } finally {
      await f.cleanup();
    }
  });

  test('persisted journal cannot turn an unresolved attempt back into publishable approved state', async () => {
    const f = await fixture({
      publisher: {
        async publish() {
          throw new Error('Timeout');
        },
      },
    });
    try {
      const id = await f.prepare();
      await f.approve(id);
      await f.publications.publish(id);
      const file = join(f.directory, 'media-operations.json');
      const value = JSON.parse(await readFile(file, 'utf8'));
      value.publications[0].state = 'approved';
      value.publications[0].history.push({
        state: 'approved',
        at: 1_000,
        detail: 'Invalid automatic retry',
        evidenceRef: null,
      });
      await writeFile(file, JSON.stringify(value), 'utf8');
      await assert.rejects(() => f.publications.publish(id), /transition journal/);
      assert.equal(JSON.parse(await readFile(file, 'utf8')).publications[0].attempts, 1);
    } finally {
      await f.cleanup();
    }
  });
}
