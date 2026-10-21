import { useId, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';

import { useProduction } from '../hooks/useProduction';
import {
  approvalLabels,
  leadLabels,
  publicationStatusLabel,
  taskLabels,
} from '../view-models/mediaOperationsLabels';

import type { ProductionStageId } from '../../contracts';

const stageLabels: Record<ProductionStageId, string> = {
  research: 'Исследование',
  script: 'Сценарий',
  fact_check: 'Проверка фактов',
  visual_plan: 'Визуальный план',
  licenses: 'Лицензии',
  voice: 'Озвучка',
  render: 'Рендер',
  qa: 'Независимая проверка качества',
  owner_approval: 'Согласование владельца',
  publication_queue: 'Очередь публикаций',
};
const roleLabels: Record<string, string> = {
  'topic-researcher': 'Исследователь тем',
  scriptwriter: 'Сценарист',
  'fact-checker': 'Фактчекер',
  'visual-editor': 'Визуальный редактор',
  'licensing-specialist': 'Специалист по лицензиям',
  'voice-tts-specialist': 'Специалист по голосам и озвучке',
  'render-engineer': 'Инженер рендера',
  'independent-qa': 'Независимый QA',
  ceo: 'Генеральный директор',
  'publication-manager': 'Менеджер публикаций',
};
const stageStatuses = {
  pending: 'Ожидает очереди',
  ready: 'Готов к выполнению',
  waiting: 'Ожидает решения',
  blocked: 'Заблокирован',
  completed: 'Завершён',
};
const reasons = {
  'unknown-role': 'Роль не найдена',
  'review-conflict': 'Конфликт независимой проверки',
  'already-active': 'Роль уже активна',
  'concurrency-cap': 'Достигнут лимит ролей',
  'no-available-executor':
    'Нет доступного провайдера; неизвестная доступность не даёт права запуска',
};

export const ProductionPanel = ({ isActive = true }: { isActive?: boolean }) => {
  const fieldId = useId();
  const model = useProduction(isActive);
  const [form, setForm] = useState({
    key: '',
    title: '',
    nicheId: '',
    teamName: '',
    channelId: '',
  });
  const [artifactPath, setArtifactPath] = useState('');
  const task = model.detail?.task;
  const pipeline = task?.pipeline;
  const current = pipeline?.stages.find((stage) => stage.status !== 'completed');
  return (
    <main className="flex size-full flex-col gap-5 overflow-auto bg-surface p-6 text-text">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Производство</h1>
        <Button variant="outline" disabled={model.busy} onClick={() => void model.refresh()}>
          Обновить
        </Button>
      </div>
      <p className="text-sm text-text-muted">
        Короткое вертикальное видео: от исследования до очереди публикаций. Каждый артефакт
        прикрепляется явно. Выбор ролей — рекомендация, без запуска моделей.
      </p>
      {model.error && (
        <p role="alert" className="rounded border border-red-500 p-3 text-red-400">
          {model.error}
        </p>
      )}
      {model.summary && (
        <section className="rounded border border-border p-4">
          <h2 className="font-semibold">Учёт и аналитика</h2>
          <p>
            {model.summary.finance.zeroRevenue
              ? 'доход: 0, фактических поступлений нет'
              : `Фактически получено: ${model.summary.finance.received / 100} ${model.summary.finance.currency}`}
          </p>
          <p>
            Прогноз: {model.summary.finance.forecast / 100}; начислено:{' '}
            {model.summary.finance.accrued / 100}; расходы: {model.summary.finance.expense / 100};
            чистая прибыль: {model.summary.finance.netProfit / 100} {model.summary.finance.currency}
          </p>
          <p className="break-all text-sm">Корень производства: {model.summary.productionRoot}</p>
          <p>
            CRM: {model.summary.contacts.length} контактов. Снимков метрик:{' '}
            {model.summary.metrics.length}. Нет измерений — нет вывода об успехе.
          </p>
          {model.summary.contacts.map((contact) => (
            <p key={contact.id}>
              {contact.name}: {leadLabels[contact.status]}
            </p>
          ))}
          {model.summary.metrics.map((metric) => (
            <p key={metric.id}>
              Видео {metric.videoId}: просмотры {metric.views ?? 'нет данных'}, удержание{' '}
              {metric.retention ?? 'нет данных'}; источник {metric.source}
            </p>
          ))}
        </section>
      )}
      <form
        className="grid gap-3 rounded border border-border p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void model.create({
            ...form,
            template: 'short-video-v1',
            channelId: form.channelId || null,
            teamName: form.teamName || null,
          });
        }}
      >
        <h2 className="font-semibold sm:col-span-2">Новая задача · короткое видео, версия 1</h2>
        {(
          [
            { field: 'key', label: 'Ключ задачи (латиница, цифры, дефис)', required: true },
            { field: 'title', label: 'Название', required: true },
            { field: 'nicheId', label: 'Направление', required: true },
            { field: 'teamName', label: 'Команда CEO (необязательно)', required: false },
            { field: 'channelId', label: 'Канал публикации (необязательно)', required: false },
          ] as const
        ).map(({ field, label, required }) => (
          <label key={field} htmlFor={`${fieldId}-${field}`} className="text-sm">
            {label}
            <Input
              id={`${fieldId}-${field}`}
              required={required}
              maxLength={field === 'key' ? 100 : 200}
              value={form[field]}
              pattern={field === 'key' ? '[a-zA-Z0-9_-]+' : undefined}
              onChange={(event) => setForm((value) => ({ ...value, [field]: event.target.value }))}
            />
          </label>
        ))}
        <Button type="submit" disabled={model.busy}>
          Создать задачу
        </Button>
      </form>
      <section>
        <h2 className="mb-2 font-semibold">Задачи</h2>
        <div className="flex flex-wrap gap-2">
          {model.tasks.map((item) => (
            <Button
              key={item.key}
              variant={model.selected === item.key ? 'secondary' : 'outline'}
              disabled={model.busy}
              onClick={() => {
                setArtifactPath('');
                model.select(item.key);
              }}
            >
              {item.pipeline?.title} · {taskLabels[item.state]}
            </Button>
          ))}
          {!model.tasks.length && <p>Задач пока нет</p>}
        </div>
      </section>
      {task && pipeline && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {pipeline.title} · {taskLabels[task.state]}
          </h2>
          <ol className="space-y-3">
            {pipeline.stages.map((stage, index) => (
              <li key={stage.id} className="rounded border border-border p-3">
                <h3 className="font-semibold">
                  {index + 1}. {stageLabels[stage.id]} — {stageStatuses[stage.status]}
                </h3>
                <p>{stage.detail}</p>
                <p>
                  Нужные роли: {stage.requiredRoleIds.map((id) => roleLabels[id] ?? id).join(', ')}
                </p>
                {stage.selection && (
                  <div className="text-sm text-text-muted">
                    <p>{stage.selectionReason}</p>
                    <p>
                      Лимит: {stage.selection.concurrencyCap}. Сохранённые активные роли:{' '}
                      {stage.selection.retained.length}. Выбрано:{' '}
                      {stage.selection.activations.length}.
                    </p>
                    {stage.selection.activations.map((role) => (
                      <p key={role.roleId}>
                        {roleLabels[role.roleId]} → {role.provider === 'codex' ? 'Кодекс' : 'Клод'}:
                        провайдер доступен, роль нужна этому этапу
                      </p>
                    ))}
                    {stage.selection.deferred.map((item) => (
                      <p key={item.taskId}>Отложено: {reasons[item.reason]}</p>
                    ))}
                  </div>
                )}
                {stage.artifacts.map((artifact) => (
                  <div key={artifact.path} className="mt-2 break-all text-sm">
                    <p>
                      Артефакт: {artifact.path} ·{' '}
                      {artifact.kind === 'file'
                        ? 'файл'
                        : 'каталог (проверен путь, содержимое не проверялось)'}
                    </p>
                    {artifact.video && (
                      <p>
                        ffprobe: {artifact.video.width}×{artifact.video.height},{' '}
                        {artifact.video.duration} с, звук{' '}
                        {artifact.video.audio ? 'есть' : 'отсутствует'}
                      </p>
                    )}
                    {artifact.qa && (
                      <div>
                        <p>Вердикт QA: {artifact.qa.verdict}</p>
                        <p>Непроверенные критерии:</p>
                        {artifact.qa.unverifiedCriteria.length ? (
                          <ul>
                            {artifact.qa.unverifiedCriteria.map((criterion) => (
                              <li key={criterion}>• {criterion}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>Нет — согласно прикреплённому отчёту</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </li>
            ))}
          </ol>
          {current && (
            <div className="space-y-3 rounded border border-border p-4">
              <h3>Текущий этап: {stageLabels[current.id]}</h3>
              {current.id !== 'owner_approval' && (
                <>
                  <label htmlFor={`${fieldId}-artifact`} className="block text-sm">
                    Абсолютный путь файла или каталога внутри корня производства
                    <Input
                      id={`${fieldId}-artifact`}
                      value={artifactPath}
                      onChange={(event) => setArtifactPath(event.target.value)}
                    />
                  </label>
                  <Button
                    disabled={model.busy || !artifactPath}
                    onClick={() =>
                      void model.attach({ key: task.key, stage: current.id, path: artifactPath })
                    }
                  >
                    Проверить и прикрепить
                  </Button>
                  {model.detail?.suggestions
                    .filter((item) => item.stage === current.id)
                    .map((item) => (
                      <div key={item.path} className="break-all text-sm">
                        <p>Найден кандидат: {item.path}</p>
                        <Button
                          variant="outline"
                          disabled={model.busy}
                          onClick={() =>
                            void model.attach({ key: task.key, stage: current.id, path: item.path })
                          }
                        >
                          Явно прикрепить найденный файл
                        </Button>
                      </div>
                    ))}
                </>
              )}
              <Button
                disabled={model.busy}
                onClick={() => void model.advance({ key: task.key, stage: current.id })}
              >
                {current.id === 'owner_approval'
                  ? 'Запросить решение / проверить согласование'
                  : 'Выполнить этап и продолжить'}
              </Button>
              {model.detail?.approval && (
                <div>
                  <p>
                    Согласование: {approvalLabels[model.detail.approval.status]} · до{' '}
                    {new Date(model.detail.approval.expiresAt).toLocaleString('ru-RU')}
                  </p>
                  <p>{model.detail.approval.actionText}</p>
                  {current.id === 'owner_approval' &&
                    model.detail.approval.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button disabled={model.busy} onClick={() => void model.decide('approve')}>
                          Утвердить от имени владельца
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={model.busy}
                          onClick={() => void model.decide('reject')}
                        >
                          Отклонить
                        </Button>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}
          <h3 className="font-semibold">История</h3>
          <ol className="text-sm">
            {pipeline.history.map((event, index) => (
              <li key={index}>
                {new Date(event.at).toLocaleString('ru-RU')} · {stageLabels[event.stage]} ·{' '}
                {event.detail}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="rounded border border-border p-4">
        <h2 className="font-semibold">Очередь публикаций</h2>
        <p className="text-sm">
          Публичная отправка требует настроенного адаптера публикации. Автоматических повторов нет.
        </p>
        {model.summary?.publications.map((record) => (
          <p key={record.operationId}>
            {record.videoId}: {publicationStatusLabel(record, Date.now())}
            {record.channelId === null ? ' · нет канала публикации' : ''}
            {record.state === 'outcome_unknown' ? ' · требуется сверка, повтор запрещён' : ''}
          </p>
        ))}
        {!model.summary?.publications.length && <p>Очередь пуста</p>}
      </section>
    </main>
  );
};
