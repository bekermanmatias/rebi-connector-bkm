/** EXAMPLE: constructor de query para tablas diccionario (marca, familia, etc). */
import type { DictionaryMapping } from '../../mapping/types';
import { parseTableName, quoteIdentifier, quoteQualified } from '../sql-guard';
import { buildDatasetQuery, selectAlias, type DatasetQuery } from './base';

export function buildDictionaryQuery(mapping: DictionaryMapping): DatasetQuery {
  const expressions = [
    selectAlias(mapping.idColumn, 'sourceId'),
    selectAlias(mapping.nameColumn, 'name'),
    selectAlias(mapping.activeColumn, 'active'),
    selectAlias(mapping.updatedAtColumn, 'sourceUpdatedAt'),
  ].filter((expr): expr is string => expr !== null);

  return buildDatasetQuery({
    source: mapping.source,
    selectExpressions: expressions,
    orderColumns: [mapping.idColumn],
  });
}

/** SELECT simple de una columna (para chequeos de presencia). */
export function buildExistsQuery(source: string, idColumn: string): string {
  const { schema, table } = parseTableName(source);
  const qualified = schema ? quoteQualified(schema, table) : quoteIdentifier(table);
  return `SELECT TOP (1) ${quoteIdentifier(idColumn)} FROM ${qualified}`;
}
