import assert from 'node:assert/strict';

import { validateCompanyRoleCatalog } from '../../../src/features/company-role-catalog';
import {
  OWNER_APPROVAL_ACTIONS,
  ROLE_IDS,
} from '../../../src/features/company-role-catalog/core/domain/catalogPolicy';
import {
  createCompanyRoleCatalogApi,
  loadCompanyRoleCatalog,
} from '../../../src/features/company-role-catalog/main';

export type RegisterCase = (name: string, fn: () => void) => unknown;
type Draft = {
  -readonly [K in keyof ReturnType<typeof loadCompanyRoleCatalog>[number]]: ReturnType<
    typeof loadCompanyRoleCatalog
  >[number][K];
};

function fails(mutate: (catalog: Draft[]) => void, code: string) {
  const catalog: Draft[] = structuredClone([...loadCompanyRoleCatalog()]);
  mutate(catalog);
  const result = validateCompanyRoleCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((issue) => issue.code === code),
    JSON.stringify(result)
  );
}

export function registerCatalogCases(test: RegisterCase) {
  test('bundled catalog contains all original 01–40 identities and a flat hierarchy', () => {
    const catalog = loadCompanyRoleCatalog();
    assert.deepEqual(validateCompanyRoleCatalog(catalog), { valid: true, issues: [] });
    assert.equal(catalog.length, 40);
    assert.deepEqual(
      catalog.map((role) => role.id),
      [...ROLE_IDS]
    );
    assert.equal(catalog[0].name, 'Генеральный директор');
    assert.equal(catalog[39].name, 'Инженер самоулучшения агентов');
    catalog.forEach((role, index) => {
      assert.equal(role.number, String(index + 1).padStart(2, '0'));
      assert.match(role.name, /[А-Яа-яЁё]/);
      assert.equal(role.reportsTo, index === 0 ? null : 'ceo');
      assert.ok(role.systemInstructions.length >= 3);
      assert.deepEqual(role.permissions.requiresOwnerApproval, OWNER_APPROVAL_ACTIONS);
      assert.ok(
        !role.permissions.allowed.some((permission) =>
          /publish|financial-transaction|sign-contract/.test(permission)
        )
      );
    });
    assert.deepEqual(catalog[0].executors, { primary: 'codex', reserves: ['anthropic'] });
    for (const id of [
      'technical-architect',
      'developer',
      'integration-engineer',
      'devops-engineer',
      'security-engineer',
      'render-engineer',
    ]) {
      assert.equal(catalog.find((role) => role.id === id)?.executors.primary, 'codex');
    }
  });

  test('validator rejects malformed containers and profiles without crashing', () => {
    for (const input of [null, {}, 'catalog', [], [null], [42], [{}]]) {
      assert.equal(validateCompanyRoleCatalog(input).valid, false);
    }
    fails((roles) => {
      roles.pop();
    }, 'role-count');
    fails((roles) => {
      roles.push(roles[0]);
    }, 'role-count');
  });

  test('validator rejects duplicate, unknown and renumbered identities', () => {
    fails((roles) => {
      roles[1] = roles[2];
    }, 'duplicate-id');
    fails((roles) => {
      roles[1].id = 'replacement-role';
    }, 'unknown-role-id');
    fails((roles) => {
      roles[1].number = '03';
    }, 'stable-number');
    fails((roles) => {
      roles[1].id = 'CEO';
    }, 'missing-role');
  });

  test('validator rejects departments turned into management layers and CEO self-reporting', () => {
    fails((roles) => {
      Object.assign(roles[34], { reportsTo: 'technical-architect' });
    }, 'flat-hierarchy');
    fails((roles) => {
      roles[0].reportsTo = 'ceo';
    }, 'flat-hierarchy');
    fails((roles) => {
      roles[1].reportsTo = null;
    }, 'flat-hierarchy');
  });

  test('validator rejects every missing required text/list field and empty list entries', () => {
    const fields = [
      'id',
      'number',
      'name',
      'department',
      'responsibilities',
      'systemInstructions',
      'requiredTools',
      'memoryRules',
      'inputArtifacts',
      'outputArtifacts',
      'acceptanceCriteria',
      'ceoInteractionRules',
      'activationConditions',
      'deactivationConditions',
      'permissions',
      'executors',
      'kind',
      'checksRoles',
    ];
    for (const field of fields) {
      const catalog = structuredClone([...loadCompanyRoleCatalog()]);
      Reflect.deleteProperty(catalog[0], field);
      assert.equal(validateCompanyRoleCatalog(catalog).valid, false, field);
    }
    fails((roles) => {
      roles[1].systemInstructions = [];
    }, 'required-text-list');
    fails((roles) => {
      roles[1].acceptanceCriteria = [' '];
    }, 'required-text-list');
    fails((roles) => {
      roles[1].name = ' ';
    }, 'required-text');
  });

  test('credential-shaped instruction fixtures are rejected without echoing secret values', () => {
    const fixtures = [
      'api_key=synthetic-fixture-12345',
      'Bearer synthetic-fixture-token-123456',
      '-----BEGIN PRIVATE KEY-----',
      'sk-ant-synthetic-fixture-1234567890',
      'password="synthetic-test-value"',
      '123456789:synthetic_fixture_token_1234567890',
    ];
    for (const fixture of fixtures) {
      const catalog = structuredClone([...loadCompanyRoleCatalog()]);
      catalog[1] = { ...catalog[1], systemInstructions: [fixture] };
      const result = validateCompanyRoleCatalog(catalog);
      assert.equal(result.valid, false);
      assert.ok(result.issues.some((issue) => issue.code === 'credential-literal'));
      assert.ok(!JSON.stringify(result).includes(fixture));
    }
  });

  test('validator rejects provider drift, duplicate executors and incorrect CEO policy', () => {
    fails((roles) => {
      Object.assign(roles[1], {
        executors: { primary: 'unconfigured-provider', reserves: ['codex'] },
      });
    }, 'unknown-provider');
    fails((roles) => {
      roles[1].executors = { primary: 'anthropic', reserves: [] };
    }, 'unknown-provider');
    fails((roles) => {
      roles[1].executors = { primary: 'codex', reserves: ['codex'] };
    }, 'duplicate-executor');
    fails((roles) => {
      roles[0].executors = { primary: 'anthropic', reserves: ['codex'] };
    }, 'ceo-executors');
  });

  test('validator enforces owner gates and disallows direct privileged capabilities', () => {
    fails((roles) => {
      roles[26].permissions = { ...roles[26].permissions, requiresOwnerApproval: [] };
    }, 'owner-approval-required');
    fails((roles) => {
      Object.assign(roles[31], {
        permissions: { ...roles[31].permissions, allowed: ['financial-transaction'] },
      });
    }, 'unsafe-capability');
    fails((roles) => {
      Object.assign(roles[26], {
        permissions: { ...roles[26].permissions, allowed: ['publish-content'] },
      });
    }, 'unsafe-capability');
  });

  test('reviewers and auditor cannot check themselves or lose independent identity', () => {
    for (const id of ['independent-qa', 'financial-auditor', 'fact-checker', 'visual-editor']) {
      fails((roles) => {
        const role = roles.find((item) => item.id === id)!;
        role.checksRoles = [id];
      }, 'review-conflict');
      fails((roles) => {
        roles.find((item) => item.id === id)!.kind = 'producer';
      }, 'independence-required');
      fails((roles) => {
        roles.find((item) => item.id === id)!.checksRoles = [];
      }, 'review-targets-required');
    }
    fails((roles) => {
      roles[38].checksRoles = ['missing-producer'];
    }, 'review-conflict');
  });

  test('read-only main API freezes nested data and exposes no command/launch surface', () => {
    const api = createCompanyRoleCatalogApi();
    assert.deepEqual(Object.keys(api).sort(), ['get', 'list', 'plan']);
    assert.equal(api.get('developer'), api.list()[34]);
    assert.equal(api.get('missing'), undefined);
    assert.ok(Object.isFrozen(api));
    assert.ok(Object.isFrozen(api.list()));
    assert.ok(Object.isFrozen(api.get('ceo')?.permissions.requiresOwnerApproval));
    assert.equal(Reflect.set(api.get('ceo')!.systemInstructions, 0, 'mutated'), false);
    assert.equal(api.plan({ tasks: [], providers: {} }).activations.length, 0);
    assert.deepEqual(api.list(), loadCompanyRoleCatalog());
  });
}
