import type { CeoRuntime } from '@features/ceo-provider-supervisor/main';
import type { ProvisioningRun } from './TeamProvisioningRunModel';
import type { TeamLaunchRequest, TeamLaunchResponse } from '@shared/types';

export function createProvisioningCeoRuntime(ports: {
  exclusive: CeoRuntime['exclusive'];
  getRun(teamName: string): ProvisioningRun | undefined;
  hasSecondaryRuns(teamName: string): boolean;
  stop(teamName: string): Promise<void>;
  launch(request: TeamLaunchRequest): Promise<TeamLaunchResponse>;
  readProjectPath(teamName: string): Promise<string | undefined>;
}): CeoRuntime {
  // Retain only project location, never provider session/auth/model/CLI arguments.
  const cwdByTeam = new Map<string, string>();
  return {
    exclusive: ports.exclusive,
    async inspect(teamName) {
      const run = ports.getRun(teamName);
      if (!run) return null;
      const provider = run.request.providerId ?? 'anthropic';
      if (provider !== 'anthropic' && provider !== 'codex') throw new Error('Unsupported CEO executor');
      if (run.launchIdentity?.billingMode !== 'subscription') throw new Error('CEO fallback requires verified subscription access');
      cwdByTeam.set(teamName, run.request.cwd);
      return {
        runId: run.runId, provider, effectsRevision: run.ceoEffectRevision ?? 0,
        safe: run.provisioningComplete && !run.cancelRequested && !run.processKilled &&
          run.leadActivityState === 'idle' &&
          run.activeToolCalls.size === 0 && run.pendingApprovals.size === 0 &&
          !run.authRetryInProgress && run.expectedMembers.length === 0 &&
          !ports.hasSecondaryRuns(teamName),
      };
    },
    async stop(teamName, expectedRunId) {
      const run = ports.getRun(teamName);
      if (!run || run.runId !== expectedRunId) throw new Error('Stale CEO owner');
      // Capture the exact ChildProcess before cleanup deletes the run registry.
      const child = run.child;
      await ports.stop(teamName);
      if (child?.pid && child.exitCode == null && child.signalCode == null) {
        throw new Error('CEO termination not confirmed');
      }
      if (ports.getRun(teamName)) throw new Error('CEO owner was not retired');
    },
    async start(teamName, providerId, prompt) {
      const cwd = cwdByTeam.get(teamName) ?? await ports.readProjectPath(teamName);
      if (!cwd || ports.getRun(teamName)) throw new Error('Safe CEO launch ownership unavailable');
      const response = await ports.launch({
        teamName, cwd, providerId, prompt, clearContext: true,
        // Keep tools under permission checks; no inherited raw --resume/extra flags.
        skipPermissions: false, extraCliArgs: '',
        providerBackendId: providerId === 'anthropic' ? 'cli-sdk' : 'codex-native',
        requiredBillingMode: 'subscription',
      });
      if (response.alreadyRunning || response.alreadyLaunching || response.launchStatus === 'already_running' || response.launchStatus === 'already_launching') {
        throw new Error('CEO fresh launch was not admitted');
      }
      return response.runId;
    },
  };
}
