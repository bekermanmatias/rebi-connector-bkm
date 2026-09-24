/**
 * EXAMPLE: constructor de query de productos a partir del mapping.
 * No contiene nombres reales de NavaSoft: todo sale de config/mapping.json.
 */
import type { ProductsMapping } from '../../mapping/types';
import { buildDatasetQuery, incrementalFilterFor, selectAlias, type DatasetQuery } from './base';

export interface DatasetQueryOptions {
  incrementalColumn?: string | null;
  incrementalOperator?: '>' | '>=';
  /** Columna alternativa (rowversion/watermark) a exponer como sourceUpdatedAt. */
  extraUpdatedAtColumn?: string | null;
}

function selectUpdatedAt(
  mapping: { updatedAtColumn?: string },
  options: DatasetQueryOptions,
): string | null {
  if (options.extraUpdatedAtColumn)
    return selectAlias(options.extraUpdatedAtColumn, 'sourceUpdatedAt');
  return selectAlias(mapping.updatedAtColumn, 'sourceUpdatedAt');
}

export function buildProductsQuery(
  mapping: ProductsMapping,
  options: DatasetQueryOptions = {},
): DatasetQuery {
  const expressions = [
    selectAlias(mapping.idColumn, 'sourceId'),
    selectAlias(mapping.skuColumn, 'sku'),
    selectAlias(mapping.barcodeColumn, 'barcode'),
    selectAlias(mapping.nameColumn, 'name'),
    selectAlias(mapping.descriptionColumn, 'description'),
    selectAlias(mapping.brandIdColumn, 'brandId'),
    selectAlias(mapping.brandNameColumn, 'brandName'),
    selectAlias(mapping.familyIdColumn, 'familyId'),
    selectAlias(mapping.familyNameColumn, 'familyName'),
    selectAlias(mapping.subfamilyIdColumn, 'subfamilyId'),
    selectAlias(mapping.subfamilyNameColumn, 'subfamilyName'),
    selectAlias(mapping.groupIdColumn, 'groupId'),
    selectAlias(mapping.groupNameColumn, 'groupName'),
    selectAlias(mapping.unitIdColumn, 'unitId'),
    selectAlias(mapping.unitColumn, 'unit'),
    selectAlias(mapping.activeColumn, 'active'),
    selectUpdatedAt(mapping, options),
  ].filter((expr): expr is string => expr !== null);

  return buildDatasetQuery({
    source: mapping.source,
    selectExpressions: expressions,
    orderColumns: [mapping.idColumn],
    filter: mapping.filter,
    incrementalFilter: options.incrementalColumn
      ? incrementalFilterFor(options.incrementalColumn, options.incrementalOperator ?? '>')
      : undefined,
  });
}
