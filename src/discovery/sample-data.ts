import type { ColumnInfo, TableInfo } from '../db/inspector';
import { sampleTable } from '../db/inspector';
import { getColumnsFor, getPrimaryKeyFor, type DatabaseCatalog } from '../db/metadata';

/** Columnas que nunca se vuelcan completas en el reporte. */
const SENSITIVE_PATTERNS =
  /(ruc|dni|cedula|documento|nro_?doc|num_?doc|pasaporte|telefono|tel[eé]fono|celular|movil|email|correo|direccion|domicilio|contacto|apellido|razon_?social|password|contrasena|clave|secreto|tarjeta|cuenta|banco)/i;

export function isSensitiveColumn(columnName: string): boolean {
  return SENSITIVE_PATTERNS.test(columnName);
}

/** Enmascara un valor: deja solo los primeros 2 caracteres. */
export function maskValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  if (text.length <= 2) return '**';
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(8, Math.max(3, text.length - 2)))}`;
}

export interface SampleColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  sensitive: boolean;
}

export interface TableSample {
  schema: string;
  table: string;
  type: TableInfo['type'];
  rowCount: number | null;
  limit: number;
  maskedColumns: string[];
  columns: SampleColumn[];
  rows: Record<string, unknown>[];
  error: string | null;
}

/** Convierte valores a algo serializable en JSON. */
function toSerializable(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function toSampleColumns(
  columns: ColumnInfo[],
  primaryKeyColumns: string[],
): SampleColumn[] {
  const pkSet = new Set(primaryKeyColumns.map((c) => c.toLowerCase()));
  return columns.map((column) => ({
    name: column.column,
    dataType: column.dataType,
    nullable: column.nullable,
    isPrimaryKey: pkSet.has(column.column.toLowerCase()),
    sensitive: isSensitiveColumn(column.column),
  }));
}

/**
 * Toma una muestra limitada y segura de una tabla.
 * Si `mask` es true, enmascara columnas sensibles.
 */
export async function collectSample(
  catalog: DatabaseCatalog,
  table: TableInfo,
  limit: number,
  mask = true,
): Promise<TableSample> {
  const columns = getColumnsFor(catalog, table.schema, table.name);
  const pk = getPrimaryKeyFor(catalog, table.schema, table.name);
  const sampleColumns = toSampleColumns(columns, pk?.columns ?? []);
  const maskedColumns = mask ? sampleColumns.filter((c) => c.sensitive).map((c) => c.name) : [];

  try {
    const result = await sampleTable(table.schema, table.name, limit);
    const rows = result.rows.map((row) => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        clean[key] = mask && isSensitiveColumn(key) ? maskValue(value) : toSerializable(value);
      }
      return clean;
    });
    return {
      schema: table.schema,
      table: table.name,
      type: table.type,
      rowCount: table.rowCount,
      limit: result.limit,
      maskedColumns,
      columns: sampleColumns,
      rows,
      error: null,
    };
  } catch (err) {
    return {
      schema: table.schema,
      table: table.name,
      type: table.type,
      rowCount: table.rowCount,
      limit,
      maskedColumns,
      columns: sampleColumns,
      rows: [],
      error: (err as Error).message,
    };
  }
}
