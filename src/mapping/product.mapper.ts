import { toCleanString, toBooleanOrNull, toIsoOrNull } from '../util/misc';
import { productSchema, type Brand, type CanonicalProductRow, type Product } from './types';

export interface ProductMapperContext {
  dictionaries?: {
    brands?: Map<string, string>;
    families?: Map<string, string>;
    subfamilies?: Map<string, string>;
    groups?: Map<string, string>;
    units?: Map<string, string>;
  };
}

function resolveName(
  id: string | null,
  explicitName: string | null,
  dictionary: Map<string, string> | undefined,
): string | null {
  if (explicitName) return explicitName;
  if (id && dictionary) return dictionary.get(id) ?? null;
  return null;
}

export function buildBrand(id: string | null, name: string | null): Brand | null {
  if (!id && !name) return null;
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
  };
}

/**
 * Normaliza una fila cruda de producto. Devuelve null si no hay id valido.
 */
export function mapProductRow(
  row: CanonicalProductRow,
  context: ProductMapperContext = {},
): Product | null {
  const sourceId = toCleanString(row.sourceId);
  if (!sourceId) return null;

  const sku = toCleanString(row.sku);
  const description = toCleanString(row.description);
  const name = toCleanString(row.name) ?? description ?? sku ?? sourceId;

  const brandId = toCleanString(row.brandId);
  const brandName = resolveName(
    brandId,
    toCleanString(row.brandName),
    context.dictionaries?.brands,
  );

  const familyId = toCleanString(row.familyId);
  const family =
    resolveName(familyId, toCleanString(row.familyName), context.dictionaries?.families) ??
    familyId;

  const subfamilyId = toCleanString(row.subfamilyId);
  const subfamily =
    resolveName(subfamilyId, toCleanString(row.subfamilyName), context.dictionaries?.subfamilies) ??
    subfamilyId;

  const groupId = toCleanString(row.groupId);
  const group =
    resolveName(groupId, toCleanString(row.groupName), context.dictionaries?.groups) ?? groupId;

  const unitId = toCleanString(row.unitId);
  const unit = resolveName(unitId, toCleanString(row.unit), context.dictionaries?.units) ?? unitId;

  return productSchema.parse({
    sourceId,
    sku,
    barcode: toCleanString(row.barcode),
    name,
    description,
    brand: buildBrand(brandId, brandName),
    family,
    subfamily,
    group,
    unit,
    active: toBooleanOrNull(row.active),
    sourceUpdatedAt: toIsoOrNull(row.sourceUpdatedAt),
  });
}
