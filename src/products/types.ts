import { z } from 'zod';

/**
 * DTO normalizado de un producto de la replica NavaSoft (dbo.ProductoStock).
 *
 * Reglas de normalizacion:
 * - Todas las columnas CHAR salen sin padding (RTRIM en SQL + trim defensivo).
 * - Los textos vacios quedan como null (incluida la marca).
 * - `stock` es numerico decimal (stock total consolidado). No se redondea.
 *
 * Campos de precio: el modelo queda preparado, pero HOY no se pueblan porque
 * la replica no expone precio. Siempre viajan como null.
 */
export const productSchema = z.object({
  code: z.string().min(1),
  manufacturerCode: z.string().nullable(),
  family: z.string().nullable(),
  subfamily: z.string().nullable(),
  productGroup: z.string().nullable(),
  description: z.string(),
  brand: z.string().nullable(),
  unit: z.string().nullable(),
  stock: z.number(),
  // --- Preparado para el futuro (sin datos en la replica actual) ---
  price: z.number().nullable(),
  priceList: z.string().nullable(),
  currency: z.string().nullable(),
});

export type ProductDto = z.infer<typeof productSchema>;

/** Fila cruda tal como la devuelve SQL Server (columnas del SELECT canonico). */
export interface ProductRow {
  code?: unknown;
  manufacturerCode?: unknown;
  family?: unknown;
  subfamily?: unknown;
  productGroup?: unknown;
  description?: unknown;
  brand?: unknown;
  unit?: unknown;
  stock?: unknown;
}

/** Filtros y paginacion ya normalizados para listar productos. */
export interface ProductListQuery {
  page: number;
  limit: number;
  search?: string;
  brand?: string;
  family?: string;
  subfamily?: string;
  group?: string;
  inStock?: boolean;
}

export interface ProductPage {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  data: ProductDto[];
}

export interface ProductsMeta {
  totalProducts: number;
  productsInStock: number;
  productsOutOfStock: number;
  brands: string[];
  families: string[];
  lastReadAt: string | null;
}

/** Contrato que consume la API HTTP local. */
export interface ProductsApi {
  list(query: ProductListQuery): Promise<ProductPage>;
  getByCode(code: string): Promise<ProductDto | null>;
  meta(): Promise<ProductsMeta>;
}
