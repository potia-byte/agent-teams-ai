import assert from 'node:assert/strict';

import { createProvisioningCeoRuntime } from '../../../src/main/services/team/provisioning/TeamProvisioningCeoRuntime';

import { quota, supervisorFixture } from './supervisorCases';

import type { ProvisioningRun } from '../../../src/main/services/team/provisioning/TeamProvisioningRunModel';
import type { TeamLaunchRequest } from '../../../src/shared/types';

export function registerRuntimeStartCases(
  test: (name: string, body: () => void | Promise<void>) => unknown
): void {
  const makeRun = (runId: string, request: TeamLaunchRequest) =>
    ({
      runId,
      teamName: quota.teamName,
      request,
      launchIdentity: { billingMode: 'subscription' },
      child: { pid: 123, exitCode: null, signalCode: null },
      provisioningComplete: true,
      leadActivityState: 'idle',
      activeToolCalls: new Map(),
      pendingApprovals: new Map(),
      expectedMembers: [],
    }) as unknown as ProvisioningRun;

  async function setup(mode: 'lag' | 'missing' | 'provider' | 'runId' | 'billing' | 'rejected') {
    const fixture = supervisorFixture();
    await fixture.prepare();
    let run: ProvisioningRun | undefined = makeRun(quota.runId, {
      teamName: quota.teamName,
      cwd: 'C:/isolated-sandbox',
      providerId: 'codex',
    });
    let replacement: ProvisioningRun | undefined;
    let elapsed = 0;
    let starts = 0;
    let startCalls = 0;
    let polls = 0;
    const runtime = createProvisioningCeoRuntime(
      {
        exclusive: async (_team, operation) => operation(),
        getRun: () => run,
        hasSecondaryRuns: () => false,
        readProjectPath: async () => 'C:/isolated-sandbox',
        stop: async () => {
          Object.assign(run!.child!, { exitCode: 0 });
          run = undefined;
        },
        launch: async (request) => {
          starts++;
          replacement = makeRun('replacement', request);
          if (mode === 'provider') replacement.request.providerId = 'codex';
          if (mode === 'runId') replacement.runId = 'another-run';
          if (mode === 'billing') {
            Object.assign(replacement.launchIdentity!, { billingMode: 'api' });
          }
          return mode === 'rejected'
            ? { runId: 'replacement', alreadyLaunching: true }
            : { runId: 'replacement' };
        },
      },
      {
        now: () => elapsed,
        wait: async (ms) => {
          assert.equal(fixture.state().status, 'starting');
          assert.equal(fixture.state().owner, null);
          polls++;
          elapsed += ms;
          // First alive registration is delayed; billing evidence follows later.
          if (mode !== 'missing' && elapsed >= 500) run = replacement;
          if (mode === 'lag' && run) {
            if (elapsed === 500) {
              run.launchIdentity = null;
              // A working replacement is owned, but is not safe to checkpoint yet.
              run.provisioningComplete = false;
              run.leadActivityState = 'active';
            }
            if (elapsed === 1_000) {
              Object.assign(run, { launchIdentity: { billingMode: 'subscription' } });
            }
          }
        },
      }
    );
    Object.assign(fixture.runtime, runtime, {
      start: (...args: Parameters<typeof runtime.start>) => {
        startCalls++;
        return runtime.start(...args);
      },
    });
    return {
      fixture,
      runtime,
      starts: () => starts,
      startCalls: () => startCalls,
      polls: () => polls,
      elapsed: () => elapsed,
      setIdle: () => Object.assign(run!, { provisioningComplete: true, leadActivityState: 'idle' }),
    };
  }

  test('start waits for delayed alive registration and billing, then commits Claude as reserve', async () => {
    const { fixture, runtime, starts, startCalls, polls, setIdle } = await setup('lag');
    await fixture.supervisor.observe(quota);
    const state = fixture.state();
    assert.equal(state.status, 'active');
    assert.equal(state.reason, null);
    assert.deepEqual(state.owner, { runId: 'replacement', provider: 'anthropic', role: 'reserve' });
    assert.deepEqual(state.roles, { primary: 'codex', reserve: 'anthropic' });
    assert.equal(state.history.at(-1)?.event, 'owner_committed');
    assert.equal(starts(), 1);
    assert.equal(startCalls(), 1);
    assert.ok(polls() >= 3);
    assert.equal((await runtime.inspect(quota.teamName))?.safe, false);
    await assert.rejects(
      () =>
        fixture.supervisor.command({
          teamName: quota.teamName,
          action: 'checkpoint',
          summary: 'busy',
          effects: [],
        }),
      /exact idle CEO owner/
    );
    setIdle();
    await fixture.supervisor.command({
      teamName: quota.teamName,
      action: 'checkpoint',
      summary: 'idle',
      effects: [],
    });
    assert.equal(fixture.state().checkpoint?.runId, 'replacement');
  });

  for (const [mode, reason] of [
    ['missing', 'start_timeout'],
    ['provider', 'replacement_ownership_unproven'],
    ['runId', 'replacement_ownership_unproven'],
    ['billing', 'replacement_ownership_unproven'],
    ['rejected', 'launch_rejected'],
  ] as const) {
    test('replacement ' + mode + ' blocks without a second launch', async () => {
      const { fixture, starts, startCalls, elapsed } = await setup(mode);
      await fixture.supervisor.observe(quota);
      const state = fixture.state();
      assert.equal(state.status, 'blocked');
      assert.equal(state.reason, reason);
      assert.equal(state.owner, null);
      assert.equal(state.history.at(-1)?.event, 'launch_outcome_unknown');
      assert.equal(
        state.history.some((entry) => entry.event === 'owner_committed'),
        false
      );
      if (mode === 'missing') assert.equal(elapsed(), 60_000);
      const retry = () => fixture.create().command({ teamName: quota.teamName, action: 'retry' });
      if (mode === 'billing') await assert.rejects(retry, /verified subscription/);
      else await retry();
      await fixture.supervisor.observe(quota);
      assert.equal(starts(), 1);
      assert.equal(startCalls(), 1);
    });
  }
}
