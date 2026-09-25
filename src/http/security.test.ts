import { describe, expect, it } from 'vitest';
import {
  evaluateCors,
  extractBearerToken,
  isAuthorized,
  parseAllowedOrigins,
  RateLimiter,
  safeCompare,
} from './security';

describe('safeCompare', () => {
  it('compara strings correctamente', () => {
    expect(safeCompare('token', 'token')).toBe(true);
    expect(safeCompare('token', 'tokem')).toBe(false);
    expect(safeCompare('token', 'token-largo')).toBe(false);
    expect(safeCompare('', '')).toBe(true);
  });
});

describe('extractBearerToken', () => {
  it('extrae el token de un header Bearer', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('bearer ABC')).toBe('ABC');
    expect(extractBearerToken('  Bearer   xyz  ')).toBe('xyz');
  });

  it('devuelve null para headers invalidos o ausentes', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});

describe('isAuthorized', () => {
  it('valida contra el token esperado', () => {
    expect(isAuthorized('Bearer secret', 'secret')).toBe(true);
    expect(isAuthorized('Bearer other', 'secret')).toBe(false);
    expect(isAuthorized(undefined, 'secret')).toBe(false);
    expect(isAuthorized('Bearer secret', '')).toBe(false);
  });
});

describe('parseAllowedOrigins', () => {
  it('parsea listas separadas por coma y recorta espacios', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins(' https://a.com , https://b.com ')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});

describe('evaluateCors', () => {
  it('no responde CORS si no hay Origin (llamadas server-to-server)', () => {
    expect(evaluateCors(undefined, ['https://a.com'])).toEqual({ origin: null, headers: {} });
  });

  it('nunca usa comodin y respeta la lista permitida', () => {
    const denied = evaluateCors('https://evil.com', ['https://a.com']);
    expect(denied.origin).toBeNull();
    expect(denied.headers).toEqual({});

    const allowed = evaluateCors('https://a.com', ['https://a.com']);
    expect(allowed.headers['Access-Control-Allow-Origin']).toBe('https://a.com');
    expect(Object.values(allowed.headers)).not.toContain('*');
  });

  it('no habilita CORS si no hay origenes configurados', () => {
    expect(evaluateCors('https://a.com', []).headers).toEqual({});
  });
});

describe('RateLimiter', () => {
  it('permite hasta el maximo y luego bloquea', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.check('ip', 0).allowed).toBe(true);
    expect(limiter.check('ip', 100).allowed).toBe(true);
    const blocked = limiter.check('ip', 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('libera la ventana con el paso del tiempo', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check('ip', 0).allowed).toBe(true);
    expect(limiter.check('ip', 500).allowed).toBe(false);
    expect(limiter.check('ip', 1500).allowed).toBe(true);
  });

  it('separa por clave y permite reset', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    limiter.reset();
    expect(limiter.check('a', 0).allowed).toBe(true);
  });
});
