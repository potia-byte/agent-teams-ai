import { planRoleActivation } from '../../core/domain/planActivation';
import { validateCompanyRoleCatalog } from '../../core/domain/validateCatalog';

import { businessProfiles } from './data/businessProfiles';
import { editorialProfiles } from './data/editorialProfiles';
import { engineeringProfiles } from './data/engineeringProfiles';
import { productionProfiles } from './data/productionProfiles';
import { strategyProfiles } from './data/strategyProfiles';
import { visualProfiles } from './data/visualProfiles';

import type { CompanyRoleCatalogApi, CompanyRoleProfile } from '../../contracts';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Loads only bundled definitions. No filesystem, network, credentials or provider probes. */
export function loadCompanyRoleCatalog(): readonly CompanyRoleProfile[] {
  const catalog = [
    ...strategyProfiles,
    ...editorialProfiles,
    ...visualProfiles,
    ...productionProfiles,
    ...businessProfiles,
    ...engineeringProfiles,
  ];
  const validation = validateCompanyRoleCatalog(catalog);
  if (!validation.valid) {
    throw new Error(
      `Invalid bundled role catalog: ${validation.issues.map(({ path, code }) => `${path}:${code}`).join(', ')}`
    );
  }
  return deepFreeze(catalog);
}

export function createCompanyRoleCatalogApi(): CompanyRoleCatalogApi {
  const catalog = loadCompanyRoleCatalog();
  return Object.freeze({
    list: () => catalog,
    get: (id: string) => catalog.find((role) => role.id === id),
    plan: (request: Parameters<CompanyRoleCatalogApi['plan']>[0]) =>
      planRoleActivation(catalog, request),
  });
}
