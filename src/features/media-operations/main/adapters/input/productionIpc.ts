import { MEDIA_PRODUCTION_CHANNELS } from '../../../contracts';
import { productionInputs } from '../../../core/application/productionInputs';

import type { MediaProductionApi } from '../../../contracts';

export interface ProductionIpcPort {
  handle(channel: string, handler: (event: unknown, input?: unknown) => unknown): void;
  removeHandler(channel: string): void;
}
export function registerProductionIpc(
  ipc: ProductionIpcPort,
  api: MediaProductionApi,
  isLocal = () => true
) {
  const handlers: Record<keyof typeof MEDIA_PRODUCTION_CHANNELS, (input: unknown) => unknown> = {
    list: (input) => {
      if (input !== undefined) throw new Error('Лишние параметры');
      return api.list();
    },
    create: (input) => api.create(productionInputs.create.parse(input)),
    get: (input) => api.get(productionInputs.key.parse(input)),
    attach: (input) => api.attach(productionInputs.attach.parse(input)),
    advance: (input) => api.advance(productionInputs.stage.parse(input)),
    decide: (input) => api.decide(productionInputs.decide.parse(input)),
    summary: (input) => {
      if (input !== undefined) throw new Error('Лишние параметры');
      return api.summary();
    },
  };
  for (const key of Object.keys(
    MEDIA_PRODUCTION_CHANNELS
  ) as (keyof typeof MEDIA_PRODUCTION_CHANNELS)[]) {
    ipc.handle(MEDIA_PRODUCTION_CHANNELS[key], async (_event, input) => {
      if (!isLocal()) throw new Error('Производство доступно только в локальном контексте');
      if (['create', 'get', 'attach', 'advance', 'decide'].includes(key)) {
        const schema =
          key === 'get'
            ? productionInputs.key
            : key === 'advance'
              ? productionInputs.stage
              : productionInputs[key as 'create' | 'attach' | 'decide'];
        if (!schema.safeParse(input).success)
          throw new Error('Некорректные параметры производства');
      }
      try {
        return await handlers[key](input);
      } catch (error) {
        // Do not echo filesystem/probe errors, arbitrary report bodies or transport diagnostics.
        if (
          error instanceof Error &&
          /^[А-Яа-яЁё]/.test(error.message) &&
          error.message.length < 400
        )
          throw new Error(error.message);
        throw new Error(
          'Не удалось выполнить действие производства. Проверьте артефакты и состояние этапа'
        );
      }
    });
  }
  return () => {
    for (const channel of Object.values(MEDIA_PRODUCTION_CHANNELS)) ipc.removeHandler(channel);
  };
}
