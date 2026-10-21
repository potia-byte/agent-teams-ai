import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import * as adapter from '../../../src/main/testing/e2eQuotaSignalInjector';

import type { LeadRuntimeFailureObservation } from '../../../src/main/services/team/TeamProvisioningService';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const signal = { teamName: 'test-quota-team', runId: 'test-run-1', providerId: 'codex', detail: 'quota exceeded' };
const encoded = JSON.stringify(signal);
let dir: string;
let file: string;
let originalFile: string | undefined;
let originalProfile: string | undefined;
let received: LeadRuntimeFailureObservation[];
let handles: Array<{ dispose(): void }>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e2e-quota-injector-'));
  file = join(dir, 'quota.jsonl');
  writeFileSync(file, '');
  originalFile = process.env.AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE;
  originalProfile = process.env.AGENT_TEAMS_ELECTRON_USER_DATA_DIR;
  process.env.AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE = file;
  process.env.AGENT_TEAMS_ELECTRON_USER_DATA_DIR = dir;
  received = [];
  handles = [];
});

afterEach(() => {
  for (const handle of handles) handle.dispose();
  for (const [key, value] of [
    ['AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE', originalFile],
    ['AGENT_TEAMS_ELECTRON_USER_DATA_DIR', originalProfile],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

function start(getLeadName: () => Promise<string | null> = async () => 'actual-team-lead') {
  const handle = adapter.startE2eQuotaSignalInjector({
    getLeadName,
    observeLeadFailure: (failure) => { received.push(failure); },
  });
  handles.push(handle);
  return handle;
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), 'polling adapter did not deliver before the deadline');
}

test('inactive unless BOTH environment markers are set', async () => {
  for (const [quotaFile, profile] of [[undefined, undefined], [file, undefined], [undefined, dir]]) {
    delete process.env.AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE;
    delete process.env.AGENT_TEAMS_ELECTRON_USER_DATA_DIR;
    if (quotaFile) process.env.AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE = quotaFile;
    if (profile) process.env.AGENT_TEAMS_ELECTRON_USER_DATA_DIR = profile;
    start();
  }
  appendFileSync(file, `${encoded}\n`);
  await delay(250);
  assert.deepEqual(received, []);
});

test('rejects outside paths, sibling prefix matches, relative paths, directories and missing files', async () => {
  const profile = join(dir, 'profile');
  mkdirSync(profile);
  const sibling = join(dir, 'profile-sibling');
  mkdirSync(sibling);
  const siblingFile = join(sibling, 'quota.jsonl');
  writeFileSync(siblingFile, '');
  for (const [quotaFile, userData] of [
    [file, profile], [siblingFile, profile], [relative(process.cwd(), file), dir],
    [file, relative(process.cwd(), dir)], [dir, dir], [join(dir, 'missing.jsonl'), dir],
  ]) {
    process.env.AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE = quotaFile;
    process.env.AGENT_TEAMS_ELECTRON_USER_DATA_DIR = userData;
    start();
  }
  appendFileSync(file, `${encoded}\n`);
  appendFileSync(siblingFile, `${encoded}\n`);
  await delay(250);
  assert.deepEqual(received, []);
});

test('rejects a symlinked directory escaping the profile', async () => {
  const profile = join(dir, 'profile');
  const outside = join(dir, 'outside');
  mkdirSync(profile);
  mkdirSync(outside);
  const outsideFile = join(outside, 'quota.jsonl');
  writeFileSync(outsideFile, '');
  symlinkSync(outside, join(profile, 'escape'), 'junction');
  process.env.AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE = join(profile, 'escape', 'quota.jsonl');
  process.env.AGENT_TEAMS_ELECTRON_USER_DATA_DIR = profile;
  start();
  appendFileSync(outsideFile, `${encoded}\n`);
  await delay(250);
  assert.deepEqual(received, []);
});

test('ignores malformed lines and does not let extra fields override terminal observations', async () => {
  start();
  const malformed: unknown[] = [null, [], 42, 'text', {},
    { ...signal, teamName: '../escape' }, { ...signal, teamName: '' },
    { ...signal, runId: null }, { ...signal, runId: '' }, { ...signal, runId: 'x'.repeat(257) },
    { ...signal, providerId: 'unknown' }, { ...signal, providerId: null },
    { ...signal, detail: {} }, { ...signal, detail: ' ' }, { ...signal, detail: 'x'.repeat(16001) },
  ];
  appendFileSync(file, `broken JSON\n\n${malformed.map((v) => JSON.stringify(v)).join('\n')}\n`);
  appendFileSync(file, `${'x'.repeat(70000)}\n`);
  appendFileSync(file, `${JSON.stringify({ ...signal, phase: 'sdk_retrying', memberName: 'attacker', observedAt: 'invalid' })}\r\n`);
  await waitFor(() => received.length === 1);
  assert.deepEqual(received[0], {
    ...signal, memberName: 'actual-team-lead', phase: 'terminal', observedAt: received[0].observedAt,
  });
  assert.ok(Number.isFinite(Date.parse(received[0].observedAt)));
  await delay(250);
  assert.equal(received.length, 1);
});

test('starts at EOF and delivers each appended line once, even identical lines and split UTF-8', async (t) => {
  writeFileSync(file, `${encoded}\n${encoded.slice(0, -1)}`);
  // Whitespace normalization matches the isolated Electron dev-profile override.
  process.env.AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE = ` ${file} `;
  process.env.AGENT_TEAMS_ELECTRON_USER_DATA_DIR = ` ${dir} `;
  const logs = t.mock.method(console, 'warn', () => {});
  start();
  appendFileSync(file, '}\n'); // Completion of a pre-startup partial line must be skipped.
  appendFileSync(file, `${encoded}\n${encoded}\n`);
  await waitFor(() => received.length === 2);
  const unicodeLine = Buffer.from(JSON.stringify({ ...signal, detail: 'quota exceeded: \u20ac' }));
  const split = unicodeLine.indexOf(Buffer.from('\u20ac')) + 1;
  appendFileSync(file, unicodeLine.subarray(0, split));
  await delay(250);
  assert.equal(received.length, 2);
  appendFileSync(file, Buffer.concat([unicodeLine.subarray(split), Buffer.from('\n')]));
  await waitFor(() => received.length === 3);
  await delay(250);
  assert.equal(received.length, 3);
  assert.equal(received[2].detail, 'quota exceeded: \u20ac');
  assert.equal(new Set(received.map((v) => v.observedAt)).size, 3);
  assert.equal(logs.mock.calls.length, 3);
  for (const call of logs.mock.calls) {
    assert.equal(call.arguments[0], 'SYNTHETIC quota signal injected (test adapter)');
  }
});

test('dispose stops polling and suppresses an in-flight lead lookup', async () => {
  let finish!: (name: string) => void;
  let lookingUp = false;
  const handle = start(() => {
    lookingUp = true;
    return new Promise<string>((resolveName) => { finish = resolveName; });
  });
  appendFileSync(file, `${encoded}\n`);
  await waitFor(() => lookingUp);
  handle.dispose();
  handle.dispose();
  finish('actual-team-lead');
  appendFileSync(file, `${encoded}\n`);
  await delay(250);
  assert.deepEqual(received, []);
});

test('a rejected lead lookup is consumed once and subsequent records still work', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let lookups = 0;
  start(async () => {
    if (++lookups === 1) throw new Error('test lookup failure');
    return 'actual-team-lead';
  });
  appendFileSync(file, `${encoded}\n${encoded}\n`);
  await waitFor(() => received.length === 1);
  await delay(250);
  assert.equal(lookups, 2);
  assert.equal(received.length, 1);
});

test('truncation never resets the cursor or replays old records', async (t) => {
  t.mock.method(console, 'warn', () => {});
  start();
  appendFileSync(file, `${encoded}\n`);
  await waitFor(() => received.length === 1);
  writeFileSync(file, '');
  await delay(250);
  appendFileSync(file, `${encoded}\n`);
  await delay(250);
  assert.equal(received.length, 1);
});

test('production export surface exposes no trigger, IPC, preload or renderer adapter', () => {
  assert.deepEqual(Object.keys(adapter), ['startE2eQuotaSignalInjector']);
  assert.deepEqual(Object.keys(start()), ['dispose']);
  const references: string[] = [];
  function scan(dirPath: string) {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const path = join(dirPath, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        if (/e2eQuotaSignalInjector|AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE/.test(readFileSync(path, 'utf8'))) {
          references.push(relative(root, path).replaceAll('\\', '/'));
        }
      }
    }
  }
  scan(resolve(root, 'src'));
  assert.deepEqual(references.sort(), [
    'src/main/composition/composeDesktopRuntimeRecovery.ts',
    'src/main/testing/e2eQuotaSignalInjector.ts',
  ]);
  const composition = readFileSync(join(root, references[0]), 'utf8');
  assert.doesNotMatch(composition, /export[^;]*startE2eQuotaSignalInjector/);
  assert.match(composition, /observeLeadFailure:\s*\(failure\)\s*=>\s*facade\.observeLeadFailure\(failure\)/);
});
