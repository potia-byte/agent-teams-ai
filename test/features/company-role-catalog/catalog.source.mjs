import { test } from 'node:test';
import { registerCatalogCases } from './catalogCases.ts';
import { registerPlannerCases } from './plannerCases.ts';

registerCatalogCases(test);
registerPlannerCases(test);
