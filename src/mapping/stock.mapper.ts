import { toCleanString, toIsoOrNull, toNumberOrNull } from '../util/misc';
import { stockSchema, type CanonicalStockRow, type Stock } from './types';

/**
 * Normaliza una fila cruda de stock. Devuelve null si no hay productSourceId.
 * Si el mapping define `quantityColumn`, se usa como cantidad fisica.
 */
export function mapStockRow(row: CanonicalStockRow): Stock | null {
  const productSourceId = toCleanString(row.productSourceId);
  if (!productSourceId) return null;

  const quantity = toNumberOrNull(row.quantity);
  const physical = toNumberOrNull(row.physical) ?? quantity;
  const reserved = toNumberOrNull(row.reserved);
  const committed = toNumberOrNull(row.committed);
  let available = toNumberOrNull(row.available);
  // `available` no se inventa: solo se calcula si no viene explicito y hay datos.
  if (available === null && physical !== null) {
    const deductions = [reserved, committed].filter((n): n is number => n !== null);
    if (deductions.length > 0) {
      available = physical - deductions.reduce((acc, n) => acc + n, 0);
    }
  }

  return stockSchema.parse({
    productSourceId,
    warehouseSourceId: toCleanString(row.warehouseSourceId),
    physical,
    reserved,
    committed,
    available,
    sourceUpdatedAt: toIsoOrNull(row.sourceUpdatedAt),
  } satisfies Stock);
}
