import { it } from 'vitest';

import { registerAdapterCases } from './adapterCases';
import { registerProviderPolicyCases } from './providerPolicyCases';
import { registerRecoveryCases } from './recoveryCases';
import { registerSupervisorCases } from './supervisorCases';
registerSupervisorCases(it);
registerAdapterCases(it);
registerProviderPolicyCases(it);
registerRecoveryCases(it);
