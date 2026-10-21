import { createCeoSupervisorFeature } from '@features/ceo-provider-supervisor/main';
import { createTeamRuntimeRecoveryFeature } from '@features/team-runtime-recovery/main';
import { startE2eQuotaSignalInjector } from '@main/testing/e2eQuotaSignalInjector';

import type { CeoRuntime } from '@features/ceo-provider-supervisor/main';
import type { IpcMain } from 'electron';

/** One recovery owner per team, using the existing recovery facade/lifecycle. */
export function composeDesktopRuntimeRecovery(deps: Parameters<typeof createTeamRuntimeRecoveryFeature>[0] & {
  ipcMain: IpcMain;
  ceoRuntime: CeoRuntime;
}): ReturnType<typeof createTeamRuntimeRecoveryFeature> {
  const recovery = createTeamRuntimeRecoveryFeature({
    ...deps, isRecoveryOwnedElsewhere: async (teamName) => (await ceo?.owns(teamName)) ?? false,
  });
  const ceo = createCeoSupervisorFeature({
    ipcMain: deps.ipcMain, teamsBasePath: deps.teamsBasePath, getContextId: deps.getCurrentContextId,
    runtime: deps.ceoRuntime,
    quiesceRecovery: (teamName) => recovery.cancelTeam(teamName, 'ceo_supervisor_enabled'),
    onError: (error) => deps.logger?.warn('CEO supervisor failed closed', { error: String(error) }),
  });
  const facade = {
    ...recovery,
    observeLeadFailure: (failure: Parameters<typeof recovery.observeLeadFailure>[0]) =>
      ceo?.observe(failure, () => recovery.observeLeadFailure(failure)),
    async dispose() { injector.dispose(); await ceo?.dispose(); await recovery.dispose(); },
  };
  const injector = startE2eQuotaSignalInjector({ getLeadName: deps.getLeadName,
    observeLeadFailure: (failure) => facade.observeLeadFailure(failure) });
  return facade;
}
