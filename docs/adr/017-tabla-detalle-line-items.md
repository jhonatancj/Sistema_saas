# ADR-017: Tabla de detalle a partir de un nodo `line-items` (excepción a "1 formulario = 1 tabla")

## Contexto
ADR-003 fija como invariante que el motor genera **1 tabla + 1 SP por
formulario**. Ventas (carrito multi-línea con descuento automático de
stock, ver `docs/plan-ventas-agenda.md`) necesita un encabezado (cliente,
fecha, total) + N líneas de detalle (producto, cantidad, precio, subtotal)
— imposible de representar en una sola tabla plana.

`@jhonatancj/dforms` `1.3.3` agregó el tipo de campo `line-items` (filas
editables y repetibles, con columnas tipadas, `optionsSource`/`relation`
por columna, `optionsFillMap` para autocompletar otras columnas, y
columnas `calculated`) más `relation` oficial en `FieldConfig` (combinable
con `optionsSource`, marca un select como FK real). Con eso ya es posible
declarar el detalle desde el builder — faltaba que el motor supiera
generar la segunda tabla.

## Decisión

### Detección y generación
`FormGeneratorService.findLineItemsNode(nodes)` busca un nodo `type ===
'line-items'` en el árbol del formulario (a lo sumo uno soportado por
formulario). Sus columnas (`node.lineItemColumns`) y el resto de sus
propiedades vienen **flat sobre el nodo**, igual que `node.relation` —
así emite el builder real (verificado toda la sesión con `extractFields()`
antes de esto); el README de dforms muestra ejemplos con `schema: {...}`
anidado, pero eso no es lo que efectivamente exporta `<d-builder>`.

Si `processForm()` encuentra un nodo `line-items` (y el encabezado no está
bindeado a una tabla existente), genera además:
- `tbl_{slug}_detalle`: `id`, `{slug}_id BIGINT NOT NULL REFERENCES
  tbl_{slug}(id) ON DELETE CASCADE`, `created_at`, y una columna por cada
  `LineItemColumnDef` (mismo mapeo de tipos que un campo normal:
  `text`→`VARCHAR`, `number`/`currency`/`calculated`→`NUMERIC(12,2)`,
  `select`→`VARCHAR(100)` o `BIGINT` si esa columna tiene `relation`).
- Si una columna tiene `relation`, además una `CONSTRAINT ... FOREIGN KEY`
  real hacia `tbl_{relation.form}(relation.keyValue)` — idempotente a mano
  contra `pg_constraint`/`pg_namespace` (Postgres no tiene `ADD CONSTRAINT
  IF NOT EXISTS`), **filtrando por namespace** además del nombre: dos
  schemas distintos (`tenant_a`/`tenant_b`) pueden generar una constraint
  con el mismo nombre para el mismo form, y sin el filtro de schema una ya
  existiría "según" el otro.
- Mismas reglas de evolución que ADR-003 (`CREATE TABLE`/`ADD COLUMN IF NOT
  EXISTS`, nunca `DROP`/`ALTER TYPE`).
- `deleteForm()` dropea la tabla de detalle **antes** que el encabezado (el
  FK del detalle apunta al encabezado).

Columnas que el propio campo no puede expresar porque no son datos que el
usuario llena (ej. `total` del encabezado, calculado por el SP sumando las
líneas) se agregan aparte, vía `ALTER TABLE` de una sola vez — mismo
patrón que cualquier otro ajuste puntual de este proyecto.

### SP siempre a mano (`recreateSp:false`)
Un form con `line-items` con lógica de negocio real (validar+descontar
stock, restituir en edición/eliminación) necesita un SP escrito a mano —
el generador nunca escribe uno automático para el detalle. El mecanismo ya
existía (`recreateSp:false` + `spName`, ver ADR-003) — no hizo falta
cambiar nada ahí.

**Gotcha real encontrado implementando el primer SP (`sp_venta_barrio`)**:
`current_schema()` dentro del SP **siempre devuelve `'public'`**,
independientemente de si el SP fue invocado como `public.sp_venta_barrio`
o `tenant_x.sp_venta_barrio` — porque esta app nunca hace `SET
search_path`, todas las queries califican el schema explícitamente
(`${schema}.tabla`). Un SP a mano que necesite saber "en qué schema estoy"
**no puede usar `current_schema()`** — tiene que recibir el nombre de
schema como texto literal horneado en el propio DDL de creación (mismo
criterio que ya usa `buildSpDDL()` para los SPs autogenerados, que
interpolan `${schema}.tbl_x` en el texto de la función). Si este SP se
sincroniza a un tenant real, hay que volver a generar su texto con el
schema del tenant, no copiarlo tal cual.

### Mutabilidad de una venta — `tenants.ventas_editable`
Por defecto una venta es inmutable una vez creada (solo INSERT/SELECT,
como una factura real — evita dejar el stock inconsistente por una edición
a medias). Configurable por tenant vía `public.tenants.ventas_editable`
(boolean, default `FALSE`, ver `Back/database/11_ventas_editable.sql`). El
SP resuelve con `COALESCE((SELECT ventas_editable FROM public.tenants
WHERE schema_name = '<schema literal>'), TRUE)` — el sandbox `public` del
propio super admin no tiene fila en `tenants`, así que el `COALESCE` cae
siempre a `TRUE` (editable) para él. Con `ventas_editable=false`,
`UPDATE`/`DELETE` lanzan `RAISE EXCEPTION` sin tocar stock. Con `true`,
`UPDATE` restituye el stock de las líneas viejas y reaplica con las
líneas nuevas (todo en la misma llamada, sin dos pasos separados desde el
cliente); `DELETE` restituye el stock completo antes del soft-delete del
encabezado. Verificado en vivo (crear venta → bloquear edición/borrado →
habilitar → editar cantidad 5→2 → confirmar stock correcto → borrar →
confirmar stock vuelve al original).

### `FormDetailComponent` — reabrir un registro con `line-items`
`selectPaged()` (la que usa la grid con filtro/orden, ver ADR-005) consulta
la tabla de encabezado directo, sin pasar por el SP — nunca trae el array
de líneas. `openEdit()` ahora detecta si el `json_form` del formulario
tiene un campo `line-items` y, si es así, pide `SELECT_BY_ID` (sí pasa por
el SP, que arma el encabezado + `detalle` vía `jsonb_agg`) antes de abrir
el modal. Genérico — cualquier form futuro con `line-items` lo hereda
gratis, no hay nada hardcodeado a "venta".

## Consecuencias
- El patrón (detección de `line-items` + tabla de detalle + FK) es
  reutilizable para cualquier futuro "encabezado + líneas" — no exclusivo
  de Ventas.
- Replicar a `venta_moda`/`venta_ferreteria` es mecánico (mismo JSON de
  formulario, cambia el catálogo de producto referenciado, mismo SP con
  los nombres de tabla/schema ajustados). `venta_belleza` ("Venta de
  servicio") es una variante sin el paso de descuento de stock.
- Sincronizar `venta_barrio` a un tenant real requiere volver a generar el
  texto del SP con el schema de ese tenant (ver gotcha de
  `current_schema()` arriba) — no es un simple `copyMissingFormsToTenant`,
  hace falta un paso extra manual hasta que exista una forma de automatizar
  "regenerar SP a mano para schema X" desde el flujo de sync.
- Un formulario con `line-items` cuya tabla de detalle tenga una columna
  `relation` nueva agregada en un reprocesamiento posterior SÍ agrega la FK
  correspondiente (a diferencia del encabezado, donde agregar `relation` a
  un campo ya existente en una tabla vieja NO agrega la FK retroactivamente
  — gap preexistente de ADR-003, no tocado por este ADR).
