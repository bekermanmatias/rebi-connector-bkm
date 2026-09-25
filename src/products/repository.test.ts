import { describe, expect, it } from 'vitest';
import { assertReadOnlyQuery } from '../db/sql-guard';
import { buildListQuery, escapeLike } from './repository';

describe('escapeLike', () => {
  it('escapa comodines y corchetes', () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    // En LIKE basta escapar el corchete de apertura; el cierre queda literal.
    expect(escapeLike('[x]')).toBe('\\[x]');
    expect(escapeLike('c\\d')).toBe('c\\\\d');
    expect(escapeLike('normal')).toBe('normal');
  });
});

describe('buildListQuery', () => {
  it('pagina con OFFSET/FETCH y bind params', () => {
    const built = buildListQuery({ page: 3, limit: 20 });
    expect(built.text).toContain('ORDER BY codi OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY');
    expect(built.binds.offset).toBe(40);
    expect(built.binds.limit).toBe(20);
    expect(built.countText).not.toContain('OFFSET');
    expect(built.countText).toContain('COUNT(*)');
    assertReadOnlyQuery(built.text);
    assertReadOnlyQuery(built.countText);
  });

  it('busca por termino sin interpolar el valor', () => {
    const built = buildListQuery({ page: 1, limit: 50, search: 'nicoll' });
    expect(built.binds.search).toBe('%nicoll%');
    expect(built.text).toContain('@search');
    expect(built.text).not.toContain('nicoll');
    assertReadOnlyQuery(built.text);
  });

  it('neutraliza comodines y evita inyeccion via search', () => {
    const malicious = "'; DROP TABLE dbo.ProductoStock; --";
    const built = buildListQuery({ page: 1, limit: 10, search: malicious });
    expect(built.text).not.toContain('DROP');
    expect(built.binds.search).toBe(`%${escapeLike(malicious)}%`);
    expect(() => assertReadOnlyQuery(built.text)).not.toThrow();
  });

  it('aplica filtros como binds (marca, familia, subfamilia, grupo)', () => {
    const built = buildListQuery({
      page: 1,
      limit: 10,
      brand: 'NICOLL',
      family: 'FERRETERIA',
      subfamily: 'HERRAMIENTAS',
      group: 'MANUAL',
    });
    expect(built.binds.f_brand).toBe('NICOLL');
    expect(built.binds.f_family).toBe('FERRETERIA');
    expect(built.binds.f_subfamily).toBe('HERRAMIENTAS');
    expect(built.binds.f_group).toBe('MANUAL');
    expect(built.text).toContain('RTRIM(marc) = @f_brand');
    expect(built.text).toContain('RTRIM(nomgru) = @f_group');
    expect(built.text).toContain('WHERE');
  });

  it('traduce inStock a condiciones de stock', () => {
    expect(buildListQuery({ page: 1, limit: 10, inStock: true }).text).toContain('stoc > 0');
    expect(buildListQuery({ page: 1, limit: 10, inStock: false }).text).toContain('stoc <= 0');
    expect(buildListQuery({ page: 1, limit: 10 }).text).not.toContain('stoc >');
  });

  it('siempre lee la tabla real dbo.ProductoStock', () => {
    const built = buildListQuery({ page: 1, limit: 1 });
    expect(built.text).toContain('FROM dbo.ProductoStock');
    expect(built.countText).toContain('FROM dbo.ProductoStock');
  });
});
