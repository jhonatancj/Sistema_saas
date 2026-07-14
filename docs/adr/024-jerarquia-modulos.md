# 024 — Jerarquía real de módulos (hasta 4 niveles, opcional)

## Contexto

ADR-023 (misma sesión, unas horas antes) agrupó el sidebar del super admin
por rubro para resolver el desorden de 16 módulos sueltos de primer nivel
— pero ese agrupamiento era **puramente calculado en el frontend**
(`rubro_id` → grupo, sin nada persistido, caso especial de código solo
para `adminNavItems`). El usuario pidió algo más general: que la
jerarquía sea un dato real, configurable a mano desde la pantalla de
Módulos (tanto el catálogo público del super admin como los módulos de un
tenant real), con hasta 4 niveles (`módulo > submódulo > submódulo >
form` — 3 niveles de módulo, el form es el 4º y último peldaño),
**opcional** (un módulo sin padre sigue siendo raíz).

## Decisión

`parent_id BIGINT` autoreferenciado en `modules` (`public` y
`{schema}.modules`, `ON DELETE SET NULL` — borrar un contenedor no borra a
sus hijos, los vuelve a la raíz):

- `ModulesService.validateModuleParent(schema, moduleId, parentId)` — un
  solo helper reusado por los 4 puntos de entrada
  (`create`/`update`Public`Module`/`Tenant`Module`). Valida, en este orden:
  auto-padre → ciclo (CTE recursivo hacia arriba desde el padre propuesto,
  ¿aparece el módulo que edito en esa cadena?) → profundidad (`profundidad
  del padre + 1 + profundidad del propio subárbol > 3` → rechaza).
  **Gotcha real encontrado verificando esto**: `array_agg(id)` sobre una
  columna `BIGINT` es un tipo distinto (`bigint[]`, OID 1016) al que
  `database.module.ts` ya normaliza (`BIGINT` escalar, OID 20) — sin
  `.map(Number)` antes de comparar, la detección de ciclo nunca disparaba
  (comparaba string contra number). Mismo patrón ya documentado en
  `docs/known-bugs.md`, esta vez vía `array_agg` en vez de una columna
  simple.
- `updatePublicModule`/`updateTenantModule`: `dto.parentId !== undefined ?
  dto.parentId : current.parent_id` — **nunca** `COALESCE` para este campo
  puntual (a diferencia de los demás campos del mismo UPDATE, que sí lo
  usan) porque hay que poder volver a mandar un módulo a la raíz
  (`parentId: null` explícito), algo que `COALESCE` no permite expresar.
- `syncPublicModulesToTenant()`: después de insertar los módulos nuevos,
  un `UPDATE` de traducción (`public.modules.parent_id` apunta a un `id`
  de `public`; el tenant tiene los suyos, linkeados vía `public_id`). Si
  el padre público no se sincronizó a ese tenant, el hijo queda sin padre
  (raíz) — degradación segura, sin error.
- Frontend: `SidebarComponent.buildModuleTree()` (reemplaza el
  agrupamiento por rubro de ADR-023) arma el árbol real a partir de
  `parent_id` — con el mismo criterio de degradación segura (un
  `parent_id` que no matchea ningún módulo de la lista recibida se trata
  como raíz, nunca desaparece). Nuevo **componente recursivo**
  `NavTreeNodeComponent` (se referencia a sí mismo en su propio template)
  reemplaza el nivel-2 hardcodeado de ADR-023 — la profundidad ya no es
  fija, el componente se anida tantas veces como el árbol lo pida. Estado
  de expansión **local a cada instancia** (`signal` propio, no un `Map`
  compartido) — al desmontarse junto con su padre, se pierde solo, sin
  lógica de reseteo manual entre ramas; distinto del nivel 1
  (`SidebarComponent.openGroup`), que sigue siendo un solo grupo abierto a
  la vez (accordion), sin cambios respecto a como ya funcionaba antes de
  esta sesión.
- `AdminModulesComponent`/`SettingsModulesComponent`: campo "Módulo padre"
  (mismo patrón que el `ng-select` de "Rubro" que ya existía) — filtra
  únicamente el propio módulo que se edita (la validación real de
  ciclo/profundidad la hace el backend).
- Datos: se crearon 5 módulos contenedor reales en `public.modules`
  (`RUBRO_TIENDA_BARRIO`/`RUBRO_MODA`/`RUBRO_FERRETERIA`/`RUBRO_BELLEZA`/
  `CATALOGO`) y se reparentaron los 16 módulos existentes — reemplaza
  1:1 el resultado visual de ADR-023 pero ahora como dato real. Los
  tenants existentes (`tenant_demo`/`tenant_acme`) **no** recibieron
  ningún contenedor — la jerarquía es opcional, queda a criterio de cada
  tenant armar la suya desde su propia pantalla de Módulos si quiere.

## Consecuencias

- ADR-023 queda superado en la práctica (el agrupamiento por rubro
  calculado ya no existe en el código) pero se conserva el archivo como
  registro histórico de la decisión intermedia, sin editarlo — según
  convención del proyecto, un ADR nuevo dice a cuál supersede en vez de
  reescribir el viejo.
- Cualquier módulo (no solo los de rubro) puede anidarse ahora — un admin
  puede armar agrupaciones arbitrarias sin que el motor tenga que conocer
  el concepto de "rubro" para nada relacionado al sidebar.
- El límite de 3 niveles de módulo es una constante (`MAX_MODULE_DEPTH`)
  en `ModulesService` — cambiarlo es un solo número, no requiere tocar el
  frontend (el componente recursivo no tiene ningún límite propio,
  renderiza lo que el backend le mande).
- Mover un módulo con hijos ya existentes revalida la profundidad de todo
  su subárbol, no solo la del módulo movido — evita que mover un
  contenedor empuje a sus nietos más allá del límite sin darse cuenta.
