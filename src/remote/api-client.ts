import axios, { type AxiosInstance } from 'axios';
import {
  APP_NAME,
  APP_VERSION,
  REMOTE_ENDPOINTS,
  REMOTE_HEARTBEAT_ENDPOINT,
  type Dataset,
} from '../config/constants';
import { getEnv, requireRemoteConfig, type Env } from '../config/env';
import { getLogger } from '../logger';
import type { SendOutcome } from '../queue/queue';
import { httpRetryDelayMs, sleep } from '../util/backoff';
import { newId } from '../util/misc';
import { createBearerAuth, type AuthStrategy } from './auth';
import { buildBatchEnvelope, heartbeatPayloadSchema, type HeartbeatPayload } from './payloads';

const HTTP_RETRIES = 2;

export interface RemoteApiClientOptions {
  env?: Env;
  auth?: AuthStrategy;
  http?: AxiosInstance;
}

export class RemoteApiClient {
  private readonly http: AxiosInstance;
  private readonly auth: AuthStrategy;
  private readonly connectorId: string;
  private readonly clientId: string;

  constructor(options: RemoteApiClientOptions = {}) {
    const env = options.env ?? getEnv();
    const remote = requireRemoteConfig(env);
    this.connectorId = env.CONNECTOR_ID;
    this.clientId = env.CLIENT_ID;
    this.auth = options.auth ?? createBearerAuth(remote.apiKey);
    this.http =
      options.http ??
      axios.create({
        baseURL: remote.baseUrl.replace(/\/+$/, ''),
        timeout: remote.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
        // No lanzar en 4xx/5xx: los interpretamos nosotros.
        validateStatus: () => true,
      });
  }

  private isRetryableStatus(status: number): boolean {
    if (status === 408 || status === 425 || status === 429) return true;
    return status >= 500;
  }

  private async post(
    endpoint: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<SendOutcome> {
    const logger = getLogger();
    const bodyText = JSON.stringify(body);
    const requestId = newId();

    for (let attempt = 1; attempt <= HTTP_RETRIES + 1; attempt++) {
      const authHeaders = this.auth.buildHeaders({
        method: 'POST',
        url: endpoint,
        body: bodyText,
        idempotencyKey,
        requestId,
      });

      try {
        const response = await this.http.post(endpoint, bodyText, {
          headers: {
            ...authHeaders,
            'X-Connector-Id': this.connectorId,
            'X-Request-Id': requestId,
            'Idempotency-Key': idempotencyKey,
            'User-Agent': `${APP_NAME}/${APP_VERSION}`,
          },
        });

        const status = response.status;
        if (status >= 200 && status < 300) {
          return { ok: true, retryable: false, status };
        }

        const retryable = this.isRetryableStatus(status);
        const message = `HTTP ${status} en ${endpoint}`;
        if (!retryable || attempt > HTTP_RETRIES) {
          return {
            ok: false,
            retryable,
            status,
            error: `${message}${response.data ? `: ${safeStringify(response.data)}` : ''}`,
          };
        }
        logger.warn({ status, endpoint, attempt }, 'Respuesta HTTP reintentable');
      } catch (err) {
        const message = (err as Error).message;
        if (attempt > HTTP_RETRIES) {
          return { ok: false, retryable: true, error: `Error de red: ${message}` };
        }
        logger.warn({ endpoint, attempt, err: message }, 'Error de red; reintentando');
      }

      await sleep(httpRetryDelayMs(attempt));
    }

    return { ok: false, retryable: true, error: 'Se agotaron los reintentos HTTP' };
  }

  /** Envia un batch de un dataset. */
  async sendBatch(
    dataset: Dataset | string,
    batchId: string,
    records: unknown[],
  ): Promise<SendOutcome> {
    const endpoint = REMOTE_ENDPOINTS[dataset as Dataset];
    if (!endpoint) {
      return { ok: false, retryable: false, error: `Dataset desconocido: ${dataset}` };
    }
    const envelope = buildBatchEnvelope({
      connectorId: this.connectorId,
      clientId: this.clientId,
      dataset,
      batchId,
      data: records,
    });
    return this.post(endpoint, envelope, batchId);
  }

  async sendHeartbeat(payload: HeartbeatPayload): Promise<SendOutcome> {
    const parsed = heartbeatPayloadSchema.parse(payload);
    return this.post(REMOTE_HEARTBEAT_ENDPOINT, parsed, newId());
  }
}

function safeStringify(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 300 ? `${text.slice(0, 300)}...[truncated]` : text;
  } catch {
    return '[unserializable]';
  }
}
