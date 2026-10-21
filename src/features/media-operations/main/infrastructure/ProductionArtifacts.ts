import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { parseQaReport } from '../../core/domain/production';

import type { ProductionStageId, VerifiedArtifact } from '../../contracts';
import type { ProductionArtifactsPort } from '../../core/application/productionPorts';

export interface ProbePort {
  probe(file: string): Promise<unknown>;
}
export const ffprobePort: ProbePort = {
  probe: (file) =>
    new Promise((resolve, reject) => {
      execFile(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
        { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(new Error('ffprobe недоступен или не смог проверить видео'));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error('Некорректный ответ ffprobe'));
          }
        }
      );
    }),
};
export function validateVideo(
  value: unknown,
  minDuration = 1,
  maxDuration = 180
): NonNullable<VerifiedArtifact['video']> {
  const data = value as {
    streams?: {
      codec_type?: string;
      width?: number;
      height?: number;
      sample_aspect_ratio?: string;
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
    }[];
    format?: { duration?: string };
  } | null;
  if (!data || !Array.isArray(data.streams)) throw new Error('ffprobe: нет потоков');
  const video = data.streams.find((stream) => stream.codec_type === 'video');
  const audio = data.streams.some((stream) => stream.codec_type === 'audio');
  const duration = Number(data.format?.duration);
  if (
    !video ||
    !Number.isSafeInteger(video.width) ||
    !Number.isSafeInteger(video.height) ||
    !video.width ||
    !video.height ||
    video.width <= 0 ||
    video.height <= 0 ||
    video.width * 16 !== video.height * 9 ||
    (video.sample_aspect_ratio && !['1:1', 'N/A'].includes(video.sample_aspect_ratio)) ||
    Number(video.tags?.rotate ?? 0) % 360 !== 0 ||
    video.side_data_list?.some((side) => Number(side.rotation ?? 0) % 360 !== 0) ||
    !audio ||
    !Number.isFinite(duration) ||
    duration < minDuration ||
    duration > maxDuration
  )
    throw new Error(
      `Видео должно быть 9:16, со звуком, длительностью ${minDuration}–${maxDuration} с`
    );
  return { width: video.width, height: video.height, duration, audio };
}

export class ProductionArtifacts implements ProductionArtifactsPort {
  constructor(
    private readonly root: string,
    private readonly probe: ProbePort = ffprobePort,
    private readonly now = Date.now
  ) {
    if (!path.isAbsolute(root)) throw new Error('Корень производства должен быть абсолютным');
  }
  private inside(root: string, file: string): boolean {
    const relative = path.relative(root, file);
    return (
      relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }
  async resolve(file: string): Promise<string> {
    if (
      typeof file !== 'string' ||
      !path.isAbsolute(file) ||
      file.includes('\0') ||
      file.split(/[\\/]/).includes('..') ||
      !this.inside(path.resolve(this.root), path.resolve(file))
    )
      throw new Error('Артефакт должен находиться внутри разрешённого корня производства');
    const [root, target] = await Promise.all([realpath(this.root), realpath(file)]);
    if (!this.inside(root, target)) throw new Error('Ссылка выходит за корень производства');
    // Prevent alternate data streams on Windows.
    if (path.relative(root, target).includes(':')) throw new Error('Недопустимый путь артефакта');
    return target;
  }
  async verify(file: string, stage: ProductionStageId): Promise<VerifiedArtifact> {
    const target = await this.resolve(file);
    const info = await stat(target);
    if (!info.isFile() && !info.isDirectory()) throw new Error('Нужен обычный файл или каталог');
    if (['render', 'qa', 'publication_queue'].includes(stage) && !info.isFile())
      throw new Error('На этом этапе нужен файл');
    if (info.isFile() && info.size === 0) throw new Error('Пустой артефакт');
    const mp4 = path.extname(target).toLowerCase() === '.mp4';
    if (stage === 'render' && !mp4) throw new Error('Для рендера нужен MP4');
    if (stage === 'qa' && path.extname(target).toLowerCase() !== '.md')
      throw new Error('Нужен QA_REPORT.md');
    if (stage === 'publication_queue' && path.extname(target).toLowerCase() !== '.md')
      throw new Error('Нужен пакет публикации в формате Markdown');
    let fingerprint = `directory:${info.mtimeMs}`;
    if (info.isFile()) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(target)) hash.update(chunk);
      fingerprint = hash.digest('hex');
    }
    const video = mp4 ? validateVideo(await this.probe.probe(target)) : null;
    if (stage === 'qa' && info.size > 256 * 1024) throw new Error('Отчёт QA слишком большой');
    const qa = stage === 'qa' ? parseQaReport(await readFile(target, 'utf8')) : null;
    const after = await stat(target);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
      throw new Error('Артефакт изменился во время проверки');
    return {
      path: target,
      kind: info.isFile() ? 'file' : 'directory',
      fingerprint,
      video,
      qa,
      verifiedAt: this.now(),
    };
  }
  async discover(key: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) return [];
    const suggestions: { stage: ProductionStageId; path: string }[] = [];
    const base = path.join(this.root, key);
    const candidates: { stage: ProductionStageId; path: string }[] = [
      { stage: 'qa', path: path.join(base, 'qa', 'QA_REPORT.md') },
      { stage: 'publication_queue', path: path.join(base, 'publish', 'PUBLISH_PACK.md') },
    ];
    try {
      const render = await this.resolve(path.join(base, 'render'));
      for (const name of (await readdir(render))
        .slice(0, 100)
        .filter((name) => /\.mp4$/i.test(name)))
        candidates.push({ stage: 'render', path: path.join(render, name) });
    } catch {
      /* Missing discovery files are normal; attaching still verifies explicitly. */
    }
    for (const candidate of candidates) {
      try {
        suggestions.push({ ...candidate, path: await this.resolve(candidate.path) });
      } catch {
        /* Suggest only contained existing paths. */
      }
    }
    return suggestions;
  }
}
