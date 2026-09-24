# Database Mapping

El connector desacopla el esquema real de NavaSoft del resto del sistema mediante
un archivo de mapping (`config/mapping.json`) validado con Zod.

- **No** se hardcodean tablas ni columnas de NavaSoft.
- Si cambia el esquema, se ajusta el mapping y, como máximo, un query builder.
- `config/mapping.example.json` es un **ejemplo** con tablas `*_EXAMPLE`. No es real.

## Cómo obtener el mapping real

1. `npm run discovery`.
2. Abrir `docs/discovery-report.md`, sección "Mapping sugerido (EXAMPLE - REVISAR)".
3. Copiar ese JSON a `config/mapping.json`, corregir nombres y quitar campos que no existan.
4. Verificar con `npm run sync:products -- --dry-run`.

`config/mapping.json` está en `.gitignore` (contiene nombres reales del cliente).
Solo `config/mapping.example.json` se versiona.

## Estructura

```jsonc
{
  "products": {
    "source": "dbo.ARTICULOS",   // tabla o vista: "tabla" o "schema.tabla"
    "idColumn": "ID_ARTICULO",   // obligatorio
    "skuColumn": "CODIGO",
    "barcodeColumn": "CODIGO_BARRA",
    "nameColumn": "DESCRIPCION",
    "descriptionColumn": "DESCRIPCION_LARGA",
    "brandIdColumn": "ID_MARCA",
    "brandNameColumn": "NOM_MARCA",     // opcional si se usan diccionarios
    "familyIdColumn": "ID_FAMILIA",
    "subfamilyIdColumn": "ID_SUBFAMILIA",
    "groupIdColumn": "ID_GRUPO",
    "unitColumn": "UMED",
    "activeColumn": "ACTIVO",
    "updatedAtColumn": "FECHA_MOD",
    "rowVersionColumn": "RV",           // alternativa a updatedAt
    "strategy": "updated_at"
  },
  "stock": {
    "source": "dbo.STOCK",
    "productIdColumn": "ID_ARTICULO",
    "warehouseIdColumn": "ID_DEPOSITO",
    "physicalColumn": "STOCK",
    "reservedColumn": "RESERVADO",
    "committedColumn": "PEDIDO",
    "availableColumn": "DISPONIBLE",
    "quantityColumn": "CANTIDAD",       // usar si no hay desglose
    "updatedAtColumn": "FECHA_MOD"
  },
  "prices": {
    "source": "dbo.PRECIOS",
    "productIdColumn": "ID_ARTICULO",
    "priceListIdColumn": "ID_LISTA",
    "amountColumn": "PRECIO",           // obligatorio
    "currencyColumn": "MONEDA",
    "taxIncludedColumn": "IGV_INCLUIDO",
    "updatedAtColumn": "FECHA_MOD"
  },
  "clients": {
    "source": "dbo.CLIENTES",
    "idColumn": "ID_CLIENTE",
    "taxIdColumn": "RUC",
    "businessNameColumn": "RAZON_SOCIAL",
    "priceListIdColumn": "ID_LISTA",
    "activeColumn": "ACTIVO",
    "updatedAtColumn": "FECHA_MOD"
  },
  "dictionaries": {
    "brands":     { "source": "dbo.MARCAS",     "idColumn": "ID_MARCA",    "nameColumn": "NOMBRE" },
    "families":   { "source": "dbo.FAMILIAS",   "idColumn": "ID_FAMILIA",  "nameColumn": "NOMBRE" },
    "subfamilies":{ "source": "dbo.SUBFAMILIAS","idColumn": "ID_SUBFAMILIA","nameColumn": "NOMBRE" },
    "groups":     { "source": "dbo.GRUPOS",     "idColumn": "ID_GRUPO",    "nameColumn": "NOMBRE" },
    "units":      { "source": "dbo.UNIDADES",   "idColumn": "ID_UNIDAD",   "nameColumn": "NOMBRE" },
    "warehouses": { "source": "dbo.DEPOSITOS",  "idColumn": "ID_DEPOSITO", "nameColumn": "NOMBRE" },
    "priceLists": { "source": "dbo.LISTAS",     "idColumn": "ID_LISTA",    "nameColumn": "NOMBRE" }
  }
}
```

Todos los campos por dataset son opcionales salvo los marcados como obligatorios.
El schema es estricto: una clave desconocida produce error de validación.

## Campos comunes de cada dataset

| Campo | Descripción |
| --- | --- |
| `source` | Tabla o vista (`tabla` o `schema.tabla`). |
| `filter` | Filtro SQL adicional **opcional** (se valida: sin `;`, sin DML/DDL). |
| `updatedAtColumn` | Columna de fecha de modificación. |
| `rowVersionColumn` | Columna `rowversion`/`timestamp`. |
| `watermarkColumn` | Columna numérica incremental. |
| `strategy` | `updated_at` \| `rowversion` \| `watermark` \| `hash` \| `full`. |

## Modelo normalizado (contrato con la API)

Los mappers convierten las columnas reales a estos modelos (ver `src/mapping/types.ts`):

- **Product**: `sourceId, sku, barcode, name, description, brand{id,name}, family, subfamily, group, unit, active, sourceUpdatedAt`
- **Stock**: `productSourceId, warehouseSourceId, physical, reserved, committed, available, sourceUpdatedAt`
- **Price**: `productSourceId, priceListSourceId, amount, currency, taxIncluded, sourceUpdatedAt`
- **Customer**: `sourceId, taxId, businessName, priceListSourceId, active, sourceUpdatedAt`
- **DictionaryEntry**: `type, sourceId, name, active, sourceUpdatedAt`

Los mappers son tolerantes: si falta el id de origen o (en precios) el monto,
la fila se omite y se cuenta como `recordsSkipped` (no rompe el sync).

## Estrategias de incremental

1. `updated_at` — `WHERE [col] > @since`, cursor = máximo timestamp visto.
2. `rowversion` — `WHERE [col] > @since` con cursor binario (hex en el estado).
3. `watermark` — `WHERE [col] > @since` numérico.
4. `hash` — full scan + hash por id; emite solo cambios. Fallback por defecto.
5. `full` — refresh completo (recomendado para la primera carga).

Se auto-detecta si no se especifica `strategy`: `updated_at` → `rowversion` →
`watermark` → `hash`. El estado se guarda en `data/sync-state.json`.

> Con ~3.300 productos, `full` controlado es aceptable para la carga inicial.
> No se activa CDC ni se crean triggers.
