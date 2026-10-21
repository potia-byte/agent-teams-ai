import { useCallback, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import type { CeoCommand, CeoState } from '../../contracts';

export function useCeoSupervisor(teamName: string) {
  const [state, setState] = useState<CeoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    setState(null); setError(null);
    const refresh = async (): Promise<void> => {
      if (inFlight) return;
      inFlight = true;
      try {
        const value = await api.ceoSupervisor.read(teamName);
        if (!disposed) { setState(value); setError(null); }
      } catch (failure) {
        if (!disposed) setError(String(failure));
      } finally { inFlight = false; }
    };
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [teamName]);
  const command = useCallback(async (input: Omit<CeoCommand, 'teamName'>) => {
    setBusy(true); setError(null);
    try { setState(await api.ceoSupervisor.command({ ...input, teamName })); }
    catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }, [teamName]);
  return { state, error, busy, command };
}
