import sql from 'mssql';
import { APP_NAME, APP_VERSION } from '../config/constants';
import { requireDbConfig, type DbConfig } from '../config/env';
import { getLogger } from '../logger';
import { markDbConnection, markDbRead } from '../runtime/context';
import { assertReadOnlyQuery } from './sql-guard';

let pool: sql.ConnectionPool | null = null;
let connecting: Promise<sql.ConnectionPool> | null = null;

export function buildPoolConfig(cfg: DbConfig): sql.config {
  return {
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeout: cfg.connectionTimeoutMs,
    requestTimeout: cfg.requestTimeoutMs,
    pool: {
      min: cfg.poolMin,
      max: cfg.poolMax,
      idleTimeoutMillis: 30_000,
    },
    options: {
      encrypt: cfg.encrypt,
      trustServerCertificate: cfg.trustServerCertificate,
      enableArithAbort: true,
      appName: `${APP_NAME}/${APP_VERSION}`,
    },
  };
}

/** Devuelve (y crea si hace falta) el pool de conexiones. */
export async function getPool(cfg?: DbConfig): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  if (connecting) return connecting;

  const effective = cfg ?? requireDbConfig();
  const logger = getLogger();
  const newPool = new sql.ConnectionPool(buildPoolConfig(effective));

  connecting = newPool
    .connect()
    .then((connected) => {
      pool = connected;
      connecting = null;
      markDbConnection(true);
      connected.on('error', (err) => {
        markDbConnection(false);
        logger.error({ err: err.message }, 'Error en el pool de SQL Server');
      });
      return connected;
    })
    .catch((err: unknown) => {
      connecting = null;
      markDbConnection(false);
      pool = null;
      throw err;
    });

  return connecting;
}

export interface QueryOptions {
  timeoutMs?: number;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  durationMs: number;
}

/**
 * Ejecuta una query de lectura parametrizada.
 * - Fuerza el guard READ ONLY (SELECT/WITH, sin escritura).
 * - Aplica timeout.
 * - Nunca interpola valores: usa bind params.
 */
export async function runQuery<T = Record<string, unknown>>(
  sqlText: string,
  binds: Record<string, unknown> = {},
  options: QueryOptions = {},
): Promise<QueryResult<T>> {
  assertReadOnlyQuery(sqlText);
  const p = await getPool();
  const request = p.request();
  if (options.timeoutMs !== undefined) {
    // mssql soporta request.timeout en runtime; los tipos no lo exponen.
    (request as unknown as { timeout: number }).timeout = options.timeoutMs;
  }

  for (const [name, value] of Object.entries(binds)) {
    request.input(name, value as never);
  }

  const start = Date.now();
  const result = await request.query<T>(sqlText);
  const durationMs = Date.now() - start;
  markDbRead();

  const rows = (result.recordset as T[] | undefined) ?? [];
  return { rows, rowCount: result.rowsAffected?.[0] ?? rows.length, durationMs };
}

/** Primer valor de la primera fila, o null. */
export async function queryScalar<T = unknown>(
  sqlText: string,
  binds: Record<string, unknown> = {},
  options: QueryOptions = {},
): Promise<T | null> {
  const { rows } = await runQuery<Record<string, T>>(sqlText, binds, options);
  const first = rows[0];
  if (!first) return null;
  const values = Object.values(first);
  return values.length > 0 ? values[0] : null;
}

export interface DatabasePing {
  connected: boolean;
  latencyMs: number | null;
}

/** Chequeo liviano de conectividad para GET /health. No propaga errores. */
export async function pingDatabase(timeoutMs = 5_000): Promise<DatabasePing> {
  const start = Date.now();
  try {
    await queryScalar('SELECT 1', {}, { timeoutMs });
    return { connected: true, latencyMs: Date.now() - start };
  } catch {
    return { connected: false, latencyMs: null };
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    try {
      await pool.close();
    } catch {
      /* ignore */
    }
    pool = null;
  }
  connecting = null;
  markDbConnection(false);
}
