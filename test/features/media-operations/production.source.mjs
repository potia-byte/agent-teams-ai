import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { createCompanyRoleCatalogApi } from '../../../src/features/company-role-catalog/main/index.ts';
import {
  PRODUCTION_STAGES,
  MEDIA_PRODUCTION_CHANNELS,
} from '../../../src/features/media-operations/contracts/index.ts';
import { parseQaReport } from '../../../src/features/media-operations/core/domain/production.ts';
import { createMediaOperationsFeature } from '../../../src/features/media-operations/main/index.ts';
import {
  ProductionArtifacts,
  validateVideo,
} from '../../../src/features/media-operations/main/infrastructure/ProductionArtifacts.ts';
import { registerProductionIpc } from '../../../src/features/media-operations/main/adapters/input/productionIpc.ts';
import {
  TelegramOwnerAdapter,
  loadTelegramOwnerAdapter,
  parseTelegramConfig,
} from '../../../src/features/media-operations/main/infrastructure/TelegramOwnerAdapter.ts';
import { createMediaProductionBridge } from '../../../src/features/media-operations/preload/index.ts';
import { createCeoProductionCapacity } from '../../../src/features/media-operations/main/adapters/output/CeoProductionCapacity.ts';

const probeResult = {
  streams: [
    { codec_type: 'video', width: 1080, height: 1920, sample_aspect_ratio: '1:1' },
    { codec_type: 'audio' },
  ],
  format: { duration: '45' },
};
const qaReport = (
  verdict = 'PASS_WITH_NOTES',
  criteria = '- Естественность голоса не проверялась'
) => `VERDICT: ${verdict}\n## UNVERIFIED_CRITERIA\n${criteria}\n`;
async function setup(t, overrides = {}) {
  const directory = await mkdtemp(resolve('test/features/media-operations/.store-production-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'production');
  await mkdir(root);
  let now = 1000,
    id = 0,
    probes = 0;
  const artifacts = new ProductionArtifacts(
    root,
    {
      probe: async () => {
        probes++;
        return probeResult;
      },
    },
    () => now
  );
  const options = {
    directory: join(directory, 'store'),
    ownerId: 'owner',
    ownerChatId: 'chat',
    now: () => now,
    nextId: () => `request-${++id}`,
    production: {
      productionRoot: root,
      artifacts,
      catalog: createCompanyRoleCatalogApi(),
      capacity: async () => ({
        providers: { codex: { configured: true, availability: 'AVAILABLE' } },
        concurrencyCap: 3,
      }),
    },
    ...overrides,
  };
  const feature = await createMediaOperationsFeature(options);
  const api = feature.production;
  const input = {
    key: 'test-video',
    title: 'Тестовый ролик',
    nicheId: 'science',
    template: 'short-video-v1',
    teamName: null,
    channelId: 'test-channel',
  };
  async function file(stage, contents) {
    const target = join(root, `${stage}${stage === 'render' ? '.mp4' : '.md'}`);
    await writeFile(
      target,
      contents ??
        (stage === 'qa' ? qaReport() : 'Локальная тестовая фикстура, не настоящий видеоролик')
    );
    return target;
  }
  async function evidence(stage, contents) {
    return api.attach({ key: input.key, stage, path: await file(stage, contents) });
  }
  async function toOwner(channelId = input.channelId) {
    await api.create({ ...input, channelId });
    for (const stage of PRODUCTION_STAGES.slice(0, 8)) {
      await evidence(stage);
      await api.advance({ key: input.key, stage });
    }
    await api.advance({ key: input.key, stage: 'owner_approval' });
    return api.get(input.key);
  }
  async function approve() {
    const detail = await api.get(input.key);
    await api.decide({ key: input.key, approvalId: detail.approval.id, decision: 'approve' });
    return api.advance({ key: input.key, stage: 'owner_approval' });
  }
  return {
    directory,
    root,
    options,
    feature,
    api,
    input,
    artifacts,
    file,
    evidence,
    toOwner,
    approve,
    setTime: (value) => {
      now = value;
    },
    probes: () => probes,
  };
}

test('file store: full desktop API cycle, role IDs, evidence, QA notes, explicit approval and idempotent queue', async (t) => {
  const f = await setup(t);
  const owner = await f.toOwner();
  assert.equal(owner.task.stage, 'owner_approval');
  assert.equal(owner.approval.status, 'pending');
  assert.deepEqual(
    owner.task.pipeline.stages.map((stage) => stage.id),
    PRODUCTION_STAGES
  );
  assert.deepEqual(owner.task.pipeline.stages[1].requiredRoleIds, ['scriptwriter']);
  assert.deepEqual(owner.task.pipeline.stages[2].requiredRoleIds, ['fact-checker']);
  assert.deepEqual(owner.task.pipeline.stages[7].requiredRoleIds, ['independent-qa']);
  for (const stage of owner.task.pipeline.stages.filter((stage) => stage.selection)) {
    assert.ok(stage.selection.activations.length + stage.selection.retained.length <= 3);
  }
  assert.equal(owner.task.pipeline.stages[7].artifacts[0].qa.unverifiedCriteria.length, 1);
  await f.approve();
  await f.evidence('publication_queue');
  const done = await f.api.advance({ key: f.input.key, stage: 'publication_queue' });
  assert.equal(done.state, 'completed');
  assert.ok(f.probes() >= 2);
  const duplicate = await f.api.create(f.input);
  assert.deepEqual(duplicate, done);
  const publication = await f.feature.publications.enqueue({
    videoId: f.input.key,
    platform: 'youtube-shorts',
    channelId: 'test-channel',
    version: 1,
    nicheId: f.input.nicheId,
  });
  assert.equal(publication.operationId, done.pipeline.operationId);
  assert.equal((await f.feature.read()).publications.length, 1);
  assert.equal((await f.api.summary()).finance.received, 0);
  assert.ok(done.pipeline.history.length > 15);
});

test('null channel blocks only public publication; research through owner approval proceed', async (t) => {
  const f = await setup(t);
  await f.toOwner(null);
  await f.approve();
  await f.evidence('publication_queue');
  const task = await f.api.advance({ key: f.input.key, stage: 'publication_queue' });
  assert.ok(task.pipeline.stages.slice(0, 9).every((stage) => stage.status === 'completed'));
  assert.equal(task.state, 'blocked');
  assert.equal(task.pipeline.stages[9].detail, 'нет канала публикации');
  await f.api.advance({ key: f.input.key, stage: 'publication_queue' });
  assert.equal((await f.feature.read()).publications.length, 1);
  assert.equal((await f.feature.read()).publications[0].attempts, 0);
});

test('preload → registered main IPC → file store completes a production cycle', async (t) => {
  const f = await setup(t);
  const handlers = new Map();
  const unregister = registerProductionIpc(
    {
      handle: (channel, callback) => handlers.set(channel, callback),
      removeHandler: (channel) => handlers.delete(channel),
    },
    f.api
  );
  t.after(unregister);
  const bridge = createMediaProductionBridge({
    invoke: async (channel, input) => handlers.get(channel)(null, input),
  });
  await bridge.create(f.input);
  assert.equal((await bridge.list()).length, 1);
  for (const stage of PRODUCTION_STAGES.slice(0, 8)) {
    await bridge.attach({ key: f.input.key, stage, path: await f.file(stage) });
    await bridge.advance({ key: f.input.key, stage });
  }
  await bridge.advance({ key: f.input.key, stage: 'owner_approval' });
  const detail = await bridge.get(f.input.key);
  await bridge.decide({ key: f.input.key, approvalId: detail.approval.id, decision: 'approve' });
  await bridge.advance({ key: f.input.key, stage: 'owner_approval' });
  await bridge.attach({
    key: f.input.key,
    stage: 'publication_queue',
    path: await f.file('publication_queue'),
  });
  const completed = await bridge.advance({ key: f.input.key, stage: 'publication_queue' });
  assert.equal(completed.state, 'completed');
  assert.equal((await bridge.summary()).publications.length, 1);
});

test('QA BLOCK persists and prevents approval; explicit corrected attachment can resume', async (t) => {
  const f = await setup(t);
  await f.api.create(f.input);
  for (const stage of PRODUCTION_STAGES.slice(0, 7)) {
    await f.evidence(stage);
    await f.api.advance({ key: f.input.key, stage });
  }
  await f.evidence('qa', qaReport('BLOCK'));
  const blocked = await f.api.advance({ key: f.input.key, stage: 'qa' });
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.stage, 'qa');
  await assert.rejects(f.api.advance({ key: f.input.key, stage: 'owner_approval' }));
  assert.equal((await f.feature.read()).approvals.length, 0);
  await f.evidence('qa', qaReport('PASS', '[]'));
  assert.equal((await f.api.advance({ key: f.input.key, stage: 'qa' })).stage, 'owner_approval');
});

test('path traversal, outside path, root itself, relative path and symlink escape rejected', async (t) => {
  const f = await setup(t);
  const outside = join(f.directory, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'report.md'), 'outside');
  for (const file of [
    `${f.root}/../outside/report.md`,
    join(outside, 'report.md'),
    f.root,
    'relative.md',
  ])
    await assert.rejects(f.artifacts.verify(file, 'research'));
  const link = join(f.root, 'escape');
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.artifacts.verify(join(link, 'report.md'), 'research'), /корень/);
});

test('MP4 requires vertical square pixels, audio and finite bounded duration', () => {
  assert.deepEqual(validateVideo(probeResult), {
    width: 1080,
    height: 1920,
    duration: 45,
    audio: true,
  });
  for (const invalid of [
    null,
    {},
    { ...probeResult, streams: [probeResult.streams[0]] },
    {
      ...probeResult,
      streams: [{ codec_type: 'video', width: 1920, height: 1080 }, probeResult.streams[1]],
    },
    ...['NaN', '0', '181', 'Infinity'].map((duration) => ({
      ...probeResult,
      format: { duration },
    })),
    {
      ...probeResult,
      streams: [{ ...probeResult.streams[0], sample_aspect_ratio: '2:1' }, probeResult.streams[1]],
    },
    {
      ...probeResult,
      streams: [
        { ...probeResult.streams[0], side_data_list: [{ rotation: 90 }] },
        probeResult.streams[1],
      ],
    },
  ])
    assert.throws(() => validateVideo(invalid));
});

test('QA explicit verdict and explicit criteria protocol fails closed', () => {
  assert.equal(parseQaReport(qaReport('PASS', '[]')).verdict, 'PASS');
  assert.equal(
    parseQaReport('Вердикт: BLOCK\n## Непроверенные критерии\n- Звук\n').unverifiedCriteria[0],
    'Звук'
  );
  for (const report of [
    'PASS',
    'VERDICT: PASS\n',
    qaReport('PASS'),
    qaReport('BLOCK', ''),
    `${qaReport()}VERDICT: PASS\n`,
    qaReport('PASS_WITH_NOTES', 'произвольный текст'),
  ])
    assert.throws(() => parseQaReport(report));
});

test('artifact changes invalidate verification and repeated advance cannot skip a stage', async (t) => {
  const f = await setup(t);
  await f.api.create(f.input);
  await f.evidence('research');
  await writeFile(await f.file('research'), 'изменённый материал');
  await assert.rejects(f.api.advance({ key: f.input.key, stage: 'research' }), /изменён/);
  await f.evidence('research');
  const results = await Promise.allSettled([
    f.api.advance({ key: f.input.key, stage: 'research' }),
    f.api.advance({ key: f.input.key, stage: 'research' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await f.api.get(f.input.key)).task.stage, 'script');
});

test('planner uses registry snapshot, UNKNOWN unavailable; running CEO counts against cap', async (t) => {
  const f = await setup(t);
  f.options.production.capacity = async () => ({
    providers: { codex: { configured: true, availability: 'UNKNOWN' } },
    concurrencyCap: 3,
  });
  let task = await f.api.create(f.input);
  assert.equal(task.pipeline.stages[0].selection.activations.length, 0);
  assert.equal(task.pipeline.stages[0].selection.deferred[0].reason, 'no-available-executor');
  f.options.production.capacity = async () => ({
    providers: { codex: { configured: true, availability: 'AVAILABLE' } },
    concurrencyCap: 1,
    activeExecutors: [{ roleId: 'ceo', provider: 'codex' }],
  });
  await f.evidence('research');
  task = await f.api.advance({ key: f.input.key, stage: 'research' });
  assert.equal(task.pipeline.stages[1].selection.activations.length, 0);
  assert.equal(task.pipeline.stages[1].selection.deferred[0].reason, 'concurrency-cap');
});

test('desktop capacity adapter reads only the named supervisor registry and retains its CEO', async () => {
  const calls = [];
  const capacity = createCeoProductionCapacity(
    {
      read: async (teamName) => {
        calls.push(teamName);
        return {
          providers: {
            codex: { availability: 'RATE_LIMITED' },
            anthropic: { availability: 'UNKNOWN' },
          },
          owner: { provider: 'codex' },
        };
      },
    },
    () => true
  );
  assert.deepEqual(await capacity(null), { providers: {}, concurrencyCap: 3 });
  assert.equal(calls.length, 0);
  const value = await capacity('test-team');
  assert.deepEqual(calls, ['test-team']);
  assert.equal(value.providers.codex.availability, 'RATE_LIMITED');
  assert.equal(value.providers.anthropic.availability, 'UNKNOWN');
  assert.deepEqual(value.activeExecutors, [{ roleId: 'ceo', provider: 'codex' }]);
  await assert.rejects(
    createCeoProductionCapacity(
      {
        read: async () => {
          throw new Error('should not read');
        },
      },
      () => false
    )('test-team'),
    /локальном/
  );
});

test('file restart restores in-flight task, preserves artifacts/history and expires approval without sending', async (t) => {
  const f = await setup(t);
  const before = await f.toOwner();
  f.setTime(before.approval.expiresAt);
  const restarted = await createMediaOperationsFeature(f.options);
  const after = await restarted.production.get(f.input.key);
  assert.equal(after.approval.status, 'expired');
  assert.equal(after.task.stage, 'owner_approval');
  assert.deepEqual(after.task.pipeline.history, before.task.pipeline.history);
  assert.deepEqual(after.task.artifacts, before.task.artifacts);
  await restarted.production.decide({
    key: f.input.key,
    approvalId: before.approval.id,
    decision: 'approve',
  });
  assert.equal((await restarted.production.get(f.input.key)).approval.status, 'expired');
  await restarted.production.advance({ key: f.input.key, stage: 'owner_approval' });
  assert.equal((await restarted.production.get(f.input.key)).approval.status, 'pending');
  assert.equal((await restarted.read()).publications.length, 1);
});

test('rejection and silence never complete owner stage', async (t) => {
  const f = await setup(t);
  const detail = await f.toOwner();
  await f.api.advance({ key: f.input.key, stage: 'owner_approval' });
  assert.equal((await f.feature.read()).approvals.length, 1);
  await assert.rejects(
    f.api.decide({ key: f.input.key, approvalId: 'wrong', decision: 'approve' })
  );
  await f.api.decide({ key: f.input.key, approvalId: detail.approval.id, decision: 'reject' });
  const task = await f.api.advance({ key: f.input.key, stage: 'owner_approval' });
  assert.equal(task.pipeline.stages[8].status, 'blocked');
  await assert.rejects(f.api.advance({ key: f.input.key, stage: 'publication_queue' }));
});

test('restart fences publishing as outcome_unknown and never retries external effect', async (t) => {
  let calls = 0,
    release;
  const f = await setup(t, {
    publisher: {
      publish: () => {
        calls++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  await f.toOwner();
  await f.approve();
  const id = (await f.api.get(f.input.key)).publication.operationId;
  const pending = f.feature.publications.publish(id);
  // Wait for the fake publisher claim, not a real service.
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  const restarted = await createMediaOperationsFeature(f.options);
  assert.equal((await restarted.read()).publications[0].state, 'outcome_unknown');
  await assert.rejects(restarted.publications.publish(id));
  assert.equal(calls, 1);
  release({ status: 'published', externalId: 'fixture', url: 'https://example.invalid/fixture' });
  await pending;
  assert.equal((await restarted.read()).publications[0].state, 'outcome_unknown');
  await f.evidence('publication_queue');
  const task = await restarted.production.advance({ key: f.input.key, stage: 'publication_queue' });
  assert.equal(task.state, 'blocked');
  assert.equal(calls, 1);
});

test('discovery suggests contained files without attaching or advancing', async (t) => {
  const f = await setup(t);
  await f.api.create(f.input);
  for (const folder of ['render', 'qa', 'publish'])
    await mkdir(join(f.root, f.input.key, folder), { recursive: true });
  await writeFile(join(f.root, f.input.key, 'render', 'video.mp4'), 'fake mp4');
  await writeFile(join(f.root, f.input.key, 'qa', 'QA_REPORT.md'), qaReport());
  await writeFile(join(f.root, f.input.key, 'publish', 'PUBLISH_PACK.md'), 'package');
  const detail = await f.api.get(f.input.key);
  assert.equal(detail.suggestions.length, 3);
  assert.deepEqual(detail.task.artifacts, []);
  assert.equal(f.probes(), 0);
});

test('corrupt pipeline order fails closed on file-store restart', async (t) => {
  const f = await setup(t);
  await f.api.create(f.input);
  const file = join(f.options.directory, 'media-operations.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  state.tasks[0].pipeline.stages.reverse();
  await writeFile(file, JSON.stringify(state));
  await assert.rejects(createMediaOperationsFeature(f.options));
});

test('expired queue authority returns to owner for explicit renewal without a duplicate publication', async (t) => {
  const f = await setup(t);
  await f.toOwner();
  await f.approve();
  await f.evidence('publication_queue');
  const before = await f.api.get(f.input.key);
  f.setTime(before.approval.expiresAt);
  assert.equal((await f.api.get(f.input.key)).approval.status, 'expired');
  const waiting = await f.api.advance({ key: f.input.key, stage: 'publication_queue' });
  assert.equal(waiting.stage, 'owner_approval');
  await f.api.advance({ key: f.input.key, stage: 'owner_approval' });
  const renewed = await f.api.get(f.input.key);
  assert.notEqual(renewed.approval.id, before.approval.id);
  assert.equal(renewed.approval.status, 'pending');
  await f.approve();
  assert.equal(
    (await f.api.advance({ key: f.input.key, stage: 'publication_queue' })).state,
    'completed'
  );
  assert.equal((await f.feature.read()).publications.length, 1);
});

test('changed render after owner grant cannot enter publication queue', async (t) => {
  const f = await setup(t);
  await f.toOwner();
  await f.approve();
  await f.evidence('publication_queue');
  await writeFile(join(f.root, 'render.mp4'), 'изменённое видео');
  await assert.rejects(f.api.advance({ key: f.input.key, stage: 'publication_queue' }), /изменён/);
  assert.equal((await f.feature.read()).publications[0].attempts, 0);
});

test('restart between approval persistence and task checkpoint reuses approval ID', async (t) => {
  const f = await setup(t);
  const before = await f.toOwner();
  const file = join(f.options.directory, 'media-operations.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  // Simulate an interrupted task checkpoint after the approval transaction committed.
  state.tasks[0].pipeline.approvalId = null;
  state.tasks[0].pipeline.operationId = null;
  await writeFile(file, JSON.stringify(state));
  const restarted = await createMediaOperationsFeature(f.options);
  await restarted.production.advance({ key: f.input.key, stage: 'owner_approval' });
  assert.equal((await restarted.production.get(f.input.key)).approval.id, before.approval.id);
  assert.equal((await restarted.read()).approvals.length, 1);
  assert.equal((await restarted.read()).publications.length, 1);
});

test('IPC validates strict DTOs before facade access; preload maps every channel and dispose removes all', async () => {
  const handlers = new Map();
  let calls = 0;
  const api = Object.fromEntries(
    Object.keys(MEDIA_PRODUCTION_CHANNELS).map((key) => [
      key,
      async () => {
        calls++;
        return [];
      },
    ])
  );
  const dispose = registerProductionIpc(
    {
      handle: (channel, callback) => handlers.set(channel, callback),
      removeHandler: (channel) => handlers.delete(channel),
    },
    api
  );
  for (const [name, value] of [
    ['create', {}],
    ['get', '../outside'],
    ['attach', { key: 'ok', stage: 'qa', path: 'a', extra: true }],
    ['advance', { key: 'ok', stage: 'unknown' }],
    ['decide', { key: 'ok', approvalId: 'a', decision: 'yes' }],
    ['list', {}],
    ['summary', {}],
  ])
    await assert.rejects(handlers.get(MEDIA_PRODUCTION_CHANNELS[name])(null, value));
  assert.equal(calls, 0);
  const bridge = createMediaProductionBridge({
    invoke: async (channel, input) => handlers.get(channel)(null, input),
  });
  await bridge.list();
  await bridge.summary();
  await bridge.get('ok');
  await bridge.advance({ key: 'ok', stage: 'research' });
  assert.equal(calls, 4);
  dispose();
  assert.equal(handlers.size, 0);
  registerProductionIpc(
    { handle: (channel, callback) => handlers.set(channel, callback), removeHandler() {} },
    api,
    () => false
  );
  await assert.rejects(handlers.get(MEDIA_PRODUCTION_CHANNELS.list)(null), /локальном/);
});

test('Telegram disabled without env file; fake fetch exact owner-only commands, bounded poll, multipart and redacted errors', async (t) => {
  assert.equal(
    await loadTelegramOwnerAdapter(undefined, async () => {
      throw new Error('must not run');
    }),
    null
  );
  assert.throws(() => parseTelegramConfig('TOKEN=invalid\nOWNER_ID=1'), /конфигурация/);
  const sent = [],
    commands = [];
  const config = { token: '123:TEST_ONLY_NOT_A_REAL_TOKEN', ownerId: '42' };
  const updates = [
    {
      update_id: 1,
      message: { from: { id: 99 }, chat: { id: 42, type: 'private' }, text: 'approve a' },
    },
    ...['approve a ', 'Approve a', 'approve a\n', 'можно', 'approve a', 'reject b'].map(
      (text, index) => ({
        update_id: index + 2,
        message: { from: { id: 42 }, chat: { id: 42, type: 'private' }, text },
      })
    ),
  ];
  const adapter = new TelegramOwnerAdapter(config, async (url, request) => {
    sent.push({ url, request });
    return new Response(
      JSON.stringify({ ok: true, result: url.endsWith('getUpdates') ? updates : true })
    );
  });
  await adapter.pollOnce(async (id, text) => {
    commands.push([id, text]);
  });
  await adapter.pollOnce(async (id, text) => {
    commands.push([id, text]);
  });
  assert.deepEqual(commands, [
    ['42', 'approve a'],
    ['42', 'reject b'],
  ]);
  assert.equal(JSON.parse(sent[0].request.body).timeout, 20);
  assert.equal(JSON.parse(sent[1].request.body).offset, 8);
  await adapter.sendMessage('42', 'согласование');
  const f = await setup(t);
  const video = await f.file('render');
  await adapter.sendVideo('42', video, 'тест');
  assert.ok(sent.at(-1).request.body instanceof FormData);
  assert.ok(sent.at(-1).request.body.get('video') instanceof Blob);
  await assert.rejects(adapter.sendMessage('99', 'x'));
  const failing = new TelegramOwnerAdapter(config, async () => {
    throw new Error(`network ${config.token}`);
  });
  await assert.rejects(
    failing.sendMessage('42', 'x'),
    (error) => !String(error).includes(config.token)
  );
  await adapter.dispose();
  await failing.dispose();
});

test('QA duplicate criteria sections cannot hide unverified criteria', () => {
  assert.throws(() =>
    parseQaReport(
      'VERDICT: PASS\n## UNVERIFIED_CRITERIA\n[]\n## UNVERIFIED_CRITERIA\n- Не проверен звук\n'
    )
  );
});

test('Telegram disposal aborts an active fake poll and adapter serialization excludes token', async () => {
  let entered,
    aborted = false;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const token = '123:TEST_ONLY_NOT_A_REAL_TOKEN';
  const adapter = new TelegramOwnerAdapter({ token, ownerId: '42' }, async (_url, request) => {
    entered();
    return new Promise((_resolve, reject) =>
      request.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error(token));
      })
    );
  });
  assert.ok(!JSON.stringify(adapter).includes(token));
  adapter.start(
    async () => undefined,
    async () => undefined
  );
  await started;
  await adapter.dispose();
  assert.equal(aborted, true);
});
