# ADR-019: `input-lupa` como patrón general para relaciones reales

## Contexto
Varios formularios modelan una relación real (cliente, empleado, producto)
con `select` + `optionsSource`, guardando el **nombre** elegido como valor
(ver `docs/plan-ventas-agenda.md`, limitación aceptada en `cita`). Dos
registros con el mismo nombre no se distinguen, y elegir una opción no
permite autocompletar otros campos del formulario en el mismo paso (ej.
elegir un cliente y autocompletar su `limite_credito`).

El usuario publicó `input-lupa` en `@jhonatancj/dforms` (`NodeType` nuevo,
disponible desde `1.3.4`, ya instalado): un input con botón de lupa que
consulta una tabla/vista vía `FORM_OPTIONS_PROVIDER`, abre un modal AG-Grid
con los resultados, y al elegir un registro copia una o más propiedades del
registro elegido hacia **otros campos** del mismo formulario
(`FieldConfig.assignments`).

## Decisión
`input-lupa` es el patrón por default para toda relación real nueva (cliente,
producto, proveedor, empleado, sucursal, o cualquier campo que necesite
buscar entre varios registros existentes) — reemplaza gradualmente a
`select`+`optionsSource` en esos casos (fase 2+ de `docs/plan-ventas-agenda.md`).

**Modelado en la tabla generada** (obligatorio para cualquier campo
`input-lupa` que deba persistirse):
1. El campo `input-lupa` en sí (ej. `sucursal_nombre`) genera una columna de
   texto (`VARCHAR(255)`) — guarda el valor de `displayProperty` del
   registro elegido (`InputLupaComponent.selectRow()`), **no el id**.
2. El id real (u otra propiedad necesaria) se guarda en un campo **declarado
   aparte** en el mismo formulario (ej. `sucursal_id`, tipo `number`,
   `hidden: true`) — el `assignment` (`{ formProperty: 'sucursal_id',
   responseProperty: 'id' }`) lo rellena al seleccionar. Si ese campo no se
   declara en el schema, el motor (`extractFields()`) nunca genera su columna
   y el id se pierde al guardar — es el error más fácil de cometer al usar
   este patrón.
3. `sourceName` es el slug del form/tabla a consultar — funciona sin cambios
   contra `RemoteFormOptionsService` (mismo mecanismo que `optionsSource` de
   `select`, `endpointId` = slug).

**Ejemplo real** (`empleados.sucursal_nombre` → `empleados.sucursal_id`, ver
`Back/database` — form `empleados` en `public`):
```json
{
  "key": "sucursal_nombre", "type": "input-lupa", "label": "Sucursal",
  "sourceType": "table", "sourceName": "sucursales", "displayProperty": "nombre",
  "assignments": [{ "formProperty": "sucursal_id", "responseProperty": "id" }],
  "lupaColumnDefs": [
    { "dataField": "nombre", "caption": "Nombre" },
    { "dataField": "codigo", "caption": "Código" },
    { "dataField": "ciudad", "caption": "Ciudad" }
  ]
}
```
más un campo hermano `{ "key": "sucursal_id", "type": "number", "hidden": true }`.

## Por qué no `relation` (FK dura) además
`relation` (ver README de dforms y `docs/adr/017-...md`) sigue existiendo
para casos que ya la usan (`select` con FK real, ej. `producto_barrio
.proveedor_id`). El ejemplo de `empleados.sucursal_id` (Fase 1) **no**
integra `relation` — es un `number` plano, sin `FOREIGN KEY` (misma
limitación aceptada para Categorías/Unidades). Agregar `relation` a un campo
declarado aparte (en vez de al propio `input-lupa`) es simplemente
declararlo en el JSON del campo hidden — el motor ya lo soporta vía
`ExtractedField.relation`, sin cambios de motor. La variante de abajo (Fase
2+) sí lo usa por default.

## Variante "sin denormalizar" — solo id, nombre resuelto por JOIN (Fase 2+)

El patrón de arriba persiste el texto elegido (ej. `sucursal_nombre`) como
columna — simple, pero duplica un dato que puede quedar desactualizado si el
registro origen cambia de nombre. Para casos donde eso importa (`cita`,
`venta_barrio`), se agregó una variante más estricta: **solo se persiste el
id real** (con `relation`, FK dura), el nombre nunca se guarda — se resuelve
siempre con un `JOIN` al leer.

1. **`persistDisplay: false`** en el nodo `input-lupa` (default `true` si no
   está — retrocompatible con el ejemplo de `sucursal_nombre` de arriba, que
   no lo usa). `FormGeneratorService.extractFields()` omite el nodo por
   completo cuando `type === 'input-lupa' && persistDisplay === false`: no
   genera columna, no aparece en el INSERT/UPDATE del SP. El campo sigue
   funcionando en el Angular form (vive en el `FormGroup`, viaja en el JSONB
   al guardar) — el motor simplemente no lo persiste.
2. El campo hermano oculto (ej. `cliente_id`) sí lleva `relation` (FK real)
   — es la única columna que existe para esta relación.
3. El nombre se resuelve con `grid_query` (`JOIN` hacia la tabla destino,
   `AS {campo}_nombre`) — tanto para la grid como para reabrir "Editar": un
   form **sin** `line-items` reutiliza directamente la fila que ya trajo la
   grid (`FormDetailComponent.openEdit()` → `submission.set({data:row})`,
   sin ida y vuelta extra al backend), así que si `grid_query` ya trae
   `cliente_nombre` vía JOIN, el input-lupa se ve pre-cargado gratis. Un
   form **con** `line-items` (ej. `venta_barrio`) pasa por `SELECT_BY_ID` del
   SP a mano — ahí el mismo JOIN se agrega directo en esa rama del SP.

```json
{
  "key": "cliente_nombre", "type": "input-lupa", "label": "Cliente",
  "sourceType": "table", "sourceName": "clientes", "displayProperty": "nombre",
  "persistDisplay": false,
  "assignments": [{ "formProperty": "cliente_id", "responseProperty": "id" }]
}
```
más un campo hermano `{ "key": "cliente_id", "type": "number", "hidden": true, "relation": { "form": "clientes", "keyValue": "id" } }`
— el `key` del campo `input-lupa` visible **debe coincidir con el alias**
que usa `grid_query` para el `JOIN` (`cl.nombre AS cliente_nombre`): así,
cuando `openEdit()` reutiliza la fila que ya trajo la grid, `submission.data
.cliente_nombre` viene poblado por el `JOIN` y el input-lupa se ve
pre-cargado sin ningún costo extra. El campo hermano (`cliente_id`) sí es el
que persiste — su `key` es el nombre real de la columna FK.

### Autocompletar desde el usuario logueado — `autoFillCurrentEmployee`
Mecanismo nuevo y genérico para precargar un campo `input-lupa` (típicamente
"vendedor"/"atendido por") con el empleado cuyo `email` coincide con el
usuario logueado, sin bloquear la búsqueda manual si no hay match (ej. el
super admin en su propio sandbox, o un usuario sin fila en `empleados`).

- Marcador en el nodo: `"autoFillCurrentEmployee": true` (opaco, propio de
  este proyecto).
- Backend: `FormExecutorService.findEmpleadoByEmail(schema, email)` —
  `SELECT id, nombre FROM {schema}.tbl_empleados WHERE email = $1 AND
  deleted_at IS NULL LIMIT 1`, `null` si no hay match (resultado válido, no
  error) o si el schema no tiene `tbl_empleados` todavía. Expuesto en
  `GET {base}/me/empleado` (`FormsController` tenant vía
  `req.user.schemaName`/`req.user.email`; `AdminFormsController` para el
  sandbox `public`, mismo criterio de schema hardcodeado que el resto de
  `AdminFormsService`).
- Frontend: `FormDetailComponent.openCreate()` busca ese marcador en el
  schema (`findAutoFillEmployeeField()`) y, si existe, llama al endpoint —
  con match, precarga `submission.data[field.key]` + cada
  `field.assignments` (mismo mapeo que aplicaría el propio `input-lupa` al
  seleccionar a mano); sin match, no hace nada.

## Consecuencias
- Motor: `input-lupa` reconocido en `extractFields()`/`toDbType()` de
  `form-generator.service.ts` (`VARCHAR(255)`); `castField()` no necesitó
  cambio (su `default` ya trata cualquier tipo no listado como texto plano,
  que es el comportamiento correcto acá).
- Builder: `extractFieldsFromSchema()` de `builder.component.ts` reconoce
  `input-lupa` para que aparezca como columna configurable en la pestaña
  Grid del formulario.
- `FormDetailComponent` no necesitó cambios — cae al filtro de texto por
  default (`agTextColumnFilter`), correcto para una columna `VARCHAR`.
- Sin FK real en el campo generado (ver arriba) — riesgo aceptado, mismo
  criterio que Categorías/Unidades.
- Sin validación server-side de que el `sucursal_id` asignado corresponda
  realmente a un registro existente de `sucursales` — el modal solo deja
  elegir de resultados reales, pero nada impide mandar un `sucursal_id`
  arbitrario directo al `execute()` (mismo nivel de confianza que el resto
  del motor: el front es la única barrera hoy).
