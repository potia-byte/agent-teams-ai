import { MEDIA_PRODUCTION_CHANNELS as channels } from '../contracts';

import type { MediaProductionApi } from '../contracts';

export function createMediaProductionBridge(ipc: {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}): MediaProductionApi {
  return {
    list: () => ipc.invoke(channels.list) as ReturnType<MediaProductionApi['list']>,
    create: (input) =>
      ipc.invoke(channels.create, input) as ReturnType<MediaProductionApi['create']>,
    get: (key) => ipc.invoke(channels.get, key) as ReturnType<MediaProductionApi['get']>,
    attach: (input) =>
      ipc.invoke(channels.attach, input) as ReturnType<MediaProductionApi['attach']>,
    advance: (input) =>
      ipc.invoke(channels.advance, input) as ReturnType<MediaProductionApi['advance']>,
    decide: (input) =>
      ipc.invoke(channels.decide, input) as ReturnType<MediaProductionApi['decide']>,
    summary: () => ipc.invoke(channels.summary) as ReturnType<MediaProductionApi['summary']>,
  };
}
