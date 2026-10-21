import type {
  ProductionTask,
  ProductionTaskState,
  PublicationRecord,
  PublicationState,
} from '../../contracts';

const publicationTransitions: Record<PublicationState, readonly PublicationState[]> = {
  draft: ['awaiting_qa', 'cancelled'],
  awaiting_qa: ['awaiting_qa', 'awaiting_owner_approval', 'cancelled'],
  awaiting_owner_approval: ['awaiting_owner_approval', 'approved', 'awaiting_qa', 'cancelled'],
  approved: ['awaiting_owner_approval', 'awaiting_qa', 'publishing', 'cancelled'],
  publishing: ['published', 'failed_known', 'outcome_unknown'],
  published: [],
  failed_known: ['awaiting_owner_approval', 'awaiting_qa', 'cancelled'],
  outcome_unknown: ['published', 'failed_known'],
  cancelled: [],
};

const taskTransitions: Record<ProductionTaskState, readonly ProductionTaskState[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['blocked', 'completed', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function assertTaskTransition(from: ProductionTaskState, to: ProductionTaskState): void {
  if (!taskTransitions[from].includes(to)) throw new Error('Invalid task transition');
}

export function validatePublicationHistory(record: PublicationRecord): void {
  if (
    record.history[0].state !== 'draft' ||
    record.history.filter((event) => event.state === 'publishing').length !== record.attempts
  )
    throw new Error('Invalid publication attempt journal');
  for (let index = 1; index < record.history.length; index++) {
    const previous = record.history[index - 1];
    const event = record.history[index];
    if (event.at < previous.at || !publicationTransitions[previous.state].includes(event.state))
      throw new Error('Invalid publication transition journal');
    if (
      (previous.state === 'outcome_unknown' || event.state === 'failed_known') &&
      !event.evidenceRef
    )
      throw new Error('External evidence is required for reconciliation or a known failure');
  }
}

export function validateTaskHistory(task: ProductionTask): void {
  if (task.history[0].state !== 'planned' || task.history.at(-1)?.state !== task.state)
    throw new Error('Invalid task journal');
  for (let index = 1; index < task.history.length; index++) {
    const previous = task.history[index - 1];
    const event = task.history[index];
    if (event.at < previous.at) throw new Error('Task journal clock moved backwards');
    assertTaskTransition(previous.state, event.state);
  }
}
