import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  isBkmConfigured,
  isDbConfigured,
  isRemoteConfigured,
  parseEnv,
  requireBkmConfig,
  requireDbConfig,
  requireRemoteConfig,
} from './env';

describe('env', () => {
  it('aplica valores por defecto', () => {
    const env = parseEnv({});
    expect(env.DB_PORT).toBe(1433);
    expect(env.SQL_PORT).toBe(1433);
    expect(env.PORT).toBe(3000);
    expect(env.API_HOST).toBe('127.0.0.1');
    expect(env.SQL_ENCRYPT).toBe(false);
    expect(env.SQL_TRUST_SERVER_CERTIFICATE).toBe(true);
    expect(env.SYNC_ENABLED).toBe(false);
    expect(env.SYNC_INTERVAL_MINUTES).toBe(5);
    expect(env.SYNC_BATCH_SIZE).toBe(500);
    expect(env.BKM_RETRY_MAX).toBe(2);
    expect(env.REMOTE_BATCH_SIZE).toBe(500);
    expect(env.CONNECTOR_ID).toBe('cooperacion-navasoft');
    expect(env.CLIENT_ID).toBe('cooperacion-peru');
    expect(env.CONNECTOR_API_TOKEN).toBeUndefined();
    expect(env.CORS_ALLOWED_ORIGINS).toBeUndefined();
  });

  it('parsea booleanos de forma estricta', () => {
    expect(parseEnv({ DB_ENCRYPT: 'true' }).DB_ENCRYPT).toBe(true);
    expect(parseEnv({ DB_ENCRYPT: 'false' }).DB_ENCRYPT).toBe(false);
    expect(parseEnv({ DB_ENCRYPT: '1' }).DB_ENCRYPT).toBe(true);
    expect(parseEnv({ SYNC_ENABLED: 'TRUE' }).SYNC_ENABLED).toBe(true);
    expect(parseEnv({ DB_TRUST_SERVER_CERTIFICATE: 'no' }).DB_TRUST_SERVER_CERTIFICATE).toBe(false);
  });

  it('rechaza numeros invalidos', () => {
    expect(() => parseEnv({ DB_PORT: 'abc' })).toThrow(ConfigError);
    expect(() => parseEnv({ SQL_PORT: 'abc' })).toThrow(ConfigError);
  });

  it('requireDbConfig lista las variables SQL_* faltantes', () => {
    const env = parseEnv({});
    expect(() => requireDbConfig(env)).toThrow(ConfigError);
    try {
      requireDbConfig(env);
    } catch (err) {
      expect((err as ConfigError).missing).toEqual(
        expect.arrayContaining(['SQL_HOST', 'SQL_DATABASE', 'SQL_USER', 'SQL_PASSWORD']),
      );
    }
  });

  it('requireDbConfig devuelve la configuracion SQL_* completa', () => {
    const env = parseEnv({
      SQL_HOST: 'localhost',
      SQL_DATABASE: 'BdRebi',
      SQL_USER: 'readonly',
      SQL_PASSWORD: 'secret',
    });
    const cfg = requireDbConfig(env);
    expect(cfg.server).toBe('localhost');
    expect(cfg.port).toBe(1433);
    expect(cfg.database).toBe('BdRebi');
    expect(cfg.user).toBe('readonly');
    expect(cfg.password).toBe('secret');
    expect(cfg.encrypt).toBe(false);
    expect(cfg.trustServerCertificate).toBe(true);
  });

  it('requireDbConfig mantiene compatibilidad con DB_* como alias', () => {
    const env = parseEnv({
      DB_SERVER: 'sql-replica',
      DB_DATABASE: 'NAVASOFT_REPLICA',
      DB_USER: 'readonly',
      DB_PASSWORD: 'secret',
    });
    const cfg = requireDbConfig(env);
    expect(cfg.server).toBe('sql-replica');
    expect(cfg.database).toBe('NAVASOFT_REPLICA');
    expect(cfg.user).toBe('readonly');
  });

  it('requireRemoteConfig valida URL y API key (legado)', () => {
    const env = parseEnv({});
    expect(() => requireRemoteConfig(env)).toThrow(ConfigError);
    const ok = parseEnv({ REMOTE_API_BASE_URL: 'https://api.example.com/', REMOTE_API_KEY: 'k' });
    const cfg = requireRemoteConfig(ok);
    expect(cfg.baseUrl).toBe('https://api.example.com/');
    expect(cfg.apiKey).toBe('k');
  });

  it('requireBkmConfig valida URL y token', () => {
    expect(() => requireBkmConfig(parseEnv({}))).toThrow(ConfigError);
    const ok = parseEnv({
      BKM_API_URL: 'https://bkm.example.com/api/products',
      BKM_API_TOKEN: 'token',
      SYNC_BATCH_SIZE: '250',
    });
    const cfg = requireBkmConfig(ok);
    expect(cfg.url).toBe('https://bkm.example.com/api/products');
    expect(cfg.apiToken).toBe('token');
    expect(cfg.batchSize).toBe(250);
  });

  it('detecta configuraciones parciales', () => {
    expect(isDbConfigured(parseEnv({ SQL_HOST: 's', SQL_DATABASE: 'd', SQL_USER: 'u' }))).toBe(
      true,
    );
    expect(isDbConfigured(parseEnv({ SQL_HOST: 's' }))).toBe(false);
    expect(isDbConfigured(parseEnv({ DB_SERVER: 's', DB_DATABASE: 'd', DB_USER: 'u' }))).toBe(true);
    expect(isRemoteConfigured(parseEnv({ REMOTE_API_BASE_URL: 'https://x' }))).toBe(false);
    expect(
      isRemoteConfigured(parseEnv({ REMOTE_API_BASE_URL: 'https://x', REMOTE_API_KEY: 'k' })),
    ).toBe(true);
    expect(isBkmConfigured(parseEnv({ BKM_API_URL: 'https://x' }))).toBe(false);
    expect(isBkmConfigured(parseEnv({ BKM_API_URL: 'https://x', BKM_API_TOKEN: 'k' }))).toBe(true);
  });
});
