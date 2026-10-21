import { it } from 'vitest';

import { registerCatalogCases } from './catalogCases';
import { registerPlannerCases } from './plannerCases';

registerCatalogCases(it);
registerPlannerCases(it);
