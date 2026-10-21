import { it } from 'vitest';

import { registerApprovalCases } from './approvalCases';
import { registerFailureCases } from './failureCases';
import { registerPublicationCases } from './publicationCases';
import { registerRecordsCases } from './recordsCases';

registerPublicationCases(it);
registerApprovalCases(it);
registerRecordsCases(it);
registerFailureCases(it);
