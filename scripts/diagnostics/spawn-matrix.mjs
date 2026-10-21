import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const gitPath = option('--git-path');
const output = option('--output');
if (
  !args.includes('--git-path') ||
  !args.includes('--output') ||
  !path.isAbsolute(gitPath) ||
  !path.isAbsolute(output) ||
  !path.relative(root, output).startsWith(`.local-tools${path.sep}`)
) {
  throw new Error('Provide absolute --git-path and --output inside checkout/.local-tools');
}
const esbuildPackage = require.resolve('esbuild/package.json', {
  paths: [path.dirname(require.resolve('vite/package.json'))],
});
const esbuildPath = path.join(
  path.dirname(
    require.resolve('@esbuild/win32-x64/package.json', {
      paths: [path.dirname(esbuildPackage)],
    })
  ),
  'esbuild.exe'
);
const tools = [
  { name: 'node', executable: process.execPath },
  { name: 'git', executable: gitPath },
  { name: 'esbuild', executable: esbuildPath },
];
const errorDto = (error) =>
  error
    ? Object.fromEntries(
        ['name', 'message', 'code', 'errno', 'syscall', 'path', 'spawnargs'].map((k) => [
          k,
          error[k],
        ])
      )
    : null;

async function run(tool, method, stdio) {
  const startedAt = new Date().toISOString();
  const options = { cwd: root, stdio, windowsHide: true, shell: false };
  let result;
  if (method === 'spawnSync') {
    const child = spawnSync(tool.executable, ['--version'], {
      ...options,
      encoding: 'utf8',
      timeout: 10000,
    });
    result = {
      exitCode: child.status,
      signal: child.signal,
      error: errorDto(child.error),
      stdout: child.stdout,
      stderr: child.stderr,
    };
  } else {
    result = await new Promise((resolve) => {
      let child;
      let stdout = '',
        stderr = '',
        timer;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ...value,
          stdout: stdio === 'pipe' ? stdout : null,
          stderr: stdio === 'pipe' ? stderr : null,
        });
      };
      try {
        child = spawn(tool.executable, ['--version'], options);
        child.stdout?.on('data', (data) => {
          stdout += data;
        });
        child.stderr?.on('data', (data) => {
          stderr += data;
        });
        child.stdin?.end();
        child.once('error', (error) => finish({ exitCode: null, error: errorDto(error) }));
        child.once('close', (exitCode, signal) => finish({ exitCode, signal, error: null }));
        timer = setTimeout(() => {
          child.kill();
          finish({ exitCode: null, error: { code: 'DIAGNOSTIC_TIMEOUT' } });
        }, 10000);
      } catch (error) {
        finish({ exitCode: null, error: errorDto(error) });
      }
    });
  }
  const row = {
    tool: tool.name,
    executable: tool.executable,
    args: ['--version'],
    method,
    stdio,
    startedAt,
    endedAt: new Date().toISOString(),
    ...result,
  };
  console.log(`${tool.name} ${method} ${stdio}: ${row.error?.code ?? row.exitCode}`);
  return row;
}

const startedAt = new Date().toISOString();
const results = [];
for (const tool of tools) {
  for (const method of ['spawn', 'spawnSync']) {
    for (const stdio of ['inherit', 'pipe']) results.push(await run(tool, method, stdio));
  }
}
const report = {
  schemaVersion: 1,
  startedAt,
  endedAt: new Date().toISOString(),
  host: {
    executable: process.execPath,
    node: process.versions.node,
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
  },
  cwd: root,
  options: { shell: false, windowsHide: true, timeoutMs: 10000 },
  results,
};
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
