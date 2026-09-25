import { toCleanString, toNumberOrNull } from '../util/misc';
import { productSchema, type ProductDto, type ProductRow } from './types';

/**
 * Normaliza una fila cruda de dbo.ProductoStock a ProductDto.
 *
 * - Aplica trim defensivo (ademas del RTRIM del SQL).
 * - Textos vacios -> null.
 * - `stock` conserva decimales.
 * - Devuelve null si no hay `code` (fila invalida, se descarta).
 */
export function mapProductRow(row: ProductRow): ProductDto | null {
  const code = toCleanString(row.code);
  if (!code) return null;

  return productSchema.parse({
    code,
    manufacturerCode: toCleanString(row.manufacturerCode),
    family: toCleanString(row.family),
    subfamily: toCleanString(row.subfamily),
    productGroup: toCleanString(row.productGroup),
    description: toCleanString(row.description) ?? '',
    brand: toCleanString(row.brand),
    unit: toCleanString(row.unit),
    stock: toNumberOrNull(row.stock) ?? 0,
    price: null,
    priceList: null,
    currency: null,
  });
}
