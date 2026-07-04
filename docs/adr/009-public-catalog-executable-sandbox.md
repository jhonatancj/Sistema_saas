# ADR-009: El catálogo público (`public`) es ejecutable — sandbox del super admin

## Contexto
`public.forms`/`public.modules` originalmente eran solo metadata: plantillas
que se copiaban a un tenant para volverse reales ahí. Un super admin no podía
crear ni probar un formulario sin antes tener un tenant real donde hacerlo.
El objetivo del negocio es poder construir y probar formularios/módulos como
super admin, y **después** decidir migrarlos a un tenant.

## Decisión
El motor de formularios (ADR-003) trata `schema='public'` como un tenant más:
- `public.forms` tiene paridad completa de columnas con `{schema}.forms` de
  tenant (`has_table`, `has_sp`, `table_name`, `sp_name`, `grid_query`, etc.).
- El builder en modo "Públicos" genera tabla y SP reales en `public` (antes
  solo hacía INSERT/UPDATE de metadata).
- El super admin tiene un sidebar dinámico (`GET /modules/public/menu`, sin
  filtro de rol — el super admin ya bypasea permisos en el resto de la app) y
  puede ejecutar CRUD real sobre esos formularios (`POST
  /admin/forms/:slug/execute`), navegando a `/admin/m/:moduleCode/:formSlug`
  (mismo `FormDetailComponent` que usa un tenant, ver "Reglas Frontend" en
  `CLAUDE.md` — el componente resuelve `/forms` vs `/admin/forms` según
  contexto).
- `FormExecutorService.getForms()` saltea la allow-list de ADR-008 cuando
  `schema==='public'` — esa lógica es "¿qué puede usar tal tenant?", no aplica
  cuando el que consulta el catálogo es el catálogo mismo.
- Los endpoints nuevos (`/admin/forms/:slug/execute`, `/admin/forms/public/tables`,
  `/modules/public/menu`, `/modules/public/:id/roles`) nunca aceptan `schema`
  del cliente — se hardcodea `'public'` server-side.

## Consecuencias / fuera de alcance a propósito
- Migrar los **datos** (tabla + filas) de un formulario ya probado en `public`
  hacia un tenant real es una fase futura, deliberadamente no implementada —
  esta decisión solo prepara el terreno (mismo motor de generación).
- `public` no tiene tabla `roles` como un tenant — los permisos por rol de un
  módulo público (`GET/POST /modules/public/:id/roles`) usan 3 códigos
  hardcodeados (`ADMIN`/`SALES`/`WAREHOUSE`, la misma convención sembrada en
  todo tenant nuevo) en vez de un JOIN real.
- El schema `public` acumula tablas de datos generadas (`tbl_{slug}`) igual
  que un tenant — al listar "tablas existentes" para bind hay que excluir
  explícitamente tanto las tablas core del sistema como las tablas huérfanas
  de drift (ver `docs/known-bugs.md`).
