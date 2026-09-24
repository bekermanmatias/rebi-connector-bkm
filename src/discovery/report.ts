import { APP_VERSION } from '../config/constants';
import type { ForeignKeyInfo } from '../db/inspector';
import type { TableSample } from './sample-data';
import type { CandidateMatch } from './candidate-tables';

export interface DiscoveryColumn {
  name: string;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  isRowVersion: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  default: string | null;
}

export interface DiscoveryTable {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  rowCount: number | null;
  primaryKey: string[];
  columns: DiscoveryColumn[];
}

export interface DiscoveryConnection {
  server: string;
  port: number;
  database: string;
  user: string;
  connected: boolean;
  latencyMs: number | null;
  serverName: string | null;
  productVersion: string | null;
  edition: string | null;
  loginName: string | null;
  isReadOnly: boolean | null;
  readOnlyDetails: string | null;
}

export interface DiscoveryIncrementalColumn {
  schema: string;
  table: string;
  column: string;
  kind: 'rowversion' | 'datetime' | 'number';
}

export interface DiscoveryReport {
  generatedAt: string;
  connectorVersion: string;
  connection: DiscoveryConnection;
  summary: {
    tables: number;
    views: number;
    columns: number;
    primaryKeys: number;
    foreignKeys: number;
  };
  tables: DiscoveryTable[];
  foreignKeys: ForeignKeyInfo[];
  candidates: CandidateMatch[];
  incrementalColumns: DiscoveryIncrementalColumn[];
  samples: TableSample[];
  /** Sugerencia de mapping derivada por heuristica. REVISAR antes de usar. */
  suggestedMapping: unknown | null;
  warnings: string[];
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderMarkdown(report: DiscoveryReport): string {
  const lines: string[] = [];
  lines.push('# Discovery Report - NavaSoft (REPLICA READ ONLY)');
  lines.push('');
  lines.push(`Generado: ${report.generatedAt}`);
  lines.push(`Connector: v${report.connectorVersion}`);
  lines.push('');

  lines.push('## Conexion');
  lines.push('');
  const c = report.connection;
  lines.push(
    mdTable(
      ['Campo', 'Valor'],
      [
        ['Servidor', escapeCell(c.serverName ?? c.server)],
        ['Puerto', escapeCell(c.port)],
        ['Base de datos', escapeCell(c.database)],
        ['Usuario', escapeCell(c.loginName ?? c.user)],
        ['Conectado', c.connected ? 'si' : 'NO'],
        ['Latencia (ms)', escapeCell(c.latencyMs)],
        ['Version SQL', escapeCell(c.productVersion)],
        ['Edicion', escapeCell(c.edition)],
        [
          'READ ONLY',
          c.isReadOnly === true ? 'SI' : c.isReadOnly === false ? 'NO (revisar)' : 'indeterminado',
        ],
        ['Detalle permisos', escapeCell(c.readOnlyDetails)],
      ],
    ),
  );
  lines.push('');

  lines.push('## Resumen');
  lines.push('');
  const s = report.summary;
  lines.push(
    mdTable(
      ['Tablas', 'Vistas', 'Columnas', 'PK', 'FK'],
      [[s.tables, s.views, s.columns, s.primaryKeys, s.foreignKeys].map(String)],
    ),
  );
  lines.push('');

  lines.push('## Tablas y vistas');
  lines.push('');
  lines.push(
    mdTable(
      ['Schema', 'Nombre', 'Tipo', 'Filas (aprox)', 'PK'],
      report.tables.map((t) => [
        escapeCell(t.schema),
        escapeCell(t.name),
        t.type,
        t.rowCount === null ? 'n/d' : String(t.rowCount),
        escapeCell(t.primaryKey.join(', ') || '-'),
      ]),
    ),
  );
  lines.push('');

  lines.push('## Candidatos por categoria');
  lines.push('');
  lines.push('> Solo heuristica por nombre de tabla/columna. Confirmar antes de mapear.');
  lines.push('');
  if (report.candidates.length === 0) {
    lines.push('_Sin candidatos detectados._');
    lines.push('');
  } else {
    lines.push(
      mdTable(
        ['Categoria', 'Tabla', 'Score', 'Filas (aprox)', 'Coincidencias'],
        report.candidates
          .slice(0, 60)
          .map((m) => [
            m.category,
            `${m.schema}.${m.table}`,
            String(m.score),
            m.rowCount === null ? 'n/d' : String(m.rowCount),
            escapeCell(
              [...m.evidence.matchedNameTokens, ...m.evidence.matchedColumns]
                .slice(0, 10)
                .join(', '),
            ),
          ]),
      ),
    );
    lines.push('');
  }

  lines.push('## Columnas de modificacion / version (incremental)');
  lines.push('');
  if (report.incrementalColumns.length === 0) {
    lines.push('_No se detectaron columnas de fecha de modificacion ni rowversion._');
    lines.push('');
  } else {
    lines.push(
      mdTable(
        ['Tabla', 'Columna', 'Tipo'],
        report.incrementalColumns
          .slice(0, 80)
          .map((col) => [`${col.schema}.${col.table}`, col.column, col.kind]),
      ),
    );
    lines.push('');
  }

  lines.push('## Foreign keys');
  lines.push('');
  if (report.foreignKeys.length === 0) {
    lines.push('_No se detectaron foreign keys._');
    lines.push('');
  } else {
    lines.push(
      mdTable(
        ['Tabla', 'Columna', 'Referencia', 'Delete', 'Update'],
        report.foreignKeys
          .slice(0, 120)
          .map((fk) => [
            `${fk.parentSchema}.${fk.parentTable}`,
            fk.parentColumn,
            `${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}`,
            fk.deleteAction,
            fk.updateAction,
          ]),
      ),
    );
    lines.push('');
  }

  lines.push('## Muestras (limitadas y enmascaradas)');
  lines.push('');
  if (report.samples.length === 0) {
    lines.push('_No se tomaron muestras._');
    lines.push('');
  }
  for (const sample of report.samples) {
    lines.push(
      `### ${sample.schema}.${sample.table} (${sample.type}, ~${sample.rowCount ?? 'n/d'} filas)`,
    );
    lines.push('');
    if (sample.error) {
      lines.push(`> No se pudo muestrear: ${escapeCell(sample.error)}`);
      lines.push('');
      continue;
    }
    if (sample.maskedColumns.length > 0) {
      lines.push(`Columnas enmascaradas: ${sample.maskedColumns.join(', ')}`);
      lines.push('');
    }
    if (sample.rows.length === 0) {
      lines.push('_Sin filas._');
      lines.push('');
      continue;
    }
    const headers = Object.keys(sample.rows[0] ?? {});
    lines.push(
      mdTable(
        headers,
        sample.rows.map((row) => headers.map((header) => escapeCell(row[header]))),
      ),
    );
    lines.push('');
  }

  lines.push('## Mapping sugerido (EXAMPLE - REVISAR)');
  lines.push('');
  lines.push(
    '> Generado por heuristica a partir de los nombres de columna. NO usar sin revisarlo. ' +
      'Renombrar/ajustar y copiar a `config/mapping.json`.',
  );
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.suggestedMapping ?? {}, null, 2));
  lines.push('```');
  lines.push('');

  if (report.warnings.length > 0) {
    lines.push('## Advertencias');
    lines.push('');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('Reporte generado automaticamente. Revisar antes de configurar la sincronizacion.');
  lines.push('');
  return lines.join('\n');
}

export const DISCOVERY_CONNECTOR_VERSION = APP_VERSION;
