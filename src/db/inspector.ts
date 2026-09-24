import { DEFAULT_SAMPLE_LIMIT } from '../config/constants';
import { runQuery } from './connection';
import { parseTableName, quoteIdentifier, quoteQualified } from './sql-guard';

export type ObjectType = 'TABLE' | 'VIEW';

export interface TableInfo {
  schema: string;
  name: string;
  type: ObjectType;
  rowCount: number | null;
}

export interface ColumnInfo {
  schema: string;
  table: string;
  ordinal: number;
  column: string;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  isRowVersion: boolean;
  defaultDefinition: string | null;
}

export interface PrimaryKeyInfo {
  schema: string;
  table: string;
  constraintName: string;
  columns: string[];
}

export interface ForeignKeyInfo {
  name: string;
  parentSchema: string;
  parentTable: string;
  parentColumn: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
  updateAction: string;
  deleteAction: string;
}

const TABLES_QUERY = `
SELECT
  s.name AS schemaName,
  o.name AS tableName,
  o.type AS objectType,
  CAST(ISNULL(SUM(p.rows), 0) AS bigint) AS rowCount
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
LEFT JOIN sys.partitions p ON p.object_id = o.object_id AND p.index_id IN (0, 1)
WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
GROUP BY s.name, o.name, o.type
ORDER BY s.name, o.name
`;

interface TableRow {
  schemaName: string;
  tableName: string;
  objectType: string;
  rowCount: number | string | null;
}

export async function listTables(): Promise<TableInfo[]> {
  const { rows } = await runQuery<TableRow>(TABLES_QUERY);
  return rows.map((row) => ({
    schema: row.schemaName,
    name: row.tableName,
    type: row.objectType === 'V' ? 'VIEW' : 'TABLE',
    rowCount: row.rowCount === null ? null : Number(row.rowCount),
  }));
}

const COLUMNS_QUERY = `
SELECT
  s.name AS schemaName,
  o.name AS tableName,
  o.type AS objectType,
  c.column_id AS ordinal,
  c.name AS columnName,
  ty.name AS dataType,
  c.max_length AS maxLength,
  c.precision AS precision,
  c.scale AS scale,
  c.is_nullable AS isNullable,
  c.is_identity AS isIdentity,
  c.is_computed AS isComputed,
  dc.definition AS defaultDefinition
FROM sys.columns c
JOIN sys.objects o ON o.object_id = c.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc
  ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
ORDER BY s.name, o.name, c.column_id
`;

interface ColumnRow {
  schemaName: string;
  tableName: string;
  columnName: string;
  ordinal: number;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isNullable: boolean | number;
  isIdentity: boolean | number;
  isComputed: boolean | number;
  defaultDefinition: string | null;
}

const truthy = (value: boolean | number | null | undefined): boolean =>
  value === true || value === 1;

export async function listColumns(filter?: {
  schema?: string | null;
  table?: string | null;
}): Promise<ColumnInfo[]> {
  const { rows } = await runQuery<ColumnRow>(COLUMNS_QUERY);
  return rows
    .filter((row) => {
      if (filter?.schema && row.schemaName.toLowerCase() !== filter.schema.toLowerCase())
        return false;
      if (filter?.table && row.tableName.toLowerCase() !== filter.table.toLowerCase()) return false;
      return true;
    })
    .map((row) => ({
      schema: row.schemaName,
      table: row.tableName,
      ordinal: row.ordinal,
      column: row.columnName,
      dataType: row.dataType,
      maxLength: row.maxLength,
      precision: row.precision,
      scale: row.scale,
      nullable: truthy(row.isNullable),
      isIdentity: truthy(row.isIdentity),
      isComputed: truthy(row.isComputed),
      isRowVersion: row.dataType === 'timestamp' || row.dataType === 'rowversion',
      defaultDefinition: row.defaultDefinition,
    }));
}

const PK_QUERY = `
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  kc.name AS constraintName,
  c.name AS columnName,
  ic.key_ordinal AS keyOrdinal
FROM sys.key_constraints kc
JOIN sys.tables t ON t.object_id = kc.parent_object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.index_columns ic
  ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE kc.type = 'PK'
ORDER BY s.name, t.name, ic.key_ordinal
`;

interface PkRow {
  schemaName: string;
  tableName: string;
  constraintName: string;
  columnName: string;
  keyOrdinal: number;
}

export async function listPrimaryKeys(filter?: {
  schema?: string | null;
  table?: string | null;
}): Promise<PrimaryKeyInfo[]> {
  const { rows } = await runQuery<PkRow>(PK_QUERY);
  const map = new Map<string, PrimaryKeyInfo>();
  for (const row of rows) {
    if (filter?.schema && row.schemaName.toLowerCase() !== filter.schema.toLowerCase()) continue;
    if (filter?.table && row.tableName.toLowerCase() !== filter.table.toLowerCase()) continue;
    const key = `${row.schemaName}.${row.tableName}`;
    const existing = map.get(key);
    if (existing) {
      existing.columns.push(row.columnName);
    } else {
      map.set(key, {
        schema: row.schemaName,
        table: row.tableName,
        constraintName: row.constraintName,
        columns: [row.columnName],
      });
    }
  }
  return [...map.values()];
}

const FK_QUERY = `
SELECT
  fk.name AS constraintName,
  ps.name AS parentSchema,
  pt.name AS parentTable,
  pc.name AS parentColumn,
  rs.name AS referencedSchema,
  rt.name AS referencedTable,
  rc.name AS referencedColumn,
  fk.update_referential_action_desc AS updateAction,
  fk.delete_referential_action_desc AS deleteAction
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
ORDER BY ps.name, pt.name, fk.name, fkc.constraint_column_id
`;

interface FkRow {
  constraintName: string;
  parentSchema: string;
  parentTable: string;
  parentColumn: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
  updateAction: string;
  deleteAction: string;
}

export async function listForeignKeys(filter?: {
  schema?: string | null;
  table?: string | null;
}): Promise<ForeignKeyInfo[]> {
  const { rows } = await runQuery<FkRow>(FK_QUERY);
  return rows
    .filter((row) => {
      if (filter?.schema && row.parentSchema.toLowerCase() !== filter.schema.toLowerCase())
        return false;
      if (filter?.table && row.parentTable.toLowerCase() !== filter.table.toLowerCase())
        return false;
      return true;
    })
    .map((row) => ({
      name: row.constraintName,
      parentSchema: row.parentSchema,
      parentTable: row.parentTable,
      parentColumn: row.parentColumn,
      referencedSchema: row.referencedSchema,
      referencedTable: row.referencedTable,
      referencedColumn: row.referencedColumn,
      updateAction: row.updateAction,
      deleteAction: row.deleteAction,
    }));
}

export interface SampleResult {
  schema: string;
  table: string;
  limit: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

/**
 * Muestra segura de filas: SELECT TOP (@limit) * FROM [schema].[tabla].
 * El limite va parametrizado y los identificadores se citan.
 */
export async function sampleTable(
  schema: string,
  table: string,
  limit = DEFAULT_SAMPLE_LIMIT,
): Promise<SampleResult> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  const qualified = quoteQualified(schema, table);
  const text = `SELECT TOP (@limit) * FROM ${qualified}`;
  const { rows } = await runQuery<Record<string, unknown>>(text, { limit: safeLimit });
  return {
    schema,
    table,
    limit: safeLimit,
    columns: rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [],
    rows,
  };
}

/** Resuelve un nombre `schema.tabla` o `tabla` a un schema+tabla existente. */
export async function resolveTable(
  input: string,
  tables: TableInfo[],
): Promise<{ schema: string; table: string } | null> {
  const parsed = parseTableName(input);
  if (parsed.schema) {
    const found = tables.find(
      (t) =>
        t.schema.toLowerCase() === parsed.schema?.toLowerCase() &&
        t.name.toLowerCase() === parsed.table.toLowerCase(),
    );
    return found ? { schema: found.schema, table: found.name } : null;
  }
  const matches = tables.filter((t) => t.name.toLowerCase() === parsed.table.toLowerCase());
  if (matches.length === 0) return null;
  // Preferir dbo si hay ambiguedad.
  const preferred = matches.find((t) => t.schema.toLowerCase() === 'dbo') ?? matches[0];
  return preferred ? { schema: preferred.schema, table: preferred.name } : null;
}

export { quoteIdentifier, quoteQualified };
