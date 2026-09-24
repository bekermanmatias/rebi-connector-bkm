import { MAX_QUEUE_ATTEMPTS, STALE_SENDING_MS } from '../config/constants';
import { getLogger } from '../logger';
import { nextRetryDate } from '../util/backoff';
import { QueueRepository, type QueueBatch, type QueueStatus } from './repository';

export interface SendOutcome {
  ok: boolean;
  /** Si false, no se reintenta (error definitivo, ej. 400/401/403). */
  retryable: boolean;
  status?: number;
  error?: string;
}

export type BatchSender = (batch: QueueBatch) => Promise<SendOutcome>;

export interface DrainResult {
  sent: number;
  retried: number;
  abandoned: number;
  remaining: number;
}

/**
 * Queue local de batches pendientes con reintentos y backoff.
 * Nunca bloquea la lectura de SQL: solo persiste y reintenta.
 */
export class LocalQueue {
  constructor(private readonly repo: QueueRepository) {}

  static open(path?: string): LocalQueue {
    return new LocalQueue(new QueueRepository(path));
  }

  get repository(): QueueRepository {
    return this.repo;
  }

  enqueue(dataset: string, records: unknown[]): QueueBatch | null {
    if (records.length === 0) return null;
    return this.repo.create(dataset, records);
  }

  stats(): Record<QueueStatus, number> {
    return this.repo.stats();
  }

  pendingCount(): number {
    return this.repo.pendingCount();
  }

  resetStale(): number {
    return this.repo.resetStaleSending(STALE_SENDING_MS);
  }

  /**
   * Intenta enviar los batches vencidos.
   * - ok -> SENT
   * - error retryable -> FAILED con proximo nextRetryAt (backoff)
   * - error no retryable -> FAILED permanente
   */
  async drain(sender: BatchSender, limit = 25): Promise<DrainResult> {
    const logger = getLogger();
    const due = this.repo.due(new Date(), limit);
    let sent = 0;
    let retried = 0;
    let abandoned = 0;

    for (const batch of due) {
      this.repo.update(batch.batchId, { status: 'SENDING' });
      let outcome: SendOutcome;
      try {
        outcome = await sender(batch);
      } catch (err) {
        outcome = { ok: false, retryable: true, error: (err as Error).message };
      }

      if (outcome.ok) {
        this.repo.update(batch.batchId, {
          status: 'SENT',
          sentAt: new Date().toISOString(),
          lastError: null,
        });
        sent++;
        continue;
      }

      const attempts = batch.attempts + 1;
      if (!outcome.retryable) {
        this.repo.update(batch.batchId, {
          status: 'FAILED',
          permanent: true,
          attempts,
          lastError: outcome.error ?? `HTTP ${outcome.status ?? 'desconocido'}`,
        });
        abandoned++;
        logger.error(
          { batchId: batch.batchId, dataset: batch.dataset, status: outcome.status },
          'Batch rechazado de forma definitiva (no se reintenta)',
        );
        continue;
      }

      const nextRetry = nextRetryDate(attempts);
      this.repo.update(batch.batchId, {
        status: 'FAILED',
        attempts,
        nextRetryAt: nextRetry,
        lastError: outcome.error ?? `HTTP ${outcome.status ?? 'desconocido'}`,
      });
      retried++;
      logger.warn(
        {
          batchId: batch.batchId,
          dataset: batch.dataset,
          attempts,
          nextRetryAt: nextRetry,
          maxAttempts: MAX_QUEUE_ATTEMPTS,
          status: outcome.status,
        },
        'Batch fallo; se reintentara',
      );
    }

    return { sent, retried, abandoned, remaining: this.repo.pendingCount() };
  }
}
