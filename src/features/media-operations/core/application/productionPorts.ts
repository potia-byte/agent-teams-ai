import type { ProductionStageId, VerifiedArtifact } from '../../contracts';
import type {
  ActivationRequest,
  CompanyRoleCatalogApi,
} from '@features/company-role-catalog/contracts';

export interface ProductionArtifactsPort {
  verify(path: string, stage: ProductionStageId): Promise<VerifiedArtifact>;
  discover(key: string): Promise<{ stage: ProductionStageId; path: string }[]>;
}
export interface ProductionDependencies {
  artifacts: ProductionArtifactsPort;
  productionRoot: string;
  catalog: CompanyRoleCatalogApi;
  /** Runtime registry is authoritative; no probes, launches or inferred availability. */
  capacity(
    teamName: string | null
  ): Promise<Pick<ActivationRequest, 'providers' | 'activeExecutors' | 'concurrencyCap'>>;
}
