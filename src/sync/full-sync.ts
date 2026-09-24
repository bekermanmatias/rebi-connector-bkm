import { DEFAULT_PAGE_SIZE } from '../config/constants';
import type { LoadedMapping } from '../mapping/load';
import { getLogger } from '../logger';
import type { ProductMapperContext } from '../mapping/product.mapper';
import type { BatchSender } from '../queue/queue';
import type { LocalQueue } from '../queue/queue';
import { markSyncSuccess } from '../runtime/context';
import { paginate } from './paging';
import {
  getDictionaryBuilds,
  getPipeline,
  type NormalizedRecord,
  type SyncDataset,
} from './pipeline';

export interface SyncDependencies {
  mapping: LoadedMapping;
  queue: LocalQueue;
  batchSize: number;
  pageSize?: number;
  sender?: BatchSender;
  /** Si true, intenta enviar inmediatamente tras encolar. */
  drainAfterEnqueue?: boolean;
  /** Si true, no encola ni envia: solo lee y mapea (diagnostico). */
  dryRun?: boolean;
  productContext?: ProductMapperContext;
  timeoutMs?: number;
}

export interface DatasetSyncResult {
  dataset: string;
  recordsRead: number;
  recordsMapped: number;
  recordsSkipped: number;
  batchesEnqueued: number;
  pendingAfter: number;
}

async function consume(
  dataset: string,
  deps: SyncDependencies,
  query: { sql: string; countSql: string; orderColumns: string[] },
  mapRow: (row: Record<string, unknown>) => NormalizedRecord | null,
  binds: Record<string, unknown> = {},
): Promise<DatasetSyncResult> {
  const logger = getLogger();
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const batchSize = Math.max(1, deps.batchSize);

  let recordsRead = 0;
  let recordsMapped = 0;
  let recordsSkipped = 0;
  let batchesEnqueued = 0;
  let buffer: NormalizedRecord[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    if (!deps.dryRun) {
      deps.queue.enqueue(dataset, buffer);
      batchesEnqueued++;
    }
    buffer = [];
  };

  const start = Date.now();
  for await (const rows of paginate({ query, pageSize, binds, timeoutMs: deps.timeoutMs })) {
    recordsRead += rows.length;
    for (const row of rows) {
      const record = mapRow(row);
      if (record) {
        recordsMapped++;
        buffer.push(record);
        if (buffer.length >= batchSize) flush();
      } else {
        recordsSkipped++;
      }
    }
  }
  flush();

  logger.info(
    {
      dataset,
      durationMs: Date.now() - start,
      recordCount: recordsMapped,
      recordsRead,
      recordsSkipped,
      batchesEnqueued,
    },
    'Sync de dataset completado',
  );

  return {
    dataset,
    recordsRead,
    recordsMapped,
    recordsSkipped,
    batchesEnqueued,
    pendingAfter: deps.dryRun ? 0 : deps.queue.pendingCount(),
  };
}

/** Full sync de un dataset (products | stock | prices | clients). */
export async function syncFullDataset(
  dataset: SyncDataset,
  deps: SyncDependencies,
): Promise<DatasetSyncResult> {
  const pipeline = getPipeline(dataset, deps.mapping.config);
  const query = pipeline.buildQuery();
  const result = await consume(dataset, deps, query, (row) =>
    pipeline.mapRow(row, deps.productContext),
  );
  if (!deps.dryRun) markSyncSuccess();
  return result;
}

/** Full sync de todos los diccionarios configurados. */
export async function syncDictionaries(deps: SyncDependencies): Promise<DatasetSyncResult> {
  const builds = getDictionaryBuilds(deps.mapping.config);
  const total: DatasetSyncResult = {
    dataset: 'dictionaries',
    recordsRead: 0,
    recordsMapped: 0,
    recordsSkipped: 0,
    batchesEnqueued: 0,
    pendingAfter: 0,
  };
  for (const build of builds) {
    const query = build.buildQuery();
    const result = await consume('dictionaries', deps, query, build.mapRow);
    total.recordsRead += result.recordsRead;
    total.recordsMapped += result.recordsMapped;
    total.recordsSkipped += result.recordsSkipped;
    total.batchesEnqueued += result.batchesEnqueued;
  }
  total.pendingAfter = deps.dryRun ? 0 : deps.queue.pendingCount();
  if (!deps.dryRun) markSyncSuccess();
  return total;
}

const FULL_DATASETS: SyncDataset[] = ['products', 'stock', 'prices', 'clients'];

/** Full sync de todos los datasets que tengan mapping configurado. */
export async function syncFull(deps: SyncDependencies): Promise<DatasetSyncResult[]> {
  const results: DatasetSyncResult[] = [];
  for (const dataset of FULL_DATASETS) {
    if (!deps.mapping.config[dataset]) continue;
    results.push(await syncFullDataset(dataset, deps));
  }
  if (getDictionaryBuilds(deps.mapping.config).length > 0) {
    results.push(await syncDictionaries(deps));
  }
  return results;
}

export { FULL_DATASETS };
