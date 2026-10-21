import { PRODUCTION_STAGES } from '../../contracts';
import { STAGE_EXECUTORS, STAGE_ROLES } from '../domain/production';

import { productionInputs } from './productionInputs';

import type {
  CreateProductionTask,
  MediaProductionApi,
  ProductionDetail,
  ProductionStage,
  ProductionTask,
  StageCommand,
} from '../../contracts';
import type { OperationsRecords } from './OperationsRecords';
import type { OwnerApprovals } from './OwnerApprovals';
import type { MediaOperationsDependencies } from './ports';
import type { ProductionDependencies } from './productionPorts';
import type { PublicationQueue } from './PublicationQueue';

/** Manual, non-LLM stage execution. Plans are persisted recommendations, never process launches. */
export class ProductionCycle implements MediaProductionApi {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly deps: MediaOperationsDependencies,
    private readonly production: ProductionDependencies,
    private readonly publications: PublicationQueue,
    private readonly approvals: OwnerApprovals,
    private readonly records: OperationsRecords
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async task(key: string): Promise<ProductionTask> {
    productionInputs.key.parse(key);
    const task = (await this.deps.repository.read()).tasks.find(
      (item) => item.key === key && item.pipeline
    );
    if (!task) throw new Error('Производственная задача не найдена');
    return task;
  }
  private current(task: ProductionTask, input: StageCommand): ProductionStage {
    const stage = task.pipeline!.stages.find((item) => item.status !== 'completed');
    if (!stage || stage.id !== input.stage) throw new Error('Этап уже изменился: обновите задачу');
    return stage;
  }
  private async plan(task: ProductionTask, stage: ProductionStage) {
    const capacity = await this.production.capacity(task.pipeline!.teamName);
    stage.selectionReason =
      'Выбраны только роли текущего этапа с доступным провайдером; активный CEO занимает слот. Причины отсрочки сохранены в плане. План не запускает процессы';
    return this.production.catalog.plan({
      ...capacity,
      tasks: stage.requiredRoleIds.map((roleId) => ({
        id: `${task.key}:${stage.id}:${roleId}`,
        roleId,
        status: 'pending',
        producerRoleIds:
          stage.id === 'qa'
            ? ['render-engineer', 'scriptwriter', 'visual-editor', 'voice-tts-specialist']
            : [],
      })),
    });
  }
  private async save(task: ProductionTask, stage: ProductionStage, detail: string) {
    task.pipeline!.history.push({ at: this.deps.now(), stage: stage.id, detail });
    const desired = task.pipeline!.stages.every((item) => item.status === 'completed')
      ? 'completed'
      : stage.status === 'blocked'
        ? 'blocked'
        : 'in_progress';
    if (task.state !== desired) {
      if (task.state === 'blocked' && desired === 'completed') {
        task.history.push({ state: 'in_progress', at: this.deps.now(), detail });
      }
      task.state = desired;
      task.history.push({ state: desired, at: this.deps.now(), detail });
    }
    const active = task.pipeline!.stages.find((item) => item.status !== 'completed');
    task.stage = active?.id ?? 'publication_queue';
    return this.deps.repository.transact((state) => {
      const index = state.tasks.findIndex((item) => item.key === task.key);
      // Reject stale writes from another instance rather than overwrite its artifacts/decision.
      if (
        index < 0 ||
        state.tasks[index].pipeline!.history.length !== task.pipeline!.history.length - 1
      )
        throw new Error('Задача изменилась в другом окне');
      state.tasks[index] = task;
      return task;
    });
  }
  async recover(): Promise<void> {
    await this.deps.repository.transact((state) => {
      for (const approval of state.approvals) {
        if (approval.status === 'pending' && approval.expiresAt <= this.deps.now())
          approval.status = 'expired';
      }
    });
  }
  async list() {
    return (await this.deps.repository.read()).tasks.filter((task) => task.pipeline);
  }
  create(raw: CreateProductionTask) {
    return this.serial(async () => {
      const input = productionInputs.create.parse(raw);
      const existing = (await this.deps.repository.read()).tasks.find(
        (task) => task.key === input.key
      );
      if (existing) {
        if (!existing.pipeline) throw new Error('Ключ занят старой задачей');
        return existing;
      }
      const task: ProductionTask = {
        key: input.key,
        videoId: input.key,
        stage: 'research',
        state: 'planned',
        artifacts: [],
        history: [
          { state: 'planned', at: this.deps.now(), detail: 'Создана производственная задача' },
        ],
        pipeline: {
          title: input.title,
          teamName: input.teamName,
          nicheId: input.nicheId,
          channelId: input.channelId,
          template: input.template,
          approvalId: null,
          operationId: null,
          stages: PRODUCTION_STAGES.map((id, index) => ({
            id,
            executor: STAGE_EXECUTORS[id],
            status: index === 0 ? 'ready' : 'pending',
            requiredRoleIds: [...STAGE_ROLES[id]],
            selection: null,
            selectionReason: 'Планирование ещё не выполнялось',
            artifacts: [],
            detail: 'Ожидается подтверждённый артефакт',
          })),
          history: [
            {
              at: this.deps.now(),
              stage: 'research',
              detail: 'Создана задача по шаблону short-video-v1',
            },
          ],
        },
      };
      task.pipeline!.stages[0].selection = await this.plan(task, task.pipeline!.stages[0]);
      return this.deps.repository.transact((state) => {
        const duplicate = state.tasks.find((item) => item.key === input.key);
        if (duplicate) return duplicate;
        state.tasks.push(task);
        return task;
      });
    });
  }
  async get(key: string): Promise<ProductionDetail> {
    await this.recover();
    const task = await this.task(key);
    const state = await this.deps.repository.read();
    const approval = state.approvals.find((item) => item.id === task.pipeline!.approvalId) ?? null;
    // Approved authority remains journalled, but an expired grant is presented as expired.
    if (approval?.status === 'approved' && approval.expiresAt <= this.deps.now())
      approval.status = 'expired';
    return {
      task,
      suggestions: await this.production.artifacts.discover(key),
      approval,
      publication:
        state.publications.find((item) => item.operationId === task.pipeline!.operationId) ?? null,
    };
  }
  attach(raw: StageCommand & { path: string }) {
    return this.serial(async () => {
      const input = productionInputs.attach.parse(raw);
      const task = await this.task(input.key);
      const stage = this.current(task, input);
      if (stage.executor === 'owner_approval')
        throw new Error('На этом этапе требуется решение владельца');
      const artifact = await this.production.artifacts.verify(input.path, stage.id);
      // Explicit replacement on the current stage only; completed artifacts remain immutable.
      stage.artifacts = [artifact];
      stage.status = 'ready';
      stage.detail = 'Артефакт прикреплён и проверен';
      task.artifacts = [...new Set([...task.artifacts, artifact.path])];
      return this.save(task, stage, stage.detail);
    });
  }
  private async verifyStage(stage: ProductionStage) {
    if (!stage.artifacts.length) throw new Error('Сначала явно прикрепите артефакт');
    for (const artifact of stage.artifacts) {
      const current = await this.production.artifacts.verify(artifact.path, stage.id);
      if (current.fingerprint !== artifact.fingerprint)
        throw new Error('Артефакт изменён: прикрепите его заново');
    }
  }
  private async preparePublication(task: ProductionTask) {
    const pipeline = task.pipeline!;
    let record = await this.publications.enqueue({
      videoId: task.videoId,
      platform: 'youtube-shorts',
      channelId: pipeline.channelId,
      version: 1,
      nicheId: pipeline.nicheId,
    });
    pipeline.operationId = record.operationId;
    if (record.state === 'draft') record = await this.publications.submitForQa(record.operationId);
    if (record.state === 'awaiting_qa') {
      const qa = pipeline.stages.find((stage) => stage.id === 'qa')!.artifacts[0]?.qa;
      if (!qa || qa.verdict === 'BLOCK') throw new Error('QA блокирует публикацию');
      record = await this.publications.recordQa(record.operationId, qa);
    }
    return record;
  }
  advance(raw: StageCommand) {
    return this.serial(async () => {
      const input = productionInputs.stage.parse(raw);
      const task = await this.task(input.key);
      const pipeline = task.pipeline!;
      const stage = this.current(task, input);
      stage.selection = await this.plan(task, stage);
      if (stage.executor === 'owner_approval') {
        // Recheck all evidence before requesting or accepting authority.
        for (const previous of pipeline.stages.slice(0, 8)) await this.verifyStage(previous);
        const publication = await this.preparePublication(task);
        await this.recover();
        const state = await this.deps.repository.read();
        let approval = state.approvals.find(
          (item) =>
            item.operationId === publication.operationId &&
            ['pending', 'approved'].includes(item.status) &&
            item.expiresAt > this.deps.now()
        );
        if (!approval && publication.state !== 'cancelled') {
          approval = await this.approvals.request({
            type: 'publication',
            operationId: publication.operationId,
            actionText: `Публикация «${pipeline.title}», версия 1, канал: ${pipeline.channelId ?? 'нет канала публикации'}. QA: ${JSON.stringify(publication.qaVerdict)}`,
            ttl: 24 * 60 * 60 * 1000,
          });
        }
        pipeline.approvalId = approval?.id ?? pipeline.approvalId;
        if (approval?.status !== 'approved') {
          stage.status = publication.state === 'cancelled' ? 'blocked' : 'waiting';
          stage.detail =
            publication.state === 'cancelled'
              ? 'Владелец отклонил публикацию'
              : 'Ожидается явное решение владельца; молчание не является согласием';
          return this.save(task, stage, stage.detail);
        }
      } else {
        await this.verifyStage(stage);
        if (stage.executor === 'qa_gate') {
          if (!stage.artifacts[0].qa) throw new Error('Нужен проверенный отчёт QA');
          if (stage.artifacts[0].qa.verdict === 'BLOCK') {
            stage.status = 'blocked';
            stage.detail = 'Проверка качества: BLOCK — переход остановлен';
            return this.save(task, stage, stage.detail);
          }
        }
        if (stage.executor === 'enqueue_publication') {
          for (const previous of pipeline.stages.slice(0, 8)) await this.verifyStage(previous);
          const publication = await this.preparePublication(task);
          const approval = (await this.deps.repository.read()).approvals.find(
            (item) => item.id === pipeline.approvalId
          );
          if (
            !approval ||
            approval.status !== 'approved' ||
            approval.expiresAt <= this.deps.now()
          ) {
            const owner = pipeline.stages.find((item) => item.id === 'owner_approval')!;
            owner.status = 'ready';
            owner.detail =
              'Согласование отсутствует или истекло; требуется новое решение владельца';
            stage.status = 'pending';
            stage.detail = 'Ожидается новое согласование владельца';
            return this.save(task, owner, owner.detail);
          }
          if (publication.channelId === null) {
            stage.status = 'blocked';
            stage.detail = 'нет канала публикации';
            return this.save(task, stage, stage.detail);
          }
          if (['outcome_unknown', 'publishing', 'cancelled'].includes(publication.state)) {
            stage.status = 'blocked';
            stage.detail = 'Результат публикации требует сверки; автоматического повтора нет';
            return this.save(task, stage, stage.detail);
          }
        }
      }
      stage.status = 'completed';
      stage.detail = 'Этап завершён';
      const next = pipeline.stages[pipeline.stages.indexOf(stage) + 1];
      if (next) {
        next.status = 'ready';
        next.selection = await this.plan(task, next);
      }
      return this.save(task, stage, 'Этап завершён; следующий план ролей сохранён');
    });
  }
  decide(raw: Parameters<MediaProductionApi['decide']>[0]) {
    return this.serial(async () => {
      const input = productionInputs.decide.parse(raw);
      const task = await this.task(input.key);
      if (task.stage !== 'owner_approval' || task.pipeline!.approvalId !== input.approvalId)
        throw new Error('Это согласование не относится к текущему этапу');
      const decision = await this.approvals.command(
        this.deps.ownerId,
        `${input.decision} ${input.approvalId}`
      );
      if (!decision) return this.task(input.key);
      const stage = this.current(task, { key: task.key, stage: 'owner_approval' });
      stage.status =
        decision.status === 'rejected'
          ? 'blocked'
          : decision.status === 'approved'
            ? 'ready'
            : 'waiting';
      stage.detail =
        decision.status === 'rejected'
          ? 'Владелец отклонил публикацию'
          : decision.status === 'approved'
            ? 'Владелец утвердил публикацию; можно завершить этап'
            : 'Срок согласования истёк; требуется новое решение';
      return this.save(task, stage, stage.detail);
    });
  }
  async summary() {
    const [state, finance] = await Promise.all([
      this.deps.repository.read(),
      this.records.reportFinance(),
    ]);
    return {
      productionRoot: this.production.productionRoot,
      finance,
      contacts: state.contacts,
      metrics: state.metrics,
      publications: state.publications,
    };
  }
}
