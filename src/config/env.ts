/**
 * Carga y validacion de variables de entorno con Zod.
 *
 * Estrategia:
 * - El schema base tiene defaults para todo lo no critico, de modo que el CLI
 *   (--help, db:test, discovery) siempre pueda arrancar.
 * - Las variables criticas (SQL, API) se validan de forma explicita y obligatoria
 *   solo cuando la operacion las necesita (requireDbConfig / requireRemoteConfig).
 * - Si SYNC_ENABLED=true, el arranque del scheduler exige SQL y API.
 */

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

let dotenvLoaded = false;

/** Carga .env una sola vez (idempotente). */
export function loadEnvFile(path?: string): void {
  if (dotenvLoaded) return;
  loadDotenv(path ? { path } : undefined);
  dotenvLoaded = true;
}

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const boolFromString = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'true' || v === '1' || v === 'yes') return true;
      if (v === 'false' || v === '0' || v === 'no') return false;
    }
    return value;
  }, z.boolean().default(defaultValue));

const intFromString = (defaultValue: number, min = 0) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).default(defaultValue));

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  // API HTTP local del connector
  PORT: intFromString(3000, 1),
  // Interfaz de escucha. 127.0.0.1 por defecto (solo local). Usar 0.0.0.0 con cuidado.
  API_HOST: z.string().min(1).default('127.0.0.1'),

  // SQL Server
  DB_SERVER: optionalString,
  DB_PORT: intFromString(1433, 1),
  DB_DATABASE: optionalString,
  DB_USER: optionalString,
  DB_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  DB_ENCRYPT: boolFromString(false),
  DB_TRUST_SERVER_CERTIFICATE: boolFromString(true),
  DB_CONNECTION_TIMEOUT_MS: intFromString(15_000, 1),
  DB_REQUEST_TIMEOUT_MS: intFromString(30_000, 1),
  SQL_POOL_MIN: intFromString(0),
  SQL_POOL_MAX: intFromString(5, 1),

  // SQL Server - nombres reales (tienen prioridad sobre DB_*, que quedan como alias)
  SQL_HOST: optionalString,
  SQL_PORT: intFromString(1433, 1),
  SQL_DATABASE: optionalString,
  SQL_USER: optionalString,
  SQL_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  SQL_ENCRYPT: boolFromString(false),
  SQL_TRUST_SERVER_CERTIFICATE: boolFromString(true),
  SQL_CONNECTION_TIMEOUT_MS: intFromString(15_000, 1),
  SQL_REQUEST_TIMEOUT_MS: intFromString(30_000, 1),

  // Identidad
  CONNECTOR_ID: z.string().min(1).default('cooperacion-navasoft'),
  CLIENT_ID: z.string().min(1).default('cooperacion-peru'),

  // API externa (pipeline generico, legado)
  REMOTE_API_BASE_URL: optionalString,
  REMOTE_API_KEY: optionalString,
  REMOTE_API_TIMEOUT_MS: intFromString(20_000, 1),
  REMOTE_BATCH_SIZE: intFromString(500, 1),

  // API HTTP local del connector (autenticacion)
  // Si esta seteado, todos los endpoints salvo GET /health exigen Bearer token.
  CONNECTOR_API_TOKEN: optionalString,
  // CORS: lista separada por comas de origenes permitidos. Vacio = CORS cerrado.
  CORS_ALLOWED_ORIGINS: optionalString,
  API_RATE_LIMIT_MAX: intFromString(120, 1),
  API_RATE_LIMIT_WINDOW_MS: intFromString(60_000, 1),

  // API BKM (destino de la sincronizacion de productos)
  BKM_API_URL: optionalString,
  BKM_API_TOKEN: optionalString,
  BKM_API_TIMEOUT_MS: intFromString(20_000, 1),
  BKM_RETRY_MAX: intFromString(2, 0),

  // Sync
  SYNC_ENABLED: boolFromString(false),
  SYNC_INTERVAL_MINUTES: intFromString(5, 1),
  SYNC_BATCH_SIZE: intFromString(500, 1),
  SYNC_PRODUCTS_SECONDS: intFromString(300, 1),
  SYNC_STOCK_SECONDS: intFromString(30, 1),
  SYNC_PRICES_SECONDS: intFromString(60, 1),
  SYNC_CLIENTS_SECONDS: intFromString(300, 1),
  SYNC_FULL_ON_START: boolFromString(false),

  // Heartbeat
  HEARTBEAT_SECONDS: intFromString(30, 1),

  // Logs
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_FILE: z.preprocess(emptyToUndefined, z.string().optional()),
  LOG_MAX_SIZE_BYTES: intFromString(10 * 1024 * 1024, 1024),
  LOG_MAX_FILES: intFromString(5, 1),

  // Estado local
  QUEUE_DB_PATH: z.string().min(1).default('./data/connector.sqlite'),
  MAPPING_PATH: z.string().min(1).default('./config/mapping.json'),

  // Scheduler
  RUN_SCHEDULER: boolFromString(true),
});

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  readonly missing: string[];
  constructor(message: string, missing: string[] = []) {
    super(message);
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

export interface DbConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  poolMin: number;
  poolMax: number;
}

export interface RemoteConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  batchSize: number;
}

export interface BkmConfig {
  url: string;
  apiToken: string;
  timeoutMs: number;
  retryMax: number;
  batchSize: number;
}

let cached: Env | null = null;

/** Parsea un objeto de entorno. Pensado para testear sin tocar process.env. */
export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Configuracion invalida (variables de entorno):\n${details}`);
  }
  return result.data;
}

/** Devuelve el entorno validado, cacheado. Carga .env la primera vez. */
export function getEnv(): Env {
  if (cached) return cached;
  loadEnvFile();
  cached = parseEnv(process.env);
  return cached;
}

/** Solo para tests: resetea la cache y permite inyectar un env. */
export function __setEnvForTests(env: Env | null): void {
  cached = env;
}

export function isDbConfigured(env: Env): boolean {
  return Boolean(
    (env.SQL_HOST ?? env.DB_SERVER) &&
    (env.SQL_DATABASE ?? env.DB_DATABASE) &&
    (env.SQL_USER ?? env.DB_USER),
  );
}

export function isRemoteConfigured(env: Env): boolean {
  return Boolean(env.REMOTE_API_BASE_URL && env.REMOTE_API_KEY);
}

/** Resuelve la config SQL (SQL_* con fallback a DB_*) o falla con un mensaje claro. */
export function requireDbConfig(env: Env = getEnv()): DbConfig {
  // Si hay cualquier variable SQL_* seteada, se usa el grupo nuevo completo.
  const usingSql = Boolean(env.SQL_HOST || env.SQL_DATABASE || env.SQL_USER || env.SQL_PASSWORD);

  const server = env.SQL_HOST ?? env.DB_SERVER;
  const database = env.SQL_DATABASE ?? env.DB_DATABASE;
  const user = env.SQL_USER ?? env.DB_USER;
  const password = usingSql ? env.SQL_PASSWORD : env.DB_PASSWORD;

  const missing: string[] = [];
  if (!server) missing.push('SQL_HOST');
  if (!database) missing.push('SQL_DATABASE');
  if (!user) missing.push('SQL_USER');
  if (password === undefined) missing.push('SQL_PASSWORD');
  if (missing.length > 0) {
    throw new ConfigError(
      `Falta configuracion de SQL Server. Completar en .env: ${missing.join(', ')}`,
      missing,
    );
  }
  return {
    server: server as string,
    port: usingSql ? env.SQL_PORT : env.DB_PORT,
    database: database as string,
    user: user as string,
    password: password ?? '',
    encrypt: usingSql ? env.SQL_ENCRYPT : env.DB_ENCRYPT,
    trustServerCertificate: usingSql
      ? env.SQL_TRUST_SERVER_CERTIFICATE
      : env.DB_TRUST_SERVER_CERTIFICATE,
    connectionTimeoutMs: usingSql ? env.SQL_CONNECTION_TIMEOUT_MS : env.DB_CONNECTION_TIMEOUT_MS,
    requestTimeoutMs: usingSql ? env.SQL_REQUEST_TIMEOUT_MS : env.DB_REQUEST_TIMEOUT_MS,
    poolMin: env.SQL_POOL_MIN,
    poolMax: env.SQL_POOL_MAX,
  };
}

/** Resuelve la config de la API externa o falla con un mensaje claro. */
export function requireRemoteConfig(env: Env = getEnv()): RemoteConfig {
  const missing: string[] = [];
  if (!env.REMOTE_API_BASE_URL) missing.push('REMOTE_API_BASE_URL');
  if (!env.REMOTE_API_KEY) missing.push('REMOTE_API_KEY');
  if (missing.length > 0) {
    throw new ConfigError(
      `Falta configuracion de la API externa. Completar en .env: ${missing.join(', ')}`,
      missing,
    );
  }
  return {
    baseUrl: env.REMOTE_API_BASE_URL as string,
    apiKey: env.REMOTE_API_KEY as string,
    timeoutMs: env.REMOTE_API_TIMEOUT_MS,
    batchSize: env.REMOTE_BATCH_SIZE,
  };
}

export function isBkmConfigured(env: Env): boolean {
  return Boolean(env.BKM_API_URL && env.BKM_API_TOKEN);
}

/** Resuelve la config de la API BKM o falla con un mensaje claro. */
export function requireBkmConfig(env: Env = getEnv()): BkmConfig {
  const missing: string[] = [];
  if (!env.BKM_API_URL) missing.push('BKM_API_URL');
  if (!env.BKM_API_TOKEN) missing.push('BKM_API_TOKEN');
  if (missing.length > 0) {
    throw new ConfigError(
      `Falta configuracion de la API BKM. Completar en .env: ${missing.join(', ')}`,
      missing,
    );
  }
  return {
    url: env.BKM_API_URL as string,
    apiToken: env.BKM_API_TOKEN as string,
    timeoutMs: env.BKM_API_TIMEOUT_MS,
    retryMax: env.BKM_RETRY_MAX,
    batchSize: env.SYNC_BATCH_SIZE,
  };
}
