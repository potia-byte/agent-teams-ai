import { homedir } from 'node:os';
import { join } from 'node:path';

import { createCompanyRoleCatalogApi } from '@features/company-role-catalog/main';
import {
  createCeoProductionCapacity,
  createMediaOperationsFeature,
  loadTelegramOwnerAdapter,
  ProductionArtifacts,
  registerProductionIpc,
} from '@features/media-operations/main';
import { app } from 'electron';

import type { CeoSupervisorApi } from '@features/ceo-provider-supervisor/contracts';
import type { MediaProductionApi } from '@features/media-operations/contracts';
import type { IpcMain } from 'electron';

/** Desktop-only filesystem integration. No provider probing, paid services or public publishing. */
export function composeMediaOperations(options: {
  ipcMain: IpcMain;
  ceo: CeoSupervisorApi;
  isLocal(): boolean;
}) {
  const ready = (async () => {
    const telegram = await loadTelegramOwnerAdapter(process.env.AGENT_TEAMS_TELEGRAM_ENV_FILE);
    const productionRoot =
      process.env.AGENT_TEAMS_PRODUCTION_ROOT ??
      join(homedir(), 'Documents', 'agent-teams-ai-fork', 'production');
    const feature = await createMediaOperationsFeature({
      directory: join(app.getPath('userData'), 'media-operations'),
      ownerId: 'desktop-owner',
      ownerChatId: telegram?.ownerId ?? 'desktop-owner',
      telegram: telegram ?? undefined,
      production: {
        productionRoot,
        artifacts: new ProductionArtifacts(productionRoot),
        catalog: createCompanyRoleCatalogApi(),
        capacity: createCeoProductionCapacity(options.ceo, options.isLocal),
      },
    });
    telegram?.start(
      (_sender, text) => feature.approvals.command('desktop-owner', text),
      () => feature.approvals.deliverPending()
    );
    return { production: feature.production!, telegram };
  })();
  // IPC is registered synchronously. Every request waits for recovery, and startup failures
  // pass through the same safe error boundary instead of leaving an unregistered channel.
  void ready.catch(() => undefined);
  const api: MediaProductionApi = {
    list: async () => (await ready).production.list(),
    create: async (input) => (await ready).production.create(input),
    get: async (key) => (await ready).production.get(key),
    attach: async (input) => (await ready).production.attach(input),
    advance: async (input) => (await ready).production.advance(input),
    decide: async (input) => (await ready).production.decide(input),
    summary: async () => (await ready).production.summary(),
  };
  const unregister = registerProductionIpc(options.ipcMain, api, options.isLocal);
  return {
    async dispose() {
      unregister();
      await (await ready.catch(() => null))?.telegram?.dispose();
    },
  };
}
