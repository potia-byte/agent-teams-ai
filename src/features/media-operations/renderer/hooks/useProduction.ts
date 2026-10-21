import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';

import type {
  CreateProductionTask,
  ProductionDetail,
  ProductionSummary,
  ProductionTask,
  StageCommand,
} from '../../contracts';

export function useProduction(isActive: boolean) {
  const [tasks, setTasks] = useState<ProductionTask[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<ProductionDetail | null>(null);
  const [summary, setSummary] = useState<ProductionSummary | null>(null);
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [list, totals, value] = await Promise.all([
        api.mediaProduction.list(),
        api.mediaProduction.summary(),
        selected ? api.mediaProduction.get(selected) : Promise.resolve(null),
      ]);
      if (request !== generation.current) return;
      setTasks(list);
      setSummary(totals);
      setDetail(value);
      setReadError('');
    } catch (failure) {
      if (request === generation.current) setReadError(String(failure));
    }
  }, [selected]);
  useEffect(() => {
    if (!isActive) return;
    setDetail(null);
    let inFlight = false;
    const poll = async () => {
      if (inFlight || mutation.current || document.hidden) return;
      inFlight = true;
      await refresh();
      inFlight = false;
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      clearInterval(timer);
      invalidate();
    };
  }, [isActive, refresh, invalidate]);
  const perform = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (mutation.current) return;
    mutation.current = true;
    generation.current++;
    setBusy(true);
    setActionError('');
    try {
      const result = await action();
      await refresh();
      return result;
    } catch (failure) {
      setActionError(String(failure));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return {
    tasks,
    detail,
    summary,
    error: actionError || readError,
    busy,
    selected,
    select: (key: string) => {
      generation.current++;
      setDetail(null);
      setSelected(key);
    },
    refresh: () => perform(async () => undefined),
    create: async (input: CreateProductionTask) => {
      const task = await perform(() => api.mediaProduction.create(input));
      if (task) setSelected(task.key);
    },
    attach: (input: StageCommand & { path: string }) =>
      perform(() => api.mediaProduction.attach(input)),
    advance: (input: StageCommand) => perform(() => api.mediaProduction.advance(input)),
    decide: (decision: 'approve' | 'reject') =>
      perform(async () => {
        if (!detail?.approval) return;
        await api.mediaProduction.decide({
          key: detail.task.key,
          approvalId: detail.approval.id,
          decision,
        });
      }),
  };
}
