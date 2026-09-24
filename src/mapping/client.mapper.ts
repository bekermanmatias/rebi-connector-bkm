import { toBooleanOrNull, toCleanString, toIsoOrNull } from '../util/misc';
import { customerSchema, type CanonicalCustomerRow, type Customer } from './types';

/**
 * Normaliza una fila cruda de cliente. Devuelve null si no hay id valido.
 * `businessName` es obligatorio en el contrato: si no viene, se usa taxId o el id.
 */
export function mapCustomerRow(row: CanonicalCustomerRow): Customer | null {
  const sourceId = toCleanString(row.sourceId);
  if (!sourceId) return null;

  const taxId = toCleanString(row.taxId);
  const businessName = toCleanString(row.businessName) ?? taxId ?? sourceId;

  return customerSchema.parse({
    sourceId,
    taxId,
    businessName,
    priceListSourceId: toCleanString(row.priceListSourceId),
    active: toBooleanOrNull(row.active),
    sourceUpdatedAt: toIsoOrNull(row.sourceUpdatedAt),
  } satisfies Customer);
}
