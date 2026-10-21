import { z } from 'zod';

import { PRODUCTION_STAGES } from '../../contracts/production';

import type { ProductionStage, ProductionStageId } from '../../contracts/production';

const text = z.string().trim().min(1).max(8000);
const timestamp = z.number().int().nonnegative().safe();
const qaVerdict = z
  .strictObject({
    verdict: z.enum(['PASS', 'PASS_WITH_NOTES', 'BLOCK']),
    unverifiedCriteria: z.array(text),
  })
  .refine((qa) => qa.verdict !== 'PASS' || qa.unverifiedCriteria.length === 0);

export const STAGE_ROLES: Record<ProductionStageId, string[]> = {
  research: ['topic-researcher'],
  script: ['scriptwriter'],
  fact_check: ['fact-checker'],
  visual_plan: ['visual-editor'],
  licenses: ['licensing-specialist'],
  voice: ['voice-tts-specialist'],
  render: ['render-engineer'],
  qa: ['independent-qa'],
  owner_approval: ['ceo'],
  publication_queue: ['publication-manager'],
};
export const STAGE_EXECUTORS: Record<ProductionStageId, ProductionStage['executor']> = {
  research: 'attach_artifact',
  script: 'attach_artifact',
  fact_check: 'attach_artifact',
  visual_plan: 'attach_artifact',
  licenses: 'attach_artifact',
  voice: 'attach_artifact',
  render: 'attach_artifact',
  qa: 'qa_gate',
  owner_approval: 'owner_approval',
  publication_queue: 'enqueue_publication',
};
const executor = z.strictObject({ roleId: text, provider: z.enum(['codex', 'anthropic']) });
const selection = z
  .strictObject({
    concurrencyCap: z.number().int().min(0).max(39),
    retained: z.array(executor),
    activations: z.array(executor.extend({ taskId: text })),
    deferred: z.array(
      z.strictObject({
        taskId: text,
        reason: z.enum([
          'unknown-role',
          'review-conflict',
          'already-active',
          'concurrency-cap',
          'no-available-executor',
        ]),
      })
    ),
  })
  .refine((plan) => plan.retained.length + plan.activations.length <= plan.concurrencyCap);
export const productionPipelineSchema = z
  .strictObject({
    template: z.literal('short-video-v1'),
    title: text,
    teamName: text.nullable(),
    nicheId: text,
    channelId: text.nullable(),
    approvalId: text.nullable(),
    operationId: text.nullable(),
    stages: z
      .array(
        z.strictObject({
          id: z.enum(PRODUCTION_STAGES),
          executor: z.enum(['attach_artifact', 'qa_gate', 'owner_approval', 'enqueue_publication']),
          status: z.enum(['pending', 'ready', 'waiting', 'blocked', 'completed']),
          requiredRoleIds: z.array(text),
          selection: selection.nullable(),
          selectionReason: text,
          detail: text,
          artifacts: z.array(
            z.strictObject({
              path: text,
              kind: z.enum(['file', 'directory']),
              fingerprint: text,
              verifiedAt: timestamp,
              video: z
                .strictObject({
                  width: z.number().positive(),
                  height: z.number().positive(),
                  duration: z.number().positive(),
                  audio: z.boolean(),
                })
                .nullable(),
              qa: qaVerdict.nullable(),
            })
          ),
        })
      )
      .length(PRODUCTION_STAGES.length),
    history: z
      .array(z.strictObject({ at: timestamp, stage: z.enum(PRODUCTION_STAGES), detail: text }))
      .min(1),
  })
  .superRefine((pipeline, ctx) => {
    let unfinished = false;
    pipeline.stages.forEach((stage, index) => {
      if (
        stage.id !== PRODUCTION_STAGES[index] ||
        stage.executor !== STAGE_EXECUTORS[stage.id] ||
        JSON.stringify(stage.requiredRoleIds) !== JSON.stringify(STAGE_ROLES[stage.id]) ||
        (unfinished && stage.status !== 'pending')
      )
        ctx.addIssue({ code: 'custom', message: 'Invalid production stage order' });
      if (stage.status !== 'completed') unfinished = true;
    });
  });

/** Explicit report protocol; missing criteria are never interpreted as verified. */
export function parseQaReport(report: string) {
  const criteriaHeadings = [
    ...report.matchAll(
      /^(?:#{1,3}[ \t]*)?(?:UNVERIFIED_CRITERIA|Unverified criteria|Непроверенные критерии)[ \t]*:?[ \t]*\r?$/gim
    ),
  ];
  const verdicts = [
    ...report.matchAll(
      /^(?:#{1,3}\s*)?(?:VERDICT|Вердикт)\s*:\s*(PASS_WITH_NOTES|PASS|BLOCK)\s*$/gim
    ),
  ];
  const section =
    /^(?:#{1,3}\s*)?(?:UNVERIFIED_CRITERIA|Unverified criteria|Непроверенные критерии)\s*:?\s*\r?\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im.exec(
      report
    );
  if (verdicts.length !== 1 || !section || criteriaHeadings.length !== 1)
    throw new Error(
      'Отчёт QA не по протоколу: нужна ровно одна строка «VERDICT: PASS | PASS_WITH_NOTES | BLOCK» и заголовок UNVERIFIED_CRITERIA со списком «- критерий» (или «нет»)'
    );
  const lines = section[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let unverifiedCriteria: string[];
  if (lines.length === 1 && /^(?:\[\]|-?\s*none|-?\s*нет)$/i.test(lines[0]))
    unverifiedCriteria = [];
  else {
    if (!lines.length || lines.some((line) => !/^[-*]\s+\S/.test(line)))
      throw new Error(
        'Отчёт QA: каждый непроверенный критерий должен быть строкой «- критерий» (или одно слово «нет»)'
      );
    unverifiedCriteria = lines.map((line) => line.replace(/^[-*]\s+/, ''));
  }
  return qaVerdict.parse({ verdict: verdicts[0][1].toUpperCase(), unverifiedCriteria });
}
