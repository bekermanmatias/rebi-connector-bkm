import { describe, expect, it } from 'vitest';
import { buildBatchEnvelope, heartbeatPayloadSchema } from './payloads';

describe('payloads', () => {
  it('construye y valida un batch', () => {
    const envelope = buildBatchEnvelope({
      connectorId: 'c',
      clientId: 'cl',
      dataset: 'products',
      batchId: 'b',
      data: [{ sourceId: '1' }],
    });
    expect(envelope.connectorId).toBe('c');
    expect(envelope.data).toHaveLength(1);
    expect(typeof envelope.sentAt).toBe('string');
  });

  it('valida el heartbeat', () => {
    const payload = {
      connectorId: 'c',
      clientId: 'cl',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      sqlConnected: true,
      lastDbReadAt: null,
      lastSuccessfulSyncAt: null,
      queuePending: 0,
      memoryUsageMb: 12.5,
      uptimeSeconds: 10,
    };
    expect(heartbeatPayloadSchema.safeParse(payload).success).toBe(true);
    expect(heartbeatPayloadSchema.safeParse({ ...payload, version: undefined }).success).toBe(
      false,
    );
    expect(heartbeatPayloadSchema.safeParse({ ...payload, queuePending: -1 }).success).toBe(false);
  });
});
