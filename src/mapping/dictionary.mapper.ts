import { toBooleanOrNull, toCleanString, toIsoOrNull } from '../util/misc';
import { dictionaryEntrySchema, type DictionaryEntry } from './types';

export interface CanonicalDictionaryRow {
  sourceId: unknown;
  name?: unknown;
  active?: unknown;
  sourceUpdatedAt?: unknown;
}

/** Normaliza una fila de tabla diccionario (marca, familia, deposito, etc.). */
export function mapDictionaryRow(
  row: CanonicalDictionaryRow,
  type: string,
): DictionaryEntry | null {
  const sourceId = toCleanString(row.sourceId);
  if (!sourceId) return null;
  return dictionaryEntrySchema.parse({
    type,
    sourceId,
    name: toCleanString(row.name),
    active: toBooleanOrNull(row.active),
    sourceUpdatedAt: toIsoOrNull(row.sourceUpdatedAt),
  } satisfies DictionaryEntry);
}
