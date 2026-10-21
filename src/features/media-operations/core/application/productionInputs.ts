import { z } from 'zod';

import { PRODUCTION_STAGES } from '../../contracts';

const key = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const label = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim() === value);
export const productionInputs = {
  key,
  create: z.strictObject({
    key,
    title: label,
    template: z.literal('short-video-v1'),
    nicheId: label,
    teamName: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)
      .nullable(),
    channelId: label.nullable(),
  }),
  stage: z.strictObject({ key, stage: z.enum(PRODUCTION_STAGES) }),
  attach: z.strictObject({
    key,
    stage: z.enum(PRODUCTION_STAGES),
    path: z.string().min(1).max(4096),
  }),
  decide: z.strictObject({
    key,
    approvalId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    decision: z.enum(['approve', 'reject']),
  }),
};
