import { it } from 'vitest';
import { registerSupervisorCases } from './supervisorCases';
import { registerAdapterCases } from './adapterCases';
registerSupervisorCases(it);
registerAdapterCases(it);
