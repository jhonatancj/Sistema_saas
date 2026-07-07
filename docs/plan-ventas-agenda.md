# Plan — Ventas (carrito + stock) y Agenda de citas

> Plan de trabajo para los 2 formularios complejos que quedaron deliberadamente
> fuera del catálogo inicial (ver `docs/adr/013-catalogo-modulos-multi-vertical.md`).
> No es un ADR — se actualiza a medida que se decide/avanza, no se acumula
> historial.

## Decisiones ya tomadas con el usuario

1. **Ventas: un módulo por rubro, con FK real** (`VENTAS_BARRIO`/`VENTAS_MODA`/
   `VENTAS_FERRETERIA`, cada uno con su propia tabla de detalle apuntando a su
   propia tabla de producto). Belleza tiene su propia variante sin descuento
   de stock.
2. **Agenda: catálogo nuevo "Empleados"** (mismo patrón que Clientes/
   Proveedores, sin login).
3. **`grid` en dforms hoy es solo visor/selector, no editable** — queda como
   punto de trabajo en la librería, ver spec abajo.
4. **Orden de arranque: Agenda primero** (CRUD simple, sin bloqueos), Ventas
   queda pendiente de que `grid` soporte líneas editables en dforms.
5. **dforms `1.3.3` publicado** con `line-items` (filas editables/
   repetibles), `relation` oficial (combinable con `optionsSource`, incluso
   dentro de una columna de `line-items`) y `time` — los 2 bloqueantes para
   Ventas ya resueltos del lado de la librería. Verificado: tipado real en
   `jhonatancj-dforms.d.ts` coincide con el README publicado; `tsc --noEmit`
   del frontend limpio contra la nueva versión.
6. **`venta_barrio` implementado y verificado end-to-end** (primera
   variante, tienda de barrio) — ver `docs/adr/017-tabla-detalle-line-items.md`
   para el diseño completo (detección de `line-items`, generación de tabla
   de detalle + FK real, SP a mano, setting `tenants.ventas_editable`).
   Sigue en el catálogo público (`public`), sin sincronizar a ningún
   tenant todavía. `venta_moda`/`venta_ferreteria`/`venta_belleza` quedan
   pendientes — mismo patrón, mecánico una vez validado este primero.

## Respuesta de base: sí se puede asignar un SP ya escrito a mano

Ya existe el mecanismo, no hay que construir nada nuevo para eso:

```typescript
// form-generator.service.ts:306-316
const recreateSp = dto.recreateSp ?? true;
const effectiveSpName = dto.spName || `sp_${dto.slug}`;
if (recreateSp) {
  // ... DROP + CREATE OR REPLACE del SP autogenerado
} else if (dto.spName) {
  hasSp = true; // SP hecho a mano por el admin — se confía en que existe
}
```

Con `recreateSp: false` + `spName: 'sp_mi_venta_custom'` en el form (ya es un
campo del builder, sección avanzada), el motor **nunca vuelve a tocar ese SP**
al reprocesar el formulario — se escribe a mano (psql u otro medio) y el
sistema solo genera/mantiene la tabla. Es la puerta de escape para los dos
formularios de este documento.

---

## 1. Ventas (carrito multi-línea + descuento de stock)

**`venta_barrio` ya implementado y verificado — ver
`docs/adr/017-tabla-detalle-line-items.md` para el diseño completo.**
`venta_moda`/`venta_ferreteria`/`venta_belleza` quedan pendientes (mismo
patrón, mecánico).

| | |
|---|---|
| **Form(s)** | `venta_barrio` (encabezado) + `venta_barrio_detalle` (líneas, generada automáticamente por el motor) |
| **Módulo** | `VENTAS_BARRIO` (id 12), rubro `tienda_barrio` |

### Decisión #1 (resuelta): módulo de Ventas por rubro, con FK real
`VENTAS_BARRIO`/`VENTAS_MODA`/`VENTAS_FERRETERIA` — cada uno con su propia
tabla de detalle apuntando a su propia tabla de producto (mismo patrón que
Inventario). Belleza tiene su propia variante ("Venta de servicio"), **sin**
descuento de stock (un servicio no tiene stock) — el SP a mano de esa
variante simplemente no tiene el paso de `UPDATE ... SET stock = stock - X`.

### Motor (backend) — implementado
`FormGeneratorService.findLineItemsNode()` detecta un nodo `line-items` en
el formulario y genera además la tabla de detalle (con FK real hacia el
encabezado y hacia cualquier columna con `relation`, ver ADR-017). El SP
(`sp_venta_barrio`, a mano, `recreateSp:false`) valida stock suficiente por
línea (`SELECT ... FOR UPDATE`) y resta en el mismo loop que inserta cada
línea — evita el bug de sub-contar demanda cuando el mismo producto
aparece en 2 líneas de la misma venta. Verificado con datos reales: 2
ventas de ejemplo, stock antes/después coincide exactamente con lo
esperado.

### Spec para dforms: campo de líneas editables (pendiente, a cargo del usuario como autor de la librería)
Confirmado: `grid` hoy es solo visor/selector de filas existentes (más
parecido a `card-list`), no soporta cargar/editar filas nuevas. Hace falta un
tipo de campo nuevo — nombre propuesto `line-items` (o un modo nuevo de
`grid`, a criterio del autor) — con:

1. **Filas editables y repetibles**: botón "+ Agregar línea" / "quitar línea",
   sin límite fijo de filas.
2. **Columnas configurables desde el builder**, cada una con su propio tipo
   (`text`/`number`/`select`/`currency`), igual que un campo normal.
3. **Una columna `select` con `optionsSource`** (reusa el mecanismo que ya
   existe — `RemoteFormOptionsService` en este proyecto — para elegir el
   producto de un catálogo real, con `valueKey`/`labelKey` igual que un
   select normal). Necesita, además, que al elegir una opción se puedan
   **copiar automáticamente otros campos del objeto crudo a otras columnas de
   la misma fila** (ej. al elegir el producto, autocompletar `precio_unitario`
   con el precio actual de ese producto) — hoy `optionsSource` solo define
   `value`/`label`, no un mapeo a más columnas.
4. **Un campo calculado de solo lectura por fila** (`subtotal = cantidad ×
   precio_unitario`) — dforms hoy no tiene concepto de "campo calculado";
   como mínimo hace falta esto para una columna dentro de `line-items`,
   aunque no se generalice a otros tipos de campo todavía.
5. **Un total general** (suma de subtotales) — puede vivir como una propiedad
   agregada que exponga el campo `line-items` (ej. `total` disponible en
   `submission.data` junto al array de líneas), o como responsabilidad del
   formulario padre sumando el array — lo que sea más simple de implementar
   del lado de la librería.
6. **Shape de salida en `submission.data`**: idealmente un array plano de
   objetos, ej. `detalle: [{ producto_id, producto_nombre, cantidad,
   precio_unitario, subtotal }, ...]` — el shape exacto queda a criterio del
   autor, pero debe quedar documentado en el README de dforms (mismo nivel de
   detalle que ya existe para `optionsSource`) porque el backend de este
   proyecto necesita ese shape exacto para poder insertar cada línea en la
   tabla de detalle generada.

### Spec para dforms: `relation` como propiedad oficial + UI en el builder (bloqueante para Ventas)
Hallazgo al revisar `jhonatancj-dforms.d.ts`: **`relation` no existe en el
tipado de dforms.** Es una convención que solo interpreta
`FormGeneratorService.extractFields()` de este backend si aparece cruda en
el JSON (`node.relation = { form, keyValue }` → genera columna `BIGINT` +
`FOREIGN KEY`) — la librería no la conoce, y por lo tanto `<d-builder>` no
tiene ningún input para configurarla; hoy solo se puede escribir a mano en
el JSON (así se hizo, ej., cuando se necesitó puntualmente). La decisión ya
tomada de que Ventas tenga FK real (no `optionsSource` suelto, ver arriba)
depende de esto. Pedido concreto:
1. Agregar `relation?: { form: string; keyValue: string }` (o el shape que
   tenga más sentido con el resto de `FieldConfig`) como propiedad oficial
   del tipo.
2. Que sea **combinable con `optionsSource`** en el mismo campo select: el
   select sigue resolviendo su lista de opciones dinámicamente (vía
   `FormOptionsProvider`, como cualquier otro `optionsSource`), pero el
   motor que consume el JSON (mi backend) necesita poder distinguir "este
   select además es una relación real" para decidir generar `BIGINT + FK`
   en vez de `VARCHAR`. Hoy no hay forma de pedir ambas cosas a la vez.
3. Un input en el panel de propiedades del builder para configurarlo cuando
   el campo es `select` (elegir el formulario destino + la columna clave),
   igual de accesible que configurar `optionsSource` hoy.

### Spec para dforms: tipo `time` (chico, no bloqueante pero útil ya)
Agenda de citas usa hoy un campo `text` libre para la hora (sin picker) por
no existir un tipo `time` nativo en dforms. Pedido: un `NodeType` `time`
análogo a `date` (mismo patrón: input HTML `time`, `min`/`max`, sin
necesidad de `dateFormat` ya que `HH:MM` es un único formato razonable).

### Spec para dforms: componente de calendario (no bloqueante, backlog)
Vista día/semana/mes para Agenda de citas — hoy dforms no tiene ningún
renderer de calendario. Es la pieza más grande de las cuatro; se puede
dejar de última, Agenda ya funciona como CRUD simple sin esto.

Sin esto, Ventas no se puede empezar a construir del lado del backend/builder
de este proyecto — es la única pieza realmente bloqueante del plan completo.

### Qué falta en el builder
- Una forma de marcar, al configurar un form, "esto tiene una tabla de
  detalle" + apuntar a qué catálogo de producto referencia esa línea (nuevo,
  no existe hoy).
- Un editor de SP embebido para cuando `recreateSp: false` — hoy hay que ir a
  psql a mano. Ya existe `SqlEditorComponent`
  (`Front/src/app/shared/sql-editor/`, ya usado para `grid_query`) — reusarlo
  para mostrar/editar el SP a mano directamente desde el builder sería una
  mejora real y barata (el componente ya existe, solo falta un lugar donde
  montarlo + el endpoint que ejecute ese SQL de creación).

---

## 2. Agenda de citas (barbería/salón)

| | |
|---|---|
| **Form** | `cita` |
| **Módulo** | Nuevo `AGENDA`, rubro `belleza` |

### Decisión #2 (resuelta): catálogo nuevo "Empleados"
Mismo patrón que Clientes/Proveedores (form propio, sin login, universal —
no específico de un rubro, cualquier negocio puede tener empleados aunque
solo Agenda los use por ahora).

### Diseño concreto (arrancando ya, CRUD simple, sin calendario)
- **`empleados`** (módulo `EMPLEADOS`, core/universal): `nombre` (text,
  required), `telefono` (text), `activo` (checkbox).
- **`cita`** (módulo `AGENDA`, rubro `belleza`): `fecha` (date — **requiere
  agregar soporte de `date` al motor primero, ver abajo**), `hora` (text,
  formato libre "HH:MM" — dforms no tiene un tipo `time` nativo, se usa texto
  por ahora), `cliente`/`servicio`/`empleado` (3 `select` con `optionsSource`
  → `clientes`/`servicio_belleza`/`empleados`, mismo mecanismo ya usado para
  `categoria`/`unidad` en los forms de producto — **no** `relation`/FK real,
  por consistencia con el resto del catálogo), `notas` (textarea, opcional).
- Grid: fecha/hora/cliente/servicio/empleado, filtrable — igual que
  Clientes/Proveedores.
- **Fuera de esta primera versión**: vista de calendario visual (pendiente de
  que dforms tenga un componente de calendario) y validación de doble-reserva
  de un empleado (SP a mano — se puede agregar después sin romper nada, solo
  reprocesando el form con `recreateSp:false`).

### Requisito previo: el motor no soporta `date` todavía
`FormGeneratorService.extractFields()`/`toDbType()`/`castField()` reconocen
`text`/`number`/`select`/`textarea`/`checkbox`/`image`/`currency` — `date` no
está en la lista (ver nota en `docs/adr/003-dynamic-form-engine.md`). Hay que
agregarlo antes de construir `cita`: mapea a columna `DATE`, cast
`(p_data->>'fecha')::DATE`, mismo espejo en `CUSTOM_COLUMN_TYPES`/
`extractFieldsFromSchema()` del builder, y agregar `agDateColumnFilter` en
`FormDetailComponent.colDefs` para que el filtro de grid tenga sentido en una
columna de fecha (hoy cae al filtro de texto por default).

---

## Resumen — todo lo pedido a dforms (a cargo del usuario, en el repo de la librería)

| Pieza | Para qué | Urgencia |
|---|---|---|
| `line-items` (filas editables/repetibles) — spec completo arriba | Ventas (carrito) | Bloqueante para Ventas |
| `relation` oficial en `FieldConfig` + combinable con `optionsSource` + UI en el builder — spec completo arriba | Ventas (FK real cliente/producto) | Bloqueante para Ventas |
| Tipo `time` nativo (análogo a `date`) | Agenda (`hora` de la cita, hoy es texto libre) | Chico, no bloqueante — mejora Agenda ya construida |
| Componente de calendario (día/semana/mes) | Agenda visual | No bloqueante — Agenda ya funciona como CRUD simple |

## Resumen — mejoras en este repo (backend/builder propios, no dforms)

| Pieza | Para qué | Urgencia |
|---|---|---|
| Editor de SP embebido en el builder (reusar `SqlEditorComponent`) | Ambos, cualquier form con `recreateSp:false` | Mejora de calidad de vida, no bloqueante |
| Soporte de `date` en el motor (`extractFields`/`toDbType`/`castField` + builder + filtro de grid) | Agenda (`fecha` de la cita) | Ya hecho — ver checklist abajo |

## Estado de avance
- [x] Soporte de `date` en el motor (`extractFields`/`toDbType`/`castField`
      + `CUSTOM_COLUMN_TYPES`/`extractFieldsFromSchema()` del builder +
      `agDateColumnFilter` en la grid). Verificado con INSERT/SELECT real
      contra `tbl_cita.fecha` — el cast `::DATE` funciona correctamente.
- [x] Catálogo `empleados` (módulo `EMPLEADOS`, core/universal) — form +
      tabla + SP + grid_config + roles (ADMIN full, SALES solo ver).
- [x] Form `cita` + módulo `AGENDA` (rubro `belleza`) — `fecha`/`hora`/
      `cliente`/`servicio`/`empleado` (los 3 últimos vía `optionsSource`,
      `valueKey:'nombre'`, mismo criterio que categoría/unidad) + `notas`.
      ADMIN y SALES con CRUD completo (una recepcionista necesita poder
      crear/editar/cancelar turnos). **Sin sincronizar a ningún tenant
      todavía** — queda en el catálogo público hasta que haya un tenant real
      de rubro `belleza`.
- [x] `line-items`/`relation`/`time` publicados en dforms `1.3.3` — spec
      cumplido en el repo de la librería.
- [x] Motor: detección de `line-items` + generación de tabla de detalle con
      FK real (incluyendo FK por columna, no solo hacia el encabezado) —
      ver `docs/adr/017-tabla-detalle-line-items.md`.
- [x] `venta_barrio`: form + módulo `VENTAS_BARRIO` (rubro `tienda_barrio`)
      + SP a mano (`sp_venta_barrio`) + `tenants.ventas_editable` (setting
      nuevo, default inmutable) + toggle en tenant-detail +
      `FormDetailComponent` reabre con `SELECT_BY_ID` cuando el form tiene
      `line-items`. Verificado end-to-end: 2 ventas de ejemplo (stock
      antes/después correcto), guard de `ventas_editable` probado en los 4
      casos (bloqueado false, editar con restitución+reaplique, eliminar
      con restitución completa).
- [ ] `venta_moda`/`venta_ferreteria`/`venta_belleza` — mismo patrón que
      `venta_barrio`, pendiente de replicar.
- [ ] Sincronizar `venta_barrio` a un tenant real de rubro `tienda_barrio`
      — requiere regenerar el texto del SP con el schema de ese tenant
      (`current_schema()` no sirve para esto, ver ADR-017), no es un simple
      `copyMissingFormsToTenant`.
- [ ] Vista de calendario visual para Agenda — pendiente de que dforms tenga
      un componente de calendario; por ahora Agenda es CRUD simple (grid
      filtrable por fecha).
- [ ] Validación de doble-reserva de un empleado en el mismo horario — SP a
      mano (`recreateSp:false`), no bloqueante para usar Agenda ya.
- [x] Datos de ejemplo sembrados en `public` para poder ver todos los forms
      con contenido real: `clientes` (4), `proveedores` (3),
      `producto_barrio` (6), `producto_moda` (5), `producto_ferreteria` (5),
      `servicio_belleza` (5), `empleados` (3), `cita` (4). Convención nueva,
      agregada a `CLAUDE.md` → Reglas Backend: todo form nuevo se siembra
      con datos antes de darlo por terminado.

**Limitación conocida, aceptada por ahora**: `cliente`/`servicio`/`empleado`
en `cita` guardan el `nombre` como valor (no un id), igual que `categoria`/
`unidad` en los forms de producto — si dos clientes o dos empleados tienen
el mismo nombre exacto, `optionsSource` no los distingue. Aceptable para
esta primera versión (mismo criterio que ya se aceptó para Categorías/
Unidades); si se vuelve un problema real, la solución es pasar a
`valueKey:'id'` + un `grid_query` con JOIN para mostrar el nombre en la
grid en vez del id crudo (mecanismo ya documentado en ADR-005).
