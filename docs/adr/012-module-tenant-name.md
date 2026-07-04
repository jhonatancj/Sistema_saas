# ADR-012: Nombre distinto de módulo para el catálogo del super admin vs el tenant

## Contexto
El super admin puede necesitar varias variantes del "mismo" módulo con
formularios/campos distintos según el rubro del tenant — ej. "Inventario
Restaurantes" (con campos de perecederos/vencimiento) e "Inventario
Ferreterías" (con campos de medidas/proveedor), ambos módulos de inventario
pero con contenido diferente. Antes de este cambio, `public.modules` tenía un
solo `name`, usado tanto en el sidebar del propio super admin como en el
sidebar del tenant al sincronizar — no había forma de distinguir variantes en
el catálogo sin que el tenant también viera el nombre "interno" (ej. el
tenant vería literalmente "Inventario Restaurantes" en su sidebar, un detalle
de catálogo que no le aporta nada).

## Decisión
Columna nueva `public.modules.tenant_name VARCHAR(100)` (nullable):
- `name`: nombre que ve el super admin en su propio catálogo/sidebar
  (`GET /modules/public`, `GET /modules/public/menu`) — sirve para distinguir
  variantes entre sí.
- `tenant_name`: nombre que recibe el tenant al recibir el módulo. `NULL` =
  usa `name` tal cual (caso más común, la mayoría de módulos no necesitan un
  nombre distinto).

`COALESCE(tenant_name, name)` se usa en los dos únicos caminos que copian un
módulo del catálogo hacia `{schema}.modules` de un tenant:
1. `create_tenant_schema()` (`Back/database/04_create_tenant.sql`) — clona el
   catálogo completo al crear un tenant nuevo.
2. `ModulesService.syncPublicModulesToTenant()` — sincroniza el catálogo hacia
   un tenant ya existente (`POST /modules/public/sync/:tenantSlug`).

Una vez copiado, `{schema}.modules.name` es una fila independiente — el
tenant puede renombrarlo libremente desde `SettingsModulesComponent` → pestaña
"Editar módulo" (ver sesión anterior) sin afectar el catálogo, exactamente
igual que ya pasa con ícono/descripción.

Editable desde `AdminModulesComponent` (`admin/modules`), tanto al crear un
módulo como en su pestaña "Editar módulo" — dos campos separados con su
propio `field__hint` explicando la diferencia. La lista de módulos del panel
izquierdo muestra `→ {tenant_name} en el tenant` como subtítulo cuando difiere
de `name`, para que el super admin note a simple vista qué módulos tienen un
nombre "interno" distinto del que llega a los tenants.

## Consecuencias
- `public.modules` sigue siendo una tabla sin script de creación documentado
  en `Back/database/` (drift preexistente, ver `CLAUDE.md` § Riesgos) — la
  columna nueva se agregó como `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en
  `Back/database/08_module_tenant_name.sql`, sin resolver ese drift de fondo.
- `updatePublicModule()` usa el mismo patrón `COALESCE($n, columna)` que ya
  usaban `icon`/`description` — no se puede "limpiar" `tenant_name` de vuelta
  a `NULL` vía `PATCH` una vez seteado (mismo límite preexistente, no nuevo).
