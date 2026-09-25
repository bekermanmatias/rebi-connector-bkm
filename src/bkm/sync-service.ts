import {
  BKM_ALLOW_DELETIONS,
  BKM_PRODUCTS_DATASET,
  BKM_SYNC_MODE,
  DEFAULT_LAST_SYNC_PATH,
} from '../config/constants';
import { getLogger, type Logger } from '../logger';
import type { ProductSyncSource } from '../products/service';
import type { SendOutcome } from '../queue/queue';
import { markRuntimeError, markSyncSuccess } from '../runtime/context';
import { readJsonSync, writeJsonAtomic } from '../util/fs-atomic';
import { newId, nowIso, truncate } from '../util/misc';
import {
  bkmBatchEnvelopeSchema,
  type BkmBatchEnvelope,
  type SyncBatchError,
  type SyncResult,
} from './types';

export class SyncAlreadyRunningError extends Error {
  constructor(message = 'Ya hay una sincronizacion en curso') {
    super(message);
    this.name = 'SyncAlreadyRunningError';
  }
}

export class SyncNotConfiguredError extends Error {
  constructor(message = 'La API BKM no esta configurada (BKM_API_URL / BKM_API_TOKEN)') {
    super(message);
    this.name = 'SyncNotConfiguredError';
  }
}

/** Cliente minimo que necesita el sync (permite inyectar un fake en tests). */
export interface BkmSendClient {
  sendBatch(envelope: BkmBatchEnvelope): Promise<SendOutcome>;
}

export interface ProductSyncOptions {
  source: ProductSyncSource;
  client: BkmSendClient | null;
  batchSize: number;
  connectorId: string;
  clientId: string;
  logger?: Logger;
  lastSyncPath?: string;
}

export interface BkmBatchInput {
  connectorId: string;
  clientId: string;
  syncId: string;
  batchIndex: number;
  totalBatches: number;
  data: BkmBatchEnvelope['data'];
  batchId?: string;
  sentAt?: string;
}

export function buildBkmBatchEnvelope(input: BkmBatchInput): BkmBatchEnvelope {
  return bkmBatchEnvelopeSchema.parse({
    connectorId: input.connectorId,
    clientId: input.clientId,
    dataset: BKM_PRODUCTS_DATASET,
    syncId: input.syncId,
    batchId: input.batchId ?? newId(),
    batchIndex: input.batchIndex,
    totalBatches: input.totalBatches,
    sentAt: input.sentAt ?? nowIso(),
    mode: BKM_SYNC_MODE,
    allowDeletions: BKM_ALLOW_DELETIONS,
    data: input.data,
  });
}

/**
 * Orquesta una sincronizacion completa de productos:
 *   SQL Server -> normalizar -> lotes -> POST a BKM.
 *
 * Garantias:
 * - Una sola sincronizacion simultanea (single-flight).
 * - Nunca elimina productos del destino (mode upsert, allowDeletions=false).
 * - Reporta batches fallidos y termina en SUCCESS / PARTIAL / FAILED.
 * - No loggea payloads completos ni tokens.
 */
export class ProductSyncService {
  private running = false;
  private last: SyncResult | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly lastSyncPath: string;

  constructor(private readonly options: ProductSyncOptions) {
    this.lastSyncPath = options.lastSyncPath ?? DEFAULT_LAST_SYNC_PATH;
    this.last = readJsonSync<SyncResult>(this.lastSyncPath);
  }

  isRunning(): boolean {
    return this.running;
  }

  lastResult(): SyncResult | null {
    return this.last;
  }

  private get logger(): Logger {
    return this.options.logger ?? getLogger();
  }

  async run(): Promise<SyncResult> {
    if (this.running) throw new SyncAlreadyRunningError();
    if (!this.options.client) throw new SyncNotConfiguredError();

    this.running = true;
    const logger = this.logger;
    const syncId = newId();
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const batchSize = Math.max(1, this.options.batchSize);

    const errors: SyncBatchError[] = [];
    let totalRead = 0;
    let totalSent = 0;
    let batches = 0;
    let batchesSent = 0;
    let batchesFailed = 0;
    let status: SyncResult['status'] = 'SUCCESS';
    let errorSummary: string | null = null;

    try {
      const total = await this.options.source.count();
      const totalBatches = Math.max(1, Math.ceil(total / batchSize));
      let page = 1;
      let batchIndex = 0;

      while (true) {
        const products = await this.options.source.page(page, batchSize);
        if (products.length === 0) break;

        totalRead += products.length;
        const envelope = buildBkmBatchEnvelope({
          connectorId: this.options.connectorId,
          clientId: this.options.clientId,
          syncId,
          batchIndex,
          totalBatches,
          data: products,
        });
        batches += 1;

        const outcome = await this.options.client.sendBatch(envelope);
        if (outcome.ok) {
          batchesSent += 1;
          totalSent += products.length;
        } else {
          batchesFailed += 1;
          errors.push({
            batchIndex,
            batchId: envelope.batchId,
            status: outcome.status,
            error: truncate(outcome.error ?? 'error desconocido', 300),
          });
          logger.warn(
            {
              syncId,
              batchIndex,
              status: outcome.status,
              retryable: outcome.retryable,
              items: products.length,
            },
            'Batch hacia BKM fallo',
          );
        }

        batchIndex += 1;
        page += 1;
        if (products.length < batchSize) break;
      }

      if (batchesFailed === 0) status = 'SUCCESS';
      else if (batchesSent > 0) status = 'PARTIAL';
      else status = 'FAILED';

      errorSummary = batchesFailed > 0 ? `${batchesFailed} de ${batches} batches fallaron` : null;
      if (status === 'SUCCESS') markSyncSuccess(startedAtDate);
      else if (errorSummary) markRuntimeError(errorSummary);
    } catch (err) {
      status = 'FAILED';
      const message = truncate((err as Error).message ?? 'Error desconocido', 300);
      errorSummary = message;
      markRuntimeError(message);
      logger.error({ syncId, err: message }, 'Sync de productos fallo');
    } finally {
      this.running = false;
    }

    const finishedAtDate = new Date();
    const result: SyncResult = {
      syncId,
      status,
      startedAt,
      finishedAt: finishedAtDate.toISOString(),
      durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
      totalRead,
      totalSent,
      batches,
      batchesSent,
      batchesFailed,
      success: status === 'SUCCESS',
      error: errorSummary,
      errors,
    };

    this.last = result;
    try {
      writeJsonAtomic(this.lastSyncPath, result);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'No se pudo persistir el resumen de sync');
    }

    logger.info(
      {
        syncId,
        status: result.status,
        totalRead: result.totalRead,
        totalSent: result.totalSent,
        batches: result.batches,
        batchesFailed: result.batchesFailed,
        durationMs: result.durationMs,
      },
      'Sync de productos finalizada',
    );

    return result;
  }

  startScheduler(intervalMinutes: number): void {
    if (this.timer) return;
    if (!this.options.client) {
      this.logger.warn('SYNC_ENABLED=true pero BKM_API_URL/BKM_API_TOKEN no estan configurados');
      return;
    }
    const intervalMs = Math.max(1, intervalMinutes) * 60_000;
    this.timer = setInterval(() => {
      void this.run().catch((err: unknown) => {
        this.logger.warn({ err: (err as Error).message }, 'Sync automatica fallo');
      });
    }, intervalMs);
    this.timer.unref?.();
    this.logger.info({ intervalMinutes, intervalMs }, 'Scheduler de sync de productos iniciado');
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
