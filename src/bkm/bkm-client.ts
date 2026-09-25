import axios, { type AxiosInstance } from 'axios';
import { APP_NAME, APP_VERSION } from '../config/constants';
import { getEnv, requireBkmConfig, type BkmConfig, type Env } from '../config/env';
import { getLogger } from '../logger';
import type { SendOutcome } from '../queue/queue';
import { httpRetryDelayMs, sleep } from '../util/backoff';
import { truncate } from '../util/misc';
import type { BkmBatchEnvelope } from './types';

export interface BkmApiClientOptions {
  env?: Env;
  config?: BkmConfig;
  http?: AxiosInstance;
}

/**
 * Cliente HTTPS saliente hacia la API BKM.
 *
 * - Bearer token configurable (BKM_API_TOKEN). Nunca se loggea.
 * - Timeout por request y reintentos limitados (BKM_RETRY_MAX). Sin retry infinito.
 * - Los 4xx no reintentables se reportan tal cual.
 */
export class BkmApiClient {
  private readonly http: AxiosInstance;
  private readonly url: string;
  private readonly apiToken: string;
  private readonly retryMax: number;

  constructor(options: BkmApiClientOptions = {}) {
    const env = options.env ?? getEnv();
    const config = options.config ?? requireBkmConfig(env);
    this.url = config.url;
    this.apiToken = config.apiToken;
    this.retryMax = config.retryMax;
    this.http =
      options.http ??
      axios.create({
        timeout: config.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
  }

  private isRetryableStatus(status: number): boolean {
    if (status === 408 || status === 425 || status === 429) return true;
    return status >= 500;
  }

  async sendBatch(envelope: BkmBatchEnvelope): Promise<SendOutcome> {
    const logger = getLogger();
    const body = JSON.stringify(envelope);

    for (let attempt = 1; attempt <= this.retryMax + 1; attempt++) {
      try {
        const response = await this.http.post(this.url, body, {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'X-Connector-Id': envelope.connectorId,
            'X-Sync-Id': envelope.syncId,
            'X-Batch-Index': String(envelope.batchIndex),
            'Idempotency-Key': envelope.batchId,
            'User-Agent': `${APP_NAME}/${APP_VERSION}`,
          },
        });

        const status = response.status;
        if (status >= 200 && status < 300) {
          return { ok: true, retryable: false, status };
        }

        const retryable = this.isRetryableStatus(status);
        if (!retryable || attempt > this.retryMax) {
          return {
            ok: false,
            retryable,
            status,
            error: `HTTP ${status} al enviar batch${response.data ? `: ${safeStringify(response.data)}` : ''}`,
          };
        }
        logger.warn({ status, attempt }, 'BKM respondio con estado reintentable');
      } catch (err) {
        const message = (err as Error).message;
        if (attempt > this.retryMax) {
          return {
            ok: false,
            retryable: true,
            error: `Error de red hacia BKM: ${truncate(message, 200)}`,
          };
        }
        logger.warn({ attempt, err: message }, 'Error de red hacia BKM; reintentando');
      }

      await sleep(httpRetryDelayMs(attempt));
    }

    return { ok: false, retryable: true, error: 'Se agotaron los reintentos hacia BKM' };
  }
}

function safeStringify(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return truncate(text, 300);
  } catch {
    return '[unserializable]';
  }
}
