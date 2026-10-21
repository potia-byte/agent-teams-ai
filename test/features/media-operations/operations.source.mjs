import { test } from 'node:test';
import { registerApprovalCases } from './approvalCases.ts';
import { registerFailureCases } from './failureCases.ts';
import { registerPublicationCases } from './publicationCases.ts';
import { registerRecordsCases } from './recordsCases.ts';

registerPublicationCases(test);
registerApprovalCases(test);
registerRecordsCases(test);
registerFailureCases(test);
