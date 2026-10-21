import { CEO_COMMAND, CEO_READ } from '../contracts';
import type { CeoSupervisorApi } from '../contracts';

export function createCeoSupervisorBridge(ipc: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }): CeoSupervisorApi {
  return {
    read: (teamName) => ipc.invoke(CEO_READ, teamName) as ReturnType<CeoSupervisorApi['read']>,
    command: (command) => ipc.invoke(CEO_COMMAND, command) as ReturnType<CeoSupervisorApi['command']>,
  };
}
