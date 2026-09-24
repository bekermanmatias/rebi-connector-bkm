/**
 * Constantes globales del connector.
 * Nada aqui debe depender de nombres reales de NavaSoft.
 */

export const APP_NAME = 'cooperacion-navasoft-connector';
export const APP_VERSION = '0.1.0';

/** Datasets que el connector sabe sincronizar. */
export const DATASETS = ['products', 'stock', 'prices', 'clients', 'dictionaries'] as const;
export type Dataset = (typeof DATASETS)[number];

/**
 * Backoff de reintentos de la queue local (ms).
 * Se aplica por intento: intento 1 -> 5s, intento 2 -> 15s, ...
 * Una vez agotada la lista se mantiene el ultimo valor (retry periodico).
 */
export const RETRY_BACKOFF_MS = [
  5_000, 15_000, 30_000, 60_000, 300_000, 900_000, 1_800_000,
] as const;

/** Cantidad maxima de intentos antes de marcar FAILED definitivo. */
export const MAX_QUEUE_ATTEMPTS = 20;

/** Si un batch quedo en SENDING mas de esto, se considera huerfano y vuelve a PENDING. */
export const STALE_SENDING_MS = 5 * 60 * 1000;

/** Endpoints de la API externa (relativos a REMOTE_API_BASE_URL). */
export const REMOTE_ENDPOINTS: Record<Dataset, string> = {
  products: '/integrations/navasoft/products/batch',
  stock: '/integrations/navasoft/stock/batch',
  prices: '/integrations/navasoft/prices/batch',
  clients: '/integrations/navasoft/clients/batch',
  dictionaries: '/integrations/navasoft/dictionaries/batch',
};

export const REMOTE_HEARTBEAT_ENDPOINT = '/integrations/navasoft/heartbeat';

export const DEFAULT_REMOTE_BATCH_SIZE = 500;

/** Cantidad de filas leidas por pagina desde SQL Server en un full sync. */
export const DEFAULT_PAGE_SIZE = 1000;

/** Limite por defecto para `db:sample`. */
export const DEFAULT_SAMPLE_LIMIT = 20;

/** Limite por defecto de filas de muestra guardadas en el reporte de discovery. */
export const DEFAULT_DISCOVERY_SAMPLE_LIMIT = 10;

/** Cantidad maxima de filas de catalogo (tablas/columnas) que se traen de una sola vez. */
export const CATALOG_PAGE_SIZE = 5000;

/** Carpetas por defecto del proyecto, relativas al cwd. */
export const DEFAULT_DATA_DIR = './data';
export const DEFAULT_LOG_DIR = './logs';
export const DEFAULT_DISCOVERY_DIR = './docs';
export const DEFAULT_MAPPING_PATH = './config/mapping.json';
export const DEFAULT_MAPPING_EXAMPLE_PATH = './config/mapping.example.json';
