import type { CeoProvider, CeoState, ExecutorAvailability } from '../../contracts';

export const providerLabels: Record<CeoProvider, string> = { codex: 'Codex', anthropic: 'Claude' };
export const statusLabels: Record<CeoState['status'], string> = {
  disabled: 'Выключен',
  active: 'Работает',
  stopping: 'Остановка исполнителя',
  starting: 'Новая сессия',
  waiting: 'Ожидание исполнителя',
  blocked: 'Нужна сверка состояния',
};
export const availabilityLabels: Record<ExecutorAvailability, string> = {
  AVAILABLE: 'Доступен',
  BUSY: 'Занят',
  RATE_LIMITED: 'Квота исчерпана',
  AUTH_REQUIRED: 'Нужен вход в аккаунт',
  UNAVAILABLE: 'Недоступен',
  UNKNOWN: 'Доступность не проверена',
};
export const reasonLabels: Record<string, string> = {
  start_failed: 'Не удалось подтвердить результат запуска; повторный запуск заблокирован',
  replacement_ownership_unproven:
    'Владение новой сессией не подтверждено; повторный запуск заблокирован',
  launch_rejected: 'Новый запуск не допущен; требуется сверка состояния',
  start_timeout: 'Истекло время подтверждения новой сессии; повторный запуск заблокирован',
  runtime_ownership_unknown: 'Текущий исполнитель не подтверждён',
  interrupted_handoff: 'Переключение было прервано; требуется ручная сверка',
  unsafe_checkpoint_or_unknown_effect:
    'Нет безопасной контрольной точки или результат действия неизвестен',
  handoff_outcome_unknown: 'Результат остановки или передачи управления неизвестен',
  no_available_executor: 'Нет доступного исполнителя, отличного от предыдущего',
  launch_outcome_unknown: 'Результат запуска неизвестен; повторный запуск заблокирован',
};
export const eventLabels: Record<string, string> = {
  enabled: 'Роль директора включена',
  running_on_reserve: 'Директор работает на резерве',
  checkpoint_saved: 'Контрольная точка сохранена',
  availability_confirmed: 'Доступность подтверждена пользователем',
  availability_probed: 'Получен результат проверки доступности',
  quota_confirmed: 'Квота исчерпана',
  starting_fresh_session: 'Запуск новой сессии',
  owner_committed: 'Исполнитель назначен',
  waiting_for_executor: 'Ожидание доступного исполнителя',
  manual_reconciliation_required: 'Требуется сверка действий',
  launch_outcome_unknown: 'Результат запуска неизвестен',
  handoff_outcome_unknown: 'Результат передачи неизвестен',
  runtime_ownership_unknown: 'Текущий исполнитель не подтверждён',
  interrupted_handoff: 'Переключение прервано',
};

export function historyTimestamp(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? 'Дата неизвестна' : date.toLocaleString('ru-RU');
}
