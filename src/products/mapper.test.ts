import { describe, expect, it } from 'vitest';
import { mapProductRow } from './mapper';

describe('mapProductRow', () => {
  it('quita el padding de columnas CHAR', () => {
    const product = mapProductRow({
      code: 'ABC123     ',
      family: 'FERRETERIA                          ',
      subfamily: 'HERRAMIENTAS                        ',
      productGroup: 'MANUAL                              ',
      manufacturerCode: 'NICOLL              ',
      description: 'Tornillo hexagonal',
      brand: 'NICOLL              ',
      unit: 'UN ',
      stock: 12,
    });

    expect(product).toEqual({
      code: 'ABC123',
      family: 'FERRETERIA',
      subfamily: 'HERRAMIENTAS',
      productGroup: 'MANUAL',
      manufacturerCode: 'NICOLL',
      description: 'Tornillo hexagonal',
      brand: 'NICOLL',
      unit: 'UN',
      stock: 12,
      price: null,
      priceList: null,
      currency: null,
    });
  });

  it('convierte marca vacia (o solo espacios) en null', () => {
    expect(mapProductRow({ code: 'A', brand: '' })?.brand).toBeNull();
    expect(mapProductRow({ code: 'A', brand: '    ' })?.brand).toBeNull();
    expect(mapProductRow({ code: 'A', brand: null })?.brand).toBeNull();
  });

  it('conserva stock decimal sin redondear', () => {
    expect(mapProductRow({ code: 'A', stock: 12.5 })?.stock).toBe(12.5);
    expect(mapProductRow({ code: 'A', stock: '7.250' })?.stock).toBe(7.25);
    // 2265 productos con stock 0 deben conservarse como 0.
    expect(mapProductRow({ code: 'A', stock: 0 })?.stock).toBe(0);
  });

  it('normaliza textos opcionales vacios a null', () => {
    const product = mapProductRow({ code: 'A', description: '  ', family: '', unit: '   ' });
    expect(product?.description).toBe('');
    expect(product?.family).toBeNull();
    expect(product?.unit).toBeNull();
  });

  it('descarta filas sin code', () => {
    expect(mapProductRow({ code: '' })).toBeNull();
    expect(mapProductRow({ code: '   ' })).toBeNull();
    expect(mapProductRow({})).toBeNull();
  });

  it('deja los campos de precio preparados pero vacios', () => {
    const product = mapProductRow({ code: 'A' });
    expect(product?.price).toBeNull();
    expect(product?.priceList).toBeNull();
    expect(product?.currency).toBeNull();
  });
});
