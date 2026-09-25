import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { SyncAlreadyRunningError, SyncNotConfiguredError } from '../bkm/sync-service';
import type { SyncResult } from '../bkm/types';
import { APP_NAME, APP_VERSION } from '../config/constants';
import type { Env } from '../config/env';
import { getLogger, type Logger } from '../logger';
import { parseListQuery } from '../products/service';
import type { ProductsApi } from '../products/types';
import { uptimeSeconds } from '../runtime/context';
import { HttpError, toErrorResponse } from './errors';
import { normalizePath, Router, type HttpResponse, type RequestContext } from './router';
import { evaluateCors, isAuthorized, parseAllowedOrigins, RateLimiter } from './security';

const MAX_BODY_BYTES = 1024 * 1024;
const PUBLIC_PATHS = new Set(['/health']);

export interface SqlHealth {
  connected: boolean;
  latencyMs: number | null;
}

export interface SyncApi {
  run(): Promise<SyncResult>;
  isRunning(): boolean;
  lastResult(): SyncResult | null;
}

export interface HttpContext {
  env: Env;
  products: ProductsApi;
  sync: SyncApi;
  checkSql: () => Promise<SqlHealth>;
  logger?: Logger;
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return undefined;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Body demasiado grande');
    }
    chunks.push(buf);
  }
  if (size === 0) return undefined;

  const text = Buffer.concat(chunks).toString('utf8');
  const contentType = headerValue(req.headers['content-type']) ?? '';
  if (!contentType.includes('application/json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Body JSON invalido');
  }
}

/** Envuelve errores de SQL en un 503 limpio (sin filtrar detalles del driver). */
function asSqlError(err: unknown, logger: Logger): never {
  if (err instanceof HttpError) throw err;
  logger.warn({ err: (err as Error).message }, 'Error consultando SQL Server');
  throw new HttpError(503, 'SQL_UNAVAILABLE', 'No se pudo consultar la base de datos');
}

export function createHttpServer(context: HttpContext): Server {
  const logger = context.logger ?? getLogger();
  const allowedOrigins = parseAllowedOrigins(context.env.CORS_ALLOWED_ORIGINS);
  const limiter = new RateLimiter(
    context.env.API_RATE_LIMIT_MAX,
    context.env.API_RATE_LIMIT_WINDOW_MS,
  );

  const handleHealth = async (): Promise<HttpResponse> => {
    const sql = await context.checkSql();
    return {
      status: 200,
      body: {
        status: sql.connected ? 'ok' : 'degraded',
        service: APP_NAME,
        version: APP_VERSION,
        timestamp: new Date().toISOString(),
        uptimeSeconds: uptimeSeconds(),
        sql: { connected: sql.connected, latencyMs: sql.latencyMs },
      },
    };
  };

  const handleListProducts = async (ctx: RequestContext): Promise<HttpResponse> => {
    try {
      const page = await context.products.list(parseListQuery(ctx.query));
      return { status: 200, body: page };
    } catch (err) {
      asSqlError(err, logger);
    }
  };

  const handleProductsMeta = async (): Promise<HttpResponse> => {
    try {
      return { status: 200, body: await context.products.meta() };
    } catch (err) {
      asSqlError(err, logger);
    }
  };

  const handleGetProduct = async (ctx: RequestContext): Promise<HttpResponse> => {
    const code = ctx.params.code?.trim();
    if (!code) throw new HttpError(400, 'INVALID_CODE', 'Codigo de producto requerido');
    try {
      const product = await context.products.getByCode(code);
      if (!product) throw new HttpError(404, 'NOT_FOUND', 'Producto no encontrado');
      return { status: 200, body: product };
    } catch (err) {
      asSqlError(err, logger);
    }
  };

  const handleSync = async (): Promise<HttpResponse> => {
    if (context.sync.isRunning()) {
      throw new HttpError(409, 'SYNC_IN_PROGRESS', 'Ya hay una sincronizacion en curso');
    }
    try {
      const result = await context.sync.run();
      const status = result.status === 'SUCCESS' ? 200 : result.status === 'PARTIAL' ? 207 : 502;
      return { status, body: result };
    } catch (err) {
      if (err instanceof SyncAlreadyRunningError) {
        throw new HttpError(409, 'SYNC_IN_PROGRESS', err.message);
      }
      if (err instanceof SyncNotConfiguredError) {
        throw new HttpError(503, 'SYNC_NOT_CONFIGURED', err.message);
      }
      throw err;
    }
  };

  const handleSyncStatus = (): HttpResponse => ({
    status: 200,
    body: { running: context.sync.isRunning(), lastSync: context.sync.lastResult() },
  });

  const router = new Router()
    .add('GET', '/health', handleHealth)
    .add('GET', '/products', handleListProducts)
    .add('GET', '/products/meta', handleProductsMeta)
    .add('GET', '/products/:code', handleGetProduct)
    .add('POST', '/sync', handleSync)
    .add('GET', '/sync/status', handleSyncStatus);

  return createServer((req, res) => {
    void dispatch(req, res).catch((err: unknown) => {
      logger.error({ err: (err as Error).message }, 'Error fatal en el handler HTTP');
      if (!res.headersSent) {
        res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': JSON_CONTENT_TYPE });
      }
      res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }));
    });
  });

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const start = Date.now();
    const method = (req.method ?? 'GET').toUpperCase();
    const rawUrl = req.url ?? '/';
    const url = new URL(rawUrl, `http://${headerValue(req.headers.host) ?? 'localhost'}`);
    const pathname = normalizePath(url.pathname);

    const cors = evaluateCors(headerValue(req.headers.origin), allowedOrigins);
    const baseHeaders: Record<string, string> = {
      ...SECURITY_HEADERS,
      'Content-Type': JSON_CONTENT_TYPE,
      ...cors.headers,
    };

    const finish = (status: number, body: unknown, extra: Record<string, string> = {}): void => {
      const durationMs = Date.now() - start;
      if (status >= 500) logger.error({ method, path: pathname, status, durationMs }, 'HTTP');
      else if (status >= 400) logger.warn({ method, path: pathname, status, durationMs }, 'HTTP');
      else logger.debug({ method, path: pathname, status, durationMs }, 'HTTP');

      if (!res.headersSent) res.writeHead(status, { ...baseHeaders, ...extra });
      res.end(JSON.stringify(body));
    };

    try {
      if (method === 'OPTIONS') {
        res.writeHead(204, baseHeaders);
        res.end();
        return;
      }

      const isPublic = PUBLIC_PATHS.has(pathname);

      if (!isPublic) {
        const rate = limiter.check(clientIp(req));
        if (!rate.allowed) {
          finish(
            429,
            { error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes' } },
            { 'Retry-After': String(rate.retryAfterSeconds) },
          );
          return;
        }
      }

      const match = router.match(method, pathname);
      if (!match) {
        const allowed = router.allowedMethods(pathname);
        if (allowed.length > 0) {
          finish(
            405,
            { error: { code: 'METHOD_NOT_ALLOWED', message: 'Metodo no permitido' } },
            { Allow: allowed.join(', ') },
          );
          return;
        }
        finish(404, { error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } });
        return;
      }

      if (!isPublic) {
        const token = context.env.CONNECTOR_API_TOKEN;
        if (!token) {
          finish(503, {
            error: {
              code: 'AUTH_NOT_CONFIGURED',
              message: 'CONNECTOR_API_TOKEN no configurado: endpoint deshabilitado',
            },
          });
          return;
        }
        if (!isAuthorized(headerValue(req.headers.authorization), token)) {
          finish(
            401,
            { error: { code: 'UNAUTHORIZED', message: 'No autorizado' } },
            { 'WWW-Authenticate': 'Bearer' },
          );
          return;
        }
      }

      const body = await readJsonBody(req);
      const ctx: RequestContext = {
        method,
        pathname,
        query: url.searchParams,
        params: match.params,
        authorization: headerValue(req.headers.authorization),
        clientIp: clientIp(req),
        body,
        env: context.env,
      };
      const response = await match.handler(ctx);
      finish(response.status, response.body, response.headers ?? {});
    } catch (err) {
      if (!(err instanceof HttpError)) {
        logger.error(
          { method, path: pathname, err: (err as Error).message },
          'Error no controlado',
        );
      }
      const { status, body } = toErrorResponse(err);
      finish(status, body);
    }
  }
}
