import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProductDto } from '../products/types';
import type { ProductSyncSource } from '../products/service';
import type { SendOutcome } from '../queue/queue';
import {
  buildBkmBatchEnvelope,
  ProductSyncService,
  SyncAlreadyRunningError,
  SyncNotConfiguredError,
} from './sync-service';
import type { BkmBatchEnvelope } from './types';

function makeProduct(code: string): ProductDto {
  return {
    code,
    manufacturerCode: null,
    family: null,
    subfamily: null,
    productGroup: null,
    description: `Producto ${code}`,
    brand: null,
    unit: 'UN',
    stock: 1.5,
    price: null,
    priceList: null,
    currency: null,
  };
}

function fakeSource(products: ProductDto[]): ProductSyncSource {
  return {
    count: async () => products.length,
    page: async (page, limit) => products.slice((page - 1) * limit, page * limit),
  };
}

class FakeClient {
  readonly envelopes: BkmBatchEnvelope[] = [];
  constructor(private readonly failIndexes: Set<number> = new Set()) {}

  async sendBatch(envelope: BkmBatchEnvelope): Promise<SendOutcome> {
    this.envelopes.push(envelope);
    if (this.failIndexes.has(envelope.batchIndex)) {
      return { ok: false, retryable: true, status: 500, error: 'boom' };
    }
    return { ok: true, retryable: false, status: 200 };
  }
}

const tempFiles: string[] = [];

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    if (existsSync(file)) rmSync(file, { force: true });
  }
});

function tempPath(): string {
  const path = join(
    tmpdir(),
    `last-sync-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  tempFiles.push(path);
  return path;
}

function buildService(
  products: ProductDto[],
  client: FakeClient | null,
  batchSize = 500,
): ProductSyncService {
  return new ProductSyncService({
    source: fakeSource(products),
    client,
    batchSize,
    connectorId: 'cooperacion-navasoft',
    clientId: 'cooperacion-peru',
    lastSyncPath: tempPath(),
  });
}

describe('ProductSyncService', () => {
  it('sincroniza en lotes y reporta SUCCESS', async () => {
    const products = [makeProduct('A'), makeProduct('B'), makeProduct('C')];
    const client = new FakeClient();
    const result = await buildService(products, client, 2).run();

    expect(result.status).toBe('SUCCESS');
    expect(result.success).toBe(true);
    expect(result.totalRead).toBe(3);
    expect(result.totalSent).toBe(3);
    expect(result.batches).toBe(2);
    expect(result.batchesFailed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(client.envelopes).toHaveLength(2);
  });

  it('arma el envelope con idempotencia por code y sin borrados', () => {
    const envelope = buildBkmBatchEnvelope({
      connectorId: 'cooperacion-navasoft',
      clientId: 'cooperacion-peru',
      syncId: 'sync-1',
      batchIndex: 0,
      totalBatches: 1,
      data: [makeProduct('A')],
      batchId: 'batch-1',
      sentAt: '2026-01-01T00:00:00.000Z',
    });
    expect(envelope.dataset).toBe('products');
    expect(envelope.mode).toBe('upsert');
    expect(envelope.allowDeletions).toBe(false);
    expect(envelope.data[0]?.code).toBe('A');
    expect(envelope.batchId).toBe('batch-1');
  });

  it('marca PARTIAL cuando un batch falla y otro se envia', async () => {
    const products = [makeProduct('A'), makeProduct('B'), makeProduct('C')];
    const client = new FakeClient(new Set([1]));
    const result = await buildService(products, client, 2).run();

    expect(result.status).toBe('PARTIAL');
    expect(result.success).toBe(false);
    expect(result.totalSent).toBe(2);
    expect(result.batchesFailed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.batchIndex).toBe(1);
  });

  it('marca FAILED cuando todos los batches fallan', async () => {
    const products = [makeProduct('A'), makeProduct('B')];
    const client = new FakeClient(new Set([0]));
    const result = await buildService(products, client, 5).run();

    expect(result.status).toBe('FAILED');
    expect(result.success).toBe(false);
    expect(result.totalSent).toBe(0);
    expect(result.batchesSent).toBe(0);
  });

  it('rechaza una segunda sincronizacion simultanea', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = {
      async sendBatch(): Promise<SendOutcome> {
        await gate;
        return { ok: true, retryable: false, status: 200 };
      },
    };
    const service = new ProductSyncService({
      source: fakeSource([makeProduct('A')]),
      client,
      batchSize: 10,
      connectorId: 'c',
      clientId: 'cl',
      lastSyncPath: tempPath(),
    });

    const first = service.run();
    await Promise.resolve();
    await expect(service.run()).rejects.toBeInstanceOf(SyncAlreadyRunningError);
    release();
    await first;
    expect(service.isRunning()).toBe(false);
  });

  it('falla con error tipado si BKM no esta configurada', async () => {
    const service = buildService([makeProduct('A')], null);
    await expect(service.run()).rejects.toBeInstanceOf(SyncNotConfiguredError);
  });

  it('persiste el ultimo resumen de sync', async () => {
    const path = tempPath();
    const service = new ProductSyncService({
      source: fakeSource([makeProduct('A')]),
      client: new FakeClient(),
      batchSize: 10,
      connectorId: 'c',
      clientId: 'cl',
      lastSyncPath: path,
    });
    const result = await service.run();
    const reloaded = new ProductSyncService({
      source: fakeSource([]),
      client: null,
      batchSize: 10,
      connectorId: 'c',
      clientId: 'cl',
      lastSyncPath: path,
    });
    expect(reloaded.lastResult()?.syncId).toBe(result.syncId);
    expect(existsSync(path)).toBe(true);
  });
});
