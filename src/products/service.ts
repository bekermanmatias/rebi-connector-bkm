import { PRODUCTS_DEFAULT_LIMIT, PRODUCTS_MAX_LIMIT } from '../config/constants';
import { runtime } from '../runtime/context';
import {
  countAllProducts,
  getDistinctProductValues,
  getProductByCode,
  getProductCounts,
  listProducts,
  listProductsPage,
} from './repository';
import type { ProductDto, ProductListQuery, ProductsApi, ProductPage, ProductsMeta } from './types';

/** Normaliza page/limit a rangos seguros. */
export function normalizeListQuery(input: Partial<ProductListQuery>): ProductListQuery {
  const page =
    Number.isFinite(input.page) && (input.page as number) >= 1
      ? Math.trunc(input.page as number)
      : 1;
  const rawLimit =
    Number.isFinite(input.limit) && (input.limit as number) >= 1
      ? Math.trunc(input.limit as number)
      : PRODUCTS_DEFAULT_LIMIT;
  const limit = Math.min(rawLimit, PRODUCTS_MAX_LIMIT);
  return {
    page,
    limit,
    search: input.search?.trim() || undefined,
    brand: input.brand?.trim() || undefined,
    family: input.family?.trim() || undefined,
    subfamily: input.subfamily?.trim() || undefined,
    group: input.group?.trim() || undefined,
    inStock: input.inStock,
  };
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'si', 'sí']);
const FALSE_VALUES = new Set(['false', '0', 'no']);

/** Parsea los query params HTTP de GET /products. */
export function parseListQuery(params: URLSearchParams): ProductListQuery {
  const pageRaw = params.get('page');
  const limitRaw = params.get('limit');
  const inStockRaw = params.get('inStock');

  let inStock: boolean | undefined;
  if (inStockRaw !== null) {
    const value = inStockRaw.trim().toLowerCase();
    if (TRUE_VALUES.has(value)) inStock = true;
    else if (FALSE_VALUES.has(value)) inStock = false;
  }

  return normalizeListQuery({
    page: pageRaw !== null ? Number.parseInt(pageRaw, 10) : undefined,
    limit: limitRaw !== null ? Number.parseInt(limitRaw, 10) : undefined,
    search: params.get('search') ?? undefined,
    brand: params.get('brand') ?? undefined,
    family: params.get('family') ?? undefined,
    subfamily: params.get('subfamily') ?? undefined,
    group: params.get('group') ?? undefined,
    inStock,
  });
}

export class ProductService implements ProductsApi {
  async list(query: ProductListQuery): Promise<ProductPage> {
    const normalized = normalizeListQuery(query);
    const { rows, total } = await listProducts(normalized);
    const totalPages = normalized.limit > 0 ? Math.ceil(total / normalized.limit) : 0;
    return {
      page: normalized.page,
      limit: normalized.limit,
      total,
      totalPages,
      data: rows,
    };
  }

  async getByCode(code: string): Promise<ProductDto | null> {
    return getProductByCode(code);
  }

  async meta(): Promise<ProductsMeta> {
    const counts = await getProductCounts();
    const [brands, families] = await Promise.all([
      getDistinctProductValues('brand'),
      getDistinctProductValues('family'),
    ]);
    return {
      totalProducts: counts.total,
      productsInStock: counts.inStock,
      productsOutOfStock: Math.max(0, counts.total - counts.inStock),
      brands,
      families,
      lastReadAt: runtime.lastDbReadAt,
    };
  }
}

/** Fuente paginada que consume el sync hacia BKM. */
export interface ProductSyncSource {
  count(): Promise<number>;
  page(page: number, limit: number): Promise<ProductDto[]>;
}

export function createProductSyncSource(): ProductSyncSource {
  return {
    count: countAllProducts,
    page: listProductsPage,
  };
}
