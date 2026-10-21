import assert from 'node:assert/strict';

import { planRoleActivation } from '../../../src/features/company-role-catalog';
import { loadCompanyRoleCatalog } from '../../../src/features/company-role-catalog/main';

import type {
  ActivationRequest,
  ProviderAvailability,
  RoleTask,
} from '../../../src/features/company-role-catalog/contracts';
import type { RegisterCase } from './catalogCases';

const providers: ActivationRequest['providers'] = {
  codex: { configured: true, availability: 'AVAILABLE' },
  anthropic: { configured: true, availability: 'AVAILABLE' },
};
function task(roleId: string, id = roleId, priority = 0): RoleTask {
  return { id, roleId, priority, status: 'pending' };
}
function plan(request: Partial<ActivationRequest> = {}) {
  return planRoleActivation(loadCompanyRoleCatalog(), { tasks: [], providers, ...request });
}

export function registerPlannerCases(test: RegisterCase) {
  test('default 16 GB plan activates at most three task-needed roles and never all 40', () => {
    const tasks = loadCompanyRoleCatalog().map((role) => task(role.id));
    const result = plan({ tasks });
    assert.equal(result.concurrencyCap, 3);
    assert.equal(result.activations.length, 3);
    assert.equal(result.deferred.length, 37);
    const high = plan({ tasks, concurrencyCap: 1000 });
    assert.equal(high.concurrencyCap, 39);
    assert.equal(high.activations.length, 39);
    assert.equal(plan().activations.length, 0);
  });

  test('pending tasks win by priority with deterministic ties; other statuses launch nothing', () => {
    const result = plan({
      concurrencyCap: 2,
      tasks: [
        task('ceo', 'low', 1),
        task('developer', 'first-high', 10),
        task('fact-checker', 'second-high', 10),
        { ...task('video-editor'), status: 'completed' },
        { ...task('audio-engineer'), status: 'running' },
        { ...task('financial-accountant'), status: 'blocked' },
      ],
    });
    assert.deepEqual(
      result.activations.map((item) => item.taskId),
      ['first-high', 'second-high']
    );
    assert.deepEqual(result.deferred, [{ taskId: 'low', reason: 'concurrency-cap' }]);
  });

  test('all non-AVAILABLE states, missing snapshots and unconfigured providers are ineligible', () => {
    const states: ProviderAvailability[] = [
      'BUSY',
      'RATE_LIMITED',
      'AUTH_REQUIRED',
      'UNAVAILABLE',
      'UNKNOWN',
    ];
    for (const availability of states) {
      const result = plan({
        tasks: [task('ceo')],
        providers: {
          codex: { configured: true, availability },
          anthropic: { configured: false, availability: 'AVAILABLE' },
        },
      });
      assert.equal(result.activations.length, 0, availability);
      assert.equal(result.deferred[0].reason, 'no-available-executor');
    }
    assert.equal(plan({ tasks: [task('ceo')], providers: {} }).activations.length, 0);
    assert.equal(
      plan({
        tasks: [task('ceo')],
        providers: { codex: { configured: false, availability: 'AVAILABLE' } },
      }).activations.length,
      0
    );
  });

  test('CEO and development roles prefer Codex, creative roles use Anthropic; reserve must be available', () => {
    assert.deepEqual(
      plan({ tasks: [task('ceo'), task('developer'), task('scriptwriter')] }).activations.map(
        (item) => item.provider
      ),
      ['codex', 'codex', 'anthropic']
    );
    assert.equal(
      plan({
        tasks: [task('ceo')],
        providers: {
          codex: { configured: true, availability: 'RATE_LIMITED' },
          anthropic: providers.anthropic,
        },
      }).activations[0].provider,
      'anthropic'
    );
    assert.equal(
      plan({ tasks: [task('scriptwriter')], providers: { codex: providers.codex } }).activations[0]
        .provider,
      'codex'
    );
  });

  test('retained CEO counts against cap and duplicate tasks cannot create duplicate logical roles', () => {
    const result = plan({
      activeExecutors: [{ roleId: 'ceo', provider: 'codex' }],
      tasks: [
        task('ceo', 'ceo-again'),
        task('developer', 'dev-one'),
        task('developer', 'dev-two'),
        task('scriptwriter'),
        task('video-editor'),
      ],
    });
    assert.equal(result.retained.length, 1);
    assert.equal(result.activations.length, 2);
    assert.equal(
      new Set([...result.retained, ...result.activations].map((item) => item.roleId)).size,
      3
    );
    assert.equal(
      result.deferred.find((item) => item.taskId === 'dev-two')?.reason,
      'already-active'
    );
    const outage = plan({
      activeExecutors: [{ roleId: 'ceo', provider: 'codex' }],
      providers: {
        codex: { configured: true, availability: 'UNAVAILABLE' },
        anthropic: providers.anthropic,
      },
      tasks: [task('ceo')],
    });
    assert.equal(outage.activations.length, 0);
    assert.equal(outage.retained[0].provider, 'codex');
  });

  test('quota hints bound both new assignments and retained provider capacity', () => {
    const result = plan({
      tasks: [task('developer'), task('render-engineer'), task('devops-engineer')],
      providers: {
        codex: { ...providers.codex!, quota: { remainingActivations: 1 } },
        anthropic: { ...providers.anthropic!, quota: { maxConcurrentRoles: 1 } },
      },
    });
    assert.deepEqual(
      result.activations.map((item) => item.provider),
      ['codex', 'anthropic']
    );
    assert.equal(result.deferred[0].reason, 'no-available-executor');
    const retained = plan({
      activeExecutors: [{ roleId: 'ceo', provider: 'codex' }],
      tasks: [task('developer')],
      providers: {
        codex: { ...providers.codex!, quota: { maxConcurrentRoles: 1 } },
      },
    });
    assert.equal(retained.activations.length, 0);
    for (const value of [0, -1, NaN, Infinity, 1.5]) {
      assert.equal(
        plan({
          tasks: [task('ceo')],
          providers: {
            codex: { ...providers.codex!, quota: { remainingActivations: value } },
          },
        }).activations.length,
        0
      );
    }
  });

  test('review tasks cannot be assigned to their producer; same provider across independent roles is allowed', () => {
    const result = plan({
      tasks: [
        { ...task('independent-qa', 'self'), producerRoleIds: ['independent-qa'] },
        { ...task('financial-auditor', 'auditor-self'), producerRoleIds: ['financial-auditor'] },
        { ...task('independent-qa', 'valid'), producerRoleIds: ['developer'] },
        task('developer'),
      ],
    });
    assert.deepEqual(
      result.deferred.map((item) => item.reason),
      ['review-conflict', 'review-conflict']
    );
    assert.deepEqual(
      result.activations.map((item) => item.provider),
      ['codex', 'codex']
    );
  });

  test('unknown roles defer without consuming a slot; cap zero suspends all new work', () => {
    const result = plan({ tasks: [task('missing-role'), task('developer')], concurrencyCap: 1 });
    assert.equal(result.deferred[0].reason, 'unknown-role');
    assert.equal(result.activations.length, 1);
    assert.equal(plan({ tasks: [task('developer')], concurrencyCap: 0 }).activations.length, 0);
  });

  test('invalid caps, active ownership, catalog and pending task identities fail closed', () => {
    for (const concurrencyCap of [-1, NaN, Infinity, 1.5])
      assert.throws(() => plan({ concurrencyCap }));
    assert.throws(() =>
      plan({ concurrencyCap: 0, activeExecutors: [{ roleId: 'ceo', provider: 'codex' }] })
    );
    assert.throws(() =>
      plan({
        activeExecutors: [
          { roleId: 'ceo', provider: 'codex' },
          { roleId: 'ceo', provider: 'anthropic' },
        ],
      })
    );
    assert.throws(() => plan({ activeExecutors: [{ roleId: 'missing', provider: 'codex' }] }));
    assert.throws(() => planRoleActivation([], { tasks: [], providers }));
    assert.throws(() => plan({ tasks: [task('developer', 'same'), task('ceo', 'same')] }));
    assert.throws(() => plan({ tasks: [task('developer', '')] }));
    assert.throws(() => plan({ tasks: [task('developer', 'id', NaN)] }));
  });

  test('planner is deterministic and never mutates input snapshots or catalog', () => {
    const catalog = loadCompanyRoleCatalog();
    const request: ActivationRequest = {
      tasks: [task('developer'), task('scriptwriter')],
      providers,
      activeExecutors: [{ roleId: 'ceo', provider: 'codex' }],
    };
    const before = structuredClone(request);
    assert.deepEqual(planRoleActivation(catalog, request), planRoleActivation(catalog, request));
    assert.deepEqual(request, before);
    assert.deepEqual(catalog, loadCompanyRoleCatalog());
  });

  test('cap and single-executor invariants hold across every cap and mixed provider states', () => {
    const catalog = loadCompanyRoleCatalog();
    for (let cap = 0; cap <= 45; cap++) {
      for (const availability of ['AVAILABLE', 'UNKNOWN', 'RATE_LIMITED'] as const) {
        const result = plan({
          concurrencyCap: cap,
          tasks: catalog.flatMap((role) => [task(role.id), task(role.id, `${role.id}-again`)]),
          providers: {
            codex: { configured: true, availability },
            anthropic: providers.anthropic,
          },
        });
        assert.ok(result.activations.length <= Math.min(cap, 39));
        assert.equal(
          new Set(result.activations.map((item) => item.roleId)).size,
          result.activations.length
        );
        assert.ok(
          result.activations.every(
            (item) => item.provider !== 'codex' || availability === 'AVAILABLE'
          )
        );
      }
    }
  });
}
