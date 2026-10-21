import type {
  ApprovalRequest,
  FinanceReport,
  LeadStatus,
  LedgerKind,
  ProductionTaskState,
  PublicationRecord,
  PublicationState,
} from '../../contracts';

export const publicationLabels: Record<PublicationState, string> = {
  draft: 'Черновик',
  awaiting_qa: 'Ожидает проверки качества',
  awaiting_owner_approval: 'Ожидает согласования владельца',
  approved: 'Согласовано',
  publishing: 'Публикуется',
  published: 'Опубликовано',
  failed_known: 'Подтверждённая ошибка',
  outcome_unknown: 'Результат неизвестен — требуется сверка',
  cancelled: 'Отменено',
};
export const approvalLabels: Record<ApprovalRequest['status'], string> = {
  pending: 'Ожидает решения',
  approved: 'Согласовано владельцем',
  rejected: 'Отклонено',
  expired: 'Срок согласования истёк',
  superseded: 'Согласование заменено',
};
export const approvalTypeLabels: Record<ApprovalRequest['type'], string> = {
  publication: 'Публикация',
  spending: 'Расход — только запись',
  contract: 'Договор — только запись',
};
export const leadLabels: Record<LeadStatus, string> = {
  new: 'Новый контакт',
  qualified: 'Квалифицирован',
  proposal: 'Предложение',
  negotiation: 'Переговоры',
  won: 'Сделка заключена',
  lost: 'Сделка не состоялась',
};
export const ledgerLabels: Record<LedgerKind, string> = {
  forecast: 'Прогноз',
  accrued: 'Подтверждённые начисления',
  received: 'Полученные деньги',
  expense: 'Расходы',
};
export const taskLabels: Record<ProductionTaskState, string> = {
  planned: 'Запланировано',
  in_progress: 'В работе',
  blocked: 'Заблокировано',
  completed: 'Завершено',
  cancelled: 'Отменено',
};
export const metricLabels = {
  views: 'Просмотры',
  retention: 'Удержание, %',
  likes: 'Отметки «Нравится»',
  subscribers: 'Подписчики',
  revenue: 'Доход по данным источника',
  unknown: 'Нет данных',
};
export function publicationStatusLabel(record: PublicationRecord, at: number): string {
  if (record.state === 'approved' && record.approval && record.approval.expiresAt <= at)
    return 'Срок согласования истёк — публикация запрещена';
  if (record.state === 'approved' && record.channelId === null)
    return 'Согласовано — ожидает выбора канала';
  return publicationLabels[record.state];
}
export function financeStatusLabel(report: FinanceReport): string {
  return report.zeroRevenue
    ? 'Полученный доход: 0 — деньги ещё не получены'
    : 'Есть фактически полученный доход';
}
