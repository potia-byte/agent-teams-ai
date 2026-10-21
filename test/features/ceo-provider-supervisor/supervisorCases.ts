import assert from 'node:assert/strict';

import { CeoSupervisor } from '../../../src/features/ceo-provider-supervisor/core/application/CeoSupervisor';
import {
  emptyCeoState,
  isConfirmedSubscriptionQuota,
  selectReserve,
} from '../../../src/features/ceo-provider-supervisor/core/domain/policy';
import {
  availabilityLabels,
  eventLabels,
  historyTimestamp,
  reasonLabels,
  statusLabels,
} from '../../../src/features/ceo-provider-supervisor/renderer/view-models/ceoSupervisorLabels';

import type {
  CeoProvider,
  ExecutorAvailability,
} from '../../../src/features/ceo-provider-supervisor/contracts';
import type {
  CeoRepository,
  CeoRuntime,
} from '../../../src/features/ceo-provider-supervisor/core/application/CeoSupervisor';
import type { CeoFailure } from '../../../src/features/ceo-provider-supervisor/core/domain/policy';

export const quota: CeoFailure = {
  teamName: 'sandbox-ceo',
  runId: 'codex-run',
  providerId: 'codex',
  phase: 'terminal',
  detail: 'usage_limit_reached',
  statusCode: 429,
};

export function supervisorFixture(
  initialProvider: CeoProvider = 'codex',
  storedRepository?: CeoRepository
) {
  let state = emptyCeoState(quota.teamName, 'isolated-context');
  let current: Awaited<ReturnType<CeoRuntime['inspect']>> = {
    runId: initialProvider + '-run',
    provider: initialProvider,
    safe: true,
    effectsRevision: 0,
  };
  let tail = Promise.resolve();
  const launches: Array<{ provider: CeoProvider; prompt: string }> = [];
  const stops: string[] = [];
  let stopGate: Promise<void> | null = null;
  let stopped!: () => void;
  const stopEntered = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  let failStop = false;
  let failStart = false;
  const repository: CeoRepository = storedRepository ?? {
    read: async () => structuredClone(state),
    async exclusive<T>(
      _team: string,
      operation: (value: typeof state, save: () => Promise<void>) => Promise<T>
    ): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const draft = structuredClone(state);
      try {
        return await operation(draft, async () => {
          state = structuredClone(draft);
        });
      } finally {
        release();
      }
    },
  };
  const runtime: CeoRuntime = {
    exclusive: async (_team, operation) => operation(),
    inspect: async () => current,
    stop: async (_team, expectedRunId) => {
      assert.equal(current?.runId, expectedRunId);
      stops.push(expectedRunId);
      stopped();
      if (stopGate) await stopGate;
      if (failStop) throw new Error('termination unconfirmed');
      current = null;
    },
    start: async (_team, provider, prompt) => {
      assert.equal(current, null, 'no overlap of director owners');
      launches.push({ provider, prompt });
      current = {
        provider,
        runId: provider + '-run-' + launches.length,
        safe: true,
        effectsRevision: 0,
      };
      if (failStart) throw new Error('unknown start result');
      return current.runId;
    },
  };
  const create = (store = repository) =>
    new CeoSupervisor({
      repository: store,
      runtime,
      now: () => '2026-10-20T12:00:00.000Z',
      newId: () => 'checkpoint-1',
    });
  const supervisor = create();
  return {
    supervisor,
    create,
    runtime,
    launches,
    stops,
    stopEntered,
    state: () => structuredClone(state),
    setState: (value: typeof state) => {
      state = structuredClone(value);
    },
    setCurrent: (value: typeof current) => {
      current = value;
    },
    blockStop: (value: Promise<void>) => {
      stopGate = value;
    },
    failStop: () => {
      failStop = true;
    },
    failStart: () => {
      failStart = true;
    },
    async prepare(
      effects: Array<{ key: string; outcome: 'confirmed' | 'not_started' | 'unknown' }> = []
    ) {
      await supervisor.command({ teamName: quota.teamName, action: 'enable' });
      await supervisor.command({
        teamName: quota.teamName,
        action: 'checkpoint',
        summary: 'Render final MP4. Publication already done must not repeat.',
        effects,
      });
      await supervisor.command({
        teamName: quota.teamName,
        action: 'available',
        provider: 'anthropic',
      });
    },
  };
}

export function registerSupervisorCases(
  test: (name: string, body: () => void | Promise<void>) => unknown
): void {
  test('Russian UI labels and history retain Cyrillic text in UTF-8', () => {
    for (const labels of [statusLabels, availabilityLabels, reasonLabels, eventLabels]) {
      for (const label of Object.values(labels)) {
        assert.match(label, /[\u0400-\u04ff]/);
        assert.doesNotMatch(label, /\?{2,}/);
      }
    }
    assert.equal(
      historyTimestamp('invalid'),
      '\u0414\u0430\u0442\u0430 \u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'
    );
    assert.match(historyTimestamp('2026-10-21T12:00:00.000Z'), /21\.10\.2026/);
  });
  test('only confirmed terminal subscription quota qualifies; generic 429/auth/network do not', () => {
    assert.equal(isConfirmedSubscriptionQuota(quota), true);
    for (const detail of [
      '429 Too Many Requests',
      'rate_limit_exceeded',
      'insufficient_quota',
      'insufficient credits',
      'ECONNRESET',
      '401 unauthorized',
      'tool failed',
    ]) {
      assert.equal(isConfirmedSubscriptionQuota({ ...quota, detail }), false, detail);
    }
    assert.equal(isConfirmedSubscriptionQuota({ ...quota, phase: 'sdk_retrying' }), false);
    assert.equal(isConfirmedSubscriptionQuota({ ...quota, providerBackendId: 'paid-api' }), false);
    assert.equal(
      isConfirmedSubscriptionQuota({
        ...quota,
        providerId: 'anthropic',
        detail: "You've hit your limit",
      }),
      true
    );
  });
  for (const provider of ['codex', 'anthropic'] as const) {
    test('enable records roles and preserves an existing ' + provider + ' owner', async () => {
      const fixture = supervisorFixture(provider);
      const state = await fixture.supervisor.command({
        teamName: quota.teamName,
        action: 'enable',
      });
      assert.deepEqual(state.roles, { primary: 'codex', reserve: 'anthropic' });
      assert.deepEqual(state.owner, {
        provider,
        runId: provider + '-run',
        role: provider === 'codex' ? 'primary' : 'reserve',
      });
      assert.equal(state.status, 'active');
      assert.equal(state.epoch, 1);
      assert.equal(
        state.history.some((event) => event.event === 'running_on_reserve'),
        provider === 'anthropic'
      );
      assert.equal(fixture.launches.length, 0);
      assert.equal(fixture.stops.length, 0);
    });
  }
  test('executor selection requires a different AVAILABLE provider and respects configured priority', () => {
    const state = emptyCeoState(quota.teamName, 'test');
    state.providers.codex.availability = state.providers.anthropic.availability = 'AVAILABLE';
    assert.equal(selectReserve(state), null, 'the previous provider must be known');
    state.owner = { provider: 'anthropic', runId: 'old', role: 'reserve' };
    assert.equal(selectReserve(state), 'codex');
    state.roles = { primary: 'anthropic', reserve: 'codex' };
    state.owner = { provider: 'anthropic', runId: 'old', role: 'primary' };
    assert.equal(selectReserve(state), 'codex');
    state.owner = { provider: 'codex', runId: 'old', role: 'reserve' };
    assert.equal(selectReserve(state), 'anthropic');
    state.checkpoint = {
      id: 'point',
      runId: 'old',
      provider: 'codex',
      runtimeRevision: 0,
      summary: 'saved',
      effects: [],
      savedAt: 'now',
    };
    state.owner = null;
    assert.equal(selectReserve(state), 'anthropic');
    state.checkpoint.provider = 'anthropic';
    for (const availability of [
      'UNKNOWN',
      'BUSY',
      'RATE_LIMITED',
      'AUTH_REQUIRED',
      'UNAVAILABLE',
    ] as const) {
      state.providers.codex.availability = availability;
      assert.equal(selectReserve(state), null);
    }
  });
  test('quota stops exact Codex owner then launches configured Claude reserve with a fresh session', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare([{ key: 'publish:video-1', outcome: 'confirmed' }]);
    await fixture.supervisor.observe({ ...quota, epoch: fixture.state().epoch });
    assert.equal(fixture.state().status, 'active');
    assert.equal(fixture.state().owner?.provider, 'anthropic');
    assert.equal(fixture.state().owner?.role, 'reserve');
    assert.equal(fixture.state().epoch, 2);
    assert.deepEqual(fixture.stops, ['codex-run']);
    assert.equal(fixture.launches.length, 1);
    assert.equal(fixture.launches[0].provider, 'anthropic');
    assert.match(fixture.launches[0].prompt, /publish:video-1/);
    assert.match(fixture.launches[0].prompt, /Fencing epoch: 2/);
    assert.doesNotMatch(fixture.launches[0].prompt, /runtimeSessionId|--resume/);
  });
  test('concurrent repeated quota events and stale old-owner events cannot launch twice', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    await Promise.all([
      fixture.supervisor.observe(quota),
      fixture.supervisor.observe(quota),
      fixture.supervisor.observe(quota),
    ]);
    await fixture.create().observe(quota);
    assert.equal(fixture.launches.length, 1);
    assert.equal(fixture.stops.length, 1);
    assert.deepEqual(fixture.state().handledRuns, [quota.runId]);
  });
  test('replacement cannot start until old owner termination is confirmed', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    let release!: () => void;
    fixture.blockStop(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const switching = fixture.supervisor.observe(quota);
    await fixture.stopEntered;
    assert.equal(fixture.state().status, 'stopping');
    assert.equal(fixture.launches.length, 0);
    release();
    await switching;
    assert.equal(fixture.launches.length, 1);
  });
  test('concurrent observe and available/retry commands serialize the entire handoff', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    let release!: () => void;
    fixture.blockStop(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const observing = fixture.supervisor.observe(quota);
    await fixture.stopEntered;
    let completed = 0;
    const commands = [
      fixture
        .create()
        .command({ teamName: quota.teamName, action: 'available', provider: 'anthropic' }),
      fixture.create().command({ teamName: quota.teamName, action: 'retry' }),
    ].map((promise) =>
      promise.then(() => {
        completed++;
      })
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(completed, 0);
    assert.equal(fixture.launches.length, 0);
    release();
    await Promise.all([observing, ...commands]);
    assert.equal(completed, 2);
    assert.equal(fixture.launches.length, 1);
    assert.equal(fixture.stops.length, 1);
    assert.equal(fixture.state().status, 'active');
  });
  for (const stale of ['runId', 'epoch', 'handledRuns', 'provider'] as const) {
    test('stale failure is ignored without mutation: ' + stale, async () => {
      const fixture = supervisorFixture();
      await fixture.prepare();
      const failure = { ...quota, epoch: fixture.state().epoch };
      if (stale === 'runId') failure.runId = 'older-run';
      if (stale === 'epoch') failure.epoch--;
      if (stale === 'provider') {
        failure.providerId = 'anthropic';
        failure.detail = "You've hit your limit";
      }
      if (stale === 'handledRuns') {
        const state = fixture.state();
        state.handledRuns.push(quota.runId);
        fixture.setState(state);
      }
      const before = fixture.state();
      assert.equal(await fixture.supervisor.observe(failure), true);
      assert.deepEqual(fixture.state(), before);
      assert.equal(fixture.stops.length, 0);
      assert.equal(fixture.launches.length, 0);
    });
  }
  test('failed termination blocks all subsequent retries and availability confirmations', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    fixture.failStop();
    await fixture.supervisor.observe(quota);
    for (const action of ['retry', 'available'] as const) {
      await fixture.create().command({ teamName: quota.teamName, action, provider: 'anthropic' });
    }
    assert.equal(fixture.state().status, 'blocked');
    assert.equal(fixture.state().reason, 'handoff_outcome_unknown');
    assert.equal(fixture.launches.length, 0);
    assert.equal(fixture.stops.length, 1);
    assert.equal(fixture.state().owner?.runId, 'codex-run');
  });
  test('UNKNOWN reserve stays queued across restart; primary availability cannot launch it', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    const state = fixture.state();
    state.providers.anthropic.availability = 'UNKNOWN';
    fixture.setState(state);
    await fixture.supervisor.observe(quota);
    assert.equal(fixture.state().status, 'waiting');
    assert.equal(fixture.launches.length, 0);
    const restarted = fixture.create();
    await restarted.command({ teamName: quota.teamName, action: 'retry' });
    await restarted.command({ teamName: quota.teamName, action: 'available', provider: 'codex' });
    assert.equal(fixture.launches.length, 0);
    await restarted.command({
      teamName: quota.teamName,
      action: 'available',
      provider: 'anthropic',
    });
    assert.equal(fixture.launches.length, 1);
    assert.equal(fixture.launches[0].provider, 'anthropic');
  });
  test('primary available never interrupts a busy active reserve or triggers fail-back', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    await fixture.supervisor.observe(quota);
    const before = fixture.state();
    fixture.setCurrent({
      runId: before.owner!.runId,
      provider: 'anthropic',
      safe: false,
      effectsRevision: 10,
    });
    await fixture
      .create()
      .command({ teamName: quota.teamName, action: 'available', provider: 'codex' });
    await fixture.create().command({ teamName: quota.teamName, action: 'retry' });
    assert.equal(fixture.state().providers.codex.availability, 'AVAILABLE');
    assert.deepEqual(fixture.state().owner, before.owner);
    assert.equal(fixture.state().epoch, before.epoch);
    assert.deepEqual(fixture.state().checkpoint, before.checkpoint);
    assert.equal(fixture.state().status, 'active');
    assert.equal(fixture.stops.length, 1);
    assert.equal(fixture.launches.length, 1);
  });
  test('every primary or reserve probe result is passive and never interrupts the active reserve', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    await fixture.supervisor.observe(quota);
    const before = fixture.state();
    const outcomes: ExecutorAvailability[] = [
      'AVAILABLE',
      'BUSY',
      'RATE_LIMITED',
      'AUTH_REQUIRED',
      'UNAVAILABLE',
      'UNKNOWN',
    ];
    for (const provider of ['codex', 'anthropic'] as const) {
      for (const availability of outcomes) {
        const state = await fixture
          .create()
          .observeProbe({ teamName: quota.teamName, provider, availability });
        assert.equal(
          state.providers[provider].availability,
          provider === 'anthropic' ? 'BUSY' : availability
        );
        assert.deepEqual(state.owner, before.owner);
        assert.equal(state.status, 'active');
        assert.equal(state.epoch, before.epoch);
        assert.deepEqual(state.checkpoint, before.checkpoint);
      }
    }
    assert.equal(fixture.stops.length, 1);
    assert.equal(fixture.launches.length, 1);
  });
  test('primary availability and successful reserve probe only update health while waiting', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    const state = fixture.state();
    state.providers.anthropic.availability = 'UNKNOWN';
    fixture.setState(state);
    await fixture.supervisor.observe(quota);
    await fixture.supervisor.observeProbe({
      teamName: quota.teamName,
      provider: 'anthropic',
      availability: 'AVAILABLE',
    });
    await fixture.supervisor.command({
      teamName: quota.teamName,
      action: 'available',
      provider: 'codex',
    });
    assert.equal(fixture.state().providers.codex.availability, 'AVAILABLE');
    assert.equal(fixture.state().providers.anthropic.availability, 'AVAILABLE');
    assert.equal(fixture.state().status, 'waiting');
    assert.equal(fixture.launches.length, 0);
    await fixture.supervisor.command({ teamName: quota.teamName, action: 'retry' });
    assert.equal(fixture.launches.length, 1);
  });
  test('enabled Claude owner waits across restart until Codex availability is confirmed', async () => {
    const fixture = supervisorFixture('anthropic');
    await fixture.prepare();
    await fixture.supervisor.observe({
      ...quota,
      providerId: 'anthropic',
      runId: 'anthropic-run',
      detail: "You've hit your limit",
    });
    const restarted = fixture.create();
    await restarted.command({
      teamName: quota.teamName,
      action: 'available',
      provider: 'anthropic',
    });
    await restarted.command({ teamName: quota.teamName, action: 'retry' });
    await restarted.observeProbe({
      teamName: quota.teamName,
      provider: 'codex',
      availability: 'AVAILABLE',
    });
    assert.equal(fixture.state().status, 'waiting');
    assert.equal(fixture.state().owner, null);
    assert.equal(fixture.launches.length, 0);
    assert.equal(fixture.stops.length, 1);
    await restarted.command({ teamName: quota.teamName, action: 'available', provider: 'codex' });
    assert.equal(fixture.state().status, 'active');
    assert.equal(fixture.state().owner?.provider, 'codex');
    assert.equal(fixture.state().owner?.role, 'primary');
    assert.equal(fixture.launches.length, 1);
    assert.equal(fixture.stops.length, 1);
  });
  test('unknown external effect blocks continuation and all subsequent commands preserve its key', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare([{ key: 'publish:unknown', outcome: 'unknown' }]);
    await fixture.supervisor.observe(quota);
    await fixture.create().command({ teamName: quota.teamName, action: 'retry' });
    await fixture
      .create()
      .command({ teamName: quota.teamName, action: 'available', provider: 'anthropic' });
    assert.equal(fixture.state().status, 'blocked');
    assert.equal(fixture.launches.length, 0);
    assert.deepEqual(fixture.state().checkpoint?.effects, [
      { key: 'publish:unknown', outcome: 'unknown' },
    ]);
  });
  test('persisted waiting state with UNKNOWN effect also blocks continuation', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare([{ key: 'publish:unknown', outcome: 'unknown' }]);
    const state = fixture.state();
    state.status = 'waiting';
    state.owner = null;
    fixture.setState(state);
    fixture.setCurrent(null);
    await fixture.create().command({ teamName: quota.teamName, action: 'retry' });
    assert.equal(fixture.state().status, 'blocked');
    assert.equal(fixture.launches.length, 0);
  });
  test('a previous owner checkpoint cannot authorize replay after another handoff', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    await fixture.supervisor.observe(quota);
    await fixture.supervisor.observe({
      ...quota,
      providerId: 'anthropic',
      runId: fixture.state().owner!.runId,
      detail: "You've hit your limit",
    });
    assert.equal(fixture.state().status, 'blocked');
    assert.equal(fixture.launches.length, 1);
  });
  test('provider session metadata in persisted context never crosses into the replacement prompt', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    const state = fixture.state();
    Object.assign(state.checkpoint!, {
      runtimeSessionId: 'codex-private-session',
      sessionId: 'old-private-session',
      resume: '--resume old-private-session',
    });
    fixture.setState(state);
    await fixture.supervisor.observe(quota);
    assert.equal(fixture.launches[0].provider, 'anthropic');
    assert.doesNotMatch(
      fixture.launches[0].prompt,
      /private-session|runtimeSessionId|sessionId|--resume|codex-run/
    );
    assert.match(fixture.launches[0].prompt, /Render final MP4/);
  });
  test('unknown start outcome blocks relaunch even when a replacement exists', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    fixture.failStart();
    await fixture.supervisor.observe(quota);
    assert.equal(fixture.state().reason, 'launch_outcome_unknown');
    await fixture.create().command({ teamName: quota.teamName, action: 'retry' });
    assert.equal(fixture.launches.length, 1);
  });
  test('restart with missing active runtime never trusts persisted owner as available', async () => {
    const fixture = supervisorFixture();
    await fixture.prepare();
    fixture.setCurrent(null);
    assert.equal((await fixture.create().read(quota.teamName)).status, 'blocked');
    assert.equal(fixture.launches.length, 0);
  });
  test('unconfigured teams keep original recovery; configured CEO owns all recovery events', async () => {
    const fixture = supervisorFixture();
    assert.equal(await fixture.supervisor.observe(quota), false);
    await fixture.prepare();
    assert.equal(await fixture.supervisor.observe({ ...quota, detail: '429 retry later' }), true);
    assert.equal(fixture.state().status, 'active');
    assert.equal(fixture.launches.length, 0);
  });
}
