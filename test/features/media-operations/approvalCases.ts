import assert from 'node:assert/strict';

import { fixture, publication } from './fixtures';

import type { RegisterTest } from './fixtures';

export function registerApprovalCases(test: RegisterTest): void {
  test('only exact owner commands approve; silence, vague text and wrong ids do nothing', async () => {
    const f = await fixture();
    try {
      const id = await f.prepare();
      const request = await f.approvals.request({
        type: 'publication',
        operationId: id,
        actionText: 'Publish version 1 to sandbox-channel',
        ttl: 100,
      });
      for (const message of [
        'yes',
        'approved',
        'да, публикуй',
        `approve ${request.id} please`,
        ` approve ${request.id}`,
        `approve ${request.id}\n`,
        `APPROVE ${request.id}`,
        'approve unknown',
        `reject ${request.id} `,
      ])
        assert.equal(await f.approvals.command('owner', message), null);
      assert.equal(await f.approvals.command('intruder', `approve ${request.id}`), null);
      assert.equal((await f.read()).publications[0].state, 'awaiting_owner_approval');
      f.setTime(1_100);
      assert.equal(
        (await f.approvals.command('owner', `approve ${request.id}`))?.status,
        'expired'
      );
      assert.equal((await f.read()).publications[0].approval, null);
      await assert.rejects(() => f.publications.publish(id));
      assert.equal(f.calls.length, 0);
    } finally {
      await f.cleanup();
    }
  });

  test('renewal supersedes old commands; reject is terminal and cannot later approve', async () => {
    const f = await fixture();
    try {
      const id = await f.prepare();
      const first = await f.approvals.request({
        type: 'publication',
        operationId: id,
        actionText: 'Publish first version',
        ttl: 100,
      });
      const second = await f.approvals.request({
        type: 'publication',
        operationId: id,
        actionText: 'Publish first version after review',
        ttl: 200,
      });
      assert.equal(await f.approvals.command('owner', `approve ${first.id}`), null);
      assert.equal((await f.approvals.command('owner', `reject ${second.id}`))?.status, 'rejected');
      assert.equal(await f.approvals.command('owner', `approve ${second.id}`), null);
      assert.equal((await f.read()).publications[0].state, 'cancelled');
      await assert.rejects(() => f.publications.publish(id));
    } finally {
      await f.cleanup();
    }
  });

  test('spending and contracts only record decisions and cannot authorize publishing', async () => {
    const f = await fixture();
    try {
      const id = await f.prepare();
      for (const type of ['spending', 'contract'] as const) {
        const request = await f.approvals.request({
          type,
          actionText: `Review ${type} proposal`,
          ttl: 100,
        });
        assert.equal(
          (await f.approvals.command('owner', `approve ${request.id}`))?.status,
          'approved'
        );
        await assert.rejects(() =>
          f.approvals.request({ type, operationId: id, actionText: 'Invalid scope', ttl: 100 })
        );
      }
      await assert.rejects(() => f.publications.publish(id));
      assert.equal((await f.read()).ledger.length, 0);
      assert.equal(f.telegram.messages.length, 0);
      assert.equal(f.calls.length, 0);
    } finally {
      await f.cleanup();
    }
  });

  test('offline fake leaves persistent Telegram outbox; explicit drain and preview target owner chat', async () => {
    const f = await fixture();
    try {
      const id = await f.prepare(publication);
      const request = await f.approvals.request({
        type: 'publication',
        operationId: id,
        actionText: 'Publish sandbox video',
        ttl: 500,
      });
      f.telegram.unavailable = true;
      await assert.rejects(() => f.approvals.deliverPending(), /Offline fake/);
      assert.equal((await f.read()).approvals[0].delivery, 'pending');
      f.telegram.unavailable = false;
      await f.approvals.deliverPending();
      await f.approvals.deliverPending();
      assert.equal(f.telegram.messages.length, 1);
      assert.equal(f.telegram.messages[0].chatId, 'owner-chat');
      assert.ok(f.telegram.messages[0].text.includes(`approve ${request.id}`));
      assert.ok(f.telegram.messages[0].text.includes(`Операция: ${id}`));
      await f.approvals.sendPreview(request.id, 'sandbox/artifacts/preview.mp4');
      assert.deepEqual(f.telegram.videos[0], {
        chatId: 'owner-chat',
        path: 'sandbox/artifacts/preview.mp4',
        caption: `${request.actionText}\nОперация: ${id}`,
      });
      f.setTime(1_500);
      await assert.rejects(() =>
        f.approvals.sendPreview(request.id, 'sandbox/artifacts/preview.mp4')
      );
    } finally {
      await f.cleanup();
    }
  });
}
