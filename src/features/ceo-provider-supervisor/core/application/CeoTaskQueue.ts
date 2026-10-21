import { blockInterruptedTasks, taskProvider } from '../domain/taskRecovery';

import type { CeoState, CeoTask } from '../../contracts';
import type { CeoRepository } from './CeoSupervisor';

export interface CeoTaskPort {
  /** Uses task.idempotencyKey for effects; rejection has an unknown outcome. */
  execute(task: Readonly<CeoTask>): Promise<void>;
}

export class CeoTaskQueue {
  private readonly initialized = new Set<string>();

  constructor(
    private readonly ports: {
      repository: CeoRepository;
      now(): string;
      executor?: CeoTaskPort;
    }
  ) {}

  private withQueue<T>(
    teamName: string,
    operation: (state: CeoState, save: () => Promise<void>) => Promise<T>
  ): Promise<T> {
    return this.ports.repository.exclusive(teamName, async (state, save) => {
      if (!this.initialized.has(teamName)) {
        if (blockInterruptedTasks(state)) await save();
        this.initialized.add(teamName);
      }
      return operation(state, save);
    });
  }

  read(teamName: string): Promise<CeoTask[]> {
    return this.withQueue(teamName, async (state) => structuredClone(state.tasks));
  }

  enqueue(
    teamName: string,
    input: Pick<CeoTask, 'id' | 'idempotencyKey' | 'kind' | 'lastSafeCheckpointId'>
  ): Promise<CeoTask> {
    if (
      typeof input.id !== 'string' ||
      !input.id.trim() ||
      typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey.trim() ||
      !['llm', 'non_llm'].includes(input.kind) ||
      (input.lastSafeCheckpointId !== null && typeof input.lastSafeCheckpointId !== 'string')
    )
      throw new Error('Invalid CEO task');
    return this.withQueue(teamName, async (state, save) => {
      const duplicate = state.tasks.find((task) => task.idempotencyKey === input.idempotencyKey);
      if (duplicate) {
        if (duplicate.kind !== input.kind) throw new Error('Conflicting CEO idempotency key');
        return structuredClone(duplicate);
      }
      if (state.tasks.some((task) => task.id === input.id))
        throw new Error('Duplicate CEO task id');
      const task: CeoTask = {
        id: input.id,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        lastSafeCheckpointId: input.lastSafeCheckpointId,
        state: 'pending',
        attempts: 0,
        provider: null,
        blockReason: null,
      };
      state.tasks.push(task);
      await save();
      return structuredClone(task);
    });
  }

  /** One explicit dispatch, saved before effects. No replay/retry of blocked work. */
  dispatchNext(teamName: string): Promise<CeoTask | null> {
    return this.withQueue(teamName, async (state, save) => {
      if (!this.ports.executor) return null;
      const provider = taskProvider(state, this.ports.now());
      const task = state.tasks.find(
        (item) => item.state === 'pending' && (item.kind === 'non_llm' || provider)
      );
      if (!task) return null;
      task.state = 'running';
      task.provider = task.kind === 'llm' ? provider : null;
      task.attempts++;
      if (task.provider) state.providers[task.provider].availability = 'BUSY';
      await save();
      try {
        await this.ports.executor.execute(structuredClone(task));
        task.state = 'done';
        if (task.provider) state.providers[task.provider].availability = 'AVAILABLE';
      } catch {
        task.state = 'blocked';
        task.blockReason = 'reconciliation_required';
        if (task.provider) state.providers[task.provider].availability = 'UNKNOWN';
      }
      await save();
      return structuredClone(task);
    });
  }
}
