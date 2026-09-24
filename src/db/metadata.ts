import {
  listColumns,
  listForeignKeys,
  listPrimaryKeys,
  listTables,
  type ColumnInfo,
  type ForeignKeyInfo,
  type PrimaryKeyInfo,
  type TableInfo,
} from './inspector';

export interface DatabaseCatalog {
  generatedAt: string;
  tables: TableInfo[];
  columns: ColumnInfo[];
  primaryKeys: PrimaryKeyInfo[];
  foreignKeys: ForeignKeyInfo[];
  columnsByTable: Map<string, ColumnInfo[]>;
  pkByTable: Map<string, PrimaryKeyInfo>;
  fkByTable: Map<string, ForeignKeyInfo[]>;
}

export function tableKey(schema: string, table: string): string {
  return `${schema.toLowerCase()}.${table.toLowerCase()}`;
}

function indexCatalog(
  tables: TableInfo[],
  columns: ColumnInfo[],
  primaryKeys: PrimaryKeyInfo[],
  foreignKeys: ForeignKeyInfo[],
): Pick<DatabaseCatalog, 'columnsByTable' | 'pkByTable' | 'fkByTable'> {
  const columnsByTable = new Map<string, ColumnInfo[]>();
  for (const column of columns) {
    const key = tableKey(column.schema, column.table);
    const list = columnsByTable.get(key);
    if (list) list.push(column);
    else columnsByTable.set(key, [column]);
  }

  const pkByTable = new Map<string, PrimaryKeyInfo>();
  for (const pk of primaryKeys) {
    pkByTable.set(tableKey(pk.schema, pk.table), pk);
  }

  const fkByTable = new Map<string, ForeignKeyInfo[]>();
  for (const fk of foreignKeys) {
    const key = tableKey(fk.parentSchema, fk.parentTable);
    const list = fkByTable.get(key);
    if (list) list.push(fk);
    else fkByTable.set(key, [fk]);
  }

  return { columnsByTable, pkByTable, fkByTable };
}

/** Trae el catalogo completo de la replica en un solo barrido. */
export async function describeDatabase(): Promise<DatabaseCatalog> {
  const [tables, columns, primaryKeys, foreignKeys] = await Promise.all([
    listTables(),
    listColumns(),
    listPrimaryKeys(),
    listForeignKeys(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    tables,
    columns,
    primaryKeys,
    foreignKeys,
    ...indexCatalog(tables, columns, primaryKeys, foreignKeys),
  };
}

export function getColumnsFor(
  catalog: DatabaseCatalog,
  schema: string,
  table: string,
): ColumnInfo[] {
  return catalog.columnsByTable.get(tableKey(schema, table)) ?? [];
}

export function getPrimaryKeyFor(
  catalog: DatabaseCatalog,
  schema: string,
  table: string,
): PrimaryKeyInfo | null {
  return catalog.pkByTable.get(tableKey(schema, table)) ?? null;
}

/** Columnas timestamp/rowversion (utiles para estrategia incremental). */
export function getRowVersionColumns(catalog: DatabaseCatalog): ColumnInfo[] {
  return catalog.columns.filter((column) => column.isRowVersion);
}

/** Columnas con nombres tipicos de fecha de modificacion. */
export function getUpdatedAtCandidates(catalog: DatabaseCatalog): ColumnInfo[] {
  const pattern =
    /(fec(h)?(a)?_?(mod|act|actualiz)|updated?_?at|last_?modif|modif|timestamp|rowversion)/i;
  return catalog.columns.filter(
    (column) =>
      pattern.test(column.column) ||
      column.dataType === 'datetime' ||
      column.dataType === 'datetime2' ||
      column.dataType === 'smalldatetime' ||
      column.isRowVersion,
  );
}
