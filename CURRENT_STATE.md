# CURRENT_STATE

> Única fuente de verdad sobre "dónde estamos ahora mismo". Este archivo se
> actualiza en cada sesión y **no** acumula historial — solo el estado
> vigente (se sobrescribe, no se agrega). Para arquitectura y reglas de
> trabajo, ver `CLAUDE.md`; para decisiones con su razonamiento, `docs/adr/`;
> para troubleshooting de bugs conocidos, `docs/known-bugs.md`.

## Último trabajo realizado

**Builder → pestaña Grid: columnas manuales para campos de un JOIN** (ver
`docs/adr/005-grid-datasource-architecture.md`) — bug real encontrado: si el
admin agregaba un JOIN en la pestaña SQL con columnas que no estaban en el
formulario visual, no había forma de mostrarlas en la grid (la lista de
columnas se armaba solo desde los campos del `d-builder`, y cualquier columna
"suelta" se perdía en cada recarga de la pestaña). Ahora hay un formulario
"+ Agregar columna" (clave + etiqueta + tipo) y esas columnas (`is_custom:
true`) se conservan; son las únicas eliminables y con tipo editable desde la
UI. Verificado por curl (`POST /admin/forms/producto/grid` con una columna
`is_custom`, round-trip correcto); estado de prueba restaurado a los 9
columnas originales de "producto". `ng build`/`tsc --noEmit` limpios. **Sin
verificación visual en navegador** (Playwright no instalado).

**`GridFormComponent`: columnas se estiran si sobra espacio** (ver
`docs/adr/005-grid-datasource-architecture.md`) — el auto-size a contenido de
la sesión anterior (`autoSizeAllColumns()`) dejaba un hueco vacío antes de
"Acciones" cuando había pocas columnas visibles (ej. dejar solo 5 visibles en
"producto"), porque auto-size ajusta al contenido pero no llena el ancho del
grid. Ahora `fitColumnsIfNeeded()` (dispara en `modelUpdated` y
`gridSizeChanged`) estira proporcionalmente con `sizeColumnsToFit()` solo
cuando el total de columnas auto-ajustadas no alcanza el ancho real del
grid — si ya lo supera (muchas columnas), no toca nada. "Acciones" tiene
`minWidth`/`maxWidth` para no estirarse. **Sin verificación visual en
navegador** (Playwright no instalado) — `ng build`/`tsc --noEmit` limpios.

**Builder → pestaña SQL: precarga la consulta actual del formulario** (ver
`docs/adr/005-grid-datasource-architecture.md`): si el form no tiene
`grid_query` propio, el editor ya no aparece vacío — se precarga con
`SELECT * FROM {schema}.{table} WHERE deleted_at IS NULL` (el equivalente a
lo que usa hoy el SP/`selectPaged` por default), para que el admin parta de
ahí y agregue joins/columnas calculadas. Guardar sin tocar ese texto NO fija
un `grid_query` nuevo (se compara contra el sugerido en `onExport()`) — solo
se persiste si el admin lo edita de verdad. Verificado por curl contra
`public.forms.producto`: PATCH con query custom persiste y se puede limpiar
de vuelta a `null`; estado de prueba restaurado. `ng build`/`tsc --noEmit`
limpios.

**`GridFormComponent`: ancho de columna automático** (ver
`docs/adr/005-grid-datasource-architecture.md`, actualizado): antes cada
columna usaba el ancho fijo configurado en el builder (o 150px por default),
lo que cortaba nombres/contenido en columnas angostas y dejaba espacio vacío
en columnas anchas con poco contenido. Ahora `onModelUpdated()` llama
`gridApi.autoSizeAllColumns()` en cada cambio de filas renderizadas (carga
inicial, página, sort, filtro, búsqueda) — el ancho se recalcula según el
contenido real de cada página. `defaultColDef` en `FormDetailComponent` acota
el resultado con `minWidth: 90`/`maxWidth: 420` para que una celda con texto
muy largo (ej. una descripción) no estire su columna a costa de las demás.
Sin verificación visual en navegador (Playwright no instalado en este
entorno) — `ng build`/`tsc --noEmit` limpios.

**Nombre de módulo distinto para catálogo (super admin) vs tenant** (ver
`docs/adr/012-module-tenant-name.md`): columna nueva `public.modules
.tenant_name` (nullable, `NULL` = usa `name`). `name` es el nombre que ve el
super admin en su propio catálogo/sidebar (para distinguir variantes, ej.
"Inventario Restaurantes" vs "Inventario Ferreterías" — mismo tipo de módulo,
formularios distintos); `tenant_name` es el nombre "genérico" que recibe
cualquier tenant al que se le asigne. `COALESCE(tenant_name, name)` aplicado
en los dos caminos que copian el catálogo a un tenant: `create_tenant_schema()`
(tenant nuevo) y `syncPublicModulesToTenant()` (tenant existente). Editable
desde `admin/modules` (crear + pestaña "Editar módulo"), con subtítulo en la
lista (`→ {tenant_name} en el tenant`) cuando difiere del nombre de catálogo.
Verificado por curl end-to-end contra `tenant_demo` real (rename, sync,
confirmar que el tenant NO recibió el nombre interno) y restaurado el estado
de prueba. `ng build`/`tsc --noEmit` limpios en ambos proyectos.

**`SettingsModulesComponent` (tenant, `/settings/modules`) a la par de
`AdminModulesComponent`**: le faltaba la pestaña "Editar módulo" (nombre,
descripción, ícono, orden en el sidebar, activo/inactivo) que sí tenía la
versión de super admin — solo tenía un editor de ícono suelto fuera de las
pestañas. Se reemplazó ese editor suelto por la misma pestaña "Editar módulo"
que usa `AdminModulesComponent` (mismo layout, mismos campos), reusando
`PATCH /modules/:id` (tenant) que ya existía pero no aceptaba `description` —
se agregó al `UPDATE` de `ModulesService.updateTenantModule()` (la columna
`{schema}.modules.description` ya existía en la tabla, solo faltaba en este
UPDATE puntual; `getTenantModules()` ya la devolvía). Verificado por curl
contra `tenant_demo` (`PATCH /modules/1` con `description` nueva, confirmado
y restaurado al valor original). `ng build`/`tsc --noEmit` limpios en ambos
proyectos.

**Modo de visualización del registro configurable desde el builder** (ver
`docs/adr/011-form-display-mode.md`): dos columnas nuevas en `{schema}.forms`
(tenant y `public`) — `display_mode` (`'modal'` default | `'inline'`) y
`modal_width` (px, nullable). Desde el panel avanzado del builder (aplica a
formularios públicos y de tenant por igual, mismo lugar que el ícono) se
elige si el registro abre en un modal (con ancho configurable) o "en la
vista" (oculta la grid y muestra el form en su lugar, con un botón "← Volver
a la grid"). `FormDetailComponent` lee estos campos del formulario cargado y
decide el render; `modal_width` se aplica con `[style.max-width.px]` inline.

Verificado por curl contra `public.forms.producto`: `PATCH` a `inline`,
`GET` confirma persistencia, `PATCH` de vuelta a `modal` con `modalWidth:900`,
valor inválido de `displayMode` rechazado con 400. Estado de prueba
restaurado (`modal`, `modal_width: null`) al terminar. `ng build`/
`tsc --noEmit` limpios en ambos proyectos. **Pendiente: verificación visual
en navegador** (Playwright no está instalado en este entorno).

## Estado actual

**Entorno de desarrollo:**
- Backend: `Back/api`, `pnpm start` (`nest start --watch`), puerto 3000.
- Frontend: `Front`, `ng serve`, puerto 4200.
- DB: `docker exec -it saas_postgres psql -U saas_user -d saas_inventario`.
- Redis provisionado en `docker-compose.yml` pero sin cliente en el backend —
  ver "Riesgos".

**Catálogo público** (`public.forms`/`public.modules`): ejecutable como un
tenant más desde el super admin (ver `docs/adr/009-...md`). `producto`/`test`
tienen tabla/SP real en `public` (sincronizados desde `tenant_demo`), 70 filas
de prueba en `tbl_producto` (`tenant_demo` tiene 71 — una extra preexistente).
Grid con búsqueda general + paginación real (`docs/adr/005-...md`); todo
`SELECT` sin `limit` explícito pagina a 25 por default.

**Tenants reales:** `acme` (`tenant_acme`) y `demo` (`tenant_demo`), ambos
`status='trial'`. Usuario de prueba `demo`: `admin@demo.com` / `password`.
Super admin real: `jcabarcasjulio@gmail.com` (contraseña la conoce el usuario
— cambiable desde `admin.localhost:4200/admin/settings/security`, nunca por
`UPDATE` directo a la DB).

**Estilos de UI**: patrones reutilizados (`.btn`, `.modal`/`.backdrop`, `.pg`,
`.card`, `.field`, `.grid`, `.badge`, `.tbl`) centralizados en
`styles/components/` (ver `docs/adr/010-shared-component-styles.md`) — no
duplicar estos bloques en un componente nuevo.

**Diseño visual:** proyecto en Stitch (herramienta externa, fuera de este
repo) *"Sistema Inventario SaaS — Actual + Visión"* (ID `3501211172838871095`)
— 15 pantallas de alta fidelidad, sigue vivo si se quiere iterar.

**Este directorio no es un repositorio git** — ver "Riesgos".

## Bugs abiertos

- Campo `image` en `VARCHAR(500)` (en vez de `TEXT`, ver
  `docs/adr/006-image-field-storage.md`) en cualquier tabla `tbl_*` generada
  antes del fix, salvo `tenant_demo.tbl_producto` (corregida a mano). Requiere
  `ALTER TABLE ... ALTER COLUMN ... TYPE TEXT` manual por tabla afectada.
- `public.module_forms` no tiene la misma constraint única
  `UNIQUE(module_id, form_slug)` que ya tienen los schemas de tenant — riesgo
  bajo hoy (`setPublicModuleForms` siempre hace DELETE+INSERT), pero
  inconsistente si se agrega otro camino de escritura a esa tabla.
- Huecos conocidos de `docs/adr/008-form-catalog-access-control.md`: sin poda
  retroactiva de asignaciones ya hechas, sin gate de runtime sobre datos ya
  asignados, `syncPublicModulesToTenant()` no pasa por el gate de acceso.
- `{schema}.module_forms.form_slug` no tiene FK hacia `forms.slug` (ni en
  `public` ni en tenant) — borrar un formulario deja filas huérfanas en
  `module_forms` que aparecen con `name: null` en el sidebar. Ver
  `docs/known-bugs.md`.
- La búsqueda general de la grid (`filter.search`) incluye columnas `image`
  (TEXT/base64) en el `OR ILIKE` — correcto pero innecesariamente costoso
  contra un campo que nunca va a matchear un término de búsqueda real. No
  resuelto: `selectPaged()` no tiene acceso al `json_form` del formulario
  para saber qué columna TEXT es en realidad una imagen.

## Riesgos

- **No hay repositorio git** — cualquier cambio roto se queda roto hasta
  arreglarlo a mano, sin red de seguridad de commits. Considerar `git init`
  antes de cambios grandes.
- `FormGeneratorService.processForm()` no es transaccional (ver
  `docs/adr/003-dynamic-form-engine.md`) — un fallo a mitad de camino puede
  desincronizar `has_table`/`has_sp` del estado real de la DB.
- `grid_query` (SQL custom de la grid) solo tiene validación de superficie, no
  un sandbox real (ver `docs/adr/005-grid-datasource-architecture.md`).
- Tablas huérfanas en `public` (`users`, `roles`, `permissions`, `user_roles`,
  `role_permissions`, `refresh_tokens`) de un prototipo pre-multi-tenant, sin
  uso real pero tampoco borradas.
- `public.subscription_plans`/`public.tenant_subscriptions` — dead code
  completo, ningún endpoint ni componente los usa.
- `public.modules`/`module_forms`/`module_roles` no tienen script de creación
  documentado en `Back/database/` (drift preexistente).

## Próximas prioridades

1. Verificación visual en navegador de todo lo agregado recientemente:
   sidebar admin dinámico, builder en modo público, `/admin/modules`, modal
   "Nuevo tenant", buscador + paginación de la grid, modo de visualización
   modal/inline + ancho custom.
2. Aplicar el fix de `image` (`VARCHAR(500)` → `TEXT`) a cualquier tabla
   afectada fuera de `tenant_demo.tbl_producto`.
3. Decidir `docker-compose.prod.yml` (pendiente desde el inicio del proyecto).
4. Decidir sobre Redis: quitarlo del compose o implementar su uso real.
5. Fase futura ya acordada con el usuario: vista para migrar los *datos*
   (tabla + filas) de un formulario probado en `public` hacia un tenant real
   elegido.
