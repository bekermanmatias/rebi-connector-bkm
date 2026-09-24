import {
  assertSafeSqlFragment,
  parseTableName,
  quoteIdentifier,
  quoteQualified,
} from '../sql-guard';

/**
 * Helpers para construir queries de lectura a partir del mapping.
 * Toda columna/tabla se cita; los valores nunca se interpolan (se bindean).
 */

export interface DatasetQuery {
  /** SELECT paginado con OFFSET/FETCH. Usa binds @offset y @pageSize. */
  sql: string;
  /** COUNT_BIG(*) con los mismos filtros. */
  countSql: string;
  /** Columnas por las que se ordena (para paginacion determinista). */
  orderColumns: string[];
}

export interface BuildOptions {
  source: string;
  /** Expresiones SELECT ya armadas (con alias). */
  selectExpressions: string[];
  /** Columnas de orden (nombres reales, sin citar). Debe haber al menos una. */
  orderColumns: string[];
  /** Filtro base del mapping (fragmento sin WHERE). */
  filter?: string;
  /** Filtro incremental seguro (ej: "[FECHA_MOD] > @since"). */
  incrementalFilter?: string;
}

function buildWhereClause(options: BuildOptions): string {
  const parts: string[] = [];
  if (options.filter) {
    assertSafeSqlFragment(options.filter, 'mapping.filter');
    parts.push(`(${options.filter})`);
  }
  if (options.incrementalFilter) {
    assertSafeSqlFragment(options.incrementalFilter, 'filtro incremental');
    parts.push(`(${options.incrementalFilter})`);
  }
  return parts.length > 0 ? `\nWHERE ${parts.join('\n  AND ')}` : '';
}

/** Arma `[col] AS [alias]`, o null si no hay columna. */
export function selectAlias(column: string | undefined, alias: string): string | null {
  if (!column) return null;
  return `${quoteIdentifier(column)} AS ${quoteIdentifier(alias)}`;
}

export function buildDatasetQuery(options: BuildOptions): DatasetQuery {
  if (options.selectExpressions.length === 0) {
    throw new Error('buildDatasetQuery: se requiere al menos una columna de seleccion.');
  }
  if (options.orderColumns.length === 0) {
    throw new Error('buildDatasetQuery: se requiere al menos una columna de orden.');
  }

  const { schema, table } = parseTableName(options.source);
  const qualified = schema ? quoteQualified(schema, table) : quoteIdentifier(table);
  const where = buildWhereClause(options);
  const orderBy = options.orderColumns.map((column) => quoteIdentifier(column)).join(', ');

  const sql = `SELECT
  ${options.selectExpressions.join(',\n  ')}
FROM ${qualified}${where}
ORDER BY ${orderBy}
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`;

  const countSql = `SELECT COUNT_BIG(*) AS total FROM ${qualified}${where}`;

  return { sql, countSql, orderColumns: options.orderColumns };
}

/** Filtro incremental parametrizado (siempre con @since bindeado). */
export function incrementalFilterFor(column: string, operator: '>' | '>='): string {
  return `${quoteIdentifier(column)} ${operator} @since`;
}
