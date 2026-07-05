# ADR-003: Motor low-code de formularios dinámicos (tabla + SP por formulario)

## Contexto
El producto no es un ERP de módulos fijos (productos, ventas, compras como
tablas codificadas a mano). Es un motor genérico: un builder visual
(`@jhonatancj/dforms`) arma un JSON describiendo campos, y el sistema debe
persistir esos datos sin que un desarrollador escriba una migración por cada
formulario nuevo que un super admin o tenant decida crear.

## Decisión
`FormGeneratorService` (`Back/api/src/modules/forms/form-generator.service.ts`)
genera, a partir del JSON del builder, una **tabla** (`tbl_{slug}`) y un
**stored procedure** (`sp_{slug}(p_action, p_id, p_data, p_limit, p_offset)`)
reales en Postgres, dentro del schema que corresponda (un tenant o `public`).
El SP centraliza INSERT/UPDATE/DELETE/SELECT/SELECT_BY_ID vía `CASE p_action`.

Reglas de evolución del schema generado (invariantes, no negociables):
- Una tabla nueva se crea con `CREATE TABLE IF NOT EXISTS` (idempotente).
- Reprocesar un formulario ya existente **nunca** hace `DROP`/`ALTER TYPE` —
  solo `ALTER TABLE ADD COLUMN IF NOT EXISTS` para campos nuevos, siempre
  `NULL` (nunca backfill, nunca `NOT NULL`).
- El SP se regenera siempre con `CREATE OR REPLACE`, pero si la firma de
  parámetros cambia, hay que emitir un `DROP FUNCTION IF EXISTS` de la firma
  vieja exacta **antes** — Postgres distingue funciones por firma completa, y
  dos overloads con parámetros `DEFAULT` conviviendo produce
  `function ... is not unique`.
- Un formulario puede enlazarse (`bind`) a una tabla ya existente en vez de
  generar una nueva (`table_name` seteado) — en ese caso se valida que las
  columnas del builder existan en `information_schema.columns` antes de tocar
  el SP, y nunca se corre DDL de tabla.
- `recreateSp: false` permite que un super admin mantenga un SP escrito a mano
  sin que el generador lo pise.
- Un formulario puede tener `grid_query` (SQL SELECT custom) como fuente de la
  grid en vez de `tbl_{slug}` — permite joins con otras tablas del mismo
  schema.

El mismo motor opera indistintamente sobre un schema `tenant_<slug>` o sobre
`public` (el catálogo del super admin es, para este motor, "un tenant más") —
ver ADR-009.

**Tipos de campo soportados** (deben coincidir con los `NodeType` de
`@jhonatancj/dforms` que persisten datos — los de layout como `container`/
`column`/`stepper`/`step` nunca generan columna): `text`, `number`,
`select`, `textarea`, `checkbox`, `image`, `currency`. Agregar soporte a un
tipo nuevo de la librería (ej. `date`, `radio`, `email`, `password`, ya
exportados por dforms pero sin mapear acá) requiere tocar 3 puntos en
`form-generator.service.ts`: la lista de tipos reconocidos en
`extractFields()`, el `case` de `toDbType()` (tipo SQL de la columna) y el
`case` de `castField()` (cómo castear el JSONB del SP al tipo de columna) —
si falta cualquiera de los 3, el campo se ignora silenciosamente al generar
la tabla/SP (sin error, simplemente no persiste). Espejo obligatorio en el
frontend: `CUSTOM_COLUMN_TYPES`/`extractFieldsFromSchema()` en
`builder.component.ts` (para que la pestaña Grid lo reconozca) y, si el tipo
necesita un render/filtro particular en la grid de datos (ver `currency`),
`FormDetailComponent.colDefs`.

## Consecuencias
- Máxima flexibilidad: cualquier formulario nuevo no requiere deploy de
  backend.
- El generador **no es transaccional** (crear/alterar tabla, regenerar SP, y
  actualizar la fila de metadata en `{schema}.forms` son queries separadas) —
  un fallo a mitad de camino puede dejar `has_table`/`has_sp` desincronizados
  del estado real de la DB. Mitigado parcialmente con `CREATE TABLE IF NOT
  EXISTS`, no resuelto de raíz. Ver `docs/known-bugs.md`.
- Los campos `required` del builder no se traducen a `NOT NULL` real en la
  tabla generada (necesario para que `ALTER TABLE ADD COLUMN` sin backfill
  nunca falle) — la validación de "requerido" vive solo en el formulario del
  frontend, no en la base de datos.
