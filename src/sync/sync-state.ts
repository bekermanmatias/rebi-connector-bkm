import { dirname, join } from 'node:path';
import { getEnv } from '../config/env';
import { readJsonSync, writeJsonAtomic } from '../util/fs-atomic';
import { nowIso } from '../util/misc';

export type CursorKind = 'timestamp' | 'number' | 'rowversion' | 'hash' | null;

export interface DatasetState {
  dataset: string;
  lastCursor: string | null;
  cursorKind: CursorKind;
  strategy: string | null;
  lastSuccessfulSync: string | null;
  lastAttempt: string | null;
  lastError: string | null;
  recordsLastRun: number;
}

export interface SyncStateFile {
  version: 1;
  datasets: Record<string, DatasetState>;
  /** Hash por dataset y por id, usado por la estrategia 'hash'. */
  hashes: Record<string, Record<string, string>>;
}

function emptyDatasetState(dataset: string): DatasetState {
  return {
    dataset,
    lastCursor: null,
    cursorKind: null,
    strategy: null,
    lastSuccessfulSync: null,
    lastAttempt: null,
    lastError: null,
    recordsLastRun: 0,
  };
}

/** Ruta del archivo de estado, junto a la queue. */
export function syncStatePath(): string {
  const env = getEnv();
  return join(dirname(env.QUEUE_DB_PATH), 'sync-state.json');
}

export class SyncStateStore {
  private state: SyncStateFile;

  constructor(private readonly path: string = syncStatePath()) {
    const loaded = readJsonSync<SyncStateFile>(this.path);
    this.state =
      loaded && loaded.version === 1
        ? { version: 1, datasets: loaded.datasets ?? {}, hashes: loaded.hashes ?? {} }
        : { version: 1, datasets: {}, hashes: {} };
  }

  private persist(): void {
    writeJsonAtomic(this.path, this.state);
  }

  get(dataset: string): DatasetState {
    return this.state.datasets[dataset] ?? emptyDatasetState(dataset);
  }

  all(): DatasetState[] {
    return Object.values(this.state.datasets);
  }

  update(dataset: string, patch: Partial<DatasetState>): DatasetState {
    const next = { ...this.get(dataset), ...patch, dataset };
    this.state.datasets[dataset] = next;
    this.persist();
    return next;
  }

  recordAttempt(dataset: string): void {
    this.update(dataset, { lastAttempt: nowIso() });
  }

  recordSuccess(
    dataset: string,
    params: {
      cursor?: string | null;
      cursorKind?: CursorKind;
      strategy?: string | null;
      recordCount: number;
    },
  ): DatasetState {
    return this.update(dataset, {
      lastSuccessfulSync: nowIso(),
      lastError: null,
      recordsLastRun: params.recordCount,
      ...(params.cursor !== undefined ? { lastCursor: params.cursor } : {}),
      ...(params.cursorKind !== undefined ? { cursorKind: params.cursorKind } : {}),
      ...(params.strategy !== undefined ? { strategy: params.strategy } : {}),
    });
  }

  recordFailure(dataset: string, error: string): void {
    this.update(dataset, { lastError: error, lastAttempt: nowIso() });
  }

  // --- Estrategia hash ---

  getHashes(dataset: string): Record<string, string> {
    return this.state.hashes[dataset] ?? {};
  }

  setHashes(dataset: string, hashes: Record<string, string>): void {
    this.state.hashes[dataset] = hashes;
    this.persist();
  }

  /** Elimina hashes de ids que ya no existen. */
  pruneHashes(dataset: string, validIds: Set<string>): void {
    const existing = this.state.hashes[dataset];
    if (!existing) return;
    let changed = false;
    for (const id of Object.keys(existing)) {
      if (!validIds.has(id)) {
        delete existing[id];
        changed = true;
      }
    }
    if (changed) this.persist();
  }
}
