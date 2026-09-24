import { describe, expect, it } from 'vitest';
import {
  UnsafeQueryError,
  assertReadOnlyQuery,
  assertSafeSqlFragment,
  parseTableName,
  quoteIdentifier,
  quoteQualified,
} from './sql-guard';

describe('sql-guard', () => {
  it('permite SELECT y WITH', () => {
    expect(() => assertReadOnlyQuery('SELECT 1')).not.toThrow();
    expect(() => assertReadOnlyQuery('select * FROM dbo.T')).not.toThrow();
    expect(() =>
      assertReadOnlyQuery('WITH cte AS (SELECT 1 AS x) SELECT * FROM cte'),
    ).not.toThrow();
    expect(() => assertReadOnlyQuery('SELECT TOP (@limit) * FROM [dbo].[T]')).not.toThrow();
  });

  it('no da falsos positivos con columnas tipo updated_at/created_at', () => {
    expect(() =>
      assertReadOnlyQuery(
        "SELECT [UPDATED_AT], [CREATED_AT] FROM dbo.T WHERE [UPDATED_AT] > '2020-01-01'",
      ),
    ).not.toThrow();
  });

  it('rechaza DML y DDL', () => {
    expect(() => assertReadOnlyQuery('INSERT INTO t VALUES (1)')).toThrow(UnsafeQueryError);
    expect(() => assertReadOnlyQuery('UPDATE t SET a = 1')).toThrow(UnsafeQueryError);
    expect(() => assertReadOnlyQuery('DELETE FROM t')).toThrow(UnsafeQueryError);
    expect(() => assertReadOnlyQuery('DROP TABLE t')).toThrow(UnsafeQueryError);
    expect(() => assertReadOnlyQuery('SELECT 1; TRUNCATE TABLE t')).toThrow(UnsafeQueryError);
    expect(() => assertReadOnlyQuery('SELECT 1; EXEC sp_who')).toThrow(UnsafeQueryError);
  });

  it('rechaza multiples sentencias', () => {
    expect(() => assertReadOnlyQuery('SELECT 1; SELECT 2')).toThrow(UnsafeQueryError);
    expect(() => assertReadOnlyQuery('SELECT 1;')).not.toThrow();
  });

  it('ignora literales de string y comentarios', () => {
    expect(() => assertReadOnlyQuery("SELECT 'DELETE FROM t' AS x")).not.toThrow();
    expect(() => assertReadOnlyQuery('SELECT 1 -- UPDATE t')).not.toThrow();
  });

  it('valida fragmentos', () => {
    expect(() => assertSafeSqlFragment('ACTIVO = 1')).not.toThrow();
    expect(() => assertSafeSqlFragment('1 = 1; DROP TABLE t')).toThrow(UnsafeQueryError);
  });

  it('cita identificadores de forma segura', () => {
    expect(quoteIdentifier('ARTICULOS')).toBe('[ARTICULOS]');
    expect(quoteIdentifier('a]b')).toBe('[a]]b]');
    expect(quoteQualified('dbo', 'ART')).toBe('[dbo].[ART]');
    expect(() => quoteIdentifier('')).toThrow(UnsafeQueryError);
    expect(() => quoteIdentifier('a;b')).not.toThrow(); // dentro de [] es literal
    expect(parseTableName('dbo.ART')).toEqual({ schema: 'dbo', table: 'ART' });
    expect(parseTableName('ART')).toEqual({ schema: null, table: 'ART' });
    expect(() => parseTableName('a.b.c')).toThrow(UnsafeQueryError);
  });
});
