import type { DatasetQueryOptions } from '../db/queries/products';
import { buildClientsQuery } from '../db/queries/clients';
import { buildDictionaryQuery } from '../db/queries/dictionaries';
import { buildPricesQuery } from '../db/queries/prices';
import { buildProductsQuery } from '../db/queries/products';
import { buildStockQuery } from '../db/queries/stock';
import { mapCustomerRow } from '../mapping/client.mapper';
import { mapDictionaryRow, type CanonicalDictionaryRow } from '../mapping/dictionary.mapper';
import { mapPriceRow } from '../mapping/price.mapper';
import { mapProductRow, type ProductMapperContext } from '../mapping/product.mapper';
import { mapStockRow } from '../mapping/stock.mapper';
import type {
  CanonicalCustomerRow,
  CanonicalPriceRow,
  CanonicalProductRow,
  CanonicalStockRow,
  ClientsMapping,
  MappingConfig,
  PricesMapping,
  ProductsMapping,
  StockMapping,
} from '../mapping/types';
import type { DatasetQuery } from '../db/queries/base';

export type SyncDataset = 'products' | 'stock' | 'prices' | 'clients';

export type NormalizedRecord = Record<string, unknown>;

export interface DatasetPipeline {
  dataset: SyncDataset;
  buildQuery(options?: DatasetQueryOptions): DatasetQuery;
  mapRow(row: Record<string, unknown>, context?: ProductMapperContext): NormalizedRecord | null;
}

export class MappingNotConfiguredError extends Error {
  constructor(dataset: string) {
    super(
      `El dataset "${dataset}" no tiene mapping configurado. ` +
        `Completar config/mapping.json (ver docs/DATABASE_MAPPING.md).`,
    );
    this.name = 'MappingNotConfiguredError';
  }
}

export function getMappingEntry(
  dataset: SyncDataset,
  config: MappingConfig,
): ProductsMapping | StockMapping | PricesMapping | ClientsMapping | undefined {
  return config[dataset];
}

export function getPipeline(dataset: SyncDataset, config: MappingConfig): DatasetPipeline {
  switch (dataset) {
    case 'products': {
      const mapping = config.products;
      if (!mapping) throw new MappingNotConfiguredError(dataset);
      return {
        dataset,
        buildQuery: (options) => buildProductsQuery(mapping, options),
        mapRow: (row, context) =>
          mapProductRow(row as unknown as CanonicalProductRow, context) as NormalizedRecord | null,
      };
    }
    case 'stock': {
      const mapping = config.stock;
      if (!mapping) throw new MappingNotConfiguredError(dataset);
      return {
        dataset,
        buildQuery: (options) => buildStockQuery(mapping, options),
        mapRow: (row) =>
          mapStockRow(row as unknown as CanonicalStockRow) as NormalizedRecord | null,
      };
    }
    case 'prices': {
      const mapping = config.prices;
      if (!mapping) throw new MappingNotConfiguredError(dataset);
      return {
        dataset,
        buildQuery: (options) => buildPricesQuery(mapping, options),
        mapRow: (row) =>
          mapPriceRow(row as unknown as CanonicalPriceRow) as NormalizedRecord | null,
      };
    }
    case 'clients': {
      const mapping = config.clients;
      if (!mapping) throw new MappingNotConfiguredError(dataset);
      return {
        dataset,
        buildQuery: (options) => buildClientsQuery(mapping, options),
        mapRow: (row) =>
          mapCustomerRow(row as unknown as CanonicalCustomerRow) as NormalizedRecord | null,
      };
    }
  }
}

export interface DictionaryBuild {
  type: string;
  buildQuery: () => DatasetQuery;
  mapRow: (row: Record<string, unknown>) => NormalizedRecord | null;
}

/** Diccionarios configurados (marcas, familias, depositos, etc). */
export function getDictionaryBuilds(config: MappingConfig): DictionaryBuild[] {
  const dicts = config.dictionaries;
  if (!dicts) return [];
  const builds: DictionaryBuild[] = [];
  for (const [type, mapping] of Object.entries(dicts)) {
    if (!mapping) continue;
    builds.push({
      type,
      buildQuery: () => buildDictionaryQuery(mapping),
      mapRow: (row) =>
        mapDictionaryRow(row as unknown as CanonicalDictionaryRow, type) as NormalizedRecord | null,
    });
  }
  return builds;
}

/** Identificador de origen de un registro normalizado, para dedupe/hash. */
export function recordId(dataset: SyncDataset, record: NormalizedRecord): string | null {
  const key =
    dataset === 'clients' ? 'sourceId' : dataset === 'products' ? 'sourceId' : 'productSourceId';
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export type { DatasetQuery, DatasetQueryOptions };
