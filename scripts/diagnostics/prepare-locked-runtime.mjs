import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { verifyRuntimeArchiveChecksum } from '../lib/runtime-archive-checksum.mjs';
import {
  getExpectedRuntimeCliVersion,
  matchesRuntimeCliVersion,
} from '../lib/runtime-cli-version.mjs';
import {
  extractArchive,
  findExtractedBinary,
  publishRuntimePayload,
} from '../lib/runtime-payload-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'runtime.lock.json'), 'utf8'));
const platform = `${process.platform}-${process.arch}`;
const asset = lock.assets[platform];
if (lock.version !== '0.0.124' || !asset) throw new Error('Expected locked runtime 0.0.124');
const cache = path.join(root, '.local-tools/runtime-cache', lock.version, platform);
const diagnostics = path.join(root, '.local-tools/diagnostics');
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(diagnostics, { recursive: true });
const archive = path.join(cache, asset.file);
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  version: lock.version,
  platform,
  archive,
  expectedSha256: asset.sha256,
  proxyEnvironmentModified: false,
  ready: false,
};
try {
  if (!fs.existsSync(archive)) {
    if (!process.argv.includes('--download'))
      throw new Error('Archive absent; explicit --download required');
    report.url = `https://github.com/${lock.releaseRepository}/releases/download/${lock.releaseTag}/${asset.file}`;
    const response = await fetch(report.url, { signal: AbortSignal.timeout(180000) });
    report.httpStatus = response.status;
    if (!response.ok || !response.body)
      throw new Error(`Locked runtime download returned HTTP ${response.status}`);
    // A partial transfer is preserved as .part and never accepted as the archive.
    await pipeline(
      Readable.fromWeb(response.body),
      fs.createWriteStream(`${archive}.part`, { flags: 'wx' })
    );
    fs.renameSync(`${archive}.part`, archive);
  }
  report.actualSha256 = await verifyRuntimeArchiveChecksum(archive, asset, platform);
  report.checksumVerified = true;
  const extracted = path.join(cache, 'verified-extracted');
  extractArchive(archive, extracted, asset.archiveKind, (command, args, options) => {
    const result = spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Archive extraction exited ${result.status}`);
  });
  const binary = findExtractedBinary(extracted, asset.binaryName);
  const versionFile = path.join(diagnostics, 'locked-runtime-version.txt');
  const fd = fs.openSync(versionFile, 'w');
  let version;
  try {
    const result = spawnSync(binary, ['--version'], {
      cwd: cache,
      stdio: ['ignore', fd, fd],
      timeout: 15000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Locked runtime --version exited ${result.status}`);
  } finally {
    fs.closeSync(fd);
  }
  version = fs.readFileSync(versionFile, 'utf8').trim();
  report.cliVersionOutput = version;
  report.versionCapture = 'file descriptors; not a pipe-based launcher test';
  if (!matchesRuntimeCliVersion(version, getExpectedRuntimeCliVersion(lock))) {
    throw new Error('Locked runtime CLI version mismatch');
  }
  report.binary = publishRuntimePayload(binary, path.join(cache, 'payload-v1'), asset.sha256);
  report.ready = true;
} catch (error) {
  report.error = { message: error.message, code: error.code, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(diagnostics, 'locked-runtime.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  console.log(JSON.stringify(report, null, 2));
}
