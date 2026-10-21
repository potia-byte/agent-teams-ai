import type { ProvisioningRun } from './TeamProvisioningRunModel';
import type { CeoRuntime } from '@features/ceo-provider-supervisor/main';
import type { TeamLaunchRequest, TeamLaunchResponse } from '@shared/types';

export function createProvisioningCeoRuntime(
  ports: {
    exclusive: CeoRuntime['exclusive'];
    /** Only the team's registered alive run, never its pending provisioning run. */
    getRun(teamName: string): ProvisioningRun | undefined;
    hasSecondaryRuns(teamName: string): boolean;
    stop(teamName: string): Promise<void>;
    launch(request: TeamLaunchRequest): Promise<TeamLaunchResponse>;
    readProjectPath(teamName: string): Promise<string | undefined>;
  },
  clock: {
    now(): number;
    wait(ms: number): Promise<void>;
  } = {
    now: () => performance.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
): CeoRuntime {
  // Retain only project location, never provider session/auth/model/CLI arguments.
  const cwdByTeam = new Map<string, string>();
  return {
    exclusive: ports.exclusive,
    async inspect(teamName) {
      const run = ports.getRun(teamName);
      if (!run) return null;
      const provider = run.request.providerId ?? 'anthropic';
      if (provider !== 'anthropic' && provider !== 'codex')
        throw new Error('Unsupported CEO executor');
      if (run.launchIdentity?.billingMode !== 'subscription')
        throw new Error('CEO fallback requires verified subscription access');
      cwdByTeam.set(teamName, run.request.cwd);
      return {
        runId: run.runId,
        provider,
        effectsRevision: run.ceoEffectRevision ?? 0,
        safe:
          run.provisioningComplete &&
          !run.cancelRequested &&
          !run.processKilled &&
          run.leadActivityState === 'idle' &&
          run.activeToolCalls.size === 0 &&
          run.pendingApprovals.size === 0 &&
          !run.authRetryInProgress &&
          run.expectedMembers.length === 0 &&
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
    async start(teamName, providerId, prompt, model) {
      const cwd = cwdByTeam.get(teamName) ?? (await ports.readProjectPath(teamName));
      if (!cwd || ports.getRun(teamName)) throw new Error('launch_rejected');
      const response = await ports.launch({
        teamName,
        cwd,
        providerId,
        prompt,
        clearContext: true,
        ...(model ? { model } : {}),
        // Keep tools under permission checks; no inherited raw --resume/extra flags.
        skipPermissions: false,
        extraCliArgs: '',
        providerBackendId: providerId === 'anthropic' ? 'cli-sdk' : 'codex-native',
        requiredBillingMode: 'subscription',
      });
      if (
        response.alreadyRunning ||
        response.alreadyLaunching ||
        response.launchStatus === 'already_running' ||
        response.launchStatus === 'already_launching'
      ) {
        throw new Error('launch_rejected');
      }
      if (!response.runId) throw new Error('replacement_ownership_unproven');
      // launchTeam acknowledges spawn, not ready/alive registration. Launch exactly
      // once, then await ownership evidence without treating a pending run as alive.
      const deadline = clock.now() + 60_000;
      for (;;) {
        const run = ports.getRun(teamName);
        if (run) {
          if (
            run.runId !== response.runId ||
            run.teamName !== teamName ||
            run.request.providerId !== providerId ||
            run.cancelRequested ||
            run.processKilled ||
            run.processClosed ||
            run.child?.exitCode != null ||
            run.child?.signalCode != null ||
            (run.launchIdentity && run.launchIdentity.billingMode !== 'subscription')
          ) {
            throw new Error('replacement_ownership_unproven');
          }
          // Ownership and checkpoint safety are separate: a busy owner may be
          // committed, but inspect().safe still requires an idle solo lead.
          if (run.launchIdentity?.billingMode === 'subscription') return response.runId;
        }
        const remaining = deadline - clock.now();
        if (remaining <= 0) throw new Error('start_timeout');
        await clock.wait(Math.min(250, remaining));
      }
    },
  };
}
