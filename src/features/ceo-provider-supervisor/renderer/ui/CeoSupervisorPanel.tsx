import { useId, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
import { Textarea } from '@renderer/components/ui/textarea';

import { useCeoSupervisor } from '../hooks/useCeoSupervisor';
import {
  availabilityLabels,
  eventLabels,
  historyTimestamp,
  providerLabels,
  reasonLabels,
  statusLabels,
} from '../view-models/ceoSupervisorLabels';

import type { CeoCheckpoint } from '../../contracts';

export const CeoSupervisorPanel = ({ teamName }: { teamName: string }) => {
  const inputId = useId();
  const { state, error, busy, command } = useCeoSupervisor(teamName);
  const [summary, setSummary] = useState('');
  const [effects, setEffects] = useState('[]');
  const [inputError, setInputError] = useState<string | null>(null);
  const save = (): void => {
    try {
      const parsed: unknown = JSON.parse(effects);
      if (!Array.isArray(parsed)) throw new Error('Нужен JSON-массив действий');
      setInputError(null);
      void command({ action: 'checkpoint', summary, effects: parsed as CeoCheckpoint['effects'] });
    } catch {
      setInputError('Проверьте JSON реестра действий');
    }
  };
  return (
    <Collapsible className="border-b border-border px-3 py-2 text-xs">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm">
          Директор CEO · {state ? statusLabels[state.status] : 'Загрузка…'}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 py-2">
        {(error || inputError) && (
          <p role="alert" className="text-red-500">
            {error || inputError}
          </p>
        )}
        {state && (
          <>
            <p>
              Основной провайдер: {providerLabels[state.roles.primary]} · резервный:{' '}
              {providerLabels[state.roles.reserve]}
            </p>
            <p>
              Текущий исполнитель:{' '}
              {state.owner
                ? providerLabels[state.owner.provider] +
                  (state.owner.role === 'primary' ? ' (основной)' : ' (резервный)')
                : 'не назначен'}{' '}
              · поколение {state.epoch}
            </p>
            {state.status === 'active' && state.owner?.role === 'reserve' && (
              <p>
                Директор работает на резерве. Восстановление основного провайдера не прерывает
                текущую сессию.
              </p>
            )}
            <p>
              Claude: {availabilityLabels[state.providers.anthropic.availability]} · Codex:{' '}
              {availabilityLabels[state.providers.codex.availability]}
            </p>
            {state.reason && (
              <p>
                Ограничение: {reasonLabels[state.reason] ?? 'Требуется ручная сверка состояния'}
              </p>
            )}
            {state.status === 'disabled' ? (
              <Button size="sm" disabled={busy} onClick={() => void command({ action: 'enable' })}>
                Включить CEO для команды из одного агента
              </Button>
            ) : (
              <>
                <p>
                  Подтверждайте доступность только после успешной проверки подписки. Непроверенный
                  провайдер не допускается к запуску.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void command({ action: 'available', provider: 'anthropic' })}
                  >
                    Claude доступен — подтверждаю
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void command({ action: 'available', provider: 'codex' })}
                  >
                    Codex доступен — подтверждаю
                  </Button>
                </div>
                <label className="block" htmlFor={inputId + '-summary'}>
                  Безопасная контрольная точка (без секретов)
                  <Textarea
                    id={inputId + '-summary'}
                    className="mt-1 text-xs"
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    rows={3}
                  />
                </label>
                <label className="block" htmlFor={inputId + '-effects'}>
                  Внешние действия: JSON с ключом key и результатом outcome
                  <Textarea
                    id={inputId + '-effects'}
                    className="mt-1 font-mono text-xs"
                    value={effects}
                    onChange={(event) => setEffects(event.target.value)}
                    rows={2}
                  />
                </label>
                <p>
                  Результат: confirmed — подтверждён, not_started — не начат, unknown — неизвестен.
                  Укажите все действия после предыдущей точки. Неизвестный результат блокирует
                  продолжение. Пустой список означает, что внешних действий не было.
                </p>
                <Button
                  size="sm"
                  disabled={busy || !summary.trim() || state.status !== 'active'}
                  onClick={save}
                >
                  Сохранить контрольную точку
                </Button>
              </>
            )}
            <p className="font-medium">История переключений</p>
            {state.history.length === 0 && <p>Событий пока нет</p>}
            <ol className="space-y-1" aria-label="История переключений CEO">
              {state.history
                .slice(-12)
                .reverse()
                .map((entry, index) => (
                  <li key={entry.epoch + '-' + entry.at + '-' + index}>
                    {historyTimestamp(entry.at)} · поколение {entry.epoch} ·{' '}
                    {eventLabels[entry.event] ?? 'Событие директора'}
                    {entry.provider &&
                      ' · ' +
                        providerLabels[entry.provider] +
                        (entry.provider === state.roles.primary ? ' (основной)' : ' (резервный)')}
                  </li>
                ))}
            </ol>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};
