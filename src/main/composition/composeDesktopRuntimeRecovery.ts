import { createCeoSupervisorFeature } from '@features/ceo-provider-supervisor/main';
import type { CeoRuntime } from '@features/ceo-provider-supervisor/main';
import { createTeamRuntimeRecoveryFeature } from '@features/team-runtime-recovery/main';
import type { IpcMain } from 'electron';

/** One recovery owner per team, using the existing recovery facade/lifecycle. */
export function composeDesktopRuntimeRecovery(deps: Parameters<typeof createTeamRuntimeRecoveryFeature>[0] & {
  ipcMain: IpcMain;
  ceoRuntime: CeoRuntime;
}): ReturnType<typeof createTeamRuntimeRecoveryFeature> {
  let ceo: ReturnType<typeof createCeoSupervisorFeature> | undefined;
  const recovery = createTeamRuntimeRecoveryFeature({
    ...deps, isRecoveryOwnedElsewhere: async (teamName) => (await ceo?.owns(teamName)) ?? false,
  });
  ceo = createCeoSupervisorFeature({
    ipcMain: deps.ipcMain, teamsBasePath: deps.teamsBasePath, getContextId: deps.getCurrentContextId,
    runtime: deps.ceoRuntime,
    quiesceRecovery: (teamName) => recovery.cancelTeam(teamName, 'ceo_supervisor_enabled'),
    onError: (error) => deps.logger?.warn('CEO supervisor failed closed', { error: String(error) }),
  });
  return {
    ...recovery,
    observeLeadFailure: (failure) => ceo?.observe(failure, () => recovery.observeLeadFailure(failure)),
    async dispose() { await ceo?.dispose(); await recovery.dispose(); },
  };
}
