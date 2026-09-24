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

  // Identidad
  CONNECTOR_ID: z.string().min(1).default('cooperacion-navasoft'),
  CLIENT_ID: z.string().min(1).default('cooperacion-peru'),

  // API externa
  REMOTE_API_BASE_URL: optionalString,
  REMOTE_API_KEY: optionalString,
  REMOTE_API_TIMEOUT_MS: intFromString(20_000, 1),
  REMOTE_BATCH_SIZE: intFromString(500, 1),

  // Sync
  SYNC_ENABLED: boolFromString(false),
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
  return Boolean(env.DB_SERVER && env.DB_DATABASE && env.DB_USER);
}

export function isRemoteConfigured(env: Env): boolean {
  return Boolean(env.REMOTE_API_BASE_URL && env.REMOTE_API_KEY);
}

/** Resuelve la config SQL o falla con un mensaje claro indicando que falta. */
export function requireDbConfig(env: Env = getEnv()): DbConfig {
  const missing: string[] = [];
  if (!env.DB_SERVER) missing.push('DB_SERVER');
  if (!env.DB_DATABASE) missing.push('DB_DATABASE');
  if (!env.DB_USER) missing.push('DB_USER');
  if (env.DB_PASSWORD === undefined) missing.push('DB_PASSWORD');
  if (missing.length > 0) {
    throw new ConfigError(
      `Falta configuracion de SQL Server. Completar en .env: ${missing.join(', ')}`,
      missing,
    );
  }
  return {
    server: env.DB_SERVER as string,
    port: env.DB_PORT,
    database: env.DB_DATABASE as string,
    user: env.DB_USER as string,
    password: env.DB_PASSWORD ?? '',
    encrypt: env.DB_ENCRYPT,
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE,
    connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
    requestTimeoutMs: env.DB_REQUEST_TIMEOUT_MS,
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
