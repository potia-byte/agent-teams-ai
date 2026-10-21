import type { ProductionDependencies } from '../../../core/application/productionPorts';
import type { CeoSupervisorApi } from '@features/ceo-provider-supervisor/contracts';

/** The existing supervisor owns health evidence; catalog planning never probes providers. */
export function createCeoProductionCapacity(
  registry: Pick<CeoSupervisorApi, 'read'>,
  isLocal: () => boolean
): ProductionDependencies['capacity'] {
  return async (teamName) => {
    if (!isLocal()) throw new Error('Производство доступно только в локальном контексте');
    if (!teamName) return { providers: {}, concurrencyCap: 3 };
    const state = await registry.read(teamName);
    return {
      concurrencyCap: 3,
      providers: {
        codex: { configured: true, availability: state.providers.codex.availability },
        anthropic: { configured: true, availability: state.providers.anthropic.availability },
      },
      activeExecutors: state.owner ? [{ roleId: 'ceo', provider: state.owner.provider }] : [],
    };
  };
}
