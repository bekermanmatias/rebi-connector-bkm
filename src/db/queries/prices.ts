/** EXAMPLE: constructor de query de precios desde el mapping. */
import type { PricesMapping } from '../../mapping/types';
import { buildDatasetQuery, incrementalFilterFor, selectAlias, type DatasetQuery } from './base';
import type { DatasetQueryOptions } from './products';

export function buildPricesQuery(
  mapping: PricesMapping,
  options: DatasetQueryOptions = {},
): DatasetQuery {
  const expressions = [
    selectAlias(mapping.productIdColumn, 'productSourceId'),
    selectAlias(mapping.priceListIdColumn, 'priceListSourceId'),
    selectAlias(mapping.amountColumn, 'amount'),
    selectAlias(mapping.currencyColumn, 'currency'),
    selectAlias(mapping.taxIncludedColumn, 'taxIncluded'),
    options.extraUpdatedAtColumn
      ? selectAlias(options.extraUpdatedAtColumn, 'sourceUpdatedAt')
      : selectAlias(mapping.updatedAtColumn, 'sourceUpdatedAt'),
  ].filter((expr): expr is string => expr !== null);

  const orderColumns = [mapping.productIdColumn];
  if (mapping.priceListIdColumn) orderColumns.push(mapping.priceListIdColumn);

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
