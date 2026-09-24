import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_MAPPING_EXAMPLE_PATH } from '../config/constants';
import { getEnv } from '../config/env';
import { readJsonSync } from '../util/fs-atomic';
import { mappingSchema, type MappingConfig } from './types';

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MappingError';
  }
}

export interface LoadedMapping {
  path: string;
  isExample: boolean;
  config: MappingConfig;
}

function parseMapping(path: string, isExample: boolean): LoadedMapping {
  const raw = readJsonSync<unknown>(path);
  if (raw === null) {
    throw new MappingError(`No se pudo leer el archivo de mapping: ${path}`);
  }
  const result = mappingSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new MappingError(`Mapping invalido en ${path}:\n${details}`);
  }
  return { path, isExample, config: result.data };
}

/**
 * Carga el mapping real (MAPPING_PATH). Si no existe, cae al example
 * y lo marca con isExample=true para que el resto del sistema advierta.
 */
export function loadMapping(explicitPath?: string): LoadedMapping {
  const env = getEnv();
  const primary = explicitPath ?? env.MAPPING_PATH;
  if (existsSync(primary)) return parseMapping(primary, false);

  const example = resolve(DEFAULT_MAPPING_EXAMPLE_PATH);
  if (existsSync(example)) return parseMapping(example, true);

  throw new MappingError(
    `No se encontro mapping. Cree ${primary} a partir de ${DEFAULT_MAPPING_EXAMPLE_PATH}.`,
  );
}

export function hasMapping(
  mapping: MappingConfig,
  dataset: 'products' | 'stock' | 'prices' | 'clients',
): boolean {
  return Boolean(mapping[dataset]);
}
