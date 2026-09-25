import { Command } from 'commander';
import { BkmApiClient } from '../bkm/bkm-client';
import { ProductSyncService } from '../bkm/sync-service';
import {
  APP_VERSION,
  DEFAULT_DISCOVERY_SAMPLE_LIMIT,
  DEFAULT_SAMPLE_LIMIT,
} from '../config/constants';
import {
  ConfigError,
  getEnv,
  isBkmConfigured,
  isDbConfigured,
  isRemoteConfigured,
  requireBkmConfig,
  requireDbConfig,
  requireRemoteConfig,
} from '../config/env';
import { closePool } from '../db/connection';
import { checkConnection } from '../db/health';
import {
  listColumns,
  listForeignKeys,
  listPrimaryKeys,
  listTables,
  resolveTable,
  sampleTable,
} from '../db/inspector';
import { runDiscovery } from '../discovery/schema-discovery';
import { getLogger } from '../logger';
import { loadMapping } from '../mapping/load';
import { createProductSyncSource } from '../products/service';
import { LocalQueue } from '../queue/queue';
import type { BatchSender } from '../queue/queue';
import { RemoteApiClient } from '../remote/api-client';
import { startServer } from '../server/bootstrap';
import { syncFull, syncFullDataset, syncDictionaries } from '../sync/full-sync';
import { syncIncrementalDataset, type IncrementalDependencies } from '../sync/incremental-sync';
import { SyncStateStore } from '../sync/sync-state';

function printRows(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    console.log('(sin filas)');
    return;
  }
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const widths = headers.map((header) =>
    Math.min(48, Math.max(header.length, ...rows.map((row) => String(row[header] ?? '').length))),
  );
  const render = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0).slice(0, widths[i] ?? 0)).join('  ');
  console.log(render(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(render(headers.map((header) => String(row[header] ?? ''))));
  }
}

function handleError(err: unknown): never {
  if (err instanceof ConfigError) {
    console.error(`\n[ConfigError] ${err.message}\n`);
  } else {
    console.error(`\n[Error] ${(err as Error).message}\n`);
  }
  process.exitCode = 1;
  throw err;
}

function warnIfExampleMapping(isExample: boolean): void {
  if (isExample) {
    console.warn(
      '\n[AVISO] No existe config/mapping.json: se esta usando config/mapping.example.json.\n' +
        '        Los datos NO corresponden a tablas reales. Ejecutar discovery y crear el mapping real.\n',
    );
  }
}

async function withPool<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await closePool();
  }
}

// ---------------------------------------------------------------------------
// db:* commands
// ---------------------------------------------------------------------------

async function cmdDbTest(): Promise<void> {
  const env = getEnv();
  requireDbConfig(env);
  const health = await checkConnection(env);
  if (!health.connected) {
    console.error(`No se pudo conectar: ${health.error}`);
    process.exitCode = 1;
    return;
  }
  console.log('Conexion SQL Server OK');
  console.log('------------------------------');
  console.log(`Servidor      : ${health.serverName ?? health.server}:${health.port}`);
  console.log(`Base de datos : ${health.database}`);
  console.log(`Usuario       : ${health.loginName ?? health.user}`);
  console.log(`Version       : ${health.productVersion ?? 'n/d'} (${health.edition ?? 'n/d'})`);
  console.log(`Latencia      : ${health.latencyMs} ms`);
  const ro = health.readOnly.isReadOnly;
  console.log(
    `READ ONLY     : ${ro === true ? 'SI' : ro === false ? 'NO (revisar permisos)' : 'indeterminado'}`,
  );
  if (health.readOnly.details) console.log(`Detalle       : ${health.readOnly.details}`);
  if (ro === false) process.exitCode = 0; // solo advertencia
}

async function cmdDbTables(): Promise<void> {
  await withPool(async () => {
    requireDbConfig(getEnv());
    const tables = await listTables();
    printRows(
      tables.map((t) => ({
        schema: t.schema,
        nombre: t.name,
        tipo: t.type,
        filasAprox: t.rowCount ?? 'n/d',
      })),
    );
    console.log(`\nTotal: ${tables.length}`);
  });
}

async function cmdDbColumns(tableArg: string): Promise<void> {
  await withPool(async () => {
    requireDbConfig(getEnv());
    if (!tableArg) {
      console.error('Uso: npm run db:columns -- <tabla|schema.tabla>');
      process.exitCode = 1;
      return;
    }
    const tables = await listTables();
    const resolved = await resolveTable(tableArg, tables);
    if (!resolved) {
      console.error(`No se encontro la tabla: ${tableArg}`);
      process.exitCode = 1;
      return;
    }
    const [columns, pk, fks] = await Promise.all([
      listColumns(resolved),
      listPrimaryKeys(resolved),
      listForeignKeys(resolved),
    ]);
    const pkSet = new Set((pk[0]?.columns ?? []).map((c) => c.toLowerCase()));
    const fkMap = new Map(fks.map((fk) => [fk.parentColumn.toLowerCase(), fk]));
    console.log(`${resolved.schema}.${resolved.table} - ${columns.length} columnas\n`);
    printRows(
      columns.map((column) => {
        const fk = fkMap.get(column.column.toLowerCase());
        return {
          columna: column.column,
          tipo: column.dataType,
          maxLen: column.maxLength ?? '',
          nullable: column.nullable ? 'si' : 'no',
          pk: pkSet.has(column.column.toLowerCase()) ? 'SI' : '',
          fk: fk ? `${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}` : '',
          identity: column.isIdentity ? 'si' : '',
          computed: column.isComputed ? 'si' : '',
          rowversion: column.isRowVersion ? 'si' : '',
          default: column.defaultDefinition ?? '',
        };
      }),
    );
  });
}

async function cmdDbRelations(): Promise<void> {
  await withPool(async () => {
    requireDbConfig(getEnv());
    const fks = await listForeignKeys();
    printRows(
      fks.map((fk) => ({
        tabla: `${fk.parentSchema}.${fk.parentTable}`,
        columna: fk.parentColumn,
        referencia: `${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}`,
        delete: fk.deleteAction,
        update: fk.updateAction,
      })),
    );
    console.log(`\nTotal: ${fks.length} foreign keys`);
  });
}

async function cmdDbSearch(term: string): Promise<void> {
  await withPool(async () => {
    requireDbConfig(getEnv());
    if (!term) {
      console.error('Uso: npm run db:search -- <termino>');
      process.exitCode = 1;
      return;
    }
    const needle = term.toLowerCase();
    const [tables, columns] = await Promise.all([listTables(), listColumns()]);
    const tableMatches = tables.filter((t) => t.name.toLowerCase().includes(needle));
    const columnMatches = columns.filter(
      (c) => c.column.toLowerCase().includes(needle) || c.table.toLowerCase().includes(needle),
    );
    console.log(`Tablas que coinciden con "${term}":`);
    printRows(
      tableMatches.map((t) => ({
        schema: t.schema,
        tabla: t.name,
        tipo: t.type,
        filasAprox: t.rowCount ?? 'n/d',
      })),
    );
    console.log(`\nColumnas/vistas que coinciden con "${term}" (hasta 100):`);
    printRows(
      columnMatches.slice(0, 100).map((c) => ({
        schema: c.schema,
        tabla: c.table,
        columna: c.column,
        tipo: c.dataType,
      })),
    );
  });
}

async function cmdDbSample(tableArg: string, limit: number): Promise<void> {
  await withPool(async () => {
    requireDbConfig(getEnv());
    if (!tableArg) {
      console.error('Uso: npm run db:sample -- <tabla> --limit 20');
      process.exitCode = 1;
      return;
    }
    const tables = await listTables();
    const resolved = await resolveTable(tableArg, tables);
    if (!resolved) {
      console.error(`No se encontro la tabla: ${tableArg}`);
      process.exitCode = 1;
      return;
    }
    const result = await sampleTable(resolved.schema, resolved.table, limit);
    printRows(result.rows as Array<Record<string, unknown>>);
    console.log(`\n${result.rows.length} filas de ${resolved.schema}.${resolved.table}`);
  });
}

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

async function cmdDiscovery(options: {
  outDir?: string;
  sampleLimit?: number;
  mask?: boolean;
}): Promise<void> {
  requireDbConfig(getEnv());
  const result = await runDiscovery({
    outDir: options.outDir,
    sampleLimit: options.sampleLimit ?? DEFAULT_DISCOVERY_SAMPLE_LIMIT,
    maskSensitive: options.mask !== false,
  });
  const { report } = result;
  console.log('\nDiscovery completado');
  console.log('--------------------');
  console.log(`Servidor      : ${report.connection.serverName ?? report.connection.server}`);
  console.log(`Base          : ${report.connection.database}`);
  console.log(
    `READ ONLY     : ${report.connection.isReadOnly === true ? 'SI' : report.connection.isReadOnly === false ? 'NO (revisar)' : 'indeterminado'}`,
  );
  console.log(`Tablas/vistas : ${report.summary.tables} / ${report.summary.views}`);
  console.log(`Columnas      : ${report.summary.columns}`);
  console.log(`PK / FK       : ${report.summary.primaryKeys} / ${report.summary.foreignKeys}`);
  const products = report.candidates.find((c) => c.category === 'products');
  console.log(
    `Candidato prod: ${products ? `${products.schema}.${products.table} (score ${products.score})` : 'no detectado'}`,
  );
  console.log(`\nReportes:`);
  console.log(`  ${result.markdownPath}`);
  console.log(`  ${result.jsonPath}`);
  if (report.warnings.length > 0) {
    console.log('\nAdvertencias:');
    for (const warning of report.warnings) console.log(`  - ${warning}`);
  }
}

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

function buildSyncDependencies(dryRun: boolean): {
  deps: IncrementalDependencies;
  queue: LocalQueue;
  sender: BatchSender;
  state: SyncStateStore;
} {
  const env = getEnv();
  requireDbConfig(env);
  const mapping = loadMapping();
  warnIfExampleMapping(mapping.isExample);
  const queue = LocalQueue.open();
  queue.resetStale();
  const state = new SyncStateStore();

  if (!dryRun && !isRemoteConfigured(env)) {
    requireRemoteConfig(env); // lanza ConfigError con detalle
  }
  const client = !dryRun && isRemoteConfigured(env) ? new RemoteApiClient({ env }) : null;

  const sender: BatchSender = async (batch) => {
    if (!client) {
      return { ok: false, retryable: true, error: 'REMOTE_API no configurada (modo dry-run?)' };
    }
    return client.sendBatch(batch.dataset, batch.batchId, batch.records);
  };

  return {
    deps: {
      mapping,
      queue,
      state,
      batchSize: env.REMOTE_BATCH_SIZE,
      dryRun,
      sender,
    },
    queue,
    sender,
    state,
  };
}

async function cmdSync(
  target: string,
  options: { dryRun?: boolean; noDrain?: boolean },
): Promise<void> {
  const dryRun = options.dryRun === true;
  const { deps, queue, sender } = buildSyncDependencies(dryRun);

  const results = [];
  if (target === 'full') {
    results.push(...(await syncFull(deps)));
  } else if (target === 'incremental') {
    const { mapping } = deps;
    for (const dataset of ['products', 'stock', 'prices', 'clients'] as const) {
      if (!mapping.config[dataset]) continue;
      results.push(
        await syncIncrementalDataset(dataset, { ...deps, state: deps.state as SyncStateStore }),
      );
    }
  } else if (target === 'dictionaries') {
    results.push(await syncDictionaries(deps));
  } else if (['products', 'stock', 'prices', 'clients'].includes(target)) {
    results.push(await syncFullDataset(target as 'products', deps));
  } else {
    console.error(
      `Dataset invalido: ${target}. Use products|stock|prices|clients|dictionaries|full|incremental`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nSync "${target}" (${dryRun ? 'DRY-RUN' : 'real'})`);
  printRows(
    results.map((r) => ({
      dataset: r.dataset,
      leidos: r.recordsRead,
      mapeados: r.recordsMapped,
      omitidos: r.recordsSkipped,
      batches: r.batchesEnqueued,
    })),
  );

  if (!dryRun && !options.noDrain) {
    const drain = await queue.drain(sender);
    console.log(
      `\nQueue: enviados=${drain.sent} reintentos=${drain.retried} descartados=${drain.abandoned} pendientes=${drain.remaining}`,
    );
  }
  const stats = queue.stats();
  console.log(
    `Queue stats: PENDING=${stats.PENDING} SENDING=${stats.SENDING} SENT=${stats.SENT} FAILED=${stats.FAILED}`,
  );
  await closePool();
}

async function cmdQueueStatus(): Promise<void> {
  const queue = LocalQueue.open();
  const stats = queue.stats();
  console.log(
    `Queue: PENDING=${stats.PENDING} SENDING=${stats.SENDING} SENT=${stats.SENT} FAILED=${stats.FAILED}`,
  );
  const state = new SyncStateStore();
  console.log('\nEstado por dataset:');
  printRows(
    state.all().map((s) => ({
      dataset: s.dataset,
      estrategia: s.strategy ?? '',
      cursor: s.lastCursor ?? '',
      ultimoExito: s.lastSuccessfulSync ?? '',
      ultimoIntento: s.lastAttempt ?? '',
      registros: s.recordsLastRun,
      error: s.lastError ?? '',
    })),
  );
}

async function cmdQueueDrain(): Promise<void> {
  const env = getEnv();
  requireRemoteConfig(env);
  const queue = LocalQueue.open();
  queue.resetStale();
  const client = new RemoteApiClient({ env });
  const result = await queue.drain(async (batch) =>
    client.sendBatch(batch.dataset, batch.batchId, batch.records),
  );
  console.log(
    `Drain: enviados=${result.sent} reintentos=${result.retried} descartados=${result.abandoned} pendientes=${result.remaining}`,
  );
}

// ---------------------------------------------------------------------------
// serve (servicio real: API HTTP + sync BKM)
// ---------------------------------------------------------------------------

async function cmdServe(): Promise<void> {
  const env = getEnv();
  const logger = getLogger();
  if (!isDbConfigured(env)) {
    logger.warn('SQL Server no configurado: GET /health reportara sql.connected=false');
  }

  const handle = await startServer(env);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Deteniendo servicio');
    try {
      await handle.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function cmdSyncBkm(): Promise<void> {
  const env = getEnv();
  requireDbConfig(env);
  if (!isBkmConfigured(env)) requireBkmConfig(env);

  const client = new BkmApiClient({ env });
  const sync = new ProductSyncService({
    source: createProductSyncSource(),
    client,
    batchSize: env.SYNC_BATCH_SIZE,
    connectorId: env.CONNECTOR_ID,
    clientId: env.CLIENT_ID,
  });

  try {
    const result = await sync.run();
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'SUCCESS') process.exitCode = 1;
  } finally {
    await closePool();
  }
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

export function createProgram(): Command {
  const program = new Command();
  program
    .name('navasoft-connector')
    .description('Connector NavaSoft -> API externa (SQL Server READ ONLY)')
    .version(APP_VERSION);

  program
    .command('db:test')
    .description('Prueba de conexion SQL Server y diagnostico READ ONLY')
    .action(() => cmdDbTest().catch(handleError));

  program
    .command('db:tables')
    .description('Lista schemas, tablas y vistas con row count aproximado')
    .action(() => cmdDbTables().catch(handleError));

  program
    .command('db:columns')
    .argument('[tabla]', 'tabla o schema.tabla')
    .description('Muestra columnas, tipos, PK, FK, identity, computed, default')
    .action((tabla: string) => cmdDbColumns(tabla).catch(handleError));

  program
    .command('db:relations')
    .description('Extrae foreign keys')
    .action(() => cmdDbRelations().catch(handleError));

  program
    .command('db:search')
    .argument('[termino]', 'termino a buscar')
    .description('Busca tablas/columnas candidatas por nombre')
    .action((termino: string) => cmdDbSearch(termino).catch(handleError));

  program
    .command('db:sample')
    .argument('[tabla]', 'tabla o schema.tabla')
    .option('--limit <n>', 'cantidad de filas', String(DEFAULT_SAMPLE_LIMIT))
    .description('Muestra filas de una tabla (limitada)')
    .action((tabla: string, opts: { limit: string }) =>
      cmdDbSample(tabla, Number.parseInt(opts.limit, 10) || DEFAULT_SAMPLE_LIMIT).catch(
        handleError,
      ),
    );

  program
    .command('discovery')
    .description('Genera docs/discovery-report.json y .md')
    .option('--out-dir <dir>', 'directorio de salida', './docs')
    .option('--sample-limit <n>', 'filas por muestra')
    .option('--no-mask', 'no enmascarar columnas sensibles (NO recomendado)')
    .action((opts: { outDir: string; sampleLimit?: string; mask: boolean }) =>
      cmdDiscovery({
        outDir: opts.outDir,
        sampleLimit: opts.sampleLimit ? Number.parseInt(opts.sampleLimit, 10) : undefined,
        mask: opts.mask,
      }).catch(handleError),
    );

  program
    .command('sync')
    .argument('<target>', 'products|stock|prices|clients|dictionaries|full|incremental')
    .option('--dry-run', 'leer y mapear sin enviar')
    .option('--no-drain', 'no enviar la queue inmediatamente')
    .description('Sincroniza datasets')
    .action((target: string, opts: { dryRun?: boolean; drain?: boolean }) =>
      cmdSync(target, { dryRun: opts.dryRun, noDrain: opts.drain === false }).catch(handleError),
    );

  program
    .command('queue:status')
    .description('Estado de la queue local y del sync state')
    .action(() => cmdQueueStatus().catch(handleError));

  program
    .command('queue:drain')
    .description('Intenta enviar los batches pendientes')
    .action(() => cmdQueueDrain().catch(handleError));

  program
    .command('sync:bkm', { isDefault: false })
    .description('Sincroniza productos hacia BKM una vez (SQL -> normalizar -> POST)')
    .action(() => cmdSyncBkm().catch(handleError));

  program
    .command('serve', { isDefault: true })
    .description('Inicia la API HTTP local (products/health/sync) y el scheduler opcional')
    .action(() => cmdServe().catch(handleError));

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}
