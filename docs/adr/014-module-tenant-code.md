# ADR-014: `tenant_code` — código de módulo desacoplado de la URL del tenant

## Contexto
Extiende `docs/adr/012-module-tenant-name.md`. Al crear el catálogo multi-
vertical (`docs/adr/013-catalogo-modulos-multi-vertical.md`) apareció el
mismo problema que ya se había resuelto para `name`, pero con `code`: el
sidebar arma la ruta del tenant como `` `/app/m/${m.code}/${f.slug}` ``
(`sidebar.component.ts`), usando literal el `code` interno del catálogo
público. Un módulo como `INVENTARIO_BARRIO` (mayúsculas, con el nombre del
rubro adentro) terminaba tal cual en la URL que ve el usuario final del
tenant — exponiendo un detalle interno de catalogación que no debería
importarle ni notar.

## Decisión
`public.modules.tenant_code` (nullable, `VARCHAR(50)`, migración
`Back/database/09_module_tenant_code.sql`) — mismo mecanismo que
`tenant_name`: `NULL` = el tenant recibe `code` tal cual; si se define, el
tenant recibe ese valor en su lugar. `syncPublicModulesToTenant()` ahora
inserta `COALESCE(tenant_code, code)` en `{schema}.modules.code` en vez de
`code` a secas.

Los 3 módulos de tienda de barrio creados en la sesión anterior ya tienen
`tenant_code` seteado: `inventario`, `clientes`, `proveedores` (minúscula,
genérico, sin rubro). Editable desde `/admin/modules` → pestaña "Editar
módulo", junto al campo de `tenant_name` ya existente.

## Consecuencias / limitación conocida
- **El `code` interno (mayúscula, específico) sigue siendo lo que ve el
  super admin** en su propio catálogo/sandbox (`/admin/m/:code/...`) — la
  resolución de `tenant_code` solo aplica en el sync hacia un tenant real.
  Es intencional, igual que `tenant_name`.
- **Riesgo no resuelto, bajo impacto hoy**: `syncPublicModulesToTenant()`
  hace `INSERT ... ON CONFLICT (code) DO UPDATE` — el conflicto se detecta
  por el `code` ya almacenado en `{schema}.modules`, no por `public_id` (no
  existe un `UNIQUE(public_id)` en `{schema}.modules`, ver
  `04_create_tenant.sql`). Si un módulo **ya sincronizado** a un tenant real
  cambia su `tenant_code` después, un re-sync no actualiza el `code` de la
  fila existente — inserta una fila duplicada con el mismo `public_id` y el
  código nuevo, en vez de corregir la vieja. No se resolvió agregando
  `UNIQUE(public_id)` porque no hay tenants reales en producción todavía
  (solo `demo`/`acme`, corregidos a mano esta sesión con un `UPDATE`
  puntual) — evaluar esa migración antes de que el primer tenant real reciba
  un módulo cuyo `tenant_code` pueda cambiar más adelante.
- Si dos módulos públicos distintos (ej. dos variantes de rubro) comparten
  el mismo `tenant_code`, y por error ambos se sincronizan al mismo tenant,
  colisionan en `uq_modules_code` del tenant — no hay validación que lo
  impida hoy. En la práctica no debería pasar: un tenant solo recibe **una**
  variante de rubro (ver ADR-013), así que dos códigos internos que resuelven
  al mismo `tenant_code` nunca coexisten en el mismo tenant.
