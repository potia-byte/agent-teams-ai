import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { JsonCeoRepository } from '../../../src/features/ceo-provider-supervisor/main/infrastructure/JsonCeoRepository';
import { createProvisioningCeoRuntime } from '../../../src/main/services/team/provisioning/TeamProvisioningCeoRuntime';

import { quota, supervisorFixture } from './supervisorCases';

import type { ProvisioningRun } from '../../../src/main/services/team/provisioning/TeamProvisioningRunModel';
import type { TeamLaunchRequest } from '../../../src/shared/types';

const storeParent = resolve('test/features/ceo-provider-supervisor');
async function removeTestStore(directory: string): Promise<void> {
  if (dirname(resolve(directory)) !== storeParent || !basename(directory).startsWith('.store-')) {
    throw new Error('Refusing cleanup outside the test store');
  }
  await rm(directory, { recursive: true, force: true });
}
async function stateFile(directory: string, teamName = quota.teamName): Promise<string> {
  const files = await readdir(directory, { recursive: true });
  const file = files.find((entry) => entry.endsWith(teamName + '.json'));
  assert.ok(file, 'persisted CEO state exists');
  return join(directory, file);
}

export function registerAdapterCases(
  test: (name: string, body: () => void | Promise<void>) => unknown
): void {
  test('real JSON storage survives reconstruction and serializes competing instances', async () => {
    const directory = await mkdtemp(join(storeParent, '.store-'));
    try {
      const first = new JsonCeoRepository(directory, 'test-only');
      const second = new JsonCeoRepository(directory, 'test-only');
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          (index % 2 ? first : second).exclusive('sandbox', async (state, save) => {
            const previous = state.epoch;
            await new Promise((resolve) => setTimeout(resolve, 2));
            state.epoch = previous + 1;
            await save();
          })
        )
      );
      assert.equal((await new JsonCeoRepository(directory, 'test-only').read('sandbox')).epoch, 8);
      await first.bindRole('sandbox');
      await second.bindRole('sandbox');
      await assert.rejects(() => second.bindRole('another-team'), /One logical CEO/);
      const stateFiles = await readdir(directory, { recursive: true });
      const stateFile = stateFiles.find((entry) => entry.endsWith('sandbox.json'))!;
      const contents = await readFile(join(directory, stateFile), 'utf8');
      assert.equal(JSON.parse(contents).epoch, 8);
      await writeFile(join(directory, stateFile), '{corrupted', 'utf8');
      await assert.rejects(() => first.read('sandbox'));
      assert.equal(await readFile(join(directory, stateFile), 'utf8'), '{corrupted');
      await assert.rejects(() => first.read('../outside'));
    } finally {
      await removeTestStore(directory);
    }
  });
  test('legacy v1 state loads default roles, derives owner role and persists additive fields', async () => {
    const directory = await mkdtemp(join(storeParent, '.store-'));
    try {
      const repository = new JsonCeoRepository(directory, 'isolated-context');
      const fixture = supervisorFixture('anthropic', repository);
      await fixture.prepare();
      const file = await stateFile(directory);
      const legacy = JSON.parse(await readFile(file, 'utf8'));
      delete legacy.roles;
      delete legacy.owner.role;
      delete legacy.checkpoint.provider;
      await writeFile(file, JSON.stringify(legacy), 'utf8');
      const restartedRepository = new JsonCeoRepository(directory, 'isolated-context');
      const state = await fixture.create(restartedRepository).read(quota.teamName);
      assert.equal(state.version, 1);
      assert.deepEqual(state.roles, { primary: 'codex', reserve: 'anthropic' });
      assert.deepEqual(state.owner, {
        provider: 'anthropic',
        runId: 'anthropic-run',
        role: 'reserve',
      });
      assert.equal(state.checkpoint?.provider, 'anthropic');
      await fixture
        .create(restartedRepository)
        .command({ teamName: quota.teamName, action: 'available', provider: 'codex' });
      const saved = JSON.parse(await readFile(file, 'utf8'));
      assert.deepEqual(saved.roles, state.roles);
      assert.equal(saved.owner.role, 'reserve');
      assert.equal(fixture.stops.length, 0);
      assert.equal(fixture.launches.length, 0);
    } finally {
      await removeTestStore(directory);
    }
  });
  test('persisted custom roles survive reconstruction and drive reserve selection', async () => {
    const directory = await mkdtemp(join(storeParent, '.store-'));
    try {
      const repository = new JsonCeoRepository(directory, 'isolated-context');
      await repository.exclusive(quota.teamName, async (state, save) => {
        state.roles = { primary: 'anthropic', reserve: 'codex' };
        await save();
      });
      const fixture = supervisorFixture(
        'anthropic',
        new JsonCeoRepository(directory, 'isolated-context')
      );
      await fixture.prepare();
      await fixture.supervisor.command({
        teamName: quota.teamName,
        action: 'available',
        provider: 'codex',
      });
      await fixture.supervisor.observe({
        ...quota,
        runId: 'anthropic-run',
        providerId: 'anthropic',
        detail: "You've hit your limit",
      });
      const state = await new JsonCeoRepository(directory, 'isolated-context').read(quota.teamName);
      assert.deepEqual(state.roles, { primary: 'anthropic', reserve: 'codex' });
      assert.equal(state.owner?.provider, 'codex');
      assert.equal(state.owner?.role, 'reserve');
      assert.equal(fixture.launches.length, 1);
    } finally {
      await removeTestStore(directory);
    }
  });
  test('invalid roles, owner role, checkpoint provider and future versions fail closed without rewriting', async () => {
    const directory = await mkdtemp(join(storeParent, '.store-'));
    try {
      const repository = new JsonCeoRepository(directory, 'isolated-context');
      const fixture = supervisorFixture('codex', repository);
      await fixture.prepare();
      const file = await stateFile(directory);
      const valid = JSON.parse(await readFile(file, 'utf8'));
      const variants = [
        { ...valid, roles: null },
        { ...valid, roles: { primary: 'codex', reserve: 'codex' } },
        { ...valid, roles: { primary: 'codex', reserve: 'paid-api' } },
        { ...valid, owner: { ...valid.owner, role: 'reserve' } },
        { ...valid, checkpoint: { ...valid.checkpoint, provider: 'paid-api' } },
        { ...valid, version: 2 },
      ];
      for (const variant of variants) {
        const contents = JSON.stringify(variant);
        await writeFile(file, contents, 'utf8');
        await assert.rejects(
          () => new JsonCeoRepository(directory, 'isolated-context').read(quota.teamName),
          /Invalid CEO/
        );
        assert.equal(await readFile(file, 'utf8'), contents);
      }
    } finally {
      await removeTestStore(directory);
    }
  });
  test('legacy waiting checkpoint with unknown provider cannot authorize a fresh launch', async () => {
    const directory = await mkdtemp(join(storeParent, '.store-'));
    try {
      const repository = new JsonCeoRepository(directory, 'isolated-context');
      const fixture = supervisorFixture('codex', repository);
      await fixture.prepare();
      const file = await stateFile(directory);
      const legacy = JSON.parse(await readFile(file, 'utf8'));
      legacy.status = 'waiting';
      legacy.owner = null;
      delete legacy.roles;
      delete legacy.checkpoint.provider;
      await writeFile(file, JSON.stringify(legacy), 'utf8');
      fixture.setCurrent(null);
      const state = await fixture
        .create(new JsonCeoRepository(directory, 'isolated-context'))
        .command({ teamName: quota.teamName, action: 'retry' });
      assert.equal(state.status, 'blocked');
      assert.equal(state.checkpoint?.provider, null);
      assert.equal(fixture.launches.length, 0);
    } finally {
      await removeTestStore(directory);
    }
  });
  for (const interruptedStatus of ['starting', 'stopping'] as const) {
    for (const entrypoint of ['read', 'command', 'observe'] as const) {
      test(
        'new supervisor and JSON repository block persisted ' +
          interruptedStatus +
          ' via ' +
          entrypoint +
          ' without second launch',
        async () => {
          const directory = await mkdtemp(join(storeParent, '.store-'));
          try {
            const repository = new JsonCeoRepository(directory, 'isolated-context');
            const fixture = supervisorFixture('codex', repository);
            await fixture.prepare();
            await fixture.supervisor.observe(quota);
            assert.equal(fixture.launches.length, 1);
            await repository.exclusive(quota.teamName, async (state, save) => {
              state.status = interruptedStatus;
              if (interruptedStatus === 'starting') state.owner = null;
              await save();
            });
            const restarted = fixture.create(new JsonCeoRepository(directory, 'isolated-context'));
            if (entrypoint === 'observe') assert.equal(await restarted.observe(quota), true);
            const state =
              entrypoint === 'read'
                ? await restarted.read(quota.teamName)
                : entrypoint === 'command'
                  ? await restarted.command({ teamName: quota.teamName, action: 'retry' })
                  : await new JsonCeoRepository(directory, 'isolated-context').read(quota.teamName);
            assert.equal(state.status, 'blocked');
            await restarted.command({
              teamName: quota.teamName,
              action: 'available',
              provider: 'codex',
            });
            await restarted.command({
              teamName: quota.teamName,
              action: 'available',
              provider: 'anthropic',
            });
            await restarted.command({ teamName: quota.teamName, action: 'retry' });
            await restarted.observe(quota);
            assert.equal(
              (await new JsonCeoRepository(directory, 'isolated-context').read(quota.teamName))
                .status,
              'blocked'
            );
            assert.equal(fixture.launches.length, 1);
            assert.equal(fixture.stops.length, 1);
          } finally {
            await removeTestStore(directory);
          }
        }
      );
    }
  }
  test('JSON file lock serializes observe plus commands across separate supervisor/repository instances', async () => {
    const directory = await mkdtemp(join(storeParent, '.store-'));
    try {
      const fixture = supervisorFixture(
        'codex',
        new JsonCeoRepository(directory, 'isolated-context')
      );
      await fixture.prepare();
      let release!: () => void;
      fixture.blockStop(
        new Promise<void>((resolve) => {
          release = resolve;
        })
      );
      const observing = fixture.supervisor.observe(quota);
      await fixture.stopEntered;
      let commandsCompleted = 0;
      const restarted = fixture.create(new JsonCeoRepository(directory, 'isolated-context'));
      const competing = [
        restarted.command({ teamName: quota.teamName, action: 'available', provider: 'anthropic' }),
        restarted.command({ teamName: quota.teamName, action: 'retry' }),
        restarted.observe(quota),
      ].map((promise) =>
        promise.then(() => {
          commandsCompleted++;
        })
      );
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(commandsCompleted, 0);
        assert.equal(fixture.launches.length, 0);
      } finally {
        release();
      }
      await Promise.all([observing, ...competing]);
      const state = await restarted.read(quota.teamName);
      assert.equal(state.status, 'active');
      assert.equal(state.owner?.provider, 'anthropic');
      assert.equal(fixture.launches.length, 1);
      assert.equal(fixture.stops.length, 1);
    } finally {
      await removeTestStore(directory);
    }
  });
  for (const provider of ['codex', 'anthropic'] as const) {
    test(
      'lifecycle adapter creates fresh ' +
        provider +
        ' session without inherited provider session IDs',
      async () => {
        const child = { pid: 123, exitCode: null as number | null, signalCode: null };
        let run = {
          runId: 'old',
          request: {
            cwd: 'C:/isolated-sandbox',
            providerId: provider === 'codex' ? 'anthropic' : 'codex',
            extraCliArgs: '--resume private-session',
            resumeSessionId: 'private-session',
          },
          launchIdentity: { billingMode: 'subscription' },
          child,
          provisioningComplete: true,
          activeToolCalls: new Map(),
          pendingApprovals: new Map(),
          expectedMembers: [],
          leadActivityState: 'idle',
          ceoEffectRevision: 4,
        } as unknown as ProvisioningRun | undefined;
        let launched: TeamLaunchRequest | null = null;
        const adapter = createProvisioningCeoRuntime({
          exclusive: async (_team, operation) => operation(),
          getRun: () => run,
          hasSecondaryRuns: () => false,
          readProjectPath: async () => 'C:/isolated-sandbox',
          stop: async () => {
            child.exitCode = 0;
            run = undefined;
          },
          launch: async (request) => {
            launched = request;
            return { runId: 'new' };
          },
        });
        assert.equal((await adapter.inspect('sandbox'))?.effectsRevision, 4);
        await assert.rejects(() => adapter.stop('sandbox', 'stale'), /Stale/);
        await adapter.stop('sandbox', 'old');
        assert.equal(await adapter.start('sandbox', provider, 'saved-checkpoint'), 'new');
        const request = launched as TeamLaunchRequest | null;
        assert.equal(request?.providerId, provider);
        assert.equal(request?.providerBackendId, provider === 'codex' ? 'codex-native' : 'cli-sdk');
        assert.equal(request?.requiredBillingMode, 'subscription');
        assert.equal(request?.skipPermissions, false);
        assert.equal(request?.extraCliArgs, '');
        assert.equal(request?.clearContext, true);
        assert.doesNotMatch(JSON.stringify(request), /private-session|sessionId/);
      }
    );
  }
  test('adapter rejects unconfirmed physical stop even if registry has been cleaned', async () => {
    const child = { pid: 123, exitCode: null, signalCode: null };
    let run = { runId: 'old', child } as unknown as ProvisioningRun | undefined;
    const adapter = createProvisioningCeoRuntime({
      exclusive: async (_team, operation) => operation(),
      getRun: () => run,
      hasSecondaryRuns: () => false,
      readProjectPath: async () => undefined,
      stop: async () => {
        run = undefined;
      },
      launch: async () => {
        throw new Error('must not launch');
      },
    });
    await assert.rejects(() => adapter.stop('sandbox', 'old'), /termination not confirmed/);
  });
  test('tool activity after checkpoint invalidates replay even when terminal stream clears active tools', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    fixture.setCurrent({ runId: 'codex-run', provider: 'codex', safe: true, effectsRevision: 1 });
    await fixture.supervisor.observe(quota);
    assert.equal(fixture.state().status, 'blocked');
    assert.equal(fixture.launches.length, 0);
  });
}
