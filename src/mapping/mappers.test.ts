import { describe, expect, it } from 'vitest';
import { mapCustomerRow } from './client.mapper';
import { mapPriceRow } from './price.mapper';
import { mapProductRow } from './product.mapper';
import { mapStockRow } from './stock.mapper';

describe('mappers', () => {
  it('normaliza productos', () => {
    const product = mapProductRow({
      sourceId: 10,
      sku: '  A1 ',
      name: '  Martillo  ',
      brandId: 5,
      brandName: 'Stanley',
      active: 1,
      sourceUpdatedAt: new Date('2024-01-02T03:04:05Z'),
    });
    expect(product).not.toBeNull();
    expect(product?.sourceId).toBe('10');
    expect(product?.sku).toBe('A1');
    expect(product?.name).toBe('Martillo');
    expect(product?.brand).toEqual({ id: '5', name: 'Stanley' });
    expect(product?.active).toBe(true);
    expect(product?.sourceUpdatedAt).toBe('2024-01-02T03:04:05.000Z');
  });

  it('usa diccionario de marca cuando no viene el nombre', () => {
    const product = mapProductRow(
      { sourceId: 1, name: 'X', brandId: 7 },
      { dictionaries: { brands: new Map([['7', 'Marca Siete']]) } },
    );
    expect(product?.brand).toEqual({ id: '7', name: 'Marca Siete' });
  });

  it('devuelve null si falta el id', () => {
    expect(mapProductRow({ sourceId: null, name: 'X' })).toBeNull();
  });

  it('normaliza stock y calcula disponible', () => {
    const stock = mapStockRow({ productSourceId: 1, physical: 10, reserved: 3, committed: 2 });
    expect(stock?.available).toBe(5);
    expect(mapStockRow({ productSourceId: null })).toBeNull();
  });

  it('normaliza precios y exige monto', () => {
    const price = mapPriceRow({ productSourceId: 1, amount: '12,5', taxIncluded: 'si' });
    expect(price?.amount).toBe(12.5);
    expect(price?.taxIncluded).toBe(true);
    expect(mapPriceRow({ productSourceId: 1 })).toBeNull();
  });

  it('normaliza clientes', () => {
    const customer = mapCustomerRow({ sourceId: 99, taxId: '20123456789', active: 'no' });
    expect(customer?.businessName).toBe('20123456789');
    expect(customer?.active).toBe(false);
    expect(mapCustomerRow({ sourceId: null })).toBeNull();
  });
});
