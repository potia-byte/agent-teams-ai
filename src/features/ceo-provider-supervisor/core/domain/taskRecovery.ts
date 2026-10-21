import { isSelectableProvider } from './providerRegistry';

import type { CeoProvider, CeoState } from '../../contracts';

export function blockInterruptedTasks(state: CeoState): boolean {
  let changed = false;
  for (const task of state.tasks) {
    if (task.state !== 'running') continue;
    task.state = 'blocked';
    task.blockReason = 'reconciliation_required';
    // A claimed provider has an unknown outcome too; don't silently reuse it.
    if (
      task.provider &&
      state.providers[task.provider].availability === 'BUSY' &&
      state.owner?.provider !== task.provider
    ) {
      state.providers[task.provider].availability = 'UNKNOWN';
    }
    changed = true;
  }
  return changed;
}

export function taskProvider(state: CeoState, at: string): CeoProvider | null {
  if (['blocked', 'starting', 'stopping'].includes(state.status)) return null;
  return (
    [state.roles.primary, state.roles.reserve].find((provider) =>
      isSelectableProvider(state, provider, at)
    ) ?? null
  );
}
