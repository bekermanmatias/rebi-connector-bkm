/**
 * Autenticacion contra la API externa.
 *
 * Hoy: Bearer token (REMOTE_API_KEY).
 * Manana: se puede reemplazar por HMAC o mTLS implementando AuthStrategy,
 * sin tocar el resto del connector.
 */

export interface AuthContext {
  method: string;
  url: string;
  body: string;
  idempotencyKey?: string;
  requestId?: string;
}

export interface AuthStrategy {
  readonly name: string;
  buildHeaders(context: AuthContext): Record<string, string>;
}

/** Bearer token estatico. */
export function createBearerAuth(apiKey: string): AuthStrategy {
  return {
    name: 'bearer',
    buildHeaders() {
      return { Authorization: `Bearer ${apiKey}` };
    },
  };
}

/**
 * Placeholder documentado para HMAC-SHA256.
 * No se usa todavia, pero deja el punto de extension listo.
 */
export function createHmacAuth(_secret: string): AuthStrategy {
  return {
    name: 'hmac-sha256',
    buildHeaders() {
      throw new Error('Autenticacion HMAC no implementada. Usar Bearer por ahora.');
    },
  };
}
