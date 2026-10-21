const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const output = value('--output');
const nodePath = value('--node-path');
if (
  !args.includes('--output') ||
  !args.includes('--node-path') ||
  !path.isAbsolute(output) ||
  !path.isAbsolute(nodePath) ||
  !path.relative(root, output).startsWith(`.local-tools${path.sep}`)
) {
  throw new Error('Provide absolute --node-path and --output inside checkout/.local-tools');
}
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  host: {
    executable: process.execPath,
    electron: process.versions.electron,
    node: process.versions.node,
    abi: process.versions.modules,
    processType: process.type,
  },
  checks: {},
};
const errorDto = (error) => ({ message: error.message, code: error.code, stack: error.stack });
const isElectronMain = process.type === 'browser';
let app;
function persist() {
  report.endedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
process.once('uncaughtException', (error) => {
  report.fatalError = errorDto(error);
  report.passed = false;
  persist();
  if (app) app.exit(1);
  else process.exit(1);
});
if (isElectronMain) {
  app = require('electron').app;
  const state = path.join(root, '.local-tools/diagnostics/native-electron-state');
  for (const [name, suffix] of Object.entries({
    userData: 'user-data',
    sessionData: 'session',
    logs: 'logs',
    crashDumps: 'crashes',
    temp: 'tmp',
  })) {
    const location = path.join(state, suffix);
    fs.mkdirSync(location, { recursive: true });
    app.setPath(name, location);
  }
}

async function probe() {
  if (process.versions.electron !== '44.4.5' || process.versions.modules !== '149') {
    throw new Error('This probe requires locked Electron 44.4.5 / ABI 149');
  }
  try {
    const Database = require('better-sqlite3');
    const database = new Database(':memory:');
    try {
      database.exec('CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      database.transaction(() =>
        database.prepare('INSERT INTO proof VALUES (?, ?)').run(1, 'native-ok')
      )();
      const row = database.prepare('SELECT value FROM proof WHERE id=?').get(1);
      if (row?.value !== 'native-ok') throw new Error('SQLite roundtrip mismatch');
      report.checks.sqlite = { passed: true, storage: ':memory:', transaction: true, row };
    } finally {
      database.close();
    }
  } catch (error) {
    report.checks.sqlite = { passed: false, error: errorDto(error) };
  }

  report.checks.pty = await new Promise((resolve) => {
    let terminal,
      timer,
      settled = false,
      text = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    try {
      terminal = require('node-pty').spawn(
        nodePath,
        ['-e', "process.stdout.write('MEDIA_NATIVE_PTY_OK\\r\\n')"],
        { name: 'xterm-color', cols: 80, rows: 24, cwd: root, env: { ...process.env } }
      );
      terminal.onData((data) => {
        text += data;
      });
      terminal.onExit(({ exitCode, signal }) =>
        finish({
          passed: exitCode === 0 && text.includes('MEDIA_NATIVE_PTY_OK'),
          childExecutable: nodePath,
          pid: terminal.pid,
          exitCode,
          signal,
          output: text,
        })
      );
      timer = setTimeout(() => {
        try {
          terminal.kill();
        } catch {
          /* only this owned test PTY */
        }
        finish({ passed: false, error: { code: 'NATIVE_PTY_TIMEOUT' }, pid: terminal.pid });
      }, 10000);
    } catch (error) {
      finish({ passed: false, error: errorDto(error) });
    }
  });
}

(async () => {
  try {
    if (app) await app.whenReady();
    await probe();
  } catch (error) {
    report.error = errorDto(error);
  }
  report.passed = !report.error && report.checks.sqlite?.passed && report.checks.pty?.passed;
  persist();
  console.log(JSON.stringify(report));
  if (app) app.exit(report.passed ? 0 : 1);
  else process.exitCode = report.passed ? 0 : 1;
})();
