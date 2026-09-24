import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Crea un directorio (recursivo) si no existe. */
export function ensureDir(dirPath: string): void {
  if (!dirPath) return;
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
}

/** Asegura el directorio contenedor de un archivo. */
export function ensureParentDir(filePath: string): void {
  ensureDir(dirname(filePath));
}

/** Lee y parsea un JSON. Devuelve null si no existe o es invalido. */
export function readJsonSync<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Escritura atomica de JSON: escribe en un archivo temporal y luego renombra.
 * Evita archivos truncados si el proceso muere a mitad de la escritura.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureParentDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  try {
    renameSync(tmp, filePath);
  } catch {
    // En algunos filesystems Windows el rename sobre un archivo existente falla.
    try {
      rmSync(filePath, { force: true });
    } catch {
      /* ignore */
    }
    renameSync(tmp, filePath);
  }
}

export function writeTextAtomic(filePath: string, content: string): void {
  ensureParentDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, 'utf8');
  try {
    renameSync(tmp, filePath);
  } catch {
    try {
      rmSync(filePath, { force: true });
    } catch {
      /* ignore */
    }
    renameSync(tmp, filePath);
  }
}
