# 021 — Descuento de precio en encabezado de venta

## Contexto

Pedido explícito del usuario: todas las ventas (`venta_barrio`, y por
extensión `venta_moda`/`venta_ferreteria`/`venta_belleza`) deben poder
aplicar un descuento sobre el total, ya sea como monto fijo o como
porcentaje. `venta_barrio` ya existía (ver ADR-017) sin este campo.

## Decisión

Descuento a nivel de **encabezado** (no por línea), con dos columnas nuevas
más una recalculada:

- `descuento_tipo VARCHAR('monto'|'porcentaje')`, `descuento_valor
  NUMERIC(12,2)` — capturados como campos de formulario normales
  (`select` + `number`), persistidos vía `ALTER TABLE` no destructivo
  (ADR-003).
- `subtotal NUMERIC(12,2)` — suma de las líneas, **antes** de aplicar el
  descuento. No es un campo de formulario (no aparece en `json_form`,
  igual que `total` en el diseño original de ADR-017) — se agrega a mano
  vía `ALTER TABLE` porque `FormGeneratorService` solo genera columnas para
  campos reales del form.
- `total` pasa a ser el **neto**: `GREATEST(subtotal - descuento, 0)` —
  nunca negativo. Cálculo del descuento en el SP:
  `tipo='porcentaje' → subtotal * valor / 100`; `tipo='monto' → valor`;
  cualquier otro valor (incl. `NULL`, sin descuento aplicado) → `0`.
- El cálculo vive en el SP a mano de cada venta (mismo patrón de
  `recreate_sp=false` + schema horneado que ya usaba `sp_venta_barrio`, ver
  ADR-017/020) — no en el frontend, para que el total persistido sea
  siempre confiable sin depender de qué cliente lo calculó.

`venta_barrio` (ya existente) se migró en caliente: `ALTER TABLE` +
`sp_venta_barrio` regenerado a mano con la lógica de descuento agregada;
las 3 ventas de ejemplo preexistentes se backfillearon con
`subtotal = total` (no tenían descuento histórico).

## Consecuencias

- Mismo patrón de descuento en las 5 variantes de venta (barrio, moda,
  ferretería, belleza) — un cambio futuro al cálculo (ej. tope máximo de
  descuento, descuento solo para ciertos roles) tendría que replicarse en
  los 4-5 SPs a mano, no hay un único punto de verdad todavía. Aceptado
  como costo del patrón "SP a mano por variante" ya establecido en
  ADR-017; extraerlo a una función SQL compartida (`sp_calcular_descuento`)
  queda como mejora futura si el cálculo se vuelve más complejo.
- No hay tope de validación sobre `descuento_valor` en el backend (ej. un
  porcentaje de 500% no se rechaza, solo se clampa el `total` resultante a
  0 vía `GREATEST`) — aceptado por ahora, el owner del negocio es quien
  carga sus propias ventas.
- Compras (`compra_barrio`/`compra_moda`/`compra_ferreteria`) **no**
  llevan descuento — decisión de alcance, no pedida por el usuario.
