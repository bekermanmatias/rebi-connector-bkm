import type { ColumnInfo, TableInfo } from '../db/inspector';
import { getColumnsFor, type DatabaseCatalog } from '../db/metadata';

/**
 * Heuristicas de deteccion para el descubrimiento del esquema NavaSoft.
 * Considera nombres abreviados y en espanol. No asume ningun schema fijo.
 */

export type CandidateCategory =
  | 'products'
  | 'stock'
  | 'prices'
  | 'priceLists'
  | 'clients'
  | 'brands'
  | 'families'
  | 'subfamilies'
  | 'groups'
  | 'units'
  | 'warehouses';

export const CANDIDATE_CATEGORIES: CandidateCategory[] = [
  'products',
  'stock',
  'prices',
  'priceLists',
  'clients',
  'brands',
  'families',
  'subfamilies',
  'groups',
  'units',
  'warehouses',
];

/**
 * Terminos por categoria (minusculas, sin acentos).
 * Se comparan por token: abreviaturas cortas exigen token exacto.
 */
export const CANDIDATE_TERMS: Record<CandidateCategory, string[]> = {
  products: [
    'art',
    'articulo',
    'articulos',
    'prod',
    'producto',
    'productos',
    'item',
    'items',
    'sku',
  ],
  stock: [
    'stock',
    'stk',
    'exist',
    'existencia',
    'existencias',
    'saldo',
    'saldos',
    'disponible',
    'inventario',
  ],
  prices: ['prec', 'precio', 'precios', 'price', 'importe', 'valor'],
  priceLists: ['lisp', 'lista', 'listas', 'tarifa', 'listaprec', 'listaprecio', 'pricelist'],
  clients: ['cli', 'cliente', 'clientes', 'cta', 'cuenta', 'customer'],
  brands: ['marca', 'marcas', 'marc', 'brand'],
  families: ['fam', 'familia', 'familias'],
  subfamilies: ['subfam', 'subfamilia', 'subfamilias'],
  groups: ['gru', 'grupo', 'grupos'],
  units: ['umed', 'unidad', 'unidades', 'unid', 'uni', 'medida', 'medidas'],
  warehouses: [
    'dep',
    'depo',
    'deposito',
    'depositos',
    'alm',
    'almacen',
    'almacenes',
    'bodega',
    'bodegas',
  ],
};

export interface CandidateEvidence {
  matchedNameTokens: string[];
  matchedColumns: string[];
}

export interface CandidateMatch {
  category: CandidateCategory;
  schema: string;
  table: string;
  type: TableInfo['type'];
  score: number;
  rowCount: number | null;
  evidence: CandidateEvidence;
}

export interface DiscoveryCandidates {
  matches: CandidateMatch[];
  byCategory: Record<CandidateCategory, CandidateMatch[]>;
  primaryByCategory: Partial<Record<CandidateCategory, CandidateMatch>>;
}

export function normalizeTokenText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Divide un nombre en tokens por separadores y cambios de camelCase. */
export function tokenize(value: string): string[] {
  return normalizeTokenText(value)
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function tokenMatches(tokens: string[], term: string): boolean {
  for (const token of tokens) {
    if (token === term) return true;
    if (term.length >= 4 && token.startsWith(term)) return true;
    if (token.length >= 4 && term.startsWith(token)) return true;
  }
  return false;
}

function scoreName(tokens: string[], terms: string[]): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;
  for (const term of terms) {
    if (tokenMatches(tokens, term)) {
      matched.push(term);
      score += 3;
    }
  }
  return { score, matched };
}

function scoreColumns(
  columns: ColumnInfo[],
  terms: string[],
): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;
  for (const column of columns) {
    const tokens = tokenize(column.column);
    for (const term of terms) {
      if (tokenMatches(tokens, term) && !matched.includes(column.column)) {
        matched.push(column.column);
        score += 1;
      }
    }
  }
  return { score, matched };
}

/** Puntaje de una tabla para cada categoria. */
export function scoreTable(
  table: TableInfo,
  columns: ColumnInfo[],
  category: CandidateCategory,
): CandidateMatch | null {
  const terms = CANDIDATE_TERMS[category];
  const nameTokens = tokenize(table.name);
  const nameScore = scoreName(nameTokens, terms);
  const columnScore = scoreColumns(columns, terms);
  const score = nameScore.score * 2 + columnScore.score;
  if (score <= 0) return null;
  return {
    category,
    schema: table.schema,
    table: table.name,
    type: table.type,
    score,
    rowCount: table.rowCount,
    evidence: {
      matchedNameTokens: nameScore.matched,
      matchedColumns: columnScore.matched.slice(0, 12),
    },
  };
}

export function findCandidates(catalog: DatabaseCatalog): DiscoveryCandidates {
  const matches: CandidateMatch[] = [];
  const byCategory = Object.fromEntries(
    CANDIDATE_CATEGORIES.map((category) => [category, [] as CandidateMatch[]]),
  ) as Record<CandidateCategory, CandidateMatch[]>;

  for (const table of catalog.tables) {
    const columns = getColumnsFor(catalog, table.schema, table.name);
    for (const category of CANDIDATE_CATEGORIES) {
      const match = scoreTable(table, columns, category);
      if (!match) continue;
      matches.push(match);
      byCategory[category].push(match);
    }
  }

  for (const category of CANDIDATE_CATEGORIES) {
    byCategory[category].sort((a, b) => b.score - a.score || (b.rowCount ?? 0) - (a.rowCount ?? 0));
  }
  matches.sort((a, b) => b.score - a.score);

  const primaryByCategory: Partial<Record<CandidateCategory, CandidateMatch>> = {};
  for (const category of CANDIDATE_CATEGORIES) {
    const best = byCategory[category][0];
    if (best) primaryByCategory[category] = best;
  }

  return { matches, byCategory, primaryByCategory };
}

/** Columnas timestamp/rowversion/utilizadas como cursor de modificacion. */
export function findIncrementalColumns(
  catalog: DatabaseCatalog,
): Array<{
  schema: string;
  table: string;
  column: string;
  kind: 'rowversion' | 'datetime' | 'number';
}> {
  const result: Array<{
    schema: string;
    table: string;
    column: string;
    kind: 'rowversion' | 'datetime' | 'number';
  }> = [];
  const dateTypes = new Set(['datetime', 'datetime2', 'smalldatetime', 'date', 'datetimeoffset']);
  const numericTypes = new Set(['int', 'bigint', 'smallint', 'tinyint']);
  const namePattern = /(fec|fecha|mod|updated|actualiz|timestamp|rowversion|version)/i;

  for (const column of catalog.columns) {
    if (column.isRowVersion) {
      result.push({
        schema: column.schema,
        table: column.table,
        column: column.column,
        kind: 'rowversion',
      });
      continue;
    }
    if (dateTypes.has(column.dataType) && namePattern.test(column.column)) {
      result.push({
        schema: column.schema,
        table: column.table,
        column: column.column,
        kind: 'datetime',
      });
      continue;
    }
    if (numericTypes.has(column.dataType) && /version|rowversion/i.test(column.column)) {
      result.push({
        schema: column.schema,
        table: column.table,
        column: column.column,
        kind: 'number',
      });
    }
  }
  return result;
}
