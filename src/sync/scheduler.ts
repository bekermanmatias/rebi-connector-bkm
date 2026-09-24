import type { Env } from '../config/env';
import { getLogger } from '../logger';
import type { LoadedMapping } from '../mapping/load';
import type { BatchSender, LocalQueue } from '../queue/queue';
import { syncFullDataset, syncDictionaries } from './full-sync';
import { syncIncrementalDataset } from './incremental-sync';
import type { SyncDataset } from './pipeline';
import type { SyncStateStore } from './sync-state';

export interface SchedulerDependencies {
  env: Env;
  mapping: LoadedMapping;
  queue: LocalQueue;
  state: SyncStateStore;
  sender: BatchSender;
  /** Sobrescribe para tests; por defecto usa syncIncrementalDataset. */
  runDataset?: (dataset: SyncDataset) => Promise<unknown>;
}

const QUEUE_DRAIN_SECONDS = 15;

/**
 * Scheduler simple basado en setInterval.
 * - Un timer por dataset segun SYNC_*_SECONDS.
 * - Un timer de drain de la queue.
 * - Evita solapamiento: si un dataset todavia corre, se salta el tick.
 */
export class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(private readonly deps: SchedulerDependencies) {}

  start(): void {
    const logger = getLogger();
    const env = this.deps.env;

    const intervals: Array<{ dataset: SyncDataset; seconds: number }> = [
      { dataset: 'products', seconds: env.SYNC_PRODUCTS_SECONDS },
      { dataset: 'stock', seconds: env.SYNC_STOCK_SECONDS },
      { dataset: 'prices', seconds: env.SYNC_PRICES_SECONDS },
      { dataset: 'clients', seconds: env.SYNC_CLIENTS_SECONDS },
    ];

    for (const { dataset, seconds } of intervals) {
      if (seconds <= 0) continue;
      if (!this.deps.mapping.config[dataset]) {
        logger.warn({ dataset }, 'Dataset sin mapping: no se agenda');
        continue;
      }
      this.addTimer(`sync:${dataset}`, seconds * 1000, () => this.runDataset(dataset));
    }

    // Diccionarios una vez al arranque (cambian poco).
    if (this.deps.mapping.config.dictionaries) {
      void this.runDictionaries();
    }

    this.addTimer('queue:drain', QUEUE_DRAIN_SECONDS * 1000, () => this.drainQueue());

    logger.info('Scheduler iniciado');
  }

  private addTimer(name: string, intervalMs: number, task: () => Promise<void>): void {
    const timer = setInterval(() => {
      void task().catch((err: unknown) => {
        getLogger().error({ task: name, err: (err as Error).message }, 'Tarea del scheduler fallo');
      });
    }, intervalMs);
    timer.unref?.();
    this.timers.push(timer);
  }

  async runDataset(dataset: SyncDataset): Promise<void> {
    if (this.running.has(dataset)) return;
    this.running.add(dataset);
    try {
      if (this.deps.runDataset) {
        await this.deps.runDataset(dataset);
      } else {
        await syncIncrementalDataset(dataset, {
          mapping: this.deps.mapping,
          queue: this.deps.queue,
          state: this.deps.state,
          batchSize: this.deps.env.REMOTE_BATCH_SIZE,
          drainAfterEnqueue: true,
        });
      }
    } finally {
      this.running.delete(dataset);
    }
  }

  async runFullDataset(dataset: SyncDataset): Promise<void> {
    await syncFullDataset(dataset, {
      mapping: this.deps.mapping,
      queue: this.deps.queue,
      batchSize: this.deps.env.REMOTE_BATCH_SIZE,
    });
    await this.drainQueue();
  }

  private async runDictionaries(): Promise<void> {
    try {
      await syncDictionaries({
        mapping: this.deps.mapping,
        queue: this.deps.queue,
        batchSize: this.deps.env.REMOTE_BATCH_SIZE,
      });
    } catch (err) {
      getLogger().error({ err: (err as Error).message }, 'Sync de diccionarios fallo');
    }
  }

  async drainQueue(): Promise<void> {
    if (this.running.has('queue')) return;
    this.running.add('queue');
    try {
      const result = await this.deps.queue.drain(this.deps.sender);
      if (result.sent > 0 || result.retried > 0 || result.abandoned > 0) {
        getLogger().info(result, 'Drain de queue');
      }
    } finally {
      this.running.delete('queue');
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}
