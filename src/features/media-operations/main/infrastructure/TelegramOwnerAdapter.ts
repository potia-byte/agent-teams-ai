import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { TelegramPort } from '../../core/application/ports';

interface TelegramConfig {
  token: string;
  ownerId: string;
}
export function parseTelegramConfig(source: string): TelegramConfig {
  const entries = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^(TOKEN|OWNER_ID)=([^\r\n]+)$/.exec(line);
    if (!match || entries.has(match[1])) throw new Error('Некорректная конфигурация Telegram');
    entries.set(match[1], match[2]);
  }
  const token = entries.get('TOKEN') ?? '';
  const ownerId = entries.get('OWNER_ID') ?? '';
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token) || !/^[1-9]\d{0,18}$/.test(ownerId))
    throw new Error('Некорректная конфигурация Telegram');
  return { token, ownerId };
}
/** This is the only runtime configuration source. Never include the file contents in errors. */
export async function loadTelegramOwnerAdapter(
  envFile: string | undefined,
  fetchPort: typeof fetch = fetch
) {
  if (!envFile) return null;
  if (!path.isAbsolute(envFile))
    throw new Error('Путь конфигурации Telegram должен быть абсолютным');
  try {
    return new TelegramOwnerAdapter(
      parseTelegramConfig(await readFile(envFile, 'utf8')),
      fetchPort
    );
  } catch {
    throw new Error('Не удалось загрузить конфигурацию Telegram');
  }
}
export class TelegramOwnerAdapter implements TelegramPort {
  readonly #config: TelegramConfig;
  private offset = 0;
  private stopped = false;
  private readonly controllers = new Set<AbortController>();
  private loop: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wake: (() => void) | null = null;
  constructor(
    config: TelegramConfig,
    private readonly fetchPort: typeof fetch = fetch
  ) {
    this.#config = { ...config };
  }
  get ownerId() {
    return this.#config.ownerId;
  }
  private async call(
    method: string,
    body: FormData | Record<string, unknown>,
    longPoll = false
  ): Promise<unknown> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), longPoll ? 25_000 : 15_000);
    try {
      const response = await this.fetchPort(
        `https://api.telegram.org/bot${this.#config.token}/${method}`,
        {
          method: 'POST',
          body: body instanceof FormData ? body : JSON.stringify(body),
          headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
          signal: controller.signal,
        }
      );
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { ok?: boolean; result?: unknown };
      if (data.ok !== true) throw new Error();
      return data.result;
    } catch {
      throw new Error('Telegram временно недоступен');
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  async sendMessage(chatId: string, text: string): Promise<void> {
    if (chatId !== this.ownerId) throw new Error('Недопустимый получатель Telegram');
    await this.call('sendMessage', { chat_id: this.ownerId, text });
  }
  async sendVideo(chatId: string, artifactPath: string, caption: string): Promise<void> {
    if (chatId !== this.ownerId) throw new Error('Недопустимый получатель Telegram');
    try {
      if ((await stat(artifactPath)).size > 50 * 1024 * 1024) throw new Error();
      const bytes = await readFile(artifactPath);
      const body = new FormData();
      body.set('chat_id', this.ownerId);
      body.set('caption', caption);
      body.set(
        'video',
        new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }),
        path.basename(artifactPath)
      );
      await this.call('sendVideo', body);
    } catch {
      throw new Error('Не удалось отправить видео владельцу');
    }
  }
  async pollOnce(command: (ownerId: string, text: string) => Promise<unknown>): Promise<void> {
    const updates = await this.call(
      'getUpdates',
      { offset: this.offset, timeout: 20, limit: 100, allowed_updates: ['message'] },
      true
    );
    if (!Array.isArray(updates)) throw new Error('Некорректный ответ Telegram');
    for (const raw of updates) {
      const update = raw as {
        update_id?: number;
        message?: { from?: { id?: number }; chat?: { id?: number; type?: string }; text?: string };
      };
      if (!Number.isSafeInteger(update.update_id) || update.update_id! < this.offset) continue;
      const message = update.message;
      if (
        String(message?.from?.id) === this.ownerId &&
        String(message?.chat?.id) === this.ownerId &&
        message?.chat?.type === 'private' &&
        typeof message.text === 'string' &&
        /^(approve|reject) [a-zA-Z0-9_-]{1,128}$/.exec(message.text)?.[0] === message.text
      )
        await command(this.ownerId, message.text);
      this.offset = update.update_id! + 1;
    }
  }
  start(
    command: (ownerId: string, text: string) => Promise<unknown>,
    deliver: () => Promise<void>
  ) {
    if (this.loop) return;
    this.loop = (async () => {
      while (!this.stopped) {
        try {
          await deliver();
          if (!this.stopped) await this.pollOnce(command);
        } catch {
          /* Persistent outbox and exact approval IDs permit a later delivery. No token diagnostics. */
        }
        if (this.stopped) break;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          this.timer = setTimeout(resolve, 3000);
        });
        this.wake = null;
        this.timer = null;
      }
    })();
  }
  async dispose() {
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
    if (this.timer) clearTimeout(this.timer);
    this.wake?.();
    await this.loop;
  }
}
