import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { SyncResult } from '../bkm/types';
import { parseEnv, type Env } from '../config/env';
import { SyncNotConfiguredError } from '../bkm/sync-service';
import type { HttpContext } from './server';
import { createHttpServer } from './server';
import type {
  ProductDto,
  ProductListQuery,
  ProductPage,
  ProductsApi,
  ProductsMeta,
} from '../products/types';

const PRODUCT: ProductDto = {
  code: 'ABC123',
  manufacturerCode: 'NICOLL',
  family: 'FERRETERIA',
  subfamily: 'HERRAMIENTAS',
  productGroup: 'MANUAL',
  description: 'Tornillo',
  brand: 'NICOLL',
  unit: 'UN',
  stock: 12.5,
  price: null,
  priceList: null,
  currency: null,
};

const SYNC_OK: SyncResult = {
  syncId: 'sync-test',
  status: 'SUCCESS',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  durationMs: 1000,
  totalRead: 1,
  totalSent: 1,
  batches: 1,
  batchesSent: 1,
  batchesFailed: 0,
  success: true,
  error: null,
  errors: [],
};

interface Harness {
  base: string;
  close: () => Promise<void>;
  calls: { list: ProductListQuery[] };
}

const openServers: Server[] = [];

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface ApiError {
  error: { code: string; message: string };
}

afterEach(async () => {
  await Promise.all(
    openServers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function startHarness(options: {
  env?: Partial<Record<string, string>>;
  run?: () => Promise<SyncResult>;
  isRunning?: () => boolean;
  products?: Partial<ProductsApi>;
}): Promise<Harness> {
  const env: Env = parseEnv({
    CONNECTOR_API_TOKEN: 'secret-token',
    API_RATE_LIMIT_MAX: '1000',
    ...options.env,
  });
  const calls = { list: [] as ProductListQuery[] };

  const products: ProductsApi = {
    list: async (query) => {
      calls.list.push(query);
      const page: ProductPage = {
        page: query.page,
        limit: query.limit,
        total: 0,
        totalPages: 0,
        data: [],
      };
      return page;
    },
    getByCode: async (code) => (code === PRODUCT.code ? PRODUCT : null),
    meta: async (): Promise<ProductsMeta> => ({
      totalProducts: 1,
      productsInStock: 1,
      productsOutOfStock: 0,
      brands: ['NICOLL'],
      families: ['FERRETERIA'],
      lastReadAt: '2026-01-01T00:00:00.000Z',
    }),
    ...options.products,
  };

  const context: HttpContext = {
    env,
    products,
    sync: {
      run: options.run ?? (async () => SYNC_OK),
      isRunning: options.isRunning ?? (() => false),
      lastResult: () => null,
    },
    checkSql: async () => ({ connected: true, latencyMs: 2 }),
  };

  const server = createHttpServer(context);
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, calls, close: async () => {} };
}

describe('HTTP API', () => {
  it('GET /health es publico y no filtra secretos', async () => {
    const { base } = await startHarness({});
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.status).toBe('ok');
    expect(body.service).toBeTruthy();
    expect(body.version).toBeTruthy();
    expect(body.sql).toEqual({ connected: true, latencyMs: 2 });
    expect(raw).not.toContain('secret-token');
    expect(raw.toLowerCase()).not.toContain('password');
    expect(raw.toLowerCase()).not.toContain('sql_user');
  });

  it('GET /health reporta degraded si SQL esta caido', async () => {
    const { base } = await startHarness({
      products: {},
    });
    const server2 = createHttpServer({
      env: parseEnv({ CONNECTOR_API_TOKEN: 'secret-token' }),
      products: {
        list: async () => ({ page: 1, limit: 50, total: 0, totalPages: 0, data: [] }),
        getByCode: async () => null,
        meta: async () => ({
          totalProducts: 0,
          productsInStock: 0,
          productsOutOfStock: 0,
          brands: [],
          families: [],
          lastReadAt: null,
        }),
      },
      sync: { run: async () => SYNC_OK, isRunning: () => false, lastResult: () => null },
      checkSql: async () => ({ connected: false, latencyMs: null }),
    });
    openServers.push(server2);
    await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve));
    const { port } = server2.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect((await readJson<{ status: string }>(res)).status).toBe('degraded');
    expect(base).toBeTruthy();
  });

  it('protege /products con Bearer token', async () => {
    const { base } = await startHarness({});
    expect((await fetch(`${base}/products`)).status).toBe(401);
    expect(
      (await fetch(`${base}/products`, { headers: { Authorization: 'Bearer nope' } })).status,
    ).toBe(401);

    const ok = await fetch(`${base}/products`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(ok.status).toBe(200);
  });

  it('traduce los filtros de querystring a la consulta', async () => {
    const { base, calls } = await startHarness({});
    await fetch(`${base}/products?search=nicoll&inStock=true&page=2&limit=5&brand=NICOLL`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(calls.list[0]).toMatchObject({
      page: 2,
      limit: 5,
      search: 'nicoll',
      inStock: true,
      brand: 'NICOLL',
    });
  });

  it('GET /products/:code devuelve 200 o 404 limpio', async () => {
    const { base } = await startHarness({});
    const headers = { Authorization: 'Bearer secret-token' };
    const found = await fetch(`${base}/products/${PRODUCT.code}`, { headers });
    expect(found.status).toBe(200);
    expect((await readJson<{ code: string }>(found)).code).toBe(PRODUCT.code);

    const missing = await fetch(`${base}/products/NOEXISTE`, { headers });
    expect(missing.status).toBe(404);
    expect((await readJson<ApiError>(missing)).error.code).toBe('NOT_FOUND');
  });

  it('GET /products/meta devuelve conteos y no un lastUpdatedAt inventado', async () => {
    const { base } = await startHarness({});
    const res = await fetch(`${base}/products/meta`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ totalProducts: number; lastReadAt: string | null }>(res);
    expect(body.totalProducts).toBe(1);
    expect(body).not.toHaveProperty('lastUpdatedAt');
    expect(body.lastReadAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('POST /sync requiere token y devuelve 200 en exito', async () => {
    const { base } = await startHarness({});
    expect((await fetch(`${base}/sync`, { method: 'POST' })).status).toBe(401);

    const res = await fetch(`${base}/sync`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(res.status).toBe(200);
    expect((await readJson<{ status: string }>(res)).status).toBe('SUCCESS');
  });

  it('POST /sync responde 409 si ya hay una sync en curso', async () => {
    const { base } = await startHarness({ isRunning: () => true });
    const res = await fetch(`${base}/sync`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(res.status).toBe(409);
    expect((await readJson<ApiError>(res)).error.code).toBe('SYNC_IN_PROGRESS');
  });

  it('POST /sync responde 503 si BKM no esta configurada', async () => {
    const { base } = await startHarness({
      run: async () => {
        throw new SyncNotConfiguredError();
      },
    });
    const res = await fetch(`${base}/sync`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(res.status).toBe(503);
    expect((await readJson<ApiError>(res)).error.code).toBe('SYNC_NOT_CONFIGURED');
  });

  it('deshabilita endpoints protegidos si no hay CONNECTOR_API_TOKEN', async () => {
    const { base } = await startHarness({ env: { CONNECTOR_API_TOKEN: '' } });
    const res = await fetch(`${base}/products`, { headers: { Authorization: 'Bearer x' } });
    expect(res.status).toBe(503);
    expect((await readJson<ApiError>(res)).error.code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('responde 405 y 404 correctamente', async () => {
    const { base } = await startHarness({});
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('aplica CORS solo al origen permitido', async () => {
    const { base } = await startHarness({
      env: { CORS_ALLOWED_ORIGINS: 'https://bkm.example.com' },
    });
    const denied = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.com' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();

    const allowed = await fetch(`${base}/health`, {
      headers: { Origin: 'https://bkm.example.com' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://bkm.example.com');
  });

  it('mapea errores de SQL a 503 SQL_UNAVAILABLE sin stack', async () => {
    const { base } = await startHarness({
      products: {
        list: async () => {
          throw new Error('ConnectionError: failed to connect to localhost:1433');
        },
      },
    });
    const res = await fetch(`${base}/products`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(res.status).toBe(503);
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.error.code).toBe('SQL_UNAVAILABLE');
    expect(raw).not.toContain('1433');
    expect(raw).not.toContain('stack');
  });
});
