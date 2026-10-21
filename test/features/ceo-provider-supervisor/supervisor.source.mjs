import { test } from 'node:test';
import { registerSupervisorCases } from './supervisorCases.ts';
import { registerAdapterCases } from './adapterCases.ts';
import { registerProviderPolicyCases } from './providerPolicyCases.ts';
import { registerRecoveryCases } from './recoveryCases.ts';
registerSupervisorCases(test);
registerAdapterCases(test);
registerProviderPolicyCases(test);
registerRecoveryCases(test);
