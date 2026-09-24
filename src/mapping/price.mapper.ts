import { toBooleanOrNull, toCleanString, toIsoOrNull, toNumberOrNull } from '../util/misc';
import { priceSchema, type CanonicalPriceRow, type Price } from './types';

/**
 * Normaliza una fila cruda de precio. Devuelve null si falta el producto
 * o el monto (no se emite un precio sin importe).
 */
export function mapPriceRow(row: CanonicalPriceRow): Price | null {
  const productSourceId = toCleanString(row.productSourceId);
  if (!productSourceId) return null;
  const amount = toNumberOrNull(row.amount);
  if (amount === null) return null;

  return priceSchema.parse({
    productSourceId,
    priceListSourceId: toCleanString(row.priceListSourceId),
    amount,
    currency: toCleanString(row.currency),
    taxIncluded: toBooleanOrNull(row.taxIncluded),
    sourceUpdatedAt: toIsoOrNull(row.sourceUpdatedAt),
  } satisfies Price);
}
