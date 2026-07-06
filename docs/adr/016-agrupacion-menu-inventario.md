# ADR-016: Agrupar Categorías/Unidades dentro de Inventario, y los ítems de sistema en "Administración"

## Contexto
Con el catálogo de los 4 rubros completo (ADR-013) y Categorías/Unidades de
medida como módulos propios (ADR-015), el sidebar quedó con demasiadas
entradas de primer nivel: cada `INVENTARIO_*`/`SERVICIOS_BELLEZA` generaba
su grupo con un solo form adentro, y `CATEGORIAS`/`UNIDADES_MEDIDA` cada uno
el suyo (también con un solo form). En el sidebar de super admin, además,
`Tenants`/`Super Admins`/`Módulos`/`Rubros`/`Builder`/`Seguridad` estaban
sueltos junto a los módulos de negocio. El usuario pidió agrupar ambas
cosas.

## Decisión

### Catálogo: `categorias`/`unidades_medida` anidados dentro de cada Inventario/Servicios
Matiza (no reemplaza) el diseño de ADR-015: en vez de que Categorías y
Unidades de medida sean módulos propios que un tenant sincroniza aparte,
sus forms (`categorias`, `unidades_medida` — sin cambios, siguen siendo las
mismas tablas compartidas con filas de los 4 rubros mezcladas en `public`)
se asignan directamente al `module_forms` de cada módulo de rubro:

| Módulo | Forms anidados |
|---|---|
| `INVENTARIO_BARRIO` | `producto_barrio`, `categorias`, `unidades_medida` |
| `INVENTARIO_MODA` | `producto_moda`, `categorias` (sin unidades — no aplica) |
| `INVENTARIO_FERRETERIA` | `producto_ferreteria`, `categorias`, `unidades_medida` |
| `SERVICIOS_BELLEZA` | `servicio_belleza`, `categorias` (sin unidades) |

`CLIENTES`/`PROVEEDORES` quedan igual que antes (grupos propios, no se
tocaron). Los módulos standalone `CATEGORIAS`/`UNIDADES_MEDIDA` quedan
`is_active = FALSE` — no se ofrecen más como opción separada en el selector
de sync (`syncPublicModulesToTenant` ya filtra `WHERE is_active = TRUE`).
No se borraron: las forms siguen existiendo, solo cambia a través de qué
módulo se sincronizan de ahora en más.

Sin cambios de código — `{schema}.module_forms` ya era una tabla puente
module_id↔form_slug sin restricción de exclusividad; esto es 100%
reorganización de filas, corrida vía script Nest de un solo uso.

`tenant_demo` (ya tenía los módulos standalone sincronizados, ids 9/10)
se reorganizó a mano: sus `module_forms` de `categorias`/`unidades_medida`
se movieron al módulo `Inventario` local (id 1), y las filas de módulo 9/10
(`module_forms`, `module_roles`, `modules`) se borraron — **sin tocar**
`tbl_categorias`/`tbl_unidades_medida` ni sus datos (8 y 6 filas
respectivamente, intactas). Verificado simulando la query de
`getTenantModulesByRole('ADMIN')`: un solo grupo "Inventario" con Productos/
Categorías/Unidades de medida adentro, en ese orden (`sort_order` 0/1/2).

### Sidebar de super admin: grupo "Administración"
`sidebar.component.ts`, `adminNavItems` — `Tenants`, `Super Admins`,
`Módulos`, `Rubros`, `Builder`, `Seguridad` pasan a ser `children` de un
único `NavItem` "Administración", al final de la lista (mismo criterio que
ya usa "Configuración" en `tenantNavItems`: ítems de sistema, no de
negocio, siempre al final). `Dashboard` queda afuera del grupo (landing
page). Los módulos dinámicos (`...menuService.modules()`) no cambian.

## Consecuencias
- Un módulo nuevo de rubro que necesite Categorías/Unidades debe agregarlo
  a su propio `module_forms` explícitamente (no hay default automático) —
  seguir la tabla de arriba como referencia al crear el 5° rubro.
- Si en el futuro se reactivan `CATEGORIAS`/`UNIDADES_MEDIDA` como módulos
  standalone (`is_active = TRUE` de nuevo) sin desanidarlos primero, un
  tenant que sincronice ambos vería el form duplicado (una vez suelto, otra
  vez dentro de Inventario) — no hay guard que lo impida.
