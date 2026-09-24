import { z } from 'zod';
import { APP_VERSION } from '../config/constants';

/** Envelope comun de todos los batches. */
export const batchEnvelopeSchema = z.object({
  connectorId: z.string().min(1),
  clientId: z.string().min(1),
  dataset: z.string().min(1),
  sentAt: z.string().min(1),
  batchId: z.string().min(1),
  data: z.array(z.record(z.unknown())),
});

export type BatchEnvelope = z.infer<typeof batchEnvelopeSchema>;

export interface BatchEnvelopeInput {
  connectorId: string;
  clientId: string;
  dataset: string;
  batchId: string;
  data: unknown[];
  sentAt?: string;
}

export function buildBatchEnvelope(input: BatchEnvelopeInput): BatchEnvelope {
  return batchEnvelopeSchema.parse({
    connectorId: input.connectorId,
    clientId: input.clientId,
    dataset: input.dataset,
    sentAt: input.sentAt ?? new Date().toISOString(),
    batchId: input.batchId,
    data: input.data,
  });
}

export const heartbeatPayloadSchema = z.object({
  connectorId: z.string().min(1),
  clientId: z.string().min(1),
  timestamp: z.string().min(1),
  version: z.string().min(1),
  sqlConnected: z.boolean(),
  lastDbReadAt: z.string().nullable(),
  lastSuccessfulSyncAt: z.string().nullable(),
  queuePending: z.number().int().nonnegative(),
  memoryUsageMb: z.number().nonnegative(),
  uptimeSeconds: z.number().int().nonnegative(),
  replicaLastUpdateAt: z.string().nullable().optional(),
  replicaLagSeconds: z.number().nullable().optional(),
});

export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;

export { APP_VERSION };
