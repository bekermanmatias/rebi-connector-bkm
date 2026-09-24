import { join } from 'node:path';
import {
  APP_VERSION,
  DEFAULT_DISCOVERY_DIR,
  DEFAULT_DISCOVERY_SAMPLE_LIMIT,
} from '../config/constants';
import { checkConnection } from '../db/health';
import type { ColumnInfo, TableInfo } from '../db/inspector';
import { getColumnsFor, getPrimaryKeyFor, type DatabaseCatalog } from '../db/metadata';
import { describeDatabase } from '../db/metadata';
import { closePool } from '../db/connection';
import { getLogger } from '../logger';
import { writeJsonAtomic, writeTextAtomic, ensureDir } from '../util/fs-atomic';
import {
  findCandidates,
  findIncrementalColumns,
  type CandidateCategory,
  type DiscoveryCandidates,
} from './candidate-tables';
import {
  renderMarkdown,
  type DiscoveryColumn,
  type DiscoveryReport,
  type DiscoveryTable,
} from './report';
import { collectSample, type TableSample } from './sample-data';

export interface DiscoveryOptions {
  outDir?: string;
  sampleLimit?: number;
  maskSensitive?: boolean;
  /** Maximo de tablas a muestrear. */
  maxSamples?: number;
}

export interface DiscoveryRunResult {
  report: DiscoveryReport;
  jsonPath: string;
  markdownPath: string;
}

const SAMPLE_CATEGORY_ORDER: CandidateCategory[] = [
  'products',
  'stock',
  'prices',
  'priceLists',
  'clients',
  'brands',
  'families',
  'subfamilies',
  'groups',
  'units',
  'warehouses',
];

function buildTableEntries(catalog: DatabaseCatalog): DiscoveryTable[] {
  return catalog.tables.map((table) => {
    const columns = getColumnsFor(catalog, table.schema, table.name);
    const pk = getPrimaryKeyFor(catalog, table.schema, table.name);
    const pkSet = new Set((pk?.columns ?? []).map((c) => c.toLowerCase()));
    const fkColumns = new Set(
      (
        catalog.fkByTable.get(`${table.schema.toLowerCase()}.${table.name.toLowerCase()}`) ?? []
      ).map((fk) => fk.parentColumn.toLowerCase()),
    );
    const discoveryColumns: DiscoveryColumn[] = columns.map((column) => ({
      name: column.column,
      dataType: column.dataType,
      maxLength: column.maxLength,
      precision: column.precision,
      scale: column.scale,
      nullable: column.nullable,
      isIdentity: column.isIdentity,
      isComputed: column.isComputed,
      isRowVersion: column.isRowVersion,
      isPrimaryKey: pkSet.has(column.column.toLowerCase()),
      isForeignKey: fkColumns.has(column.column.toLowerCase()),
      default: column.defaultDefinition,
    }));
    return {
      schema: table.schema,
      name: table.name,
      type: table.type,
      rowCount: table.rowCount,
      primaryKey: pk?.columns ?? [],
      columns: discoveryColumns,
    };
  });
}

function findColumn(
  columns: ColumnInfo[],
  include: RegExp[],
  exclude: RegExp[] = [],
): string | undefined {
  const match = columns.find(
    (column) =>
      include.some((pattern) => pattern.test(column.column)) &&
      !exclude.some((pattern) => pattern.test(column.column)),
  );
  return match?.column;
}

function pickIdColumn(catalog: DatabaseCatalog, table: TableInfo): string {
  const pk = getPrimaryKeyFor(catalog, table.schema, table.name);
  if (pk && pk.columns.length > 0) return pk.columns[0] as string;
  const columns = getColumnsFor(catalog, table.schema, table.name);
  const identity = columns.find((column) => column.isIdentity);
  if (identity) return identity.column;
  return findColumn(columns, [/(^|_)id($|_)/i, /codigo/i, /^cod/i]) ?? columns[0]?.column ?? 'ID';
}

function suggestProducts(catalog: DatabaseCatalog, table: TableInfo): Record<string, unknown> {
  const columns = getColumnsFor(catalog, table.schema, table.name);
  const id = pickIdColumn(catalog, table);
  const barcode = findColumn(columns, [/barr/i, /barcode/i, /ean/i, /upc/i, /gtin/i]);
  const sku = findColumn(
    columns,
    [/sku/i, /cod/i, /codigo/i],
    [/barr/i, ...(barcode ? [new RegExp(`^${barcode}$`, 'i')] : [])],
  );
  const name = findColumn(columns, [/descr/i, /nombre/i, /denomin/i, /detalle/i]);
  const description = findColumn(
    columns,
    [/descr/i, /detalle/i, /observ/i],
    name ? [new RegExp(`^${name}$`, 'i')] : [],
  );
  const brandId = findColumn(columns, [/marc/i], [/nom/i, /descr/i]);
  const brandName = findColumn(columns, [/marc/i, /brand/i], [/id/i, /cod/i]);
  const familyId = findColumn(columns, [/fam/i], [/sub/i, /nom/i, /descr/i]);
  const familyName = findColumn(columns, [/fam/i], [/sub/i, /id/i, /cod/i]);
  const subfamilyId = findColumn(columns, [/sub.?fam/i], [/nom/i, /descr/i]);
  const subfamilyName = findColumn(columns, [/sub.?fam/i], [/id/i, /cod/i]);
  const groupId = findColumn(columns, [/grup/i], [/sub/i, /nom/i, /descr/i]);
  const groupName = findColumn(columns, [/grup/i], [/id/i, /cod/i]);
  const unit = findColumn(columns, [/umed/i, /unidad/i, /medida/i, /uni/i]);
  const active = findColumn(columns, [/activo/i, /habilitad/i, /estado/i, /status/i]);
  const updatedAt = findColumn(columns, [
    /fec/i,
    /mod/i,
    /actualiz/i,
    /updated/i,
    /timestamp/i,
    /version/i,
  ]);

  return {
    source: `${table.schema}.${table.name}`,
    idColumn: id,
    ...(sku ? { skuColumn: sku } : {}),
    ...(barcode ? { barcodeColumn: barcode } : {}),
    ...(name ? { nameColumn: name } : {}),
    ...(description ? { descriptionColumn: description } : {}),
    ...(brandId ? { brandIdColumn: brandId } : {}),
    ...(brandName ? { brandNameColumn: brandName } : {}),
    ...(familyId ? { familyIdColumn: familyId } : {}),
    ...(familyName ? { familyNameColumn: familyName } : {}),
    ...(subfamilyId ? { subfamilyIdColumn: subfamilyId } : {}),
    ...(subfamilyName ? { subfamilyNameColumn: subfamilyName } : {}),
    ...(groupId ? { groupIdColumn: groupId } : {}),
    ...(groupName ? { groupNameColumn: groupName } : {}),
    ...(unit ? { unitColumn: unit } : {}),
    ...(active ? { activeColumn: active } : {}),
    ...(updatedAt ? { updatedAtColumn: updatedAt, strategy: 'updated_at' } : {}),
  };
}

function suggestSimple(
  catalog: DatabaseCatalog,
  table: TableInfo,
  kind: 'stock' | 'prices' | 'clients',
): Record<string, unknown> {
  const columns = getColumnsFor(catalog, table.schema, table.name);
  const id = pickIdColumn(catalog, table);
  const productRef = findColumn(columns, [/art/i, /prod/i, /item/i, /id/i, /cod/i]) ?? id;
  const updatedAt = findColumn(columns, [
    /fec/i,
    /mod/i,
    /actualiz/i,
    /updated/i,
    /timestamp/i,
    /version/i,
  ]);

  if (kind === 'stock') {
    return {
      source: `${table.schema}.${table.name}`,
      productIdColumn: productRef,
      ...(findColumn(columns, [/dep/i, /alm/i, /bodeg/i])
        ? { warehouseIdColumn: findColumn(columns, [/dep/i, /alm/i, /bodeg/i]) }
        : {}),
      ...(findColumn(columns, [/stoc/i, /exist/i, /saldo/i, /fisic/i, /cant/i])
        ? { physicalColumn: findColumn(columns, [/stoc/i, /exist/i, /saldo/i, /fisic/i, /cant/i]) }
        : {}),
      ...(findColumn(columns, [/reserv/i])
        ? { reservedColumn: findColumn(columns, [/reserv/i]) }
        : {}),
      ...(findColumn(columns, [/comprom/i, /pedid/i])
        ? { committedColumn: findColumn(columns, [/comprom/i, /pedid/i]) }
        : {}),
      ...(findColumn(columns, [/dispon/i])
        ? { availableColumn: findColumn(columns, [/dispon/i]) }
        : {}),
      ...(updatedAt ? { updatedAtColumn: updatedAt, strategy: 'updated_at' } : {}),
    };
  }
  if (kind === 'prices') {
    return {
      source: `${table.schema}.${table.name}`,
      productIdColumn: productRef,
      ...(findColumn(columns, [/lisp/i, /lista/i, /tarifa/i])
        ? { priceListIdColumn: findColumn(columns, [/lisp/i, /lista/i, /tarifa/i]) }
        : {}),
      amountColumn: findColumn(columns, [/prec/i, /importe/i, /valor/i, /price/i]) ?? 'PRECIO',
      ...(findColumn(columns, [/moned/i, /currency/i])
        ? { currencyColumn: findColumn(columns, [/moned/i, /currency/i]) }
        : {}),
      ...(findColumn(columns, [/igv/i, /imp/i, /tax/i, /inclu/i])
        ? { taxIncludedColumn: findColumn(columns, [/igv/i, /imp/i, /tax/i, /inclu/i]) }
        : {}),
      ...(updatedAt ? { updatedAtColumn: updatedAt, strategy: 'updated_at' } : {}),
    };
  }
  return {
    source: `${table.schema}.${table.name}`,
    idColumn: id,
    ...(findColumn(columns, [/ruc/i, /dni/i, /doc/i])
      ? { taxIdColumn: findColumn(columns, [/ruc/i, /dni/i, /doc/i]) }
      : {}),
    ...(findColumn(columns, [/raz/i, /nomb/i, /cliente/i])
      ? { businessNameColumn: findColumn(columns, [/raz/i, /nomb/i, /cliente/i]) }
      : {}),
    ...(findColumn(columns, [/lisp/i, /lista/i, /tarifa/i])
      ? { priceListIdColumn: findColumn(columns, [/lisp/i, /lista/i, /tarifa/i]) }
      : {}),
    ...(findColumn(columns, [/activ/i, /estado/i, /status/i])
      ? { activeColumn: findColumn(columns, [/activ/i, /estado/i, /status/i]) }
      : {}),
    ...(updatedAt ? { updatedAtColumn: updatedAt, strategy: 'updated_at' } : {}),
  };
}

function suggestMapping(
  catalog: DatabaseCatalog,
  candidates: DiscoveryCandidates,
): Record<string, unknown> {
  const suggested: Record<string, unknown> = {};
  const products = candidates.primaryByCategory.products;
  if (products) {
    const table = catalog.tables.find(
      (t) => t.schema === products.schema && t.name === products.table,
    );
    if (table) suggested.products = suggestProducts(catalog, table);
  }
  for (const kind of ['stock', 'prices', 'clients'] as const) {
    const candidate = candidates.primaryByCategory[kind];
    if (!candidate) continue;
    const table = catalog.tables.find(
      (t) => t.schema === candidate.schema && t.name === candidate.table,
    );
    if (table) suggested[kind] = suggestSimple(catalog, table, kind);
  }
  return suggested;
}

/** Ejecuta el discovery completo y escribe los reportes. */
export async function runDiscovery(options: DiscoveryOptions = {}): Promise<DiscoveryRunResult> {
  const logger = getLogger();
  const outDir = options.outDir ?? DEFAULT_DISCOVERY_DIR;
  const sampleLimit = options.sampleLimit ?? DEFAULT_DISCOVERY_SAMPLE_LIMIT;
  const mask = options.maskSensitive ?? true;
  const maxSamples = options.maxSamples ?? 15;

  logger.info('Iniciando discovery del esquema');
  const connection = await checkConnection(undefined, undefined, false);

  const catalog = await describeDatabase();
  const candidates = findCandidates(catalog);
  const incrementalColumns = findIncrementalColumns(catalog);
  const tables = buildTableEntries(catalog);

  // Seleccion de tablas a muestrear: primarias por categoria, sin duplicados.
  const sampleTargets = new Map<string, TableInfo>();
  for (const category of SAMPLE_CATEGORY_ORDER) {
    const candidate = candidates.primaryByCategory[category];
    if (!candidate) continue;
    const key = `${candidate.schema.toLowerCase()}.${candidate.table.toLowerCase()}`;
    if (sampleTargets.has(key)) continue;
    const table = catalog.tables.find(
      (t) => t.schema === candidate.schema && t.name === candidate.table,
    );
    if (table) sampleTargets.set(key, table);
  }

  const samples: TableSample[] = [];
  for (const table of [...sampleTargets.values()].slice(0, maxSamples)) {
    samples.push(await collectSample(catalog, table, sampleLimit, mask));
  }

  const warnings: string[] = [];
  if (connection.readOnly.isReadOnly === false) {
    warnings.push(
      'El login tiene permisos de escritura sobre la base. Usar un usuario READ ONLY dedicado.',
    );
  }
  if (connection.readOnly.isReadOnly === null) {
    warnings.push('No se pudo determinar READ ONLY; verificar permisos manualmente.');
  }
  if (!candidates.primaryByCategory.products) {
    warnings.push('No se detecto una tabla candidata de productos. Revisar heuristica/nombres.');
  }
  if (catalog.tables.length === 0) {
    warnings.push('No se listaron tablas: verificar permisos de lectura del catalogo (sys.*).');
  }

  const report: DiscoveryReport = {
    generatedAt: new Date().toISOString(),
    connectorVersion: APP_VERSION,
    connection: {
      server: connection.server,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      connected: connection.connected,
      latencyMs: connection.latencyMs,
      serverName: connection.serverName,
      productVersion: connection.productVersion,
      edition: connection.edition,
      loginName: connection.loginName,
      isReadOnly: connection.readOnly.isReadOnly,
      readOnlyDetails: connection.readOnly.details,
    },
    summary: {
      tables: catalog.tables.filter((t) => t.type === 'TABLE').length,
      views: catalog.tables.filter((t) => t.type === 'VIEW').length,
      columns: catalog.columns.length,
      primaryKeys: catalog.primaryKeys.length,
      foreignKeys: catalog.foreignKeys.length,
    },
    tables,
    foreignKeys: catalog.foreignKeys,
    candidates: candidates.matches,
    incrementalColumns,
    samples,
    suggestedMapping: suggestMapping(catalog, candidates),
    warnings,
  };

  ensureDir(outDir);
  const jsonPath = join(outDir, 'discovery-report.json');
  const markdownPath = join(outDir, 'discovery-report.md');
  writeJsonAtomic(jsonPath, report);
  writeTextAtomic(markdownPath, renderMarkdown(report));

  await closePool();
  logger.info({ jsonPath, markdownPath }, 'Discovery completado');

  return { report, jsonPath, markdownPath };
}
