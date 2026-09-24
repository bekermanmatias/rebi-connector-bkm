import { RETRY_BACKOFF_MS } from '../config/constants';

/**
 * Devuelve el delay de reintento para un intento dado (1-based).
 * delay(1) = 5s, delay(2) = 15s, ... Una vez agotada la tabla, se
 * mantiene el ultimo valor (retry periodico).
 */
export function computeBackoffMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return RETRY_BACKOFF_MS[0];
  const index = Math.min(Math.trunc(attempt) - 1, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[index] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
}

/** Siguiente fecha de reintento (ISO) a partir de `now` y el intento. */
export function nextRetryDate(attempt: number, now: Date = new Date()): string {
  return new Date(now.getTime() + computeBackoffMs(attempt)).toISOString();
}

/** Espera simple. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Calcula el delay para un reintento HTTP inmediato (dentro del mismo intento
 * de envio). Backoff exponencial con jitter, tope de 10s.
 */
export function httpRetryDelayMs(attempt: number, baseMs = 500, maxMs = 10_000): number {
  const exp = baseMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exp, maxMs);
  const jitter = Math.floor(Math.random() * Math.min(250, capped));
  return capped + jitter;
}
