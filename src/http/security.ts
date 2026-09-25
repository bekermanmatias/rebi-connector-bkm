import { timingSafeEqual } from 'node:crypto';

/** Comparacion de strings en tiempo constante (evita timing attacks). */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Extrae el token de un header Authorization: Bearer <token>. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/** Valida el header Authorization contra el token esperado. */
export function isAuthorized(header: string | undefined, expectedToken: string): boolean {
  const token = extractBearerToken(header);
  if (!token) return false;
  return safeCompare(token, expectedToken);
}

/** Parsea CORS_ALLOWED_ORIGINS (lista separada por comas). */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export interface CorsResult {
  origin: string | null;
  headers: Record<string, string>;
}

/**
 * CORS cerrado por defecto: solo se responde con cabeceras si el Origin
 * entrante esta explicitamente en la lista permitida. Nunca se usa "*".
 */
export function evaluateCors(
  requestOrigin: string | undefined,
  allowedOrigins: string[],
): CorsResult {
  if (!requestOrigin || allowedOrigins.length === 0 || !allowedOrigins.includes(requestOrigin)) {
    return { origin: null, headers: {} };
  }
  return {
    origin: requestOrigin,
    headers: {
      'Access-Control-Allow-Origin': requestOrigin,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    },
  };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Rate limiter en memoria (ventana fija deslizante por clave). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const windowStart = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

    if (list.length >= this.max) {
      this.hits.set(key, list);
      const oldest = list[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    list.push(now);
    this.hits.set(key, list);
    return { allowed: true, remaining: Math.max(0, this.max - list.length), retryAfterSeconds: 0 };
  }

  reset(): void {
    this.hits.clear();
  }
}
