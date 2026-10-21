export type CeoProvider = 'anthropic' | 'codex';
export interface CeoProviderRoles {
  primary: CeoProvider;
  reserve: CeoProvider;
}
export type ExecutorAvailability =
  | 'AVAILABLE'
  | 'BUSY'
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export interface CeoCheckpoint {
  id: string;
  runId: string;
  /** Null only for legacy checkpoints whose provider cannot be proven. */
  provider: CeoProvider | null;
  runtimeRevision: number;
  summary: string;
  /** Stable operation keys. Unknown outcomes must be reconciled, never replayed. */
  effects: Array<{ key: string; outcome: 'confirmed' | 'not_started' | 'unknown' }>;
  savedAt: string;
}

export interface CeoState {
  version: 1;
  roleId: 'ceo';
  teamName: string;
  contextId: string;
  epoch: number;
  status: 'disabled' | 'active' | 'stopping' | 'starting' | 'waiting' | 'blocked';
  roles: CeoProviderRoles;
  owner: { provider: CeoProvider; runId: string; role: keyof CeoProviderRoles } | null;
  providers: Record<CeoProvider, { availability: ExecutorAvailability; verifiedAt: string | null }>;
  checkpoint: CeoCheckpoint | null;
  handledRuns: string[];
  history: Array<{ at: string; epoch: number; event: string; provider?: CeoProvider }>;
  reason: string | null;
}

export interface CeoCommand {
  teamName: string;
  action: 'enable' | 'checkpoint' | 'available' | 'retry';
  summary?: string;
  effects?: CeoCheckpoint['effects'];
  provider?: CeoProvider;
}

/** Passive health evidence. It never authorizes a launch or fail-back. */
export interface CeoProbeResult {
  teamName: string;
  provider: CeoProvider;
  availability: ExecutorAvailability;
}

export interface CeoSupervisorApi {
  read(teamName: string): Promise<CeoState>;
  command(command: CeoCommand): Promise<CeoState>;
}
export interface CeoSupervisorElectronApi {
  ceoSupervisor: CeoSupervisorApi;
}
export const CEO_READ = 'ceo-supervisor:read';
export const CEO_COMMAND = 'ceo-supervisor:command';
