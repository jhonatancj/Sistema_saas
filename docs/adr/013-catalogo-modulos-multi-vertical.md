# ADR-013: Catálogo de módulos multi-vertical (moda, ferretería, barbería/salón, tienda de barrio)

## Contexto
El SaaS va a servir 4 tipos de negocio con necesidades de inventario muy
distintas: almacenes de moda (tallas/colores), ferreterías (unidad de
medida), barberías/salones de belleza (venden servicios, no productos) y
tiendas de barrio (inventario genérico + fiado). Hacía falta decidir si el
catálogo público (`public.modules`/`public.forms`) modela esto con un único
módulo genérico o con variantes por rubro.

## Decisión
**Core compartido + variantes por rubro**, reutilizando el patrón ya
existente de `docs/adr/012-module-tenant-name.md` (mismo *concepto* de
módulo, entidad distinta por rubro con su propio `code` único — `modules.code`
tiene constraint única, así que cada variante necesita su propio código).

**Módulos core** (un solo `code`, compartido por los 4 rubros, se sincroniza
igual sin importar el negocio del tenant):
- `CLIENTES` — nombre, documento, teléfono, email, dirección, `limite_credito`
  (fiado — aplica a cualquier rubro, no solo tienda de barrio), notas, activo.
- `PROVEEDORES` — nombre/razón social, contacto, teléfono, email, dirección,
  notas, activo.

**Módulos por rubro** (un `code` distinto por variante, mismo concepto de
"catálogo de lo que se vende"):
- `INVENTARIO_BARRIO` (tienda de barrio) — implementado. Form
  `producto_barrio`: nombre, código/SKU, categoría (Abarrotes/Bebidas/Aseo/
  Snacks/Lácteos/Panadería/Cigarrería/Otros), precio_compra, precio_venta,
  stock, unidad (unidad/paquete/caja/gramo/kilo/litro), imagen, descripción,
  activo.
- `INVENTARIO_MODA` (moda/ropa) — implementado. Form `producto_moda`: mismo
  esqueleto que `producto_barrio` pero con `talla` (select XS-XXL) y `color`
  (texto libre) en vez de `unidad`, y categoría de prenda (camisa/pantalón/
  vestido/calzado/accesorio/otros) en vez de categoría de abarrotes.
- `INVENTARIO_FERRETERIA` — implementado. Form `producto_ferreteria`: mismo
  esqueleto, `unidad_medida` con opciones técnicas (unidad/metro/kilo/litro/
  galón/rollo/caja) y categoría técnica (herramientas/eléctrico/plomería/
  pintura/ferretería general/otros) en vez de la categoría de abarrotes.
- `SERVICIOS_BELLEZA` — implementado. Form `servicio_belleza`: no es
  inventario de productos sino catálogo de servicios: nombre del servicio,
  categoría (corte/color/manicure/pedicure/tratamiento/otros),
  `duracion_min` (number), precio, descripción, activo. Sin `stock` (no
  aplica a un servicio).

Los 3 módulos de inventario (`INVENTARIO_BARRIO`/`INVENTARIO_MODA`/
`INVENTARIO_FERRETERIA`) comparten `tenant_code: 'inventario'` (ver
ADR-014) — un tenant que reciba cualquiera de los 3 ve la misma URL
genérica, sin importar el rubro real. `SERVICIOS_BELLEZA` usa
`tenant_code: 'servicios'`.

Cada tenant recibe, vía el modal de sincronización (`tenant-detail.component`,
`POST /admin/tenants/:id/modules/sync` con `moduleIds`), los módulos core
**más** el módulo de inventario/servicios que corresponda a su rubro — nunca
los 4 variantes de inventario a la vez.

## Formularios complejos, deliberadamente fuera de esta fase
Dos features quedaron fuera a pedido explícito del usuario — requieren
diseño de tabla+SP a mano, no solo un JSON del builder, porque el motor
actual (`FormGeneratorService`) genera un CRUD de una sola tabla, sin lógica
transaccional entre tablas:

1. **Ventas con carrito multi-línea y descuento automático de stock** — el
   generador actual no soporta un encabezado de venta + N líneas de detalle
   que además tienen que restar `stock` en `tbl_producto_*` de forma
   transaccional. Requiere una tabla de encabezado, una de detalle, y un SP
   escrito a mano (`recreateSp: false`) con esa lógica.
2. **Agenda de citas** (barbería/salón) — turnos por fecha/hora/empleado con
   vista de calendario. El CRUD simple es viable con el motor actual (fecha,
   hora, cliente, servicio, empleado como campos planos), pero la experiencia
   de calendario/disponibilidad es una feature de UI aparte, no solo una
   tabla.

Construir estos dos en conjunto con el usuario cuando llegue el momento —
no bloquean el resto del catálogo.

## Cómo se creó el catálogo
Los 6 módulos/forms (`CLIENTES`, `PROVEEDORES`, `INVENTARIO_BARRIO`,
`INVENTARIO_MODA`, `INVENTARIO_FERRETERIA`, `SERVICIOS_BELLEZA`) se crearon
llamando directamente a los mismos servicios que usa la API (`FormGeneratorService.processForm('public', …)`,
`ModulesService.createPublicModule()`, `setPublicModuleForms()`,
`setPublicModuleRoles()`) desde un script Nest de un solo uso, no a mano por
SQL — así el JSON de cada formulario tiene exactamente la forma que produce
`@jhonatancj/dforms` (nodos `column`/`text`/`number`/`select`/`textarea`/
`checkbox`/`image`, cada uno con `children: []`) y pasa por las mismas reglas
de generación de DDL que el builder visual.

**Nota operativa histórica, ya resuelta (ver ADR-015)**: en su momento,
sincronizar módulos a un tenant (`syncPublicModulesToTenant`) copiaba la
*definición* del formulario (`json_form`) a `{schema}.forms`, pero no
generaba la tabla/SP real de ese tenant — requería abrir el formulario en
el builder en modo "Por tenant" y guardar, o invocar `processForm` a mano
(como en esta sesión). Un bug real reportado al sincronizar Categorías/
Unidades a `tenant_demo` (la tabla no existía) llevó a agregar
`ModulesService.ensureFormsGenerated()`, que ahora genera tabla/SP para
cualquier form recién asignado dentro del propio sync — ya no hace falta el
paso manual.

**Bug encontrado tras crear el catálogo: la grid no mostraba nada.**
`FormDetailComponent.colDefs` (Front) arma las columnas de AG-Grid
**exclusivamente** desde `{schema}.forms.grid_config` (la pestaña "Grid" del
builder) — nunca desde `json_form`. `processForm()` no toca `grid_config`
(solo lo hace `saveGridConfig()`, que dispara la pestaña "Grid" al guardar).
Como los 3 forms de esta sesión se crearon llamando a `processForm()`
directo, `grid_config` quedó en `[]` y la grid se veía vacía en los 3 —
aunque `json_form`/tabla/SP estaban perfectos. Corregido llamando
`AdminFormsService.saveGridConfig(slug, columns)` para `public` **y** para
`demo` (columns = una entrada por campo del formulario, en el mismo orden,
`visible: true`, mismo shape que produce `loadGridConfig()` la primera vez
que se abre la pestaña Grid sin config previa). **Al crear un form nuevo sin
pasar por el builder visual, `grid_config` es un paso aparte que no se puede
saltar** — no basta con `processForm()`.

## Permisos por rol (module_roles) del catálogo
Definidos en `public.module_roles` (se copian al tenant en el sync):

| Módulo | ADMIN | SALES | WAREHOUSE |
|---|---|---|---|
| Inventario (barrio/moda/ferretería) | CRUD completo | solo ver | CRUD completo |
| Clientes | CRUD completo | ver+crear+editar (sin borrar) | sin acceso |
| Proveedores | CRUD completo | sin acceso | solo ver |
| Servicios (belleza) | CRUD completo | solo ver | sin acceso |

## Consecuencias
- Cada rubro nuevo agrega un módulo (`code` nuevo) + form nuevo al catálogo
  público, nunca modifica los existentes — los tenants ya sincronizados con
  un rubro no se ven afectados al agregar otro.
- `public.module_roles` **debe** definirse para todo módulo nuevo antes (o
  junto con) asignarle forms — un módulo sin filas en `module_roles` queda
  invisible para cualquier rol de tenant (`getTenantModulesByRole()` hace
  `INNER JOIN module_roles WHERE can_view = TRUE`), aunque el super admin sí
  lo vea en su propio catálogo. Error real encontrado y corregido en esta
  sesión.
- Después de sincronizar un módulo a un tenant, sigue pendiente el paso
  manual de abrir cada formulario nuevo en el builder ("Por tenant") y
  guardar, para generar su tabla/SP real en ese schema.
