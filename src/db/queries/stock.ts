/** EXAMPLE: constructor de query de stock desde el mapping. */
import type { StockMapping } from '../../mapping/types';
import { buildDatasetQuery, incrementalFilterFor, selectAlias, type DatasetQuery } from './base';
import type { DatasetQueryOptions } from './products';

export function buildStockQuery(
  mapping: StockMapping,
  options: DatasetQueryOptions = {},
): DatasetQuery {
  const expressions = [
    selectAlias(mapping.productIdColumn, 'productSourceId'),
    selectAlias(mapping.warehouseIdColumn, 'warehouseSourceId'),
    selectAlias(mapping.physicalColumn, 'physical'),
    selectAlias(mapping.reservedColumn, 'reserved'),
    selectAlias(mapping.committedColumn, 'committed'),
    selectAlias(mapping.availableColumn, 'available'),
    selectAlias(mapping.quantityColumn, 'quantity'),
    options.extraUpdatedAtColumn
      ? selectAlias(options.extraUpdatedAtColumn, 'sourceUpdatedAt')
      : selectAlias(mapping.updatedAtColumn, 'sourceUpdatedAt'),
  ].filter((expr): expr is string => expr !== null);

  const orderColumns = [mapping.productIdColumn];
  if (mapping.warehouseIdColumn) orderColumns.push(mapping.warehouseIdColumn);

  return buildDatasetQuery({
    source: mapping.source,
    selectExpressions: expressions,
    orderColumns,
    filter: mapping.filter,
    incrementalFilter: options.incrementalColumn
      ? incrementalFilterFor(options.incrementalColumn, options.incrementalOperator ?? '>')
      : undefined,
  });
}
