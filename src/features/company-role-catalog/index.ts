/** Browser-safe pure policies; bundled data loading is owned by the main entrypoint. */
export type {
  ActivationPlan,
  ActivationRequest,
  CatalogProvider,
  CatalogValidationResult,
  CompanyRoleCatalogApi,
  CompanyRoleProfile,
} from './contracts';
export { planRoleActivation } from './core/domain/planActivation';
export { validateCompanyRoleCatalog } from './core/domain/validateCatalog';
