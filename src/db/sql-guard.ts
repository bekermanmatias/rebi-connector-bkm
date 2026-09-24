/**
 * Guard de seguridad para SQL.
 *
 * Aunque la replica es READ ONLY a nivel de permisos, el connector agrega su
 * propia proteccion: toda query configurable debe empezar con SELECT o WITH y
 * no puede contener sentencias de escritura/DDL/ejecucion.
 */

export class UnsafeQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeQueryError';
  }
}

const ALLOWED_START = /^\s*(select|with)\b/i;

/**
 * Palabras prohibidas. Se evaluan sobre la query SIN literales de string ni
 * comentarios, para evitar falsos positivos (por ejemplo un valor 'DELETE').
 *
 * Los lookarounds de identificador evitan rechazar columnas legitimas que
 * contienen una palabra clave como prefijo (p.ej. `updated_at`, `created_by`).
 */
const FORBIDDEN_KEYWORDS =
  /(?<![A-Za-z0-9_])(insert|update|delete|merge|drop|alter|truncate|create|replace|exec|execute|grant|revoke|deny|backup|restore|shutdown|reconfigure|dbcc|bulk|openrowset|opendatasource|openquery)(?![A-Za-z0-9_])/i;

/** Prefijos de procedimientos extendidos / del sistema. */
const FORBIDDEN_PREFIXES = /(?<![A-Za-z0-9_])(sp_|xp_)[A-Za-z0-9_]*/i;

/** Quita literales de string, identificadores entre corchetes y comentarios. */
export function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Comentario de linea
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // Comentario de bloque
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // String literal
    if (ch === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    // Identificador entre corchetes
    if (ch === '[') {
      i++;
      while (i < n && sql[i] !== ']') i++;
      i++;
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Lanza UnsafeQueryError si la query no es estrictamente de lectura.
 * - Debe comenzar con SELECT o WITH.
 * - No puede contener palabras de escritura/DDL.
 * - No puede encadenar multiples sentencias (punto y coma intermedio).
 */
export function assertReadOnlyQuery(sql: string): void {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new UnsafeQueryError('La query SQL esta vacia.');
  }
  if (!ALLOWED_START.test(sql)) {
    throw new UnsafeQueryError(
      'Solo se permiten queries de lectura que comiencen con SELECT o WITH.',
    );
  }

  const scan = stripLiteralsAndComments(sql);
  const match = FORBIDDEN_KEYWORDS.exec(scan);
  if (match) {
    throw new UnsafeQueryError(
      `Query rechazada: contiene la palabra prohibida "${match[0]}". Solo se permite lectura.`,
    );
  }
  const prefixMatch = FORBIDDEN_PREFIXES.exec(scan);
  if (prefixMatch) {
    throw new UnsafeQueryError(
      `Query rechazada: contiene el prefijo prohibido "${prefixMatch[0]}". Solo se permite lectura.`,
    );
  }

  // Multiples sentencias: un ';' que no sea el ultimo caracter significativo.
  const withoutTrailing = scan.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new UnsafeQueryError('Query rechazada: no se permiten multiples sentencias.');
  }
}

/**
 * Valida un fragmento de SQL configurable (por ejemplo un WHERE) para
 * asegurarse de que no introduce escritura ni sentencias adicionales.
 * No exige que empiece con SELECT.
 */
export function assertSafeSqlFragment(fragment: string, label = 'fragmento SQL'): void {
  if (typeof fragment !== 'string') {
    throw new UnsafeQueryError(`${label} invalido.`);
  }
  const scan = stripLiteralsAndComments(fragment);
  if (scan.includes(';')) {
    throw new UnsafeQueryError(`${label} rechazado: no se permiten multiples sentencias.`);
  }
  const match = FORBIDDEN_KEYWORDS.exec(scan) ?? FORBIDDEN_PREFIXES.exec(scan);
  if (match) {
    throw new UnsafeQueryError(`${label} rechazado: contiene "${match[0]}".`);
  }
}

/**
 * Cita un identificador SQL Server de forma segura.
 * Rechaza caracteres de control y saltos; el resto se escapa segun el
 * estandar de corchetes ([nombre] con ] duplicado).
 */
export function quoteIdentifier(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new UnsafeQueryError('Identificador SQL vacio.');
  }
  if (name.length > 128) {
    throw new UnsafeQueryError(`Identificador SQL demasiado largo: ${name.length} caracteres.`);
  }
  if (/[\u0000-\u001f]/.test(name)) {
    throw new UnsafeQueryError('Identificador SQL con caracteres de control.');
  }
  return `[${name.replace(/\]/g, ']]')}]`;
}

/** Cita schema.tabla. */
export function quoteQualified(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

/** Valida que un nombre de tabla opcional `schema.tabla` o `tabla` sea seguro. */
export function parseTableName(input: string): { schema: string | null; table: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new UnsafeQueryError('Nombre de tabla vacio.');
  const parts = trimmed.split('.');
  if (parts.length > 2) {
    throw new UnsafeQueryError(`Nombre de tabla invalido: ${input}`);
  }
  if (parts.length === 1) {
    return { schema: null, table: parts[0] as string };
  }
  return { schema: parts[0] as string, table: parts[1] as string };
}
