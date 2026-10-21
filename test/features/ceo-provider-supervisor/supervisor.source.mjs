import { test } from 'node:test';
import { registerSupervisorCases } from './supervisorCases.ts';
import { registerAdapterCases } from './adapterCases.ts';
registerSupervisorCases(test);
registerAdapterCases(test);
