import type { Server } from 'node:http';
import { BkmApiClient } from '../bkm/bkm-client';
import { ProductSyncService } from '../bkm/sync-service';
import { closePool, pingDatabase } from '../db/connection';
import { getEnv, isBkmConfigured, type Env } from '../config/env';
import { createHttpServer } from '../http/server';
import { getLogger } from '../logger';
import { createProductSyncSource, ProductService } from '../products/service';

export interface ServerHandle {
  server: Server;
  host: string;
  port: number;
  url: string;
  sync: ProductSyncService;
  close(): Promise<void>;
}

/**
 * Levanta el servicio real:
 *   - API HTTP local (products / health / sync)
 *   - cliente HTTPS saliente hacia BKM
 *   - scheduler opcional de sync (SYNC_ENABLED)
 */
export async function startServer(env: Env = getEnv()): Promise<ServerHandle> {
  const logger = getLogger();

  const products = new ProductService();
  const client = isBkmConfigured(env) ? new BkmApiClient({ env }) : null;
  if (!client) {
    logger.warn('BKM_API_URL/BKM_API_TOKEN no configurados: POST /sync respondera 503');
  }

  const sync = new ProductSyncService({
    source: createProductSyncSource(),
    client,
    batchSize: env.SYNC_BATCH_SIZE,
    connectorId: env.CONNECTOR_ID,
    clientId: env.CLIENT_ID,
    logger,
  });

  const httpServer = createHttpServer({
    env,
    products,
    sync,
    checkSql: () => pingDatabase(Math.min(env.SQL_REQUEST_TIMEOUT_MS, 5_000)),
    logger,
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    httpServer.once('error', onError);
    httpServer.listen(env.PORT, env.API_HOST, () => {
      httpServer.off('error', onError);
      resolve();
    });
  });

  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : env.PORT;
  const host = env.API_HOST;
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const url = `http://${displayHost}:${port}`;

  if (env.SYNC_ENABLED) {
    sync.startScheduler(env.SYNC_INTERVAL_MINUTES);
  } else {
    logger.info('SYNC_ENABLED=false: sincronizacion automatica deshabilitada');
  }

  logger.info(
    {
      url,
      host,
      port,
      sqlConfigured: Boolean(env.SQL_HOST ?? env.DB_SERVER),
      bkmConfigured: isBkmConfigured(env),
    },
    'API HTTP iniciada',
  );

  const close = async (): Promise<void> => {
    sync.stopScheduler();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await closePool();
    logger.info('Servicio detenido');
  };

  return { server: httpServer, host, port, url, sync, close };
}
