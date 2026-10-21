import { OWNER_APPROVAL_ACTIONS, ROLE_IDS } from '../../../core/domain/catalogPolicy';

import type { CatalogCapability, CatalogProvider, CompanyRoleProfile } from '../../../contracts';
import type { CompanyRoleId } from '../../../core/domain/catalogPolicy';

export interface ProfileDefinition {
  readonly id: CompanyRoleId;
  readonly name: string;
  readonly responsibility: string;
  readonly instructions: readonly string[];
  readonly tools: readonly string[];
  readonly capabilities: readonly CatalogCapability[];
  readonly primary: CatalogProvider;
  readonly memory: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly acceptance: readonly string[];
  readonly activate: string;
  readonly kind?: CompanyRoleProfile['kind'];
  readonly checks?: readonly CompanyRoleId[];
}

/** Shared restrictions are expanded into each standalone profile; definitions grant no authority. */
export function defineProfiles(
  department: string,
  definitions: readonly ProfileDefinition[]
): CompanyRoleProfile[] {
  return definitions.map((definition) => ({
    id: definition.id,
    number: String(ROLE_IDS.indexOf(definition.id) + 1).padStart(2, '0'),
    name: definition.name,
    department,
    reportsTo: definition.id === 'ceo' ? null : 'ceo',
    kind: definition.kind ?? 'producer',
    responsibilities: [definition.responsibility],
    systemInstructions: [
      ...definition.instructions,
      'Работай только в назначенной задаче и изолированной рабочей области. Не читай секреты; не используй платные API, подписки или облачные GPU.',
      'Публикации, расходы, финансовые действия и договоры передавай в owner-approval: конкретное действие, id заявки и срок. Молчание не разрешение; при ожидании сохрани checkpoint и продолжай безопасные задачи.',
    ],
    requiredTools: definition.tools,
    permissions: {
      allowed: ['read-assigned-artifacts', 'write-own-drafts', ...definition.capabilities],
      requiresOwnerApproval: [...OWNER_APPROVAL_ACTIONS],
      prohibited: [
        'read-secrets',
        'paid-api',
        'paid-subscription',
        'automatic-payment',
        'cloud-gpu',
        'destructive-command',
        'modify-unrelated-project',
        'modify-live-agent-teams',
        'bypass-platform-verification',
        'self-approve-owner-action',
      ],
    },
    executors: {
      primary: definition.primary,
      reserves: [definition.primary === 'codex' ? 'anthropic' : 'codex'],
    },
    memoryRules: [
      definition.memory,
      'Память принадлежит логической роли, а не модели. Версионируй выводы, источники, решения и checkpoint; отмечай устаревшие сведения и противоречия. Не сохраняй секреты и лишние персональные данные.',
    ],
    inputArtifacts: definition.inputs,
    outputArtifacts: definition.outputs,
    acceptanceCriteria: definition.acceptance,
    ceoInteractionRules:
      definition.id === 'ceo'
        ? [
            'Принимай поручения владельца, назначай задачи напрямую сотрудникам; не создавай начальников отделов. Только один исполнитель владеет ролью CEO.',
            'Передавай владельцу план, результаты и конкретные заявки на согласование; не выдавай прогнозы за полученные деньги.',
          ]
        : [
            `Получай приоритет и границы задачи только от CEO; передавай ему: ${definition.outputs.join(', ')}.`,
            'Сообщай CEO блокеры, непроверенные критерии, стоимость и риски; не отдавай распоряжения другим ролям и не подменяй решение владельца.',
          ],
    activationConditions: [
      definition.activate,
      'Есть назначенная ожидающая задача, настроенный доступный исполнитель, квота и свободный слот.',
    ],
    deactivationConditions: [
      `Переданы CEO результаты: ${definition.outputs.join(', ')}; сохранены история и checkpoint.`,
      'Нет готовых задач, требуется согласование, исчерпана квота или ресурс: сохранить checkpoint и освободить слот после подтверждения остановки; не запускать второго исполнителя роли.',
    ],
    checksRoles: definition.checks ?? [],
  }));
}
