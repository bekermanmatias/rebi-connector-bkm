import { DEFAULT_PAGE_SIZE } from '../config/constants';
import { runQuery } from '../db/connection';
import type { DatasetQuery } from '../db/queries/base';

export interface PaginateOptions {
  query: DatasetQuery;
  pageSize?: number;
  binds?: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Itera las filas de una query paginada (OFFSET/FETCH) pagina por pagina.
 * Corta cuando una pagina vuelve incompleta.
 */
export async function* paginate<T = Record<string, unknown>>(
  options: PaginateOptions,
): AsyncGenerator<T[], void, void> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  let offset = 0;

  for (;;) {
    const { rows } = await runQuery<T>(
      options.query.sql,
      { ...(options.binds ?? {}), offset, pageSize },
      { timeoutMs: options.timeoutMs },
    );
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < pageSize) return;
    offset += rows.length;
  }
}
