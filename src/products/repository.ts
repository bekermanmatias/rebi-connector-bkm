import { PRODUCTS_TABLE } from '../config/constants';
import { queryScalar, runQuery } from '../db/connection';
import { toNumberOrNull } from '../util/misc';
import { mapProductRow } from './mapper';
import type { ProductDto, ProductListQuery, ProductRow } from './types';

/**
 * Capa unica de acceso a dbo.ProductoStock.
 *
 * Toda lectura de productos pasa por aqui: la query canonica se define una sola
 * vez y todas las variantes (listado, detalle, meta, sync) reutilizan estas
 * mismas columnas. Nunca se interpola input del usuario: todo va por bind params.
 */

/** Columnas del SELECT canonico (CHAR sin padding, marca vacia -> NULL). */
export const PRODUCT_SELECT_COLUMNS = `
  RTRIM(codi) AS code,
  RTRIM(nomfam) AS family,
  RTRIM(nomsub) AS subfamily,
  RTRIM(nomgru) AS productGroup,
  RTRIM(codf) AS manufacturerCode,
  RTRIM(descr) AS description,
  NULLIF(RTRIM(marc), '') AS brand,
  RTRIM(umed) AS unit,
  stoc AS stock
`;

const PRODUCT_FROM = `FROM ${PRODUCTS_TABLE}`;

/** Columnas reales asociadas a cada filtro aceptado (whitelist anti-inyeccion). */
const FILTER_COLUMNS = {
  brand: 'marc',
  family: 'nomfam',
  subfamily: 'nomsub',
  group: 'nomgru',
} as const;

export type ProductFilterKey = keyof typeof FILTER_COLUMNS;

/** Escapa comodines de LIKE para que el termino se trate como texto literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_[]/g, (ch) => `\\${ch}`);
}

function mapRows(rows: ProductRow[]): ProductDto[] {
  return rows.map(mapProductRow).filter((product): product is ProductDto => product !== null);
}

interface WhereParts {
  clauses: string[];
  binds: Record<string, unknown>;
}

function buildWhere(query: ProductListQuery): WhereParts {
  const clauses: string[] = [];
  const binds: Record<string, unknown> = {};

  const search = query.search?.trim();
  if (search) {
    binds.search = `%${escapeLike(search)}%`;
    clauses.push(
      "(RTRIM(codi) LIKE @search ESCAPE '\\' OR RTRIM(descr) LIKE @search ESCAPE '\\'" +
        " OR RTRIM(marc) LIKE @search ESCAPE '\\' OR RTRIM(codf) LIKE @search ESCAPE '\\'" +
        " OR RTRIM(nomfam) LIKE @search ESCAPE '\\' OR RTRIM(nomsub) LIKE @search ESCAPE '\\'" +
        " OR RTRIM(nomgru) LIKE @search ESCAPE '\\')",
    );
  }

  for (const key of Object.keys(FILTER_COLUMNS) as ProductFilterKey[]) {
    const value = key === 'group' ? query.group : query[key];
    if (value) {
      const bindName = `f_${key}`;
      binds[bindName] = value;
      clauses.push(`RTRIM(${FILTER_COLUMNS[key]}) = @${bindName}`);
    }
  }

  if (query.inStock === true) clauses.push('stoc > 0');
  else if (query.inStock === false) clauses.push('stoc <= 0');

  return { clauses, binds };
}

export interface BuiltListQuery {
  text: string;
  binds: Record<string, unknown>;
  countText: string;
  countBinds: Record<string, unknown>;
}

/** Construye (de forma pura y testeable) la query paginada y su COUNT. */
export function buildListQuery(query: ProductListQuery): BuiltListQuery {
  const { clauses, binds } = buildWhere(query);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const offset = (query.page - 1) * query.limit;

  return {
    text:
      `SELECT ${PRODUCT_SELECT_COLUMNS} ${PRODUCT_FROM} ${where}` +
      ' ORDER BY codi OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY',
    binds: { ...binds, offset, limit: query.limit },
    countText: `SELECT COUNT(*) AS total ${PRODUCT_FROM} ${where}`,
    countBinds: { ...binds },
  };
}

export interface ListProductsResult {
  rows: ProductDto[];
  total: number;
}

export async function listProducts(query: ProductListQuery): Promise<ListProductsResult> {
  const { text, binds, countText, countBinds } = buildListQuery(query);
  const [page, count] = await Promise.all([
    runQuery<ProductRow>(text, binds),
    queryScalar<unknown>(countText, countBinds),
  ]);
  return { rows: mapRows(page.rows), total: toNumberOrNull(count) ?? 0 };
}

/** Pagina simple (sin filtros) usada por la sincronizacion hacia BKM. */
export async function listProductsPage(page: number, limit: number): Promise<ProductDto[]> {
  const query: ProductListQuery = { page, limit };
  const { text, binds } = buildListQuery(query);
  const { rows } = await runQuery<ProductRow>(text, binds);
  return mapRows(rows);
}

export async function getProductByCode(code: string): Promise<ProductDto | null> {
  const text = `SELECT ${PRODUCT_SELECT_COLUMNS} ${PRODUCT_FROM} WHERE codi = @code`;
  const { rows } = await runQuery<ProductRow>(text, { code });
  return mapRows(rows)[0] ?? null;
}

export async function countAllProducts(): Promise<number> {
  const total = await queryScalar<unknown>(`SELECT COUNT(*) AS total ${PRODUCT_FROM}`);
  return toNumberOrNull(total) ?? 0;
}

export interface ProductCounts {
  total: number;
  inStock: number;
}

export async function getProductCounts(): Promise<ProductCounts> {
  const text = `SELECT COUNT(*) AS total, SUM(CASE WHEN stoc > 0 THEN 1 ELSE 0 END) AS inStock ${PRODUCT_FROM}`;
  const { rows } = await runQuery<{ total?: unknown; inStock?: unknown }>(text);
  const row = rows[0];
  return {
    total: toNumberOrNull(row?.total) ?? 0,
    inStock: toNumberOrNull(row?.inStock) ?? 0,
  };
}

export async function getDistinctProductValues(key: ProductFilterKey): Promise<string[]> {
  const column = FILTER_COLUMNS[key];
  const text =
    `SELECT DISTINCT RTRIM(${column}) AS label ${PRODUCT_FROM} ` +
    `WHERE RTRIM(${column}) <> '' ORDER BY label`;
  const { rows } = await runQuery<{ label?: unknown }>(text);
  return rows
    .map((row) => (typeof row.label === 'string' ? row.label.trim() : ''))
    .filter((value) => value.length > 0);
}
