import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { JsonMediaOperationsRepository } from '../../../src/features/media-operations/main/infrastructure/JsonMediaOperationsRepository';
import { financeStatusLabel, metricLabels } from '../../../src/features/media-operations/renderer/view-models/mediaOperationsLabels';

import { fixture, publication } from './fixtures';

import type { LedgerEntry, MetricSnapshot } from '../../../src/features/media-operations/contracts';
import type { RegisterTest } from './fixtures';

export function registerRecordsCases(test: RegisterTest): void {
  test('CRM stores source, manual probability, interactions and follow-ups without sending', async () => {
    const f = await fixture();
    try {
      await f.records.addContact({
        id: 'lead',
        name: 'Sandbox partner',
        source: 'manual research',
      });
      await f.records.updateLead('lead', {
        status: 'proposal',
        dealProbability: 0.35,
        followUpDueAt: 2_000,
      });
      await f.records.logInteraction('lead', {
        at: 1_000,
        text: 'Draft proposal reviewed locally',
        recordedBy: 'sales',
      });
      assert.equal((await f.records.followUpsDue(1_999)).length, 0);
      assert.equal((await f.records.followUpsDue(2_000)).length, 1);
      const lead = (await f.read()).contacts[0];
      assert.equal(lead.probabilitySource, 'manual');
      assert.equal(lead.dealProbability, 0.35);
      assert.equal(lead.interactions.length, 1);
      await assert.rejects(() =>
        f.records.updateLead('lead', { status: 'won', dealProbability: 1.1, followUpDueAt: null })
      );
      await f.records.updateLead('lead', {
        status: 'won',
        dealProbability: 1,
        followUpDueAt: 2_000,
      });
      assert.equal((await f.records.followUpsDue(3_000)).length, 0);
      assert.equal(f.telegram.messages.length + f.calls.length, 0);
    } finally {
      await f.cleanup();
    }
  });

  test('ledger separates all four sums; only receipts minus expenses form net profit', async () => {
    const f = await fixture();
    try {
      const base = {
        currency: 'USD',
        recordedBy: 'bookkeeper',
        at: 1_000,
        evidenceRef: null,
        platformConfirmationRef: null,
      };
      await f.records.recordLedger({ ...base, id: 'forecast', kind: 'forecast', amount: 90_000 });
      await f.records.recordLedger({
        ...base,
        id: 'accrued',
        kind: 'accrued',
        amount: 10_000,
        platformConfirmationRef: 'platform:statement',
      });
      await f.records.recordLedger({ ...base, id: 'expense', kind: 'expense', amount: 200 });
      const zero = await f.records.reportFinance();
      assert.deepEqual(zero, {
        currency: 'USD',
        forecast: 90_000,
        accrued: 10_000,
        received: 0,
        expense: 200,
        netProfit: -200,
        zeroRevenue: true,
      });
      assert.match(financeStatusLabel(zero), /0.*не получены/);
      await assert.rejects(() =>
        f.records.recordLedger({ ...base, id: 'missing', kind: 'received', amount: 1_000 })
      );
      await assert.rejects(() =>
        f.records.recordLedger({ ...base, id: 'unconfirmed', kind: 'accrued', amount: 1_000 })
      );
      await assert.rejects(() =>
        f.records.recordLedger({ ...base, id: 'fraction', kind: 'expense', amount: 1.25 })
      );
      await assert.rejects(() =>
        f.records.recordLedger({
          ...base,
          id: 'mixed',
          kind: 'forecast',
          amount: 1_000,
          currency: 'EUR',
        })
      );
      await f.records.recordLedger({
        ...base,
        id: 'received',
        kind: 'received',
        amount: 3_000,
        evidenceRef: 'bank:receipt-1',
      });
      const report = await f.records.reportFinance();
      assert.equal(report.netProfit, 2_800);
      assert.equal(report.zeroRevenue, false);
      await assert.rejects(() => f.records.auditLedger('received', 'bookkeeper'), /independent/);
      await assert.rejects(() => f.records.auditLedger('received', ' bookkeeper '));
      const audited = await f.records.auditLedger('received', 'independent-auditor');
      assert.equal(audited.audited, true);
      assert.equal(audited.auditedBy, 'independent-auditor');
      assert.equal(audited.auditedAt, 1_000);
      await assert.rejects(() => f.records.auditLedger('received', 'another-auditor'));
      assert.equal(f.calls.length, 0);
    } finally {
      await f.cleanup();
    }
  });

  test('metric snapshots preserve explicit nulls and provenance; metrics never become receipts', async () => {
    const f = await fixture();
    try {
      const snapshot: MetricSnapshot = {
        id: 'snapshot-1',
        videoId: 'video-1',
        source: 'manual:platform-export',
        collectedAt: 1_000,
        views: 0,
        retention: null,
        likes: null,
        subscribers: null,
        revenue: 500,
      };
      await f.records.recordMetrics(snapshot);
      await f.records.recordMetrics({
        ...snapshot,
        id: 'snapshot-2',
        collectedAt: 2_000,
        views: 50,
        retention: 37.5,
      });
      const persisted = await new JsonMediaOperationsRepository(f.directory, 'owner').read();
      assert.deepEqual(persisted.metrics[0], snapshot);
      assert.equal(persisted.metrics[1].retention, 37.5);
      assert.equal((await f.records.reportFinance()).received, 0);
      await assert.rejects(() =>
        f.records.recordMetrics({ ...snapshot, id: 'invalid', views: Number.NaN })
      );
      await assert.rejects(() =>
        f.records.recordMetrics({ ...snapshot, id: 'invalid', retention: 101 })
      );
      const missing = { ...snapshot } as Partial<MetricSnapshot>;
      delete missing.likes;
      await assert.rejects(() => f.records.recordMetrics(missing as MetricSnapshot));
      assert.equal(metricLabels.unknown, 'Нет данных');
    } finally {
      await f.cleanup();
    }
  });

  test('production journal is idempotent, preserves artifacts and prevents terminal regressions', async () => {
    const f = await fixture();
    try {
      const input = { key: 'video-1:edit:v1', videoId: 'video-1', stage: 'editing' };
      await f.records.enqueueTask(input);
      await f.records.advanceTask(input.key, 'in_progress', 'Started', ['sandbox/script.md']);
      await f.records.advanceTask(input.key, 'blocked', 'Awaiting audio', ['sandbox/script.md']);
      await f.records.advanceTask(input.key, 'in_progress', 'Audio ready', ['sandbox/audio.wav']);
      await f.records.advanceTask(input.key, 'completed', 'Rendered', ['sandbox/video.mp4']);
      const duplicate = await f.records.enqueueTask(input);
      assert.equal(duplicate.state, 'completed');
      assert.equal(duplicate.history.length, 5);
      assert.deepEqual(duplicate.artifacts, [
        'sandbox/script.md',
        'sandbox/audio.wav',
        'sandbox/video.mp4',
      ]);
      await assert.rejects(() => f.records.advanceTask(input.key, 'in_progress', 'Restart'));
      assert.equal((await f.read()).tasks.length, 1);
    } finally {
      await f.cleanup();
    }
  });

  test('JSON transactions serialize writers, roll back rejected updates and preserve corrupt evidence', async () => {
    const f = await fixture();
    try {
      const first = new JsonMediaOperationsRepository(f.directory, 'owner');
      const second = new JsonMediaOperationsRepository(f.directory, 'owner');
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          (index % 2 ? first : second).transact((state) => {
            state.contacts.push({
              id: `lead-${index}`,
              name: 'Sandbox',
              source: 'fixture',
              status: 'new',
              dealProbability: null,
              probabilitySource: 'manual',
              followUpDueAt: null,
              interactions: [],
            });
          })
        )
      );
      assert.equal((await second.read()).contacts.length, 8);
      await assert.rejects(() =>
        first.transact((state) => {
          state.schemaVersion = 2 as 1;
        })
      );
      assert.equal((await second.read()).schemaVersion, 1);
      const retained = await first.transact((state) => state);
      retained.contacts.length = 0;
      assert.equal((await second.read()).contacts.length, 8);
      await assert.rejects(
        () => new JsonMediaOperationsRepository(f.directory, 'other-owner').read(),
        /mismatch/
      );
      await assert.rejects(
        () => new JsonMediaOperationsRepository(f.directory, 'owner', 'EUR').read(),
        /mismatch/
      );
      const file = join(f.directory, 'media-operations.json');
      const valid = await readFile(file, 'utf8');
      await writeFile(file, '{corrupt', 'utf8');
      await assert.rejects(() => first.read());
      await assert.rejects(() => first.transact(() => undefined));
      assert.equal(await readFile(file, 'utf8'), '{corrupt');
      await writeFile(file, valid, 'utf8');
      const malformed = JSON.parse(valid);
      malformed.schemaVersion = 999;
      await writeFile(file, JSON.stringify(malformed), 'utf8');
      await assert.rejects(() => first.read());
    } finally {
      await f.cleanup();
    }
  });

  test('tampered approval identity and unaudited receipts fail closed on disk', async () => {
    const f = await fixture();
    try {
      const id = await f.prepare(publication);
      await f.approve(id);
      const file = join(f.directory, 'media-operations.json');
      const valid = await readFile(file, 'utf8');
      const tampered = JSON.parse(valid);
      tampered.publications[0].approval.operationId = 'another-operation';
      await writeFile(file, JSON.stringify(tampered), 'utf8');
      await assert.rejects(() => f.publications.publish(id));
      assert.equal(f.calls.length, 0);
      const badLedger: LedgerEntry = {
        id: 'bad',
        kind: 'received',
        amount: 100,
        currency: 'USD',
        recordedBy: 'same',
        at: 1_000,
        evidenceRef: 'receipt',
        platformConfirmationRef: null,
        audited: true,
        auditedBy: 'same',
        auditedAt: 1_000,
      };
      tampered.publications = [];
      tampered.approvals = [];
      tampered.ledger = [badLedger];
      await writeFile(file, JSON.stringify(tampered), 'utf8');
      await assert.rejects(() => f.read(), /independent/);
    } finally {
      await f.cleanup();
    }
  });
}
