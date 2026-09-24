import { join } from 'node:path';
import { DEFAULT_DATA_DIR } from '../config/constants';
import { getEnv } from '../config/env';
import { readJsonSync, writeJsonAtomic } from '../util/fs-atomic';
import { newId, nowIso } from '../util/misc';

export type QueueStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';

export interface QueueBatch {
  batchId: string;
  dataset: string;
  status: QueueStatus;
  records: unknown[];
  recordCount: number;
  attempts: number;
  permanent: boolean;
  createdAt: string;
  updatedAt: string;
  nextRetryAt: string;
  sentAt: string | null;
  lastError: string | null;
}

export interface QueueStateFile {
  version: 1;
  batches: QueueBatch[];
}

const MAX_SENT_HISTORY = 500;

function emptyState(): QueueStateFile {
  return { version: 1, batches: [] };
}

export function defaultQueuePath(): string {
  try {
    return getEnv().QUEUE_DB_PATH;
  } catch {
    return join(DEFAULT_DATA_DIR, 'connector.sqlite');
  }
}

/**
 * Persistencia local de batches pendientes.
 * Almacenamiento JSON atomico, sin dependencias nativas.
 * Un unico proceso escribe este archivo (el connector).
 */
export class QueueRepository {
  private state: QueueStateFile;

  constructor(private readonly path: string = defaultQueuePath()) {
    const loaded = readJsonSync<QueueStateFile>(this.path);
    this.state = loaded && loaded.version === 1 ? loaded : emptyState();
    this.pruneSentHistory();
  }

  private persist(): void {
    writeJsonAtomic(this.path, this.state);
  }

  private pruneSentHistory(): void {
    const sent = this.state.batches.filter((b) => b.status === 'SENT');
    if (sent.length <= MAX_SENT_HISTORY) return;
    const remove = new Set(
      sent
        .sort((a, b) => a.sentAt?.localeCompare(b.sentAt ?? '') ?? 0)
        .slice(0, sent.length - MAX_SENT_HISTORY)
        .map((b) => b.batchId),
    );
    this.state.batches = this.state.batches.filter((b) => !remove.has(b.batchId));
    this.persist();
  }

  create(dataset: string, records: unknown[]): QueueBatch {
    const timestamp = nowIso();
    const batch: QueueBatch = {
      batchId: newId(),
      dataset,
      status: 'PENDING',
      records,
      recordCount: records.length,
      attempts: 0,
      permanent: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      nextRetryAt: timestamp,
      sentAt: null,
      lastError: null,
    };
    this.state.batches.push(batch);
    this.persist();
    return batch;
  }

  get(batchId: string): QueueBatch | null {
    return this.state.batches.find((b) => b.batchId === batchId) ?? null;
  }

  all(): QueueBatch[] {
    return this.state.batches;
  }

  /** Batches listos para enviar (PENDING o FAILED retryable, nextRetryAt <= now). */
  due(now: Date = new Date(), limit = 50): QueueBatch[] {
    const nowMs = now.getTime();
    return this.state.batches
      .filter(
        (b) =>
          !b.permanent &&
          (b.status === 'PENDING' || b.status === 'FAILED') &&
          new Date(b.nextRetryAt).getTime() <= nowMs,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }

  update(batchId: string, patch: Partial<QueueBatch>): QueueBatch | null {
    const batch = this.get(batchId);
    if (!batch) return null;
    Object.assign(batch, patch, { updatedAt: nowIso() });
    this.persist();
    return batch;
  }

  /** Vuelve a PENDING los batches SENDING colgados (proceso reiniciado, etc). */
  resetStaleSending(staleMs: number, now: Date = new Date()): number {
    let reset = 0;
    for (const batch of this.state.batches) {
      if (batch.status !== 'SENDING') continue;
      if (now.getTime() - new Date(batch.updatedAt).getTime() > staleMs) {
        batch.status = 'PENDING';
        batch.updatedAt = now.toISOString();
        batch.nextRetryAt = now.toISOString();
        reset++;
      }
    }
    if (reset > 0) this.persist();
    return reset;
  }

  stats(): Record<QueueStatus, number> {
    const stats: Record<QueueStatus, number> = { PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0 };
    for (const batch of this.state.batches) stats[batch.status]++;
    return stats;
  }

  pendingCount(): number {
    return this.state.batches.filter(
      (b) =>
        !b.permanent && (b.status === 'PENDING' || b.status === 'FAILED' || b.status === 'SENDING'),
    ).length;
  }
}
