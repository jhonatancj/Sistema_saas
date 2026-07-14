# 023 — Agrupación del sidebar del super admin por rubro

## Contexto

Con el catálogo de los 4 rubros completo (Inventario+Ventas+Compras por
rubro, ver `docs/plan-ventas-agenda.md` y ADR-013/017/019), el sidebar del
super admin (`SidebarComponent.adminNavItems`) pasó de tener ~5 módulos a
16 — cada módulo del catálogo público se renderizaba como un grupo suelto
de primer nivel (`VENTAS_BARRIO`, `VENTAS_MODA`, `VENTAS_FERRETERIA`,
`VENTAS_BELLEZA`, `COMPRAS_BARRIO`, ... todos al mismo nivel que
`CLIENTES`/`EMPLEADOS`). Pedido explícito del usuario: "ya hay muchas
cosas regadas".

Nota: esto **solo afecta al sidebar admin** — un tenant real siempre tiene
un único rubro asignado (nunca ve más de ~7 módulos), así que
`tenantNavItems` no necesitó ningún cambio.

## Decisión

Agregar un nivel de agrupación por `rubro_id` **solo en `adminNavItems`**:

- `ModulesService.getPublicModulesForMenu()` ahora hace `LEFT JOIN
  public.tbl_rubro` y expone `rubro_id`/`rubro_code`/`rubro_nombre` por
  módulo (`rubro_id NULL` para los universales: Clientes/Proveedores/
  Empleados/Sucursales).
- `SidebarComponent.adminNavItems` agrupa los módulos recibidos por
  `rubro_id` — un grupo de primer nivel por rubro (`Tienda de Barrio`,
  `Moda`, `Ferretería`, `Barbería / Salón de Belleza`, orden por
  `rubro_id`), más un grupo `Catálogo` para los `rubro_id: null`.
  `Administración` (Tenants/Super Admins/Módulos/Rubros/Builder/Seguridad)
  sigue como estaba.
- El sidebar pasó de 2 niveles (grupo → form) a 3 (rubro → módulo → form)
  **solo para este caso** — se extendió `NavChild` para que pueda tener
  `children?: NavChild[]` (antes solo `NavItem` los tenía), y el template
  (`sidebar.component.html`) agrega un `@if (child.children)` extra: si un
  nivel-2 tiene hijos, se renderiza como botón expandible
  (`.sidebar__subitem`) en vez de link directo. Estado de expansión nuevo:
  `openSubGroup` (además del `openGroup` ya existente) — cambiar de rubro
  resetea `openSubGroup` a `null` para no dejar un sub-grupo de otra rama
  abierto.
- Un tenant real (`tenantNavItems`) nunca genera un nodo con `children`
  anidados en sus propios children (sus formularios siempre son hojas), así
  que el `@if (child.children)` nuevo del template no le afecta — sigue
  renderizando 2 niveles exactamente igual que antes.
- Íconos por rubro: mapa fijo por `rubro.code` (`tienda_barrio`→store,
  `moda`→shirt, `ferreteria`→screwdriver-wrench, `belleza`→scissors) con
  default genérico (`layer-group`) para un rubro nuevo sin entrada en el
  mapa — puramente cosmético, no rompe si se agrega un 5º rubro.

## Consecuencias

- El sidebar admin pasa de 16 grupos sueltos a 7 (4 rubros + Catálogo +
  Administración + Dashboard) — verificado en el navegador real.
- Un rubro nuevo (5º, 6º...) no necesita ningún cambio de código: aparece
  solo con el ícono default hasta que se agregue una entrada en
  `RUBRO_ICONS`.
- El sidebar del tenant (`tenantNavItems`) queda sin cambios funcionales —
  no tiene sentido agrupar por rubro ahí porque un tenant real solo tiene
  uno.
