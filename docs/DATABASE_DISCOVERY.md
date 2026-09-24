# Database Discovery

El connector **no asume** los nombres reales de tablas ni columnas de NavaSoft.
La primera tarea al entrar al servidor es descubrir el esquema real de la réplica.

> Todo el discovery usa únicamente `SELECT` sobre catálogos del sistema (`sys.*`)
> y `SELECT TOP (@n)` sobre tablas de usuario. Nunca escribe. Ver `docs/SECURITY.md`.

## Flujo recomendado (día 1 en el RDP)

1. Completar `.env` con credenciales de la réplica (usuario READ ONLY).
2. `npm run db:test` — confirmar conexión, versión y READ ONLY.
3. `npm run discovery` — generar `docs/discovery-report.md` y `.json`.
4. Revisar candidatos y muestras.
5. Crear `config/mapping.json` a partir de `config/mapping.example.json` y de la
   sección "Mapping sugerido (EXAMPLE)" del reporte.
6. `npm run sync:products -- --dry-run` y luego real.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run db:test` | Conecta, muestra servidor, base, versión, login, latencia y diagnóstico READ ONLY. |
| `npm run db:tables` | Lista schemas, tablas y vistas con row count aproximado. |
| `npm run db:columns -- <tabla>` | Columnas con tipo, nullable, PK, FK, identity, computed, default, rowversion. Acepta `tabla` o `schema.tabla`. |
| `npm run db:relations` | Todas las foreign keys existentes. |
| `npm run db:search -- <termino>` | Busca tablas/columnas por nombre (soporta abreviaturas). |
| `npm run db:sample -- <tabla> --limit 20` | Muestra limitada de filas. |
| `npm run discovery` | Genera el reporte completo. |

### `db:test` y READ ONLY

`db:test` consulta `HAS_PERMS_BY_NAME` e `IS_MEMBER` para reportar si el login
tiene INSERT/UPDATE/DELETE o roles de escritura. Esto es un **diagnóstico**, no
un permiso: la protección real viene de los permisos SQL de la réplica **más**
el guard del connector (`src/db/sql-guard.ts`).

## Qué incluye el reporte

- Conexión y diagnóstico READ ONLY.
- Resumen (tablas, vistas, columnas, PK, FK).
- Listado de tablas/vistas con PK y filas aproximadas.
- Columnas completas por tabla (en el JSON) y detalladas para candidatos (en el MD).
- Candidatos por categoría con score y evidencia.
- Columnas de modificación (`fecha_mod`, `updated_at`, `rowversion`, etc.).
- Foreign keys.
- Muestras limitadas y enmascaradas.
- Mapping sugerido (EXAMPLE, requiere revisión).
- Advertencias.

## Heurísticas de candidatos

La detección es por token (soporta abreviaturas y español). Ejemplos de términos:

| Categoría | Términos |
| --- | --- |
| products | art, articulo(s), prod, producto(s), item(s), sku |
| stock | stock, stk, exist(encia), saldo, disponible, inventario |
| prices | prec, precio(s), price, importe, valor |
| priceLists | lisp, lista(s), tarifa, listaprecio |
| clients | cli, cliente(s), cta, cuenta |
| brands | marca(s), marc, brand |
| families | fam, familia(s) |
| subfamilies | subfam, subfamilia(s) |
| groups | gru, grupo(s) |
| units | umed, unidad(es), unid, uni, medida(s) |
| warehouses | dep, deposito, alm, almacen, bodega |

Un token de 3 caracteres debe coincidir exacto (ej. `art` sí, `cuarto` no);
términos de 4+ aceptan prefijo (ej. `articulo` matchea `articulos`).

> Los candidatos son una **guía**. Siempre confirmar con `db:columns` y muestras.

## Privacidad de datos

- Las muestras se limitan (por defecto 10 filas en el reporte, configurable con
  `--sample-limit`).
- Las columnas detectadas como sensibles (`ruc`, `dni`, `documento`, `telefono`,
  `email`, `direccion`, `razon_social`, `password`, etc.) se **enmascaran**.
- Usar `--no-mask` solo en entornos controlados (no recomendado).
- `docs/discovery-report.*` está en `.gitignore` porque contiene el esquema real.

## Modo dry-run de sync

Los comandos `sync:*` aceptan `--dry-run`, que lee y mapea sin encolar ni enviar.
Sirve para validar el mapping antes de tocar la API externa.
