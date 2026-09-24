import { DEFAULT_PAGE_SIZE } from '../config/constants';
import { getLogger } from '../logger';
import type { DatasetMapping } from '../mapping/types';
import { markSyncSuccess } from '../runtime/context';
import { stableHash, toIsoOrNull, toNumberOrNull } from '../util/misc';
import { syncFullDataset, type DatasetSyncResult, type SyncDependencies } from './full-sync';
import { paginate } from './paging';
import {
  getMappingEntry,
  getPipeline,
  recordId,
  type DatasetPipeline,
  type NormalizedRecord,
  type SyncDataset,
} from './pipeline';
import { SyncStateStore, type CursorKind } from './sync-state';

export type IncrementalStrategy = 'updated_at' | 'rowversion' | 'watermark' | 'hash' | 'full';

export interface IncrementalDependencies extends SyncDependencies {
  state: SyncStateStore;
}

export interface IncrementalResult extends DatasetSyncResult {
  strategy: IncrementalStrategy;
  cursor: string | null;
}

function detectStrategy(entry: DatasetMapping, storedStrategy: string | null): IncrementalStrategy {
  const explicit = (entry.strategy ?? storedStrategy) as IncrementalStrategy | null | undefined;
  if (explicit === 'full') return 'full';
  if (
    explicit === 'updated_at' ||
    explicit === 'rowversion' ||
    explicit === 'watermark' ||
    explicit === 'hash'
  ) {
    return explicit;
  }
  if (entry.updatedAtColumn) return 'updated_at';
  if (entry.rowVersionColumn) return 'rowversion';
  if (entry.watermarkColumn) return 'watermark';
  return 'hash';
}

function cursorColumnFor(entry: DatasetMapping, strategy: IncrementalStrategy): string | null {
  if (strategy === 'updated_at') return entry.updatedAtColumn ?? null;
  if (strategy === 'rowversion') return entry.rowVersionColumn ?? null;
  if (strategy === 'watermark') return entry.watermarkColumn ?? null;
  return null;
}

function cursorFromRaw(
  row: Record<string, unknown>,
  strategy: IncrementalStrategy,
): string | number | Buffer | null {
  const raw = row.sourceUpdatedAt;
  if (strategy === 'updated_at') return toIsoOrNull(raw);
  if (strategy === 'watermark') return toNumberOrNull(raw);
  if (strategy === 'rowversion') {
    if (Buffer.isBuffer(raw)) return raw;
    if (typeof raw === 'string' && raw.length > 0) return Buffer.from(raw, 'hex');
  }
  return null;
}

function compareCursors(
  a: string | number | Buffer | null,
  b: string | number | Buffer | null,
): number {
  if (a === null) return -1;
  if (b === null) return 1;
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return Buffer.compare(a, b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function cursorToStored(value: string | number | Buffer | null): string | null {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return value.toString('hex');
  return String(value);
}

function bindSince(since: string, strategy: IncrementalStrategy): unknown {
  if (strategy === 'rowversion') return Buffer.from(since, 'hex');
  if (strategy === 'watermark') return Number(since);
  return since;
}

interface EnqueueBuffer {
  push(record: NormalizedRecord): void;
  flush(): void;
  batches: () => number;
}

function makeBuffer(dataset: string, deps: IncrementalDependencies): EnqueueBuffer {
  const batchSize = Math.max(1, deps.batchSize);
  let buffer: NormalizedRecord[] = [];
  let batches = 0;
  return {
    push(record) {
      buffer.push(record);
      if (buffer.length >= batchSize) this.flush();
    },
    flush() {
      if (buffer.length === 0) return;
      if (!deps.dryRun) {
        deps.queue.enqueue(dataset, buffer);
        batches++;
      }
      buffer = [];
    },
    batches: () => batches,
  };
}

/** Incremental por columna (updated_at / rowversion / watermark). */
async function syncByColumn(
  dataset: SyncDataset,
  deps: IncrementalDependencies,
  pipeline: DatasetPipeline,
  strategy: IncrementalStrategy,
  column: string,
): Promise<IncrementalResult> {
  const logger = getLogger();
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const stored = deps.state.get(dataset);
  const since = stored.lastCursor;

  const binds: Record<string, unknown> = {};
  if (since !== null && since !== undefined) {
    binds.since = bindSince(since, strategy);
  }

  const query = pipeline.buildQuery({
    incrementalColumn: since !== null && since !== undefined ? column : null,
    incrementalOperator: '>',
    extraUpdatedAtColumn: strategy === 'updated_at' ? null : column,
  });

  const buffer = makeBuffer(dataset, deps);
  let recordsRead = 0;
  let recordsMapped = 0;
  let recordsSkipped = 0;
  let maxCursor: string | number | Buffer | null = null;

  const start = Date.now();
  for await (const rows of paginate({ query, pageSize, binds, timeoutMs: deps.timeoutMs })) {
    recordsRead += rows.length;
    for (const row of rows) {
      const cursor = cursorFromRaw(row, strategy);
      if (compareCursors(cursor, maxCursor) > 0) maxCursor = cursor;
      const record = pipeline.mapRow(row, deps.productContext);
      if (record) {
        recordsMapped++;
        buffer.push(record);
      } else {
        recordsSkipped++;
      }
    }
  }
  buffer.flush();

  const storedCursor = cursorToStored(maxCursor);
  const cursorKind: CursorKind =
    strategy === 'updated_at'
      ? 'timestamp'
      : strategy === 'watermark'
        ? 'number'
        : strategy === 'rowversion'
          ? 'rowversion'
          : null;

  if (!deps.dryRun) {
    deps.state.recordSuccess(dataset, {
      cursor: storedCursor ?? since,
      cursorKind,
      strategy,
      recordCount: recordsMapped,
    });
    markSyncSuccess();
  }

  logger.info(
    {
      dataset,
      strategy,
      durationMs: Date.now() - start,
      recordCount: recordsMapped,
      recordsRead,
      cursor: storedCursor,
    },
    'Incremental sync completado',
  );

  return {
    dataset,
    strategy,
    cursor: storedCursor ?? since,
    recordsRead,
    recordsMapped,
    recordsSkipped,
    batchesEnqueued: buffer.batches(),
    pendingAfter: deps.dryRun ? 0 : deps.queue.pendingCount(),
  };
}

/** Fallback por hash: lee todo y emite solo registros nuevos/cambiados. */
async function syncByHash(
  dataset: SyncDataset,
  deps: IncrementalDependencies,
  pipeline: DatasetPipeline,
): Promise<IncrementalResult> {
  const logger = getLogger();
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const storedHashes = deps.state.getHashes(dataset);
  const nextHashes: Record<string, string> = {};
  const query = pipeline.buildQuery();
  const buffer = makeBuffer(dataset, deps);

  let recordsRead = 0;
  let changed = 0;
  let recordsSkipped = 0;

  const start = Date.now();
  for await (const rows of paginate({ query, pageSize, timeoutMs: deps.timeoutMs })) {
    recordsRead += rows.length;
    for (const row of rows) {
      const record = pipeline.mapRow(row, deps.productContext);
      if (!record) {
        recordsSkipped++;
        continue;
      }
      const id = recordId(dataset, record);
      if (!id) {
        recordsSkipped++;
        continue;
      }
      const hash = stableHash(record);
      nextHashes[id] = hash;
      if (storedHashes[id] !== hash) {
        changed++;
        buffer.push(record);
      }
    }
  }
  buffer.flush();

  if (!deps.dryRun) {
    deps.state.setHashes(dataset, nextHashes);
    deps.state.recordSuccess(dataset, { strategy: 'hash', recordCount: changed });
    markSyncSuccess();
  }

  logger.info(
    {
      dataset,
      strategy: 'hash',
      durationMs: Date.now() - start,
      recordCount: changed,
      recordsRead,
    },
    'Incremental sync por hash completado',
  );

  return {
    dataset,
    strategy: 'hash',
    cursor: null,
    recordsRead,
    recordsMapped: changed,
    recordsSkipped,
    batchesEnqueued: buffer.batches(),
    pendingAfter: deps.dryRun ? 0 : deps.queue.pendingCount(),
  };
}

/** Incremental sync de un dataset segun la estrategia configurada/auto-detectada. */
export async function syncIncrementalDataset(
  dataset: SyncDataset,
  deps: IncrementalDependencies,
): Promise<IncrementalResult> {
  const entry = getMappingEntry(dataset, deps.mapping.config);
  if (!entry) {
    throw new Error(`El dataset "${dataset}" no tiene mapping configurado.`);
  }
  const pipeline = getPipeline(dataset, deps.mapping.config);
  const stored = deps.state.get(dataset);
  const strategy = detectStrategy(entry, stored.strategy);
  deps.state.recordAttempt(dataset);

  try {
    if (strategy === 'full') {
      const result = await syncFullDataset(dataset, deps);
      deps.state.recordSuccess(dataset, { strategy: 'full', recordCount: result.recordsMapped });
      return { ...result, strategy: 'full', cursor: stored.lastCursor };
    }
    if (strategy === 'hash') {
      return await syncByHash(dataset, deps, pipeline);
    }
    const column = cursorColumnFor(entry, strategy);
    if (!column) {
      const result = await syncFullDataset(dataset, deps);
      deps.state.recordSuccess(dataset, { strategy: 'full', recordCount: result.recordsMapped });
      return { ...result, strategy: 'full', cursor: stored.lastCursor };
    }
    return await syncByColumn(dataset, deps, pipeline, strategy, column);
  } catch (err) {
    deps.state.recordFailure(dataset, (err as Error).message);
    throw err;
  }
}
