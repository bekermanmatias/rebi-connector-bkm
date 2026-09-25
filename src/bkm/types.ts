import { z } from 'zod';
import { productSchema } from '../products/types';

/**
 * Contrato de envio hacia la API BKM.
 *
 * Idempotencia: el destino identifica cada producto por `code`. Reenviar el
 * mismo `code` debe ser un upsert, no un duplicado.
 *
 * Reconciliacion: HOY el connector nunca elimina productos del destino. El
 * envelope declara explicitamente `mode: "upsert"` y `allowDeletions: false`
 * para que una sincronizacion futura de borrados sea opt-in y explicita.
 */
export const bkmBatchEnvelopeSchema = z.object({
  connectorId: z.string().min(1),
  clientId: z.string().min(1),
  dataset: z.literal('products'),
  syncId: z.string().min(1),
  batchId: z.string().min(1),
  batchIndex: z.number().int().min(0),
  totalBatches: z.number().int().min(1),
  sentAt: z.string().min(1),
  mode: z.literal('upsert'),
  allowDeletions: z.literal(false),
  data: z.array(productSchema),
});

export type BkmBatchEnvelope = z.infer<typeof bkmBatchEnvelopeSchema>;

export type SyncStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface SyncBatchError {
  batchIndex: number;
  batchId: string;
  status?: number;
  error: string;
}

/** Resumen de una sincronizacion de productos. Se persiste y se expone por HTTP. */
export interface SyncResult {
  syncId: string;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalRead: number;
  totalSent: number;
  batches: number;
  batchesSent: number;
  batchesFailed: number;
  success: boolean;
  error: string | null;
  errors: SyncBatchError[];
}
