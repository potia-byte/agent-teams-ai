import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { withFileLock } from '@main/services/team/fileLock';
import { atomicWriteAsync } from '@main/utils/atomicWrite';

import { emptyMediaState, validateMediaState } from '../../core/domain/state';

import type { MediaOperationsState } from '../../contracts';
import type { MediaOperationsRepository } from '../../core/application/ports';

export class JsonMediaOperationsRepository implements MediaOperationsRepository {
  private readonly directory: string;
  private readonly file: string;

  constructor(
    directory: string,
    private readonly ownerId: string,
    private readonly currency = 'USD'
  ) {
    emptyMediaState(ownerId, currency);
    this.directory = resolve(directory);
    this.file = join(this.directory, 'media-operations.json');
  }

  private validate(value: unknown): asserts value is MediaOperationsState {
    validateMediaState(value);
    if (value.ownerId !== this.ownerId || value.currency !== this.currency)
      throw new Error('Media repository owner or currency mismatch');
  }

  async read(): Promise<MediaOperationsState> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      this.validate(value);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return emptyMediaState(this.ownerId, this.currency);
      // Corruption is never replaced with an empty state: that would erase deduplication evidence.
      throw error;
    }
  }

  async transact<T>(operation: (state: MediaOperationsState) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return withFileLock(
      this.file,
      async () => {
        const state = await this.read();
        const result = operation(state);
        if (result && typeof result === 'object' && 'then' in result)
          throw new Error('Repository transactions must be synchronous');
        this.validate(state);
        const detachedResult = structuredClone(result);
        await atomicWriteAsync(this.file, `${JSON.stringify(state, null, 2)}\n`, {
          mode: 0o600,
          directoryMode: 0o700,
          durability: 'strict',
          syncDirectory: true,
        });
        return detachedResult;
      },
      { preventLiveOwnerTakeover: true, acquireTimeoutMs: 5_000 }
    );
  }
}
