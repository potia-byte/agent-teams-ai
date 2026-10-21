import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { CeoSupervisor } from '../../../src/features/ceo-provider-supervisor/core/application/CeoSupervisor';
import { JsonCeoRepository } from '../../../src/features/ceo-provider-supervisor/main/infrastructure/JsonCeoRepository';

import { quota, supervisorFixture } from './supervisorCases';

import type { CeoState, CeoTask } from '../../../src/features/ceo-provider-supervisor/contracts';
import type { AvailabilityProbePort } from '../../../src/features/ceo-provider-supervisor/core/application/AvailabilityProbes';
import type { CeoTaskPort } from '../../../src/features/ceo-provider-supervisor/core/application/CeoTaskQueue';

const parent = resolve('test/features/ceo-provider-supervisor');
const at = '2026-10-21T12:00:00.000Z';
const input = (id: string, kind: CeoTask['kind'] = 'llm') => ({
  id,
  idempotencyKey: 'effect:' + id,
  kind,
  lastSafeCheckpointId: 'safe-checkpoint',
});

async function withStore(
  operation: (store: {
    repository: JsonCeoRepository;
    fixture: ReturnType<typeof supervisorFixture>;
    create(options?: { probe?: AvailabilityProbePort; executor?: CeoTaskPort }): CeoSupervisor;
    advance(ms: number): void;
    directory: string;
    file(): Promise<string>;
  }) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(parent, '.store-'));
  if (dirname(resolve(directory)) !== parent || !basename(directory).startsWith('.store-'))
    throw new Error('Unsafe test store cleanup');
  try {
    const repository = new JsonCeoRepository(directory, 'isolated-context');
    const fixture = supervisorFixture('codex', repository);
    let now = Date.parse(at);
    const create = (options: { probe?: AvailabilityProbePort; executor?: CeoTaskPort } = {}) =>
      new CeoSupervisor({
        repository: new JsonCeoRepository(directory, 'isolated-context'),
        runtime: fixture.runtime,
        now: () => new Date(now).toISOString(),
        newId: () => 'checkpoint-test',
        probe: options.probe,
        taskExecutor: options.executor,
      });
    await operation({
      repository,
      fixture,
      create,
      directory,
      advance: (ms) => {
        now += ms;
      },
      file: async () => {
        const files = await readdir(directory, { recursive: true });
        const file = files.find((name) => name.endsWith(quota.teamName + '.json'));
        assert.ok(file);
        return join(directory, file);
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function registerRecoveryCases(
  test: (name: string, body: () => void | Promise<void>) => unknown
): void {
  test('cheap auth/version evidence cannot promote UNKNOWN or clear RATE_LIMITED', async () => {
    await withStore(async ({ create, fixture, repository, advance }) => {
      fixture.setCurrent(null);
      let calls = 0;
      const probe: AvailabilityProbePort = {
        check: async () => {
          calls++;
          return { availability: 'AVAILABLE', explicitCapacity: false };
        },
      };
      let state = await create({ probe }).probeAvailability(quota.teamName, 'codex');
      assert.equal(state.providers.codex.availability, 'UNKNOWN');
      assert.equal(state.providers.codex.probesToday, 1);
      await repository.exclusive(quota.teamName, async (draft, save) => {
        draft.providers.codex.availability = 'RATE_LIMITED';
        draft.providers.codex.verifiedAt = at;
        await save();
      });
      advance(16 * 60_000);
      state = await create({ probe }).probeAvailability(quota.teamName, 'codex');
      assert.equal(state.providers.codex.availability, 'RATE_LIMITED');
      assert.equal(state.providers.codex.probesToday, 2);
      assert.equal(calls, 2);
      assert.equal(fixture.launches.length, 0);
    });
  });

  test('explicit successful probe restores primary pool without interrupting reserve', async () => {
    await withStore(async ({ create, fixture, advance }) => {
      await fixture.prepare();
      await fixture.supervisor.observe(quota);
      const before = await fixture.create().read(quota.teamName);
      assert.equal(before.owner?.provider, 'anthropic');
      advance(7 * 60 * 60_000);
      const state = await create({
        probe: { check: async () => ({ availability: 'AVAILABLE', explicitCapacity: true }) },
      }).probeAvailability(quota.teamName, 'codex');
      assert.equal(state.providers.codex.availability, 'AVAILABLE');
      assert.equal(state.providers.codex.cooldownUntil, null);
      assert.equal(state.providers.codex.consecutiveFailures, 0);
      assert.equal(state.providers.codex.totalFailures, 1);
      assert.deepEqual(state.owner, before.owner);
      assert.equal(state.epoch, before.epoch);
      assert.equal(fixture.launches.length, 1);
      assert.equal(fixture.stops.length, 1);
    });
  });

  test('busy owner and unregistered live runtime never receive a scheduled probe', async () => {
    await withStore(async ({ create, fixture, repository }) => {
      let calls = 0;
      const probe: AvailabilityProbePort = {
        check: async () => {
          calls++;
          return { availability: 'AVAILABLE', explicitCapacity: true };
        },
      };
      // Live runtime is present before the role is enabled.
      await create({ probe }).probeAvailability(quota.teamName, 'codex');
      await fixture.prepare();
      await create({ probe }).probeAvailability(quota.teamName, 'codex');
      await repository.exclusive(quota.teamName, async (state, save) => {
        state.providers.codex.availability = 'UNKNOWN';
        await save();
      });
      await create({ probe }).probeAvailability(quota.teamName, 'codex');
      assert.equal(calls, 0);
      assert.equal((await repository.read(quota.teamName)).providers.codex.probesToday, 0);
    });
  });

  test('concurrent probe ticks consume one durable attempt and restart preserves daily limit', async () => {
    await withStore(async ({ create, fixture, repository, advance }) => {
      fixture.setCurrent(null);
      let calls = 0;
      const probe: AvailabilityProbePort = {
        check: async () => {
          calls++;
          throw new Error('raw error must not persist');
        },
      };
      await Promise.all([
        create({ probe }).probeAvailability(quota.teamName, 'codex'),
        create({ probe }).probeAvailability(quota.teamName, 'codex'),
      ]);
      assert.equal(calls, 1);
      let state = await repository.read(quota.teamName);
      assert.equal(state.providers.codex.probeFailures, 1);
      assert.equal(state.providers.codex.probesToday, 1);
      assert.doesNotMatch(JSON.stringify(state), /raw error/);
      await repository.exclusive(quota.teamName, async (draft, save) => {
        draft.providers.codex.probesToday = 8;
        await save();
      });
      advance(7 * 60 * 60_000);
      await create({ probe }).probeAvailability(quota.teamName, 'codex');
      assert.equal(calls, 1);
      advance(24 * 60 * 60_000);
      state = await create({ probe }).probeAvailability(quota.teamName, 'codex');
      assert.equal(calls, 2);
      assert.equal(state.providers.codex.probesToday, 1);
    });
  });

  test('probe reservation survives crash before evidence and respects backoff after restart', async () => {
    await withStore(async ({ create, fixture, repository }) => {
      fixture.setCurrent(null);
      let reserved = false;
      const supervisor = create({
        probe: {
          check: async () => {
            const state = await repository.read(quota.teamName);
            reserved =
              state.providers.codex.probesToday === 1 && state.providers.codex.probeFailures === 1;
            throw new Error('interrupted');
          },
        },
      });
      await supervisor.probeAvailability(quota.teamName, 'codex');
      let calls = 0;
      await create({
        probe: {
          check: async () => {
            calls++;
            return { availability: 'AVAILABLE', explicitCapacity: true };
          },
        },
      }).probeAvailability(quota.teamName, 'codex');
      assert.equal(reserved, true);
      assert.equal(calls, 0);
    });
  });

  test('nonquota failures update registry counters/cooldown but never hand off', async () => {
    await withStore(async ({ fixture, repository }) => {
      await fixture.prepare();
      for (const [detail, statusCode] of [
        ['retry-after: 60', 429],
        ['ECONNRESET', undefined],
        ['unauthorized', 401],
        ['tool failed', undefined],
        ['process timeout', undefined],
        ['unexpected', undefined],
      ] as const) {
        await fixture.supervisor.observe({
          ...quota,
          detail,
          statusCode,
          retryAfterMs: statusCode === 429 ? 3_600_000 : undefined,
        });
      }
      const state = await repository.read(quota.teamName);
      assert.equal(state.providers.codex.totalFailures, 6);
      assert.equal(state.providers.codex.cooldownUntil, '2026-10-20T13:00:00.000Z');
      assert.equal(state.providers.codex.availability, 'AUTH_REQUIRED');
      assert.equal(fixture.stops.length, 0);
      assert.equal(fixture.launches.length, 0);
      assert.equal(state.epoch, 1);
      await fixture.supervisor.observe({ ...quota, runId: 'retired-run' });
      assert.equal((await repository.read(quota.teamName)).providers.codex.totalFailures, 6);
    });
  });

  test('pending LLM work stays queued with no provider while non_llm completes', async () => {
    await withStore(async ({ create, fixture }) => {
      fixture.setCurrent(null);
      const executed: string[] = [];
      const supervisor = create({
        executor: {
          execute: async (task) => {
            executed.push(task.id);
          },
        },
      });
      await supervisor.tasks.enqueue(quota.teamName, input('llm'));
      assert.equal(await supervisor.tasks.dispatchNext(quota.teamName), null);
      await supervisor.tasks.enqueue(quota.teamName, input('local-render', 'non_llm'));
      const done = await supervisor.tasks.dispatchNext(quota.teamName);
      assert.equal(done?.provider, null);
      assert.equal(done?.state, 'done');
      assert.deepEqual(executed, ['local-render']);
      const tasks = await create().tasks.read(quota.teamName);
      assert.deepEqual(
        tasks.map((task) => [task.id, task.state, task.attempts]),
        [
          ['llm', 'pending', 0],
          ['local-render', 'done', 1],
        ]
      );
    });
  });

  test('AVAILABLE provider dispatch persists claim/checkpoint before effects and deduplicates keys', async () => {
    await withStore(async ({ create, repository, fixture }) => {
      fixture.setCurrent(null);
      await repository.exclusive(quota.teamName, async (state, save) => {
        state.providers.codex.availability = 'AVAILABLE';
        await save();
      });
      let calls = 0;
      const supervisor = create({
        executor: {
          execute: async (task) => {
            calls++;
            const stored = await repository.read(quota.teamName);
            assert.equal(stored.tasks[0].state, 'running');
            assert.equal(stored.tasks[0].attempts, 1);
            assert.equal(stored.providers.codex.availability, 'BUSY');
            assert.equal(task.lastSafeCheckpointId, 'safe-checkpoint');
            assert.equal(task.idempotencyKey, 'effect:publish');
          },
        },
      });
      await Promise.all([
        supervisor.tasks.enqueue(quota.teamName, input('publish')),
        create().tasks.enqueue(quota.teamName, { ...input('publish'), id: 'duplicate' }),
      ]);
      assert.equal((await supervisor.tasks.read(quota.teamName)).length, 1);
      assert.equal((await supervisor.tasks.dispatchNext(quota.teamName))?.state, 'done');
      await supervisor.tasks.enqueue(quota.teamName, input('publish'));
      assert.equal(await supervisor.tasks.dispatchNext(quota.teamName), null);
      assert.equal(calls, 1);
      assert.equal(
        (await repository.read(quota.teamName)).providers.codex.availability,
        'AVAILABLE'
      );
    });
  });

  test('file-store restart blocks running tasks for reconciliation and dispatches only pending', async () => {
    await withStore(async ({ create, repository, fixture }) => {
      fixture.setCurrent(null);
      const initial = create();
      for (const id of ['interrupted', 'pending', 'done'])
        await initial.tasks.enqueue(quota.teamName, input(id));
      await repository.exclusive(quota.teamName, async (state, save) => {
        Object.assign(state.tasks[0], { state: 'running', attempts: 2, provider: 'codex' });
        Object.assign(state.tasks[2], { state: 'done', attempts: 1, provider: 'anthropic' });
        state.providers.codex.availability = 'BUSY';
        await save();
      });
      const executed: string[] = [];
      const restarted = create({
        executor: {
          execute: async (task) => {
            executed.push(task.id);
          },
        },
      });
      const recovered = await restarted.read(quota.teamName);
      assert.equal(recovered.tasks[0].state, 'blocked');
      assert.equal(recovered.tasks[0].blockReason, 'reconciliation_required');
      assert.equal(recovered.tasks[0].lastSafeCheckpointId, 'safe-checkpoint');
      assert.equal(recovered.tasks[0].attempts, 2);
      assert.equal(recovered.providers.codex.availability, 'UNKNOWN');
      assert.equal(await restarted.tasks.dispatchNext(quota.teamName), null);
      await restarted.command({ teamName: quota.teamName, action: 'available', provider: 'codex' });
      await restarted.tasks.dispatchNext(quota.teamName);
      assert.deepEqual(executed, ['pending']);
      const again = await create().tasks.read(quota.teamName);
      assert.deepEqual(
        again.map((task) => task.state),
        ['blocked', 'done', 'done']
      );
      assert.equal(again[0].attempts, 2);
    });
  });

  test('failed task effects block reconciliation, persist no raw errors and never replay', async () => {
    await withStore(async ({ create, fixture, repository }) => {
      fixture.setCurrent(null);
      let calls = 0;
      const executor: CeoTaskPort = {
        execute: async () => {
          calls++;
          throw new Error('sensitive external error');
        },
      };
      const supervisor = create({ executor });
      await supervisor.tasks.enqueue(quota.teamName, input('send-message', 'non_llm'));
      const task = await supervisor.tasks.dispatchNext(quota.teamName);
      assert.equal(task?.state, 'blocked');
      assert.equal(task?.blockReason, 'reconciliation_required');
      await create({ executor }).tasks.dispatchNext(quota.teamName);
      assert.equal(calls, 1);
      assert.doesNotMatch(
        JSON.stringify(await repository.read(quota.teamName)),
        /sensitive external error/
      );
    });
  });

  test('crash after task effects but before final save blocks replay on file-store restart', async () => {
    await withStore(async ({ create, repository, fixture }) => {
      fixture.setCurrent(null);
      let effects = 0;
      let failCompletionSave = false;
      const supervisor = new CeoSupervisor({
        repository: {
          read: (team) => repository.read(team),
          exclusive: (team, operation) =>
            repository.exclusive(team, (state, save) =>
              operation(state, async () => {
                if (failCompletionSave) throw new Error('simulated crash before final write');
                await save();
              })
            ),
        },
        runtime: fixture.runtime,
        now: () => at,
        newId: () => 'checkpoint',
        taskExecutor: {
          execute: async () => {
            effects++;
            failCompletionSave = true;
          },
        },
      });
      await supervisor.tasks.enqueue(quota.teamName, input('publish-once', 'non_llm'));
      await assert.rejects(() => supervisor.tasks.dispatchNext(quota.teamName), /simulated crash/);
      assert.equal((await repository.read(quota.teamName)).tasks[0].state, 'running');
      const restarted = create({
        executor: {
          execute: async () => {
            effects++;
          },
        },
      });
      assert.equal(await restarted.tasks.dispatchNext(quota.teamName), null);
      const task = (await restarted.tasks.read(quota.teamName))[0];
      assert.equal(task.state, 'blocked');
      assert.equal(task.blockReason, 'reconciliation_required');
      assert.equal(task.attempts, 1);
      assert.equal(effects, 1);
    });
  });

  test('blocked supervisor dispatches non_llm work while preserving queued LLM work', async () => {
    await withStore(async ({ create, repository, fixture }) => {
      fixture.setCurrent(null);
      await repository.exclusive(quota.teamName, async (state, save) => {
        state.status = 'blocked';
        state.providers.codex.availability = 'AVAILABLE';
        await save();
      });
      const executed: string[] = [];
      const supervisor = create({
        executor: {
          execute: async (task) => {
            executed.push(task.id);
          },
        },
      });
      await supervisor.tasks.enqueue(quota.teamName, input('llm'));
      await supervisor.tasks.enqueue(quota.teamName, input('local', 'non_llm'));
      await supervisor.tasks.dispatchNext(quota.teamName);
      assert.equal(await supervisor.tasks.dispatchNext(quota.teamName), null);
      assert.deepEqual(executed, ['local']);
      assert.equal((await repository.read(quota.teamName)).tasks[0].state, 'pending');
    });
  });

  test('legacy registry/task fields default only when absent; corrupt counters/tasks fail closed', async () => {
    await withStore(async ({ repository, file }) => {
      await repository.exclusive(quota.teamName, async (_state, save) => save());
      const path = await file();
      const valid = JSON.parse(await readFile(path, 'utf8')) as CeoState;
      const legacy = structuredClone(valid) as Partial<CeoState>;
      delete legacy.tasks;
      // Simulate the exact old health shape through JSON, without weakening production types.
      Object.assign(legacy, {
        providers: {
          codex: { availability: 'UNKNOWN', verifiedAt: null },
          anthropic: { availability: 'UNKNOWN', verifiedAt: null },
        },
      });
      const contents = JSON.stringify(legacy);
      await writeFile(path, contents, 'utf8');
      const migrated = await repository.read(quota.teamName);
      assert.deepEqual(migrated.tasks, []);
      assert.equal(migrated.providers.codex.totalFailures, 0);
      assert.equal(migrated.providers.opencode.availability, 'UNKNOWN');
      assert.equal(await readFile(path, 'utf8'), contents);
      const variants = [
        { ...valid, tasks: null },
        { ...valid, tasks: [{ ...input('bad'), state: 'running', attempts: -1 }] },
        {
          ...valid,
          providers: { ...valid.providers, codex: { ...valid.providers.codex, probesToday: -1 } },
        },
        {
          ...valid,
          providers: {
            ...valid.providers,
            codex: { ...valid.providers.codex, cooldownUntil: 'invalid' },
          },
        },
      ];
      for (const variant of variants) {
        const invalid = JSON.stringify(variant);
        await writeFile(path, invalid, 'utf8');
        await assert.rejects(() => repository.read(quota.teamName), /Invalid CEO/);
        assert.equal(await readFile(path, 'utf8'), invalid);
      }
    });
  });
}
