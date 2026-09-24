import { APP_VERSION } from '../config/constants';
import type { Env } from '../config/env';
import { runQuery } from '../db/connection';
import { parseTableName, quoteIdentifier, quoteQualified } from '../db/sql-guard';
import { getLogger } from '../logger';
import type { LoadedMapping } from '../mapping/load';
import type { LocalQueue } from '../queue/queue';
import { RemoteApiClient } from '../remote/api-client';
import { heartbeatPayloadSchema, type HeartbeatPayload } from '../remote/payloads';
import { runtime, uptimeSeconds } from '../runtime/context';
import type { SyncStateStore } from '../sync/sync-state';

export interface ReplicaProbeResult {
  replicaLastUpdateAt: string | null;
  replicaLagSeconds: number | null;
}

export type ReplicaProbe = () => Promise<ReplicaProbeResult>;

/**
 * Intenta detectar el ultimo timestamp de modificacion de la replica a partir
 * del mapping de productos (o stock/precios/clientes). Best-effort.
 */
export function createReplicaProbe(mapping: LoadedMapping, timeoutMs = 5_000): ReplicaProbe {
  return async () => {
    const empty: ReplicaProbeResult = { replicaLastUpdateAt: null, replicaLagSeconds: null };
    const candidates: Array<{ source: string; column: string }> = [];
    const config = mapping.config;
    if (config.products?.updatedAtColumn) {
      candidates.push({ source: config.products.source, column: config.products.updatedAtColumn });
    }
    if (config.stock?.updatedAtColumn) {
      candidates.push({ source: config.stock.source, column: config.stock.updatedAtColumn });
    }
    if (config.prices?.updatedAtColumn) {
      candidates.push({ source: config.prices.source, column: config.prices.updatedAtColumn });
    }
    const target = candidates[0];
    if (!target) return empty;

    try {
      const { schema, table } = parseTableName(target.source);
      const qualified = schema ? quoteQualified(schema, table) : quoteIdentifier(table);
      const text = `SELECT MAX(${quoteIdentifier(target.column)}) AS lastUpdate FROM ${qualified}`;
      const { rows } = await runQuery<{ lastUpdate: unknown }>(text, {}, { timeoutMs });
      const raw = rows[0]?.lastUpdate;
      const date = raw instanceof Date ? raw : typeof raw === 'string' ? new Date(raw) : null;
      if (!date || Number.isNaN(date.getTime())) return empty;
      const lagSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
      return { replicaLastUpdateAt: date.toISOString(), replicaLagSeconds: lagSeconds };
    } catch (err) {
      getLogger().debug({ err: (err as Error).message }, 'No se pudo sondear lag de replica');
      return empty;
    }
  };
}

export interface HeartbeatDependencies {
  env: Env;
  queue: LocalQueue;
  state: SyncStateStore;
  replicaProbe?: ReplicaProbe;
}

/** Construye el payload de heartbeat a partir del estado actual. */
export async function buildHeartbeat(deps: HeartbeatDependencies): Promise<HeartbeatPayload> {
  const { env, queue, state } = deps;
  const lastSyncCandidates = [
    runtime.lastSuccessfulSyncAt,
    ...state.all().map((s) => s.lastSuccessfulSync),
  ].filter((value): value is string => Boolean(value));
  const lastSuccessfulSyncAt =
    lastSyncCandidates.length > 0 ? (lastSyncCandidates.sort().at(-1) ?? null) : null;

  const probe = deps.replicaProbe
    ? await deps.replicaProbe()
    : { replicaLastUpdateAt: null, replicaLagSeconds: null };

  const memoryUsageMb = Math.round((process.memoryUsage().rss / (1024 * 1024)) * 100) / 100;

  return heartbeatPayloadSchema.parse({
    connectorId: env.CONNECTOR_ID,
    clientId: env.CLIENT_ID,
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    sqlConnected: runtime.sqlConnected,
    lastDbReadAt: runtime.lastDbReadAt,
    lastSuccessfulSyncAt,
    queuePending: queue.pendingCount(),
    memoryUsageMb,
    uptimeSeconds: uptimeSeconds(),
    replicaLastUpdateAt: probe.replicaLastUpdateAt,
    replicaLagSeconds: probe.replicaLagSeconds,
  });
}

export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private sending = false;

  constructor(
    private readonly deps: HeartbeatDependencies,
    private readonly client: RemoteApiClient,
  ) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(5, this.deps.env.HEARTBEAT_SECONDS) * 1000;
    this.timer = setInterval(() => {
      void this.sendOnce();
    }, intervalMs);
    this.timer.unref?.();
    getLogger().info({ intervalMs }, 'Heartbeat iniciado');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sendOnce(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    const logger = getLogger();
    try {
      const payload = await buildHeartbeat(this.deps);
      runtime.lastHeartbeatAt = payload.timestamp;
      const outcome = await this.client.sendHeartbeat(payload);
      if (!outcome.ok) {
        logger.warn(
          { status: outcome.status, retryable: outcome.retryable },
          'Heartbeat no enviado',
        );
      } else {
        logger.debug('Heartbeat enviado');
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Error enviando heartbeat');
    } finally {
      this.sending = false;
    }
  }
}
