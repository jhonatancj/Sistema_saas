# ADR-018: Campos de completitud DIAN (Colombia) en Producto/Cliente/Proveedor

## Contexto
El usuario pidió que los formularios de negocio (Producto, Cliente,
Proveedor, en cualquier rubro) queden "completos" siguiendo estándares de
software empresarial, con vista a poder implementar facturación
electrónica más adelante (Colombia/DIAN — la app ya usa `es-CO` en toda la
UI). Esta es una pasada de **completitud del modelo de datos**, no la
implementación real de facturación electrónica (generación de XML/UBL,
firma digital, envío a DIAN, numeración autorizada, CUFE, etc.) — eso
queda fuera de alcance hasta que se decida encarar esa integración en
serio.

## Decisión

### Alcance: qué se agrega y qué se deja fuera
Se agrega lo mínimo necesario para que el dato exista y sea consistente,
sin construir la taxonomía completa de la DIAN (que es mucho más extensa):
- **Tipo de documento** (`tipo_documento`, select estático: CC/NIT/CE/TI/PAS)
  — subconjunto práctico, no los ~10 códigos oficiales de la Resolución
  000042. Se puede ampliar después sin romper nada (es un `select` con
  `options` estáticas, no un catálogo).
- **Tipo de persona** (`tipo_persona`, select: Natural/Jurídica).
- **Régimen tributario** (`regimen_tributario`, select: Responsable de
  IVA/No responsable de IVA).
- **Tarifa de IVA** del producto/servicio — sí como catálogo editable
  (`tarifas_iva`, nuevo form), porque a diferencia de lo anterior las
  tarifas son datos, no una enumeración fija de código (pueden cambiar por
  ley, o necesitar una tarifa adicional).

Explícitamente **fuera de esta pasada**: código UNSPSC del producto,
perfil del emisor (NIT/razón social/resolución de facturación del propio
tenant), dígito de verificación calculado, división política estructurada
(país/departamento/municipio). Se dejan para cuando se encare la
integración real de facturación electrónica.

### `tarifas_iva` — catálogo nuevo, universal (no por rubro)
A diferencia de Categorías/Unidades (ADR-015, con datos distintos por
rubro), las tarifas de IVA son las mismas para las 4 verticales — un solo
conjunto de filas en `public.tbl_tarifas_iva`, sin dimensión de rubro.
Sembrado con 4 filas: Excluido (0%), IVA 0% (0%), IVA 5% (5%), IVA 19%
(19%) — "Excluido" y "IVA 0%" son conceptos DIAN distintos (un bien
excluido no es lo mismo que uno con tarifa cero), se modelan como filas
separadas aunque el `porcentaje` numérico coincida.

Nesteado en `module_forms` de los 4 módulos de rubro (`INVENTARIO_BARRIO`/
`INVENTARIO_MODA`/`INVENTARIO_FERRETERIA`/`SERVICIOS_BELLEZA`), mismo
patrón que Categorías/Unidades (ADR-016) — no un módulo standalone nuevo.

### Producto/Servicio — `iva_id` y `proveedor_id`, ambos `relation` real
A diferencia de `categoria`/`unidad` (que usan `optionsSource` sin FK, ver
ADR-015 — aceptable para catálogos de texto libre), acá se usa `relation`
real (FK) para ambos:
- **`iva_id`** (select → `tarifas_iva`): la tarifa numérica se necesita
  confiable para cualquier cálculo de factura futuro — un valor de texto
  suelto sin FK podría desincronizarse del catálogo real.
- **`proveedor_id`** (select → `proveedores`, solo en `producto_barrio`/
  `producto_moda`/`producto_ferreteria` — **no** en `servicio_belleza`, un
  servicio no lo "suministra" un proveedor en este modelo).

`servicio_belleza` recibe `iva_id` pero no `proveedor_id`.

### Cliente/Proveedor — mismos 3 campos nuevos en ambos
`tipo_documento`/`tipo_persona`/`regimen_tributario` se agregan igual a
`clientes` y a `proveedores` — un proveedor es, para efectos DIAN, la
misma clase de entidad que un cliente (persona/empresa con documento y
régimen), solo que del otro lado de la transacción.

### Fix de motor aprovechado en esta pasada: FK retroactiva en `ALTER TABLE`
`buildAlterTableDDL()` (agregar campos a una tabla YA existente, como
`producto_barrio`/`clientes`/`proveedores` que ya tienen filas) no
agregaba la constraint de FK cuando el campo nuevo tenía `relation` — solo
agregaba la columna. Corregido con el mismo patrón idempotente que ya se
usó para la tabla de detalle de `line-items` (ADR-017): un bloque
`DO $$ IF NOT EXISTS (... pg_constraint/pg_namespace ...) THEN ALTER TABLE
ADD CONSTRAINT ... END IF END $$`. Sin este fix, `producto_barrio.iva_id`/
`proveedor_id` habrían quedado como `BIGINT` sin FK real, contradiciendo
la razón misma de elegir `relation` en vez de `optionsSource` para estos
dos campos.

### Datos existentes
Las filas ya sembradas esta sesión (4 clientes, 3 proveedores, productos
de los 3 rubros, servicios de belleza) se actualizan a mano (`UPDATE`) con
valores realistas para los campos nuevos — no quedan en `NULL` a propósito,
para que la demo se vea completa. Nuevas filas futuras si usan el builder
sin llenar estos campos sí quedan en `NULL` (comportamiento normal, ADR-003).

## Consecuencias
- El patrón (relation real + FK retroactiva) queda disponible para
  cualquier campo futuro que necesite integridad referencial real, no solo
  para IVA/proveedor.
- Si se agrega una quinta vertical, su módulo de Inventario/Servicios debe
  nestear `tarifas_iva` en su `module_forms` igual que las 4 actuales — no
  hay default automático (mismo aviso que ADR-016 para Categorías/Unidades).
- La lista de `tipo_documento` es deliberadamente incompleta frente a la
  taxonomía oficial DIAN — si se necesita el catálogo completo, hoy
  requiere editar el `select` a mano (no es un catálogo separado como
  `tarifas_iva`).
