import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  isDbConfigured,
  isRemoteConfigured,
  parseEnv,
  requireDbConfig,
  requireRemoteConfig,
} from './env';

describe('env', () => {
  it('aplica valores por defecto', () => {
    const env = parseEnv({});
    expect(env.DB_PORT).toBe(1433);
    expect(env.DB_ENCRYPT).toBe(false);
    expect(env.DB_TRUST_SERVER_CERTIFICATE).toBe(true);
    expect(env.SYNC_ENABLED).toBe(false);
    expect(env.REMOTE_BATCH_SIZE).toBe(500);
    expect(env.CONNECTOR_ID).toBe('cooperacion-navasoft');
    expect(env.CLIENT_ID).toBe('cooperacion-peru');
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
  });

  it('requireDbConfig lista las variables faltantes', () => {
    const env = parseEnv({});
    expect(() => requireDbConfig(env)).toThrow(ConfigError);
    try {
      requireDbConfig(env);
    } catch (err) {
      expect((err as ConfigError).missing).toEqual(
        expect.arrayContaining(['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD']),
      );
    }
  });

  it('requireDbConfig devuelve la configuracion completa', () => {
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
    expect(cfg.password).toBe('secret');
    expect(cfg.encrypt).toBe(false);
  });

  it('requireRemoteConfig valida URL y API key', () => {
    const env = parseEnv({});
    expect(() => requireRemoteConfig(env)).toThrow(ConfigError);
    const ok = parseEnv({ REMOTE_API_BASE_URL: 'https://api.example.com/', REMOTE_API_KEY: 'k' });
    const cfg = requireRemoteConfig(ok);
    expect(cfg.baseUrl).toBe('https://api.example.com/');
    expect(cfg.apiKey).toBe('k');
  });

  it('detecta configuraciones parciales', () => {
    expect(isDbConfigured(parseEnv({ DB_SERVER: 's', DB_DATABASE: 'd', DB_USER: 'u' }))).toBe(true);
    expect(isDbConfigured(parseEnv({ DB_SERVER: 's' }))).toBe(false);
    expect(isRemoteConfigured(parseEnv({ REMOTE_API_BASE_URL: 'https://x' }))).toBe(false);
    expect(
      isRemoteConfigured(parseEnv({ REMOTE_API_BASE_URL: 'https://x', REMOTE_API_KEY: 'k' })),
    ).toBe(true);
  });
});
