import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { isTeamProviderId } from '@shared/utils/teamProvider';

import type { LeadRuntimeFailureObservation } from '@main/services/team/TeamProvisioningService';

const MAX_LINE_BYTES = 64 * 1024;

function isInside(root: string, file: string): boolean {
  const child = relative(root, file);
  return !!child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function parseSignal(line: string) {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { teamName, runId, providerId, detail } = value as Record<string, unknown>;
    if (
      typeof teamName !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(teamName) ||
      typeof runId !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(runId) ||
      !isTeamProviderId(providerId) ||
      typeof detail !== 'string' || !detail.trim() || detail.length > 16000
    ) return null;
    return { teamName, runId, providerId, detail };
  } catch {
    return null;
  }
}

/** Internal test adapter only. Pre-create an append-only JSONL file before startup.
 * No injection method is returned or exposed through any production transport.
 */
export function startE2eQuotaSignalInjector(deps: {
  getLeadName(teamName: string): Promise<string | null>;
  observeLeadFailure(failure: LeadRuntimeFailureObservation): void;
}): { dispose(): void } {
  const inactive = { dispose() {} };
  // Mirror electronDevPathOverrides: trim, require absolute paths, then resolve.
  const file = process.env.AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE?.trim();
  const profile = process.env.AGENT_TEAMS_ELECTRON_USER_DATA_DIR?.trim();
  if (!file || !profile || !isAbsolute(file) || !isAbsolute(profile)) return inactive;
  let fd: number | undefined;
  let offset: number;
  let dropping = false;
  try {
    if (!isInside(resolve(profile), resolve(file)) ||
        !isInside(realpathSync(profile), realpathSync(file)) || !statSync(file).isFile()) return inactive;
    fd = openSync(file, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile()) { closeSync(fd); return inactive; }
    offset = stat.size; // Never replay pre-startup records, including a partial last line.
    if (offset) {
      const last = Buffer.alloc(1);
      readSync(fd, last, 0, 1, offset - 1);
      dropping = last[0] !== 10;
    }
  } catch {
    if (fd !== undefined) closeSync(fd);
    return inactive;
  }
  const descriptor = fd;
  let disposed = false;
  let busy = false;
  let pending = Buffer.alloc(0);
  let observedAtMs = 0;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    closeSync(descriptor);
  };
  const poll = async (): Promise<void> => {
    if (disposed || busy) return;
    busy = true;
    try {
      // Truncation ends this adapter; resetting the cursor could replay a signal.
      if (fstatSync(descriptor).size < offset) { dispose(); return; }
      const chunk = Buffer.alloc(MAX_LINE_BYTES);
      const count = readSync(descriptor, chunk, 0, chunk.length, offset);
      offset += count; // Consume before invoking observers; failed deliveries are not retried.
      let start = 0;
      while (start < count && !disposed) {
        const newline = chunk.indexOf(10, start);
        const end = newline < 0 || newline >= count ? count : newline;
        if (!dropping) {
          if (pending.length + end - start > MAX_LINE_BYTES) dropping = true;
          else pending = Buffer.concat([pending, chunk.subarray(start, end)]);
        }
        if (end === count) break;
        const signal = dropping ? null : parseSignal(pending.toString('utf8'));
        pending = Buffer.alloc(0);
        dropping = false;
        start = end + 1;
        if (!signal) continue;
        try {
          const memberName = await deps.getLeadName(signal.teamName);
          if (disposed || !memberName) continue;
          observedAtMs = Math.max(Date.now(), observedAtMs + 1);
          console.warn('SYNTHETIC quota signal injected (test adapter)', {
            teamName: signal.teamName, runId: signal.runId, providerId: signal.providerId,
          });
          deps.observeLeadFailure({
            ...signal, memberName, phase: 'terminal', observedAt: new Date(observedAtMs).toISOString(),
          });
        } catch (error) {
          console.warn('SYNTHETIC quota signal delivery failed (test adapter)', String(error));
        }
      }
    } catch {
      dispose(); // Fail closed on unreadable/deleted files; never reopen or reset the offset.
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => { void poll(); }, 100);
  timer.unref();
  return { dispose };
}
