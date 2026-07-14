# 022 — Orden de dependencias al generar tabla/SP en el sync a tenant

## Contexto

`ModulesService.ensureFormsGenerated()` genera tabla+SP para cualquier form
recién asignado a un tenant que todavía no las tenga, iterando sobre
`SELECT DISTINCT form_slug FROM {schema}.module_forms`. Postgres no
garantiza ningún orden para ese `DISTINCT` sin `ORDER BY`. El problema:
`FormGeneratorService.buildTableDDL()` genera el `CREATE TABLE` con las FK
de columnas `relation` **inline, en el mismo statement** (ver
`form-generator.service.ts`) — si la tabla referenciada todavía no existe,
todo el `CREATE TABLE` falla, y como `ensureFormsGenerated()` no atrapa el
error por slug, la excepción aborta el resto del loop completo.

Esto se manifestó real en esta sesión al sincronizar Ventas/Compras a
`tenant_demo`/`tenant_acme`: `venta_barrio` depende de `tbl_clientes`,
`tbl_empleados` y `tbl_sucursales` (vía `input-lupa`/`relation`), y
`empleados` a su vez depende de `tbl_sucursales`. Sin orden garantizado,
`empleados` podía intentar procesarse antes que `sucursales` y tirar
`relation "tbl_sucursales" does not exist`, tumbando todo el sync. El
workaround usado en el momento (forzar el orden llamando
`updateTenantForm()` manualmente slug por slug) no escalaba y el usuario
pidió automatizarlo.

## Decisión

`ModulesService.sortSlugsByDependencies(schema, slugs)` — ordena
topológicamente los slugs a procesar antes de que `ensureFormsGenerated()`
los itere:

1. Para cada slug, lee su `json_form` y extrae las dependencias reales:
   - Campos con `relation.form` (patrón `input-lupa`/`select`+`relation`),
     vía `FormGeneratorService.extractFields()` (ya existente, reusado).
   - Columnas del nodo `line-items` con `relation.form` (ej. `producto_id`
     en el detalle de una venta), vía `findLineItemsNode()` (ya existente).
   - Solo cuentan como dependencia los targets que también están en el
     mismo lote de `slugs` — si el target ya existe en el tenant (sync
     anterior), no hay nada que ordenar respecto a él.
2. DFS clásico (Kahn/post-order) sobre ese grafo de dependencias — un slug
   se agrega a la lista final después de todas sus dependencias.
3. Un ciclo (no debería poder pasar con los patrones actuales del motor —
   `relation` es siempre hacia catálogos "de abajo hacia arriba") se corta
   marcando el nodo visitado sin reintentarlo, para no bloquear el resto
   del sync con un error de "ciclo detectado".

`ensureFormsGenerated()` llama esto antes de iterar; el resto de la lógica
(saltar los que ya tienen `has_table && has_sp`) no cambió.

## Consecuencias

- Sincronizar cualquier combinación de módulos a un tenant (nuevo o
  existente) ya no depende de en qué orden el admin los seleccionó ni de
  qué orden devuelva Postgres — el propio grafo de `relation` decide.
  Verificado con un tenant descartable (`tenant_scratch_topo`, creado y
  borrado en esta sesión): sincronizar 7 módulos a propósito "fuera de
  orden" generó correctamente las 19 tablas con sus FKs reales.
- Costo: una query extra por slug (`SELECT json_form`) en cada llamada a
  `ensureFormsGenerated()` — aceptable, el sync a un tenant no es una
  operación de alta frecuencia.
- No resuelve el caso de una dependencia **circular real** entre dos forms
  (hoy no puede pasar con los patrones del motor — `relation` no permite
  ciclos porque un catálogo nunca referencia "hacia adelante" a un form que
  lo usa). Si en el futuro se permite eso, este mismo mecanismo lo cortaría
  silenciosamente en vez de fallar con un mensaje claro — vigilar si
  aparece un caso así.
