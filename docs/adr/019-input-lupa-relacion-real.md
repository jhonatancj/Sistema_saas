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
.proveedor_id`). `input-lupa` **no** integra `relation` en esta fase — el
campo generado (`sucursal_id`) es un `number` plano, sin
`FOREIGN KEY`. Es la misma limitación ya aceptada para Categorías/Unidades:
pragmático para arrancar, con el id real (a diferencia de guardar el nombre)
ya resuelve el problema principal (distinguir registros duplicados +
autocompletar). Agregar `relation` a un campo declarado aparte (`sucursal_id`)
en vez de al propio `input-lupa` queda como mejora futura si se necesita FK
dura — el motor ya soporta `relation` en cualquier campo vía
`ExtractedField.relation`, no requiere cambios de motor, solo declararlo en
el JSON del campo hidden.

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
