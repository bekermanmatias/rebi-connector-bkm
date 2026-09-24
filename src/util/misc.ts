import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

/** Hash estable (sha256 hex) de un valor serializable. */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value ?? {}).sort());
  return createHash('sha256').update(json).digest('hex');
}

/** Trunca un texto para logs, evitando volcar payloads completos. */
export function truncate(value: string, max = 500): string {
  return value.length <= max ? value : `${value.slice(0, max)}...[truncated]`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Convierte un valor desconocido a string limpio (trim) o null. */
export function toCleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return null;
}

/** Convierte a numero o null si no es numerico. */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const normalized = value.replace(/\s/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Convierte a boolean o null si no se puede interpretar. */
export function toBooleanOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'si', 'sí', 's', 'yes', 'y', 'activo', 'active', 'a'].includes(v))
      return true;
    if (['false', '0', 'no', 'n', 'inactivo', 'inactive', 'i'].includes(v)) return false;
  }
  return null;
}

/** Convierte a ISO string (o null) desde Date/string/number. */
export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
