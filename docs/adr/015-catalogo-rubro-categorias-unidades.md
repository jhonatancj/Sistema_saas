# ADR-015: Catálogo de Rubros + Categorías/Unidades de medida dinámicas

## Contexto
`categoria`/`unidad` en los formularios de producto eran `select` con
`options` fijas hardcodeadas en el `json_form` (ej. "Abarrotes"/"Bebidas"
para tienda de barrio). El usuario (autor de `@jhonatancj/dforms`) pidió
volverlos catálogos reales editables por CRUD. Al diseñarlo apareció un
vacío mayor: no existía ningún concepto de "rubro" en el sistema — ni en
`tenants` ni en `modules` — así que no había forma de saber a qué vertical
pertenece un tenant, ni de filtrar qué categorías/unidades le corresponden
al sincronizar.

## Decisión

### 1. `rubro` — catálogo admin-only vía el motor de formularios
`rubro` es un `public.forms` más (`FormGeneratorService.processForm`), no
una tabla escrita a mano — reutiliza 100% la infra existente
(`FormDetailComponent`, `AdminFormsController`). **No** se envuelve en un
`public.modules` (para que nunca aparezca en el sidebar de un tenant ni se
sincronice) — se expone como link fijo en `adminNavItems`
(`sidebar.component.ts`), reusando la ruta ofuscada `/admin/m` (ADR anterior
de ofuscación de URL) con `encodeFormRoute('SISTEMA', 'rubro')`. Campos:
`nombre`, `code` (identificador estable, ej. `tienda_barrio`), `activo`.
Sembrado con los 4 rubros iniciales: `tienda_barrio`, `moda`, `ferreteria`,
`belleza`.

### 2. `tenants.rubro_id` / `modules.rubro_id` — sin FK real
Columnas `BIGINT` nullable (`Back/database/10_rubro_tenant_module.sql`),
**sin `REFERENCES`** — `tbl_rubro` la crea el motor en runtime, no en el
bootstrap SQL, forzar una FK metería un problema de orden de creación; se
confía en el nivel de aplicación (mismo criterio que `table_name`/`sp_name`
en `FormGeneratorService.validateIdentifier`). `NULL` en `modules.rubro_id`
= módulo universal/core, se ofrece para cualquier tenant al sincronizar
(`CLIENTES`, `PROVEEDORES`, `CATEGORIAS`, `UNIDADES_MEDIDA`); con valor =
solo se ofrece a un tenant de ese rubro exacto (`INVENTARIO_BARRIO` →
`tienda_barrio`, etc.).

**Simplificación deliberada**: `CATEGORIAS`/`UNIDADES_MEDIDA` son módulos
core (rubro_id NULL) aunque "Unidades de medida" no aplique realmente a
`belleza` (un servicio no tiene unidad de medida) — no se modeló una
relación many-to-many módulo↔rubro para esto. Un tenant de belleza vería
"Unidades de medida" disponible en el selector de sync aunque no lo
necesite; el super admin simplemente no lo tilda. Aceptable, no es un bug.

### 3. Categorías/Unidades — una sola tabla compartida, filas etiquetadas por rubro
Dos módulos core nuevos (`CATEGORIAS`, `UNIDADES_MEDIDA`). En `public`
conviven filas de los 4 rubros mezcladas (el super admin gestiona todo
desde un catálogo único) — **"Otros" se repite a propósito en los 4
rubros**, y "Unidad"/"Kilo"/etc. se repiten entre `tienda_barrio` y
`ferreteria`. Por eso **no hay `UNIQUE(nombre)`** en `tbl_categorias`/
`tbl_unidades_medida` (el motor solo soporta `UNIQUE` de una sola columna
vía `unique: true` en el builder — habría bloqueado nombres repetidos entre
rubros distintos). Cada fila lleva su propio campo `rubro` (select con
`optionsSource: 'rubro'`, `valueKey: 'code'` — guarda el `code` del rubro
como texto plano, sin FK real, igual que cualquier `select` normal del
motor).

### 4. Sync de DATOS filtrado por rubro — primera vez que esto existe
`ModulesService.syncCatalogDataForRubro(schema)` (privado, invocado al
final de `syncPublicModulesToTenant()`, siempre que corre un sync, sin
depender de qué `moduleIds` se eligieron):
1. Resuelve el `rubro_id`/`code` del tenant — si no tiene (`demo`/`acme`,
   tenants viejos anteriores a este feature), no hace nada.
2. Genera `tbl_categorias`/`tbl_unidades_medida` en el tenant si todavía no
   existen (`processForm`), usando el `json_form` que `copyMissingFormsToTenant`
   ya copió antes en la misma función.
3. Copia filas de `public.tbl_categorias`/`tbl_unidades_medida` **filtradas
   por `rubro = code del tenant`** hacia las tablas del tenant. Idempotente
   vía `NOT EXISTS` (no `ON CONFLICT`, porque no hay `UNIQUE(nombre)` real
   — ver punto 3) — nunca pisa filas que el tenant ya haya agregado/editado
   a mano.

Es el **primer caso de sync de filas de datos reales** en el sistema — todo
sync anterior (`syncPublicModulesToTenant`'s INSERT de `modules`/
`module_forms`/`module_roles`, `copyMissingFormsToTenant`) solo copiaba
definiciones/metadata, nunca datos de negocio.

Verificado end-to-end: tenant de prueba con rubro `moda` → tras sincronizar,
`tenant_X.tbl_categorias` tiene exactamente las 6 categorías de moda
(Accesorio/Calzado/Camisa/Otros/Pantalón/Vestido), cero de barrio/
ferretería/belleza. `tbl_unidades_medida` queda vacía (correcto — no hay
unidades sembradas para `moda`, no aplica a ese rubro). Tenant de prueba
borrado tras verificar.

### 5. `categoria`/`unidad` de los formularios de producto → `optionsSource`
`producto_barrio`/`producto_moda`/`producto_ferreteria` migrados de
`options` estático a `optionsSource: 'categorias'`/`'unidades_medida'`,
`valueKey: 'nombre'`, `labelKey: 'nombre'` (mismo criterio que ya usaba el
valor legible sin capa de id separada). **No hace falta filtrar por rubro
en el resolver de opciones** — consecuencia elegante del diseño: en un
tenant real, `tbl_categorias` local *ya solo tiene* las filas de su rubro
(por el sync del punto 4); en `public`, se ven todas mezcladas — que es
exactamente lo que se pidió.

### 6. `optionsSource` real — reemplaza el mock
`Front/src/app/core/services/remote-form-options.service.ts`
(`RemoteFormOptionsService implements FormOptionsProvider`):
`loadOptions(endpointId, params)` llama `POST {base}/{endpointId}/execute`
con `{action:'SELECT', limit:1000, offset:0}` — **reusa el endpoint
`execute` que ya existe**, tratando `endpointId` como el slug del form
directamente (`'categorias'`, `'unidades_medida'`, `'rubro'`), sin
necesitar un endpoint nuevo por catálogo. `base` sale de
`TenantService.isAdminContext()` (`/admin/forms` vs `/forms`), igual que
`formsBase()` en `FormDetailComponent`. Con `limit`/`offset` explícitos,
`FormExecutorService.execute()` siempre entra por la rama paginada del SP
(`{rows, total}`, no el array plano) — `loadOptions` devuelve `res.data.rows`.
Reemplaza `FormOptionsMockService` (mock de países/departamentos sin uso
real, borrado) en los `providers` de `builder.component.ts` y
`form-detail.component.ts`.

## Consecuencias
- Crear un rubro nuevo (ej. "Restaurante") es una fila más en el catálogo
  `rubro`, sin deploy — pero requiere además: crear su módulo de inventario/
  servicios (patrón ADR-013), sembrar sus categorías/unidades, y taggear el
  módulo con `rubro_id`. No es un proceso de un solo paso todavía.
- `updatePublicModule()`/`updateTenant()` usan `COALESCE` — no se puede
  "desasignar" un `rubro_id` ya seteado a `NULL` desde la API (mismo
  límite preexistente que ya tenían `tenant_name`/`tenant_code`).
- Riesgo latente conocido, no resuelto: si un tenant cambia de rubro
  después de ya haber sincronizado categorías/unidades de su rubro
  anterior, esas filas viejas quedan huérfanas en su schema (nada las
  borra). No se modela "cambio de rubro" como caso de uso todavía.
