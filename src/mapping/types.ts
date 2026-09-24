/**
 * Modelos normalizados del connector y esquema del mapping configurable.
 *
 * IMPORTANTE: los modelos normalizados NO dependen de nombres de NavaSoft.
 * El mapping JSON conecta columnas reales -> estos campos.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Modelos normalizados (contrato con la API externa)
// ---------------------------------------------------------------------------

export const brandSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .strict();

export const productSchema = z
  .object({
    sourceId: z.string().min(1),
    sku: z.string().nullable(),
    barcode: z.string().nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    brand: brandSchema.nullable(),
    family: z.string().nullable(),
    subfamily: z.string().nullable(),
    group: z.string().nullable(),
    unit: z.string().nullable(),
    active: z.boolean().nullable(),
    sourceUpdatedAt: z.string().nullable(),
  })
  .strict();

export const stockSchema = z
  .object({
    productSourceId: z.string().min(1),
    warehouseSourceId: z.string().nullable(),
    physical: z.number().nullable(),
    reserved: z.number().nullable(),
    committed: z.number().nullable(),
    available: z.number().nullable(),
    sourceUpdatedAt: z.string().nullable(),
  })
  .strict();

export const priceSchema = z
  .object({
    productSourceId: z.string().min(1),
    priceListSourceId: z.string().nullable(),
    amount: z.number(),
    currency: z.string().nullable(),
    taxIncluded: z.boolean().nullable(),
    sourceUpdatedAt: z.string().nullable(),
  })
  .strict();

export const customerSchema = z
  .object({
    sourceId: z.string().min(1),
    taxId: z.string().nullable(),
    businessName: z.string().min(1),
    priceListSourceId: z.string().nullable(),
    active: z.boolean().nullable(),
    sourceUpdatedAt: z.string().nullable(),
  })
  .strict();

export const dictionaryEntrySchema = z
  .object({
    type: z.string().min(1),
    sourceId: z.string().min(1),
    name: z.string().nullable(),
    active: z.boolean().nullable(),
    sourceUpdatedAt: z.string().nullable(),
  })
  .strict();

export type Brand = z.infer<typeof brandSchema>;
export type Product = z.infer<typeof productSchema>;
export type Stock = z.infer<typeof stockSchema>;
export type Price = z.infer<typeof priceSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;

// ---------------------------------------------------------------------------
// Filas canonicas (salida de las queries, entrada de los mappers)
// ---------------------------------------------------------------------------

export interface CanonicalProductRow {
  sourceId: unknown;
  sku?: unknown;
  barcode?: unknown;
  name?: unknown;
  description?: unknown;
  brandId?: unknown;
  brandName?: unknown;
  familyId?: unknown;
  familyName?: unknown;
  subfamilyId?: unknown;
  subfamilyName?: unknown;
  groupId?: unknown;
  groupName?: unknown;
  unitId?: unknown;
  unit?: unknown;
  active?: unknown;
  sourceUpdatedAt?: unknown;
}

export interface CanonicalStockRow {
  productSourceId: unknown;
  warehouseSourceId?: unknown;
  physical?: unknown;
  reserved?: unknown;
  committed?: unknown;
  available?: unknown;
  quantity?: unknown;
  sourceUpdatedAt?: unknown;
}

export interface CanonicalPriceRow {
  productSourceId: unknown;
  priceListSourceId?: unknown;
  amount?: unknown;
  currency?: unknown;
  taxIncluded?: unknown;
  sourceUpdatedAt?: unknown;
}

export interface CanonicalCustomerRow {
  sourceId: unknown;
  taxId?: unknown;
  businessName?: unknown;
  priceListSourceId?: unknown;
  active?: unknown;
  sourceUpdatedAt?: unknown;
}

// ---------------------------------------------------------------------------
// Mapping configurable
// ---------------------------------------------------------------------------

const nonEmpty = z.string().min(1).max(256);
/** Un nombre de tabla `tabla` o `schema.tabla`. */
const tableRef = nonEmpty.regex(/^[^;\u0000]+$/, 'Nombre de tabla invalido');

export const incrementalStrategySchema = z.enum([
  'updated_at',
  'rowversion',
  'watermark',
  'hash',
  'full',
]);

const baseTableMapping = z.object({
  source: tableRef,
  updatedAtColumn: nonEmpty.optional(),
  rowVersionColumn: nonEmpty.optional(),
  watermarkColumn: nonEmpty.optional(),
  strategy: incrementalStrategySchema.optional(),
  /** Filtro adicional (se valida como fragmento seguro antes de usarlo). */
  filter: nonEmpty.optional(),
});

export const productsMappingSchema = baseTableMapping
  .extend({
    idColumn: nonEmpty,
    skuColumn: nonEmpty.optional(),
    barcodeColumn: nonEmpty.optional(),
    nameColumn: nonEmpty.optional(),
    descriptionColumn: nonEmpty.optional(),
    brandIdColumn: nonEmpty.optional(),
    brandNameColumn: nonEmpty.optional(),
    familyIdColumn: nonEmpty.optional(),
    familyNameColumn: nonEmpty.optional(),
    subfamilyIdColumn: nonEmpty.optional(),
    subfamilyNameColumn: nonEmpty.optional(),
    groupIdColumn: nonEmpty.optional(),
    groupNameColumn: nonEmpty.optional(),
    unitIdColumn: nonEmpty.optional(),
    unitColumn: nonEmpty.optional(),
    activeColumn: nonEmpty.optional(),
  })
  .strict();

export const stockMappingSchema = baseTableMapping
  .extend({
    productIdColumn: nonEmpty,
    warehouseIdColumn: nonEmpty.optional(),
    warehouseNameColumn: nonEmpty.optional(),
    physicalColumn: nonEmpty.optional(),
    reservedColumn: nonEmpty.optional(),
    committedColumn: nonEmpty.optional(),
    availableColumn: nonEmpty.optional(),
    /** Columna de cantidad generica si no hay desglose. */
    quantityColumn: nonEmpty.optional(),
  })
  .strict();

export const pricesMappingSchema = baseTableMapping
  .extend({
    productIdColumn: nonEmpty,
    priceListIdColumn: nonEmpty.optional(),
    priceListNameColumn: nonEmpty.optional(),
    amountColumn: nonEmpty,
    currencyColumn: nonEmpty.optional(),
    taxIncludedColumn: nonEmpty.optional(),
  })
  .strict();

export const clientsMappingSchema = baseTableMapping
  .extend({
    idColumn: nonEmpty,
    taxIdColumn: nonEmpty.optional(),
    businessNameColumn: nonEmpty.optional(),
    priceListIdColumn: nonEmpty.optional(),
    activeColumn: nonEmpty.optional(),
  })
  .strict();

export const dictionaryMappingSchema = z
  .object({
    source: tableRef,
    idColumn: nonEmpty,
    nameColumn: nonEmpty.optional(),
    activeColumn: nonEmpty.optional(),
    updatedAtColumn: nonEmpty.optional(),
  })
  .strict();

export const dictionariesMappingSchema = z
  .object({
    brands: dictionaryMappingSchema.optional(),
    families: dictionaryMappingSchema.optional(),
    subfamilies: dictionaryMappingSchema.optional(),
    groups: dictionaryMappingSchema.optional(),
    units: dictionaryMappingSchema.optional(),
    warehouses: dictionaryMappingSchema.optional(),
    priceLists: dictionaryMappingSchema.optional(),
  })
  .strict();

export const mappingSchema = z
  .object({
    products: productsMappingSchema.optional(),
    stock: stockMappingSchema.optional(),
    prices: pricesMappingSchema.optional(),
    clients: clientsMappingSchema.optional(),
    dictionaries: dictionariesMappingSchema.optional(),
  })
  .strict();

export type ProductsMapping = z.infer<typeof productsMappingSchema>;
export type StockMapping = z.infer<typeof stockMappingSchema>;
export type PricesMapping = z.infer<typeof pricesMappingSchema>;
export type ClientsMapping = z.infer<typeof clientsMappingSchema>;
export type DictionaryMapping = z.infer<typeof dictionaryMappingSchema>;
export type DictionariesMapping = z.infer<typeof dictionariesMappingSchema>;
export type MappingConfig = z.infer<typeof mappingSchema>;

export type DatasetMapping = ProductsMapping | StockMapping | PricesMapping | ClientsMapping;

export type DictionaryName = keyof DictionariesMapping;
