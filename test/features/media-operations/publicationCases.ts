import assert from 'node:assert/strict';

import { PublicationQueue } from '../../../src/features/media-operations/core/application/PublicationQueue';
import { operationIdFor } from '../../../src/features/media-operations/core/domain/publication';
import { createMediaOperationsFeature } from '../../../src/features/media-operations/main';
import { JsonMediaOperationsRepository } from '../../../src/features/media-operations/main/infrastructure/JsonMediaOperationsRepository';
import { publicationStatusLabel } from '../../../src/features/media-operations/renderer';

import { fixture, MemoryRepository, pass, publication } from './fixtures';

import type { PublisherOutcome } from '../../../src/features/media-operations/main';
import type { RegisterTest } from './fixtures';

export function registerPublicationCases(test: RegisterTest): void {
  test('operation identity includes version/platform/target; duplicate enqueue preserves history', async () => {
    const f = await fixture();
    try {
      const id = await f.prepare();
      const duplicate = await f.publications.enqueue(publication);
      assert.equal(duplicate.operationId, id);
      assert.equal(duplicate.state, 'awaiting_owner_approval');
      for (const patch of [{ version: 2 }, { platform: 'tiktok' }, { channelId: null }])
        assert.notEqual(operationIdFor({ ...publication, ...patch }), id);
      assert.notEqual(
        operationIdFor({ ...publication, videoId: 'a:b', platform: 'c' }),
        operationIdFor({ ...publication, videoId: 'a', platform: 'b:c' })
      );
      duplicate.history.length = 0;
      assert.equal((await f.read()).publications[0].history.length, 3);
      assert.equal(f.calls.length, 0);
    } finally {
      await f.cleanup();
    }
  });

  test('QA BLOCK, missing approval, unverified PASS and changed QA cannot publish', async () => {
    const f = await fixture();
    try {
      const record = await f.publications.enqueue(publication);
      const id = record.operationId;
      await assert.rejects(() => f.publications.publish(id));
      await f.publications.submitForQa(id);
      await f.publications.recordQa(id, { verdict: 'BLOCK', unverifiedCriteria: ['licenses'] });
      await assert.rejects(() =>
        f.approvals.request({
          type: 'publication',
          operationId: id,
          actionText: 'Publish',
          ttl: 100,
        })
      );
      await assert.rejects(() =>
        f.publications.recordQa(id, { verdict: 'PASS', unverifiedCriteria: ['audio'] })
      );
      await f.publications.recordQa(id, {
        verdict: 'PASS_WITH_NOTES',
        unverifiedCriteria: ['visual review'],
      });
      await assert.rejects(() => f.publications.publish(id));
      const old = await f.approve(id);
      await f.publications.recordQa(id, pass);
      assert.equal(
        (await f.read()).approvals.find((item) => item.id === old.id)?.status,
        'superseded'
      );
      await assert.rejects(() => f.publications.publish(id));
      await f.approve(id);
      assert.equal((await f.publications.publish(id)).state, 'published');
      assert.equal(f.calls.length, 1);
    } finally {
      await f.cleanup();
    }
  });

  test('first three unique niche videos always require owner approval, including other platforms', async () => {
    const f = await fixture();
    try {
      for (let n = 1; n <= 4; n++) {
        const id = await f.prepare({ ...publication, videoId: `niche-video-${n}` });
        await assert.rejects(() => f.publications.publish(id));
        await f.approve(id);
        await f.publications.publish(id);
      }
      const version = await f.publications.enqueue({
        ...publication,
        videoId: 'niche-video-1',
        version: 2,
      });
      assert.equal(version.nicheVideoOrdinal, 1);
      const other = await f.publications.enqueue({
        ...publication,
        videoId: 'niche-video-2',
        platform: 'tiktok',
      });
      assert.equal(other.nicheVideoOrdinal, 2);
      assert.deepEqual(
        (await f.read()).publications.slice(0, 4).map((item) => item.nicheVideoOrdinal),
        [1, 2, 3, 4]
      );
    } finally {
      await f.cleanup();
    }
  });

  test('null channel remains approved awaiting target; approval cannot transfer to target/version', async () => {
    const f = await fixture();
    try {
      const id = await f.prepare({ ...publication, channelId: null });
      await f.approve(id);
      const untargeted = await f.publications.publish(id);
      assert.equal(untargeted.state, 'approved');
      assert.equal(untargeted.attempts, 0);
      assert.match(publicationStatusLabel(untargeted, 1_000), /ожидает выбора канала/);
      const targeted = await f.prepare();
      await assert.rejects(() => f.publications.publish(targeted));
      assert.equal(f.calls.length, 0);
      f.setTime(2_000);
      await assert.rejects(() => f.publications.publish(id), /approval/);
      assert.match(publicationStatusLabel(untargeted, 2_000), /истёк/);
    } finally {
      await f.cleanup();
    }
  });

  test('publishing claim is on disk before call; competing instances call publisher once', async () => {
    let calls = 0;
    const f = await fixture({
      publisher: {
        async publish(record) {
          calls++;
          const disk = await new JsonMediaOperationsRepository(f.directory, 'owner').read();
          assert.equal(disk.publications[0].state, 'publishing');
          assert.equal(disk.publications[0].attempts, 1);
          assert.equal(record.operationId, disk.publications[0].operationId);
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { status: 'published', externalId: 'external', url: 'https://example.invalid/1' };
        },
      },
    });
    try {
      const id = await f.prepare();
      await f.approve(id);
      const other = new PublicationQueue({
        ...f.args,
        repository: new JsonMediaOperationsRepository(f.directory, 'owner'),
      });
      const results = await Promise.allSettled([
        f.publications.publish(id),
        other.publish(id),
        f.publications.publish(id),
      ]);
      assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(calls, 1);
      await assert.rejects(() => f.publications.publish(id));
      assert.equal((await f.read()).publications[0].state, 'published');
    } finally {
      await f.cleanup();
    }
  });

  test('failed claim commit cannot invoke publisher', async () => {
    const repository = new MemoryRepository();
    const f = await fixture({ repository });
    try {
      const id = await f.prepare();
      await f.approve(id);
      repository.failCommit = true;
      await assert.rejects(() => f.publications.publish(id), /disk failure/);
      assert.equal(f.calls.length, 0);
      assert.equal(repository.state.publications[0].state, 'approved');
    } finally {
      await f.cleanup();
    }
  });

  test('timeout is unknown and late completion cannot overwrite it; reconciliation gates retry', async () => {
    let complete!: (outcome: PublisherOutcome) => void;
    let calls = 0;
    const f = await fixture({
      publicationTimeoutMs: 5,
      publisher: {
        publish() {
          calls++;
          return new Promise((resolve) => {
            complete = resolve;
          });
        },
      },
    });
    try {
      const id = await f.prepare();
      await f.approve(id);
      assert.equal((await f.publications.publish(id)).state, 'outcome_unknown');
      complete({ status: 'published', externalId: 'late', url: 'https://example.invalid/late' });
      await Promise.resolve();
      assert.equal((await f.read()).publications[0].state, 'outcome_unknown');
      await assert.rejects(() => f.publications.retry(id));
      await assert.rejects(() => f.publications.publish(id));
      await assert.rejects(() =>
        f.publications.reconcile(id, {
          evidenceRef: '',
          observedAt: 1_000,
          outcome: { status: 'not_published' },
        })
      );
      await assert.rejects(() =>
        f.publications.reconcile(id, {
          evidenceRef: 'stale',
          observedAt: 999,
          outcome: { status: 'not_published' },
        })
      );
      await f.publications.reconcile(id, {
        evidenceRef: 'platform-search:attempt-1',
        observedAt: 1_000,
        outcome: { status: 'not_published' },
      });
      await f.publications.retry(id);
      await assert.rejects(() => f.publications.publish(id));
      assert.equal(calls, 1);
      assert.equal(
        (await f.read()).publications[0].history.at(-2)?.evidenceRef,
        'platform-search:attempt-1'
      );
    } finally {
      await f.cleanup();
    }
  });

  test('throw and malformed success fail closed; known failure needs fresh approval for manual retry', async () => {
    const f = await fixture({
      publisher: {
        async publish() {
          throw new Error('connection lost');
        },
      },
    });
    try {
      const id = await f.prepare();
      await f.approve(id);
      assert.equal((await f.publications.publish(id)).state, 'outcome_unknown');
      const reconciled = await f.publications.reconcile(id, {
        evidenceRef: 'platform:exists',
        observedAt: 1_000,
        outcome: {
          status: 'published',
          result: { externalId: 'found', url: 'https://example.invalid/found', at: 1_000 },
        },
      });
      assert.equal(reconciled.state, 'published');
      assert.equal(reconciled.result?.externalId, 'found');
      await assert.rejects(() => f.publications.retry(id));
      const second = await f.prepare({ ...publication, version: 2 });
      await f.approve(second);
      const known = new PublicationQueue({
        ...f.args,
        repository: new JsonMediaOperationsRepository(f.directory, 'owner'),
        publisher: {
          async publish() {
            return {
              status: 'failed_known',
              reason: 'Rejected before creation',
              evidenceRef: 'platform:rejected',
            };
          },
        },
      });
      assert.equal((await known.publish(second)).state, 'failed_known');
      await known.retry(second);
      await f.approve(second);
      const invalid = new PublicationQueue({
        ...f.args,
        repository: new JsonMediaOperationsRepository(f.directory, 'owner'),
        publisher: {
          async publish() {
            return { status: 'published', externalId: '', url: 'invalid' };
          },
        },
      });
      assert.equal((await invalid.publish(second)).state, 'outcome_unknown');
      assert.equal((await f.read()).publications[1].attempts, 2);
    } finally {
      await f.cleanup();
    }
  });

  test('factory restart recovers publishing without a call and fences old completion', async () => {
    let complete!: (outcome: PublisherOutcome) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = await fixture({
      publisher: {
        publish() {
          entered();
          return new Promise((resolve) => {
            complete = resolve;
          });
        },
      },
    });
    try {
      const id = await f.prepare();
      await f.approve(id);
      const pending = f.publications.publish(id);
      await started;
      const restarted = await createMediaOperationsFeature(f.args);
      assert.equal((await restarted.read()).publications[0].state, 'outcome_unknown');
      await assert.rejects(() => restarted.publications.retry(id));
      complete({ status: 'published', externalId: 'old', url: 'https://example.invalid/old' });
      assert.equal((await pending).state, 'outcome_unknown');
      assert.equal((await restarted.read()).publications[0].result, null);
    } finally {
      await f.cleanup();
    }
  });
}
