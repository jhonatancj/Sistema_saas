# 020 — Persistencia de `recreate_sp` en `{schema}.forms`

## Contexto

`FormGeneratorService.processForm()` acepta un flag `recreateSp` para decidir
si regenera el stored procedure de un form o respeta uno escrito a mano
(`recreateSp:false`, patrón usado por `venta_barrio`/`compra_barrio` desde
ADR-017). Ese flag era **transitorio**: no se guardaba en ningún lado, así
que cualquier llamada posterior a `updatePublicForm()`/`updateTenantForm()`
sobre ese slug que no repitiera `recreateSp:false` explícito (default
`true`) pisaba el SP a mano con el genérico — sin ningún error visible. Esto
ya había pasado en producción real (`sp_venta_barrio` perdió su lógica de
stock, documentado en `docs/known-bugs.md`).

El bug era más profundo de lo que parecía: el toggle "Regenerar SP" del
builder (`BuilderComponent.recreateSp`) se reseteaba a `true` en **cada**
carga de un form (`resetAdvancedFields()` nunca leía el valor real) y
`onExport()` siempre mandaba ese booleano explícito al backend — con lo
cual ni siquiera pasar `recreateSp:false` en el backend evitaba el problema
si alguien abría el form en el builder UI y guardaba sin darse cuenta.

## Decisión

Persistir `recreate_sp` como columna real de `{schema}.forms`
(`BOOLEAN NOT NULL DEFAULT TRUE`) en vez de tratarlo como parámetro
transitorio de cada llamada:

- `public`: `Back/database/12_forms_recreate_sp.sql` (+ backfill
  `recreate_sp=false` para `venta_barrio`/`compra_barrio`).
- Template de tenant nuevo: columna agregada a `04_create_tenant.sql`.
- Tenants existentes: `Back/database/migrations/004_forms_recreate_sp.sql`.
- `FormGeneratorService.processForm()`: `dto.recreateSp ?? (exists ?
  prev.recreate_sp : true)` — el valor guardado gana sobre el default
  cuando el DTO no lo especifica.
- `AdminFormsService` deja de forzar `recreateSp: dto.recreateSp ?? true`;
  pasa `dto.recreateSp` tal cual (`undefined` cuando el caller no lo
  especifica, para que `processForm` use el valor persistido).
- Frontend (`BuilderComponent.resetAdvancedFields()`): el toggle ahora
  arranca en `form?.recreate_sp ?? true`, no hardcodeado a `true`.

Todo SP a mano nuevo (`venta_moda`/`compra_moda`/`venta_ferreteria`/
`compra_ferreteria`/`venta_belleza`) se crea ya con `recreate_sp=false`
desde el arranque.

## Consecuencias

- Un form con SP a mano ya no puede perder su lógica por un `PATCH`
  incidental (cambiar el ícono, el nombre, agregar un campo) que no toque
  el SP a propósito.
- El builder UI refleja el estado real del flag — un admin que abre
  `venta_barrio` ve el checkbox "Regenerar SP" desmarcado, no marcado por
  default.
- `ensureFormsGenerated()` (sync a tenant) sigue sin filtrar por
  `recreate_sp` al copiar la *definición* (`copyMissingFormsToTenant` no
  copia esta columna) — un form con SP a mano recién sincronizado a un
  tenant nuevo arranca con `recreate_sp` en su default (`TRUE`) hasta que se
  regenere el SP a mano para ese tenant y se fuerce `recreate_sp=false` a
  mano (mismo procedimiento manual usado en la Fase D de esta sesión, ver
  `CURRENT_STATE.md`). No automatizado todavía — riesgo bajo porque el paso
  de "regenerar SP a mano con el schema del tenant horneado" ya es manual
  por el gotcha de `current_schema()` (ver `docs/known-bugs.md`).
