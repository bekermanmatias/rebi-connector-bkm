/** EXAMPLE: constructor de query de clientes desde el mapping. */
import type { ClientsMapping } from '../../mapping/types';
import { buildDatasetQuery, incrementalFilterFor, selectAlias, type DatasetQuery } from './base';
import type { DatasetQueryOptions } from './products';

export function buildClientsQuery(
  mapping: ClientsMapping,
  options: DatasetQueryOptions = {},
): DatasetQuery {
  const expressions = [
    selectAlias(mapping.idColumn, 'sourceId'),
    selectAlias(mapping.taxIdColumn, 'taxId'),
    selectAlias(mapping.businessNameColumn, 'businessName'),
    selectAlias(mapping.priceListIdColumn, 'priceListSourceId'),
    selectAlias(mapping.activeColumn, 'active'),
    options.extraUpdatedAtColumn
      ? selectAlias(options.extraUpdatedAtColumn, 'sourceUpdatedAt')
      : selectAlias(mapping.updatedAtColumn, 'sourceUpdatedAt'),
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
