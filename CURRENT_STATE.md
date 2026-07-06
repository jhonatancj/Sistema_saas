# CURRENT_STATE

> Única fuente de verdad sobre "dónde estamos ahora mismo". Este archivo se
> actualiza en cada sesión y **no** acumula historial — solo el estado
> vigente (se sobrescribe, no se agrega). Para arquitectura y reglas de
> trabajo, ver `CLAUDE.md`; para decisiones con su razonamiento, `docs/adr/`;
> para troubleshooting de bugs conocidos, `docs/known-bugs.md`.

## Último trabajo realizado

**Catálogo de Rubros + Categorías/Unidades de medida dinámicas** (ver
`docs/adr/015-catalogo-rubro-categorias-unidades.md`, feature grande de la
sesión). Resumen:
- `rubro` — form nuevo (`public.forms`, admin-only, sin módulo wrapper, link
  fijo "Rubros" en el sidebar admin). 4 filas sembradas: `tienda_barrio`/
  `moda`/`ferreteria`/`belleza`.
- `tenants.rubro_id` / `modules.rubro_id` — columnas nuevas, sin FK real
  (`tbl_rubro` la crea el motor en runtime). Módulos `INVENTARIO_*` ya
  taggeados con su rubro; `CLIENTES`/`PROVEEDORES`/`CATEGORIAS`/
  `UNIDADES_MEDIDA` quedan `NULL` (universal/core).
- `CATEGORIAS`/`UNIDADES_MEDIDA` — módulos core nuevos, una sola tabla
  compartida cada uno (filas de los 4 rubros mezcladas en `public`, cada
  fila con su propio campo `rubro`). Sembradas con las categorías/unidades
  que antes eran opciones fijas de los formularios de producto.
- **Primer caso de sync de DATOS (no solo definición) del sistema**:
  `ModulesService.syncCatalogDataForRubro()`, corre al final de todo
  `syncPublicModulesToTenant()` — copia a `{tenant}.tbl_categorias`/
  `tbl_unidades_medida` solo las filas del rubro del tenant. Verificado
  end-to-end con un tenant de prueba (rubro `moda` → exactamente sus 6
  categorías, cero de otros rubros; tenant borrado tras verificar).
- `categoria`/`unidad` de `producto_barrio`/`producto_moda`/
  `producto_ferreteria` migrados de `options` fijas a `optionsSource`
  dinámico (`'categorias'`/`'unidades_medida'`).
- `RemoteFormOptionsService` (nuevo) reemplaza `FormOptionsMockService`
  (borrado) — implementación real de `FormOptionsProvider` que reusa el
  endpoint `execute` existente (`endpointId` = slug del form), sin backend
  nuevo.
- UI: selector de rubro al crear un tenant (`tenants-list`); modal de sync
  (`tenant-detail`) filtra módulos por `rubro_id` del tenant y muestra su
  rubro; `admin-modules` permite asignar `rubro_id` a un módulo.
- `tsc --noEmit`/`ng build` (Front) y `tsc --noEmit`/`nest build` (Back)
  limpios. **Nota aparte, no relacionada al código**: durante la
  verificación, `ng build` falló por un symlink roto en el store de pnpm
  (`parse5-html-rewriting-stream`, dependencia transitiva de
  `@angular/build`) — se resolvió con `rm -rf node_modules && pnpm install`.
  No fue causado por ningún cambio de esta sesión (no se tocó
  `package.json`/lockfile); si vuelve a pasar, ese es el fix.

**Soporte para el tipo de campo `currency` de `@jhonatancj/dforms`** (el
usuario es el autor de la librería, agregó el componente en `^1.3.2` — ya
instalado, `NodeType` incluye `'currency'` en el `.d.ts`). Motor y builder
no lo reconocían todavía: agregado a `FormGeneratorService.extractFields()`/
`toDbType()` (`NUMERIC(12,2)`, igual que `number`)/`castField()` en el
backend, y a `CUSTOM_COLUMN_TYPES`/`extractFieldsFromSchema()` en
`builder.component.ts` — ver la nota nueva en
`docs/adr/003-dynamic-form-engine.md` sobre qué 3 puntos hay que tocar para
soportar cualquier tipo de campo nuevo de la librería. `FormDetailComponent`
ahora filtra `currency` con `agNumberColumnFilter` (igual que `number`) y
formatea la celda como `$ 1.234` (`Intl.NumberFormat('es-CO')`, sin symbol/
locale configurables todavía — `grid_config` no guarda esos metadatos del
campo). Migrados los campos de dinero ya existentes de `number` a
`currency` (`json_form` reprocesado + `grid_config.field_type` actualizado,
**la columna real sigue siendo `NUMERIC`, no hubo DDL destructivo**): en
`public` — `clientes.limite_credito`, `producto_barrio/moda/ferreteria
.precio_compra/precio_venta`, `servicio_belleza.precio`; y en
`tenant_demo` (tiene copias propias de `clientes`/`producto_barrio` desde el
sync) — mismos dos forms. `tsc --noEmit`/`ng build` limpios en ambos
proyectos.

**Catálogo completo de los 4 rubros** (ver
`docs/adr/013-catalogo-modulos-multi-vertical.md`) — creados
`INVENTARIO_MODA` (`producto_moda`: categoría de prenda, talla, color,
precio compra/venta, stock), `INVENTARIO_FERRETERIA` (`producto_ferreteria`:
categoría técnica, unidad de medida técnica, precio compra/venta, stock) y
`SERVICIOS_BELLEZA` (`servicio_belleza`: categoría de servicio,
duración_min, precio — sin stock, no es un producto). Mismo patrón completo
verificado con Tienda de Barrio: tabla+SP reales, `grid_config` poblado
desde el arranque (evita el bug de grid vacía documentado en
`docs/known-bugs.md`), `module_roles` por rol. Los 3 comparten
`tenant_code: 'inventario'` (moda/ferretería) o `'servicios'` (belleza) —
consistente entre variantes de un mismo concepto (ver ADR-014). **Ningún
rubro nuevo sincronizado a un tenant todavía** — el catálogo público ya
tiene los 4 rubros completos, listo para sincronizar el que corresponda
cuando haya un tenant real de cada tipo. Corregido en el camino: el usuario
había cambiado a mano `tenant_code` de `INVENTARIO_BARRIO` a `'inventariob'`
desde `/admin/modules` mientras probaba — normalizado de vuelta a
`'inventario'` para mantener consistencia entre las 3 variantes de
inventario (confirmado con el usuario antes de tocarlo).

**Ofuscar module code / form slug en la URL** (`Front/src/app/core/utils/route-obfuscation.ts`):
`tenant_code` (ver abajo) no alcanzaba porque solo aplica al sincronizar a un
tenant real — el super admin sigue viendo el `code` interno en su propio
panel (`admin.localhost`), por diseño. Pedido del usuario: ocultarlo en
cualquier contexto, sin tocar el backend. Las rutas `/app/m/:moduleCode/:formSlug`
y `/admin/m/:moduleCode/:formSlug` pasaron a ser fijas (`/app/m`, `/admin/m`,
sin params) — el sidebar codifica `code::slug` en base64 dentro de un único
query param `data` (`encodeFormRoute`/`decodeFormRoute`), y
`FormDetailComponent` lo decodifica desde `queryParamMap` (reactivo, mismo
motivo que ya obligaba a `paramMap` reactivo — ver `docs/known-bugs.md`) y
sigue usando `slug` exactamente igual que antes para todas las llamadas a la
API. **No es cifrado real** — `atob()` en la consola lo revierte al toque;
solo evita que se vea a simple vista en la barra de direcciones. Se evaluó y
descartó una alternativa más invasiva (rutear por `id` numérico con nuevos
endpoints de backend) a favor de esta, más simple y sin cambios de backend.
`ng build`/`tsc --noEmit` limpios (Front únicamente, sin cambios en `Back`).

**`tenant_code` en módulos** (ver `docs/adr/014-module-tenant-code.md`,
extiende ADR-012): el sidebar arma la URL del tenant como
`/app/m/:moduleCode/:formSlug` usando el `code` interno del catálogo tal
cual — un módulo como `INVENTARIO_BARRIO` exponía el rubro y las mayúsculas
en la URL del usuario final. Nueva columna `public.modules.tenant_code`
(nullable, mismo patrón que `tenant_name`), resuelta con
`COALESCE(tenant_code, code)` en `syncPublicModulesToTenant()`. Editable
desde `/admin/modules` → "Editar módulo". Los 3 módulos de tienda de barrio
ya tienen `tenant_code` seteado (`inventario`/`clientes`/`proveedores`);
`tenant_demo.modules.code` corregido a mano para los 3 (el re-sync no
actualiza el `code` de una fila ya sincronizada — ver limitación conocida en
el ADR, no se resuelve todavía porque no hay tenants reales en producción).

**Catálogo de producción, primer rubro (Tienda de barrio)** — ver
`docs/adr/013-catalogo-modulos-multi-vertical.md` para el diseño completo de
los 4 rubros (moda, ferretería, barbería/salón, tienda de barrio) y qué queda
deliberadamente fuera de esta fase (ventas con carrito+stock, agenda de
citas). Creados en `public` (vía los mismos servicios que usa la API, no SQL
a mano): módulos `INVENTARIO_BARRIO`/`CLIENTES`/`PROVEEDORES` con sus 3 forms
(`producto_barrio`/`clientes`/`proveedores`, tabla+SP reales generados) y
`module_roles` por rol (ADMIN/SALES/WAREHOUSE, tabla en el ADR). Sincronizado
y verificado end-to-end contra `tenant_demo` (módulos+forms+roles copiados,
tablas/SPs del tenant generados, sidebar por rol confirmado con una query
que simula `getTenantModulesByRole()`). Dos bugs reales encontrados y
corregidos en el camino, ambos documentados en `docs/known-bugs.md`: (1)
sincronizar un módulo sin `module_roles` en `public` lo deja invisible para
cualquier rol de tenant; (2) crear un form llamando a `processForm()`
directo (sin pasar por la pestaña "Grid" del builder) deja `grid_config` en
`[]` y la grid se ve vacía aunque tabla/SP estén perfectos — hace falta
`saveGridConfig()` aparte. Pendiente: repetir este mismo patrón completo
(form + módulo + roles + grid_config) para `INVENTARIO_MODA`,
`INVENTARIO_FERRETERIA`, `SERVICIOS_BELLEZA` cuando el usuario los pida
(diseño de campos ya está en el ADR).

**Reset de datos de prueba para arrancar producción**: catálogo `public`
(forms/modules/module_forms/module_roles) vaciado por completo —
`tbl_producto`/`tbl_test` y sus SPs dropeados, `TRUNCATE ... RESTART IDENTITY
CASCADE`. `tenant_demo` y `tenant_acme` vaciados de módulos/forms/tablas
generadas de la misma forma, **conservando** schema, usuario
(`admin@demo.com`) y roles. Backup previo con `pg_dump -Fc` en
`Back/database/backups/` (gitignored, no versionado). El super admin y
`demo` arrancan con sidebar vacío — es lo esperado, listo para que el usuario
cree los módulos/formularios reales.

**Eliminar formulario desde el builder** (dropea tabla+SP reales, limpia
asignaciones a módulos): `FormGeneratorService.deleteForm(schema, slug)`
(`Back/api/src/modules/forms/form-generator.service.ts`) — transacción real
(`pool.connect()` + BEGIN/COMMIT/ROLLBACK): `DROP FUNCTION` del SP (firma
nueva de 5 params y la legacy de 3, igual que `buildSpDDL`), `DROP TABLE` de
`tbl_{slug}` **solo si no está bindeado a una tabla ya existente**
(`table_name` era `NULL`), `DELETE FROM {schema}.module_forms WHERE
form_slug=$1` (arregla de raíz, para este camino, el bug de `known-bugs.md`
sobre módulos con `name: null`), y `DELETE FROM {schema}.forms` (hard delete,
no soft-delete — la fila de metadata no tiene motivo para sobrevivir si tabla
y SP ya no existen). Expuesto en `AdminFormsController` como `DELETE
/admin/forms/:slug` (público) y `DELETE /admin/forms/tenant/:tenantSlug/:slug`
(tenant), ambos solo super admin. Frontend: botón de basurero junto al lápiz
en la grid de `AdminBuilderComponent`, con `notification.confirm({danger:
true})` antes de llamar. Violación de FK (ej. otro form con una columna
`relation` hacia esta tabla) revierte todo y devuelve 400 con mensaje
legible en vez de un error crudo de Postgres. Verificado con un form de
scratch creado y borrado a mano contra la DB real (tabla+SP+fila+
module_forms confirmados eliminados), más un caso bindeado a tabla existente
(la tabla sobrevive, solo se borra SP+metadata) y el caso 404. `tsc --noEmit`
y `ng build`/`nest build` limpios en ambos proyectos.

**Modal de selección de módulos al sincronizar un tenant**: antes
"Sincronizar módulos del catálogo" en `/admin/tenants/:id` copiaba *todo* el
catálogo público activo sin posibilidad de elegir. Ahora abre un modal
(`tenant-detail.component`) que lista `GET /modules/public` con checkboxes
(todo preseleccionado por default, "Seleccionar todos"/"Ninguno" como atajo)
y manda `{ moduleIds }` a `POST /admin/tenants/:id/modules/sync`.
`ModulesService.syncPublicModulesToTenant(schema, moduleIds?)` acota las 3
queries de INSERT (modules/module_forms/module_roles) a `id = ANY($1)` cuando
se pasa el array (incluso vacío — un array vacío sincroniza nada, no cae al
comportamiento legacy); `moduleIds` `undefined` conserva el comportamiento
histórico de "todo el catálogo" para el otro caller existente
(`ModulesController.syncToTenant`, sin UI que lo use hoy). `tsc --noEmit` y
`ng build`/`nest build` limpios.

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
tenant más desde el super admin (ver `docs/adr/009-...md`). Tras el reset de
esta sesión, tiene el primer rubro real: `INVENTARIO_BARRIO`/`CLIENTES`/
`PROVEEDORES` (ver "Último trabajo realizado" y
`docs/adr/013-catalogo-modulos-multi-vertical.md`). Los otros 3 rubros
(moda, ferretería, barbería/salón) están diseñados en el ADR pero **no**
creados todavía. `tenant_demo` ya tiene ese catálogo sincronizado y con
tablas/SPs propios generados; `tenant_acme` sigue vacío. Grid con búsqueda
general + paginación real (`docs/adr/005-...md`); todo `SELECT` sin `limit`
explícito pagina a 25 por default.

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

**Hay repositorio git** (el usuario commitea directamente durante la sesión,
sin pasar por Claude — no asumir que "sin commit" significa "sin guardar").
`CLAUDE.md` tenía una nota vieja de "no hay repositorio git" que ya no aplica
y fue corregida esta sesión.

## Bugs abiertos

- El bug de `image VARCHAR(500)` (ver `docs/adr/006-image-field-storage.md`)
  ya no tiene tablas afectadas vivas — el reset de esta sesión dropeó todas
  las `tbl_*` generadas antes del fix. Vigilar si reaparece en tablas nuevas
  (no debería: `FormGeneratorService.toDbType()` ya usa `TEXT` para `image`).
- `public.module_forms` no tiene la misma constraint única
  `UNIQUE(module_id, form_slug)` que ya tienen los schemas de tenant — riesgo
  bajo hoy (`setPublicModuleForms` siempre hace DELETE+INSERT), pero
  inconsistente si se agrega otro camino de escritura a esa tabla.
- Huecos conocidos de `docs/adr/008-form-catalog-access-control.md`: sin poda
  retroactiva de asignaciones ya hechas, sin gate de runtime sobre datos ya
  asignados, `syncPublicModulesToTenant()` no pasa por el gate de acceso.
- `{schema}.module_forms.form_slug` sigue sin FK hacia `forms.slug` — pero
  desde esta sesión `FormGeneratorService.deleteForm()` limpia `module_forms`
  del slug borrado dentro de la misma transacción, así que el camino normal
  (borrar desde el builder) ya no deja huérfanos. Solo puede recurrir si algo
  borra `{schema}.forms` a mano por SQL. Ver `docs/known-bugs.md`.
- La búsqueda general de la grid (`filter.search`) incluye columnas `image`
  (TEXT/base64) en el `OR ILIKE` — correcto pero innecesariamente costoso
  contra un campo que nunca va a matchear un término de búsqueda real. No
  resuelto: `selectPaged()` no tiene acceso al `json_form` del formulario
  para saber qué columna TEXT es en realidad una imagen.

## Riesgos

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

1. `tenant_demo`/`tenant_acme` no tienen `rubro_id` (son anteriores a este
   feature) — decidir si asignarles uno (`demo` calza con `tienda_barrio`,
   ya tiene ese catálogo sincronizado) para que el modal de sync los filtre
   correctamente y puedan recibir Categorías/Unidades vía
   `syncCatalogDataForRubro()`.
2. Catálogo público completo de los 4 rubros (moda, ferretería, barbería/
   salón, tienda de barrio) — falta sincronizar cada uno hacia el tenant
   real que corresponda cuando exista (hoy solo `tienda de barrio` está
   sincronizado, a `tenant_demo`).
3. Diseñar en conjunto con el usuario los 2 formularios complejos que
   quedaron fuera a propósito: ventas con carrito multi-línea + descuento de
   stock, y agenda de citas para barbería/salón (ambos requieren tabla+SP a
   mano, no solo el builder — ver ADR-013).
4. Verificación visual en navegador de todo lo agregado recientemente:
   catálogo de Rubros/Categorías/Unidades con selects dinámicos, selector de
   rubro al crear tenant, eliminar formulario desde el builder, modal de
   selección de módulos al sincronizar, ofuscación de code/slug en la URL,
   sidebar admin dinámico, builder en modo público, `/admin/modules`, modal
   "Nuevo tenant", buscador + paginación de la grid, modo de visualización
   modal/inline + ancho custom.
5. Decidir `docker-compose.prod.yml` (pendiente desde el inicio del proyecto).
6. Decidir sobre Redis: quitarlo del compose o implementar su uso real.
7. Fase futura ya acordada con el usuario: vista para migrar los *datos*
   (tabla + filas) de un formulario probado en `public` hacia un tenant real
   elegido.
