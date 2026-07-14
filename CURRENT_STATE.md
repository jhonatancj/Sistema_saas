# CURRENT_STATE

> Única fuente de verdad sobre "dónde estamos ahora mismo". Este archivo se
> actualiza en cada sesión y **no** acumula historial — solo el estado
> vigente (se sobrescribe, no se agrega). Para arquitectura y reglas de
> trabajo, ver `CLAUDE.md`; para decisiones con su razonamiento, `docs/adr/`;
> para troubleshooting de bugs conocidos, `docs/known-bugs.md`.

## Último trabajo realizado

**Layout de 3 columnas en los formularios de venta** (pedido tras mostrar
un mockup de referencia — se aclaró explícitamente que era solo
inspiración de layout/interacción dentro del motor actual, no una réplica
pixel-perfect ni un componente a medida fuera de dforms). Reorganizados
`venta_barrio`/`moda`/`ferreteria`/`belleza`: antes 3 filas de 2 columnas
(Cliente+Fecha / Vendedor+Sucursal / Tipo+Valor descuento), ahora 2 filas
de 3 columnas (Cliente+Vendedor+Sucursal — las 3 lupas juntas — / Fecha+Tipo
descuento+Valor descuento). **Bug propio repetido, mismo patrón de las 2
veces anteriores esta sesión**: actualicé primero solo `public.forms` y
verifiqué en el navegador contra `tenant_demo`/`tenant_acme`, que tienen su
**propia copia** de estos forms (sync es copy-if-missing, nunca se
actualiza sola) — el layout viejo seguía apareciendo hasta que empujé el
mismo `json_form` a `tenant_demo.venta_barrio`/`tenant_acme.venta_moda`
explícitamente. Verificado en el navegador real. `recreate_sp` de los 4
forms (y de sus copias de tenant) se mantuvo en `false` durante todo el
cambio. Mismo criterio (3+ columnas por fila donde tenga sentido) queda
como referencia para cualquier form nuevo — no se tocó `compra_*` (no
pedido, layout ya es simple con pocos campos).

**Búsqueda por código/identificación en los campos `input-lupa`** (pedido
explícito del usuario). Investigación reveló un **bloqueo real de la
librería**: el cuadro "Buscar..." del modal de `input-lupa` hoy filtra
100% client-side (AG-Grid `quickFilterText`) sobre los resultados ya
cargados una vez (hasta 1000 filas) — nunca vuelve a pegarle al backend
mientras se escribe; y las columnas `producto`/`servicio` en `line-items`
son un `<select>` HTML **nativo** (ni `ng-select`), sin buscador de ningún
tipo. Ambas cosas requieren cambios en el código de `@jhonatancj/dforms`
(repo separado, no en este workspace) — no se pueden resolver solo desde
`Sistema_inventario`. Con el usuario: le escribí un prompt completo y
autocontenido (`prompt-dforms.md`, en el scratchpad de esta sesión — no
versionado en este repo, dárselo directo si hace falta retomarlo) con el
spec exacto de los 2 cambios necesarios (`searchParamName` opcional en
`FieldConfig` para disparar `loadOptions()` real mientras se escribe, y
`'input-lupa'` como tipo de columna de `line-items`), ambos retrocompatibles.
Mientras tanto, hecho en este repo (no depende de la librería):
- **Bug de datos encontrado**: `proveedores` no tenía **ningún** campo de
  identificación real (solo `tipo_documento`, la categoría "NIT"/"CC", sin
  el número) — agregada columna `numero_documento` (`public` + ambos
  tenants), campo nuevo en el `json_form` de `proveedores`.
- `lupaColumnDefs` completadas donde faltaba una columna de código real:
  proveedor (`numero_documento`) en `compra_barrio`/`moda`/`ferreteria`;
  vendedor (`documento`, la tabla `empleados` ya lo tenía, solo faltaba en
  la lupa) en los 4 `venta_*`. `cliente_nombre`/`sucursal_nombre` ya
  tenían `documento`/`codigo` desde antes.
- `RemoteFormOptionsService.loadOptions()`: agregado manejo reservado de
  un futuro param `search` (→ `filter.search`, texto libre) — **el
  backend ya no necesita ningún cambio**: `FormExecutorService.selectPaged()`
  ya hace `OR ILIKE` contra todas las columnas de texto (nombre Y
  documento/código) desde hace varias sesiones. Verificado end-to-end por
  API que buscar por un fragmento de `numero_documento`/`documento`
  encuentra el registro correcto — en cuanto dforms mande `search`, esto
  funciona sin tocar nada más de este lado.
- Verificado en el navegador real (`tenant_demo`): la lupa de Proveedor
  muestra la columna "N° Documento" con datos reales.

**Jerarquía real de módulos (hasta 4 niveles, opcional) — reemplaza el
agrupamiento por rubro de ADR-023.** Pedido explícito del usuario tras ver
el agrupamiento por rubro: quería que fuera un dato real configurable
desde la pantalla de Módulos, no un caso especial de código. Ver
ADR-024. Resumen:
- `parent_id` autoreferenciado en `modules` (`public` + `{schema}.modules`
  + migración `005_modules_parent_id.sql`, `ON DELETE SET NULL`).
  `ModulesService.validateModuleParent()` (nuevo, un solo helper para los
  4 puntos de entrada create/update × public/tenant): rechaza auto-padre,
  ciclos (CTE recursivo) y más de 3 niveles de módulo (el form es el 4º).
  **Bug propio encontrado y corregido**: `array_agg(bigint)` es un tipo
  distinto (OID 1016) al que `database.module.ts` ya normaliza (OID 20
  escalar) — sin `.map(Number)`, la detección de ciclo nunca disparaba
  (comparaba string contra number), mismo patrón ya conocido de
  `docs/known-bugs.md` pero vía `array_agg`.
- `syncPublicModulesToTenant()` traduce `parent_id` de `public` a los ids
  locales del tenant (via `public_id`) — si el padre no se sincronizó,
  degradación segura a raíz, sin error.
- Frontend: `SidebarComponent.buildModuleTree()` (genérico, basado en
  `parent_id`) reemplaza el `RUBRO_ICONS`/Map de rubro de ADR-023. Nuevo
  componente recursivo `NavTreeNodeComponent` (se referencia a sí mismo)
  reemplaza el nivel-2 hardcodeado — profundidad dinámica, cada instancia
  con su propio estado de expansión local (sin Map compartido). Selector
  "Módulo padre" agregado a `AdminModulesComponent`/`SettingsModulesComponent`
  (mismo patrón que el de "Rubro" ya existente).
- Datos: creados 5 módulos contenedor reales (`RUBRO_TIENDA_BARRIO`/
  `RUBRO_MODA`/`RUBRO_FERRETERIA`/`RUBRO_BELLEZA`/`CATALOGO`), reparentados
  los 16 módulos existentes — mismo resultado visual que ADR-023 pero como
  dato real ahora. `tenant_demo`/`tenant_acme` sin cambios (jerarquía
  opcional, sin contenedores creados para ellos).
- Verificado en el navegador real: cadena de 3 niveles de módulo creada,
  4to nivel y ciclo rechazados con mensaje claro vía script, `parentId:
  null` explícito vuelve un módulo a la raíz; sidebar admin visualmente
  igual a ADR-023 pero ahora con niveles independientes (no accordion
  forzado entre ramas); `tenant_demo` sin regresión (sigue plano).
  `tsc --noEmit`/`nest build` (Back) y `tsc --noEmit`/`ng build` (Front)
  limpios.

**Catálogo multi-rubro completo (ventas+compras en los 4 rubros) + fix de
raíz de `recreateSp` + sync completo a ambos tenants + verificación
visual.** Pedido explícito del usuario: "continuá con lo que hace falta
para tener todo". Resumen:

- **Fix de raíz `recreateSp`** (ver `docs/known-bugs.md`): columna nueva
  `recreate_sp BOOLEAN NOT NULL DEFAULT TRUE` en `{schema}.forms` (`public`,
  template de tenant, migración `004_forms_recreate_sp.sql`).
  `FormGeneratorService.processForm()` ahora usa el valor guardado como
  default cuando el DTO no lo especifica explícito — antes, cualquier
  `updatePublicForm()` sin `recreateSp:false` pisaba un SP a mano con el
  genérico. **Bug agravante encontrado en el frontend**: el builder
  (`BuilderComponent.resetAdvancedFields()`) reseteaba el toggle "Regenerar
  SP" a `true` en cada carga y siempre lo mandaba explícito — corregido para
  leer `form?.recreate_sp`. `venta_barrio`/`compra_barrio` (y todo SP a mano
  nuevo de esta sesión) quedan con `recreate_sp=false` persistido.
- **Descuento de precio en ventas** (monto o porcentaje, a nivel de
  encabezado): columnas `subtotal`/`descuento_tipo`/`descuento_valor` +
  `total` recalculado como neto. Aplicado a `venta_barrio` (ya existente,
  SP regenerado a mano) y de fábrica en los 3 rubros nuevos.
- **Producto (`producto_barrio`/`moda`/`ferreteria`) enriquecido**: `marca`,
  `stock_minimo`, `ubicacion` (`ALTER TABLE` no destructivo). Datos de
  ejemplo actualizados con valores reales.
- **Ventas + Compras para Moda y Ferretería** (espejo exacto de
  `venta_barrio`/`compra_barrio`, con descuento incluido desde el arranque):
  `venta_moda`/`compra_moda`, `venta_ferreteria`/`compra_ferreteria`. Tabla +
  detalle + SP a mano (`recreate_sp=false`) generados por
  `createPublicForm()` + sustitución textual del DDL ya verificado de
  barrio (`venta_barrio`→slug nuevo, `producto_barrio`→`producto_<rubro>`).
  Módulos `VENTAS_MODA`/`COMPRAS_MODA`/`VENTAS_FERRETERIA`/`COMPRAS_FERRETERIA`
  con `module_roles` (ADMIN+SALES full en ventas; ADMIN+WAREHOUSE full +
  SALES solo ver en compras). Verificado insert/update/delete con stock
  antes/después exacto en los 4 forms.
- **Ventas para Belleza** (`venta_belleza`): variante sin stock — vende
  `servicio_belleza` (sin columna `stock` en esa tabla), SP no toca
  inventario pero sí calcula descuento igual que las demás. Sin módulo de
  Compras para belleza (no aplica). Módulo `VENTAS_BELLEZA` (ADMIN+SALES).
- **Sync a `tenant_demo`** (rubro `tienda_barrio`): completa Ventas+Compras
  que faltaban. Encontrado y corregido en el camino: `tenant_demo.rubro_id`
  estaba en `3` (ferretería) pese a tener el catálogo real de barrio
  sincronizado — corregido a `1`. `venta_barrio`/`compra_barrio` dependen de
  `tbl_empleados`/`tbl_sucursales` (FK), que el tenant no tenía — sincronizados
  primero (`ensureFormsGenerated` no garantiza orden de dependencias entre
  forms con `relation` cruzada, ver "Riesgos" abajo). SPs a mano regenerados
  con el schema `tenant_demo` horneado (gotcha ya documentado). Sembrado con
  datos reales (sucursal, empleado, 2 clientes, 2 productos) y verificado
  insert de venta/compra con stock correcto.
- **Sync a `tenant_acme`**: no tenía nada sincronizado pese a tener
  `rubro_id` seteado — asignado rubro `moda` (2) y sincronizado el rubro
  completo (Inventario+Ventas+Compras+Clientes+Proveedores+Empleados+
  Sucursales+Categorías), mismo patrón de SPs a mano con schema `tenant_acme`
  horneado. Sembrado y verificado con datos reales.
- **Bug de raíz encontrado y corregido: `copyMissingFormsToTenant()` no
  copiaba `display_mode`/`modal_width`** — un form sincronizado a un tenant
  siempre quedaba en modal aunque en `public` estuviera en `inline`.
  Corregido (columnas agregadas al `INSERT ... SELECT`) y backfileado a mano
  en `tenant_demo`/`tenant_acme` para los forms ya sincronizados.
- **Bug de raíz encontrado y corregido: `empleados.sucursal_id` sin FK
  real** (`NUMERIC(12,2)` suelto, sin `relation` en el nodo oculto del
  `json_form`) — mismo patrón que ya se había corregido para
  `cita`/`venta_barrio` en una sesión anterior, pero nunca para `empleados`
  mismo. Corregido en `public` + ambos tenants (`ALTER COLUMN TYPE BIGINT` +
  `ADD CONSTRAINT` + `relation` agregada al `json_form`).
- **Automatizado el orden de dependencias en el sync a tenant** (pedido
  explícito del usuario tras el workaround manual de esta sesión): nuevo
  `ModulesService.sortSlugsByDependencies()` — ordena topológicamente los
  slugs a generar según los `relation` declarados en cada `json_form`
  (campos ocultos de `input-lupa`, `select`+`relation`, columnas de
  `line-items`), reutilizando `FormGeneratorService.extractFields()`/
  `findLineItemsNode()` ya existentes. `ensureFormsGenerated()` ahora llama
  esto antes de iterar — ya no depende de en qué orden Postgres devuelva
  `SELECT DISTINCT form_slug`. Ciclos (no deberían poder pasar) se cortan
  sin bloquear el resto en vez de tirar error. **Verificado con un tenant
  descartable creado y borrado en esta sesión** (`tenant_scratch_topo`):
  sincronizar los 7 módulos base en un orden a propósito "difícil"
  (`venta_barrio`/`compra_barrio` antes que `empleados`/`sucursales`)
  generó las 19 tablas con sus FKs reales sin ningún error ni intervención
  manual — antes de este fix, esto mismo fallaba con `relation
  "tbl_empleados" does not exist`. **Gotcha encontrado en el camino**: el
  cambio de schema a `04_create_tenant.sql` (columna `recreate_sp`) no
  alcanza con editar el archivo — la función `create_tenant_schema()` ya
  vive en Postgres y hay que reaplicarla (`CREATE OR REPLACE FUNCTION`) para
  que un tenant nuevo la reciba (mismo gotcha ya documentado en
  `docs/known-bugs.md` para otras funciones). Ver ADR nuevo
  `docs/adr/022-orden-dependencias-sync-tenant.md`.
- **Filtro de producto por proveedor en Compras + resolución de FK en la
  grid de Producto** (pedido explícito del usuario). Dos fixes de raíz:
  - `RemoteFormOptionsService.loadOptions()` (Front) ignoraba por completo
    el segundo parámetro (`_params`) — dforms ya soporta selects
    dependientes vía `optionsParams` (confirmado en el `.d.ts` de la
    librería: `LineItemColumnDef.optionsParams`, watch sobre un campo del
    formulario), pero nunca se conectaba con nada real. Ahora arma un
    `filter.filters` (`equals`) y lo manda al `execute()` existente —
    `FormExecutorService.selectPaged()` ya soportaba filtrar por columna
    validada contra `information_schema`, no hizo falta tocar el backend.
    Agregado `optionsParams: [{ field: 'proveedor_id', ... required: true }]`
    a la columna `producto_id` de `compra_barrio`/`compra_moda`/
    `compra_ferreteria` (`public` + `tenant_demo`/`tenant_acme` ya
    sincronizados) — elegir un proveedor ahora bloquea el select de
    producto hasta elegirlo, y solo lista productos de ese proveedor.
  - `producto_barrio`/`moda`/`ferreteria`: la columna "Proveedor" de la
    grid mostraba el id crudo (o nada) porque no había `grid_query` con
    JOIN — mismo patrón ya usado en `venta_barrio` (ADR-005/019), aplicado
    acá: `grid_query` con `LEFT JOIN proveedores`+`tarifas_iva`,
    `grid_config` con `proveedor_nombre`/`iva_nombre` en vez de los ids
    crudos.
  - **Bug propio encontrado en el camino**: al copiar el `grid_query` de
    `public` a `tenant_demo` sin adaptarlo, quedó con el schema `public.`
    horneado en vez de `tenant_demo.` — mismo gotcha ya documentado para
    SPs a mano (`docs/known-bugs.md`), esta vez en un `grid_query`.
    Corregido a mano con el schema correcto.
  - `tenant_demo` no tenía `tarifas_iva` sincronizado (predata esa
    característica) — sincronizado + sembrado (4 tarifas), y
    `producto_barrio`/`compra_barrio` de `tenant_demo` actualizados a la
    definición pública actual (tenían proveedor_id pero no `grid_query` ni
    `optionsParams`). Sembrado un 2º proveedor + productos reales para
    poder demostrar el filtro con dos proveedores distintos.
  - Verificado en el navegador real (`tenant_demo`): grid de Productos
    resuelve "tatiana"/"Comercializadora Andina" en vez de ids; formulario
    de Compra con proveedor elegido por `input-lupa` y el select de
    producto filtrado (confirmado "Arroz Diana" listado al elegir
    "tatiana"). Verificado también a nivel de API el caso general (mismo
    proveedor → mismo subconjunto de productos, deterministico) en
    `public` y ambos tenants.
- **Reordenamiento del sidebar del super admin por rubro** (pedido
  explícito: "ya hay muchas cosas regadas" — con los 4 rubros completos,
  el sidebar admin tenía 16 grupos sueltos de primer nivel). Nuevo nivel
  de agrupación **solo en `adminNavItems`** (rubro → módulo → form, 3
  niveles): `ModulesService.getPublicModulesForMenu()` ahora expone
  `rubro_id`/`rubro_code`/`rubro_nombre` por módulo (JOIN a `tbl_rubro`);
  el sidebar agrupa en `Tienda de Barrio`/`Moda`/`Ferretería`/`Barbería /
  Salón de Belleza` + `Catálogo` (universales: Clientes/Proveedores/
  Empleados/Sucursales) + `Administración` (sin cambios). `NavChild` ahora
  admite un nivel extra de `children` propio, con su propio estado de
  expansión (`openSubGroup`) — el sidebar de tenant (`tenantNavItems`)
  queda sin cambios funcionales (un tenant real solo tiene un rubro).
  Ver ADR-023. Verificado en el navegador real contra el super admin:
  pasó de 16 grupos sueltos a 7, los 3 niveles expanden/colapsan
  correctamente y cambiar de rubro resetea el sub-grupo abierto.
  `tsc --noEmit`/`nest build` (Back) y `tsc --noEmit`/`ng build` (Front)
  limpios.
- **Verificación visual con Playwright** (Chromium instalado por primera vez
  en este entorno): login real en `demo.localhost` (`admin@demo.com`),
  confirmado en el navegador real — sidebar dinámico con los módulos nuevos
  (Ventas/Compras/Empleados/Sucursales), `venta_barrio` abre **inline** (sin
  modal, confirma el fix de `display_mode`), formulario de venta muestra
  `input-lupa` para Cliente/Vendedor/Sucursal y los campos de Descuento,
  `compra_barrio` abre en modal con Proveedor (`input-lupa`) y line-items.
  `producto_barrio` en `tenant_demo` NO muestra `marca`/`ubicacion` — **es lo
  esperado**, esa copia es anterior a la Fase B de esta sesión y el sync es
  copy-if-missing (nunca pisa un form ya sincronizado); confirmado en
  cambio que `tenant_acme.producto_moda` (sincronizado después del fix) sí
  las trae. **Sin verificar el lado super admin** (no tengo la contraseña,
  solo el usuario la conoce).
- `tsc --noEmit`/`nest build` (Back) y `tsc --noEmit` (Front) limpios en
  cada fase. Sin commit — el usuario aplica/commitea él mismo.

## Estado actual

**Entorno de desarrollo:**
- Backend: `Back/api`, `nest start --watch` corriendo, puerto 3000.
- Frontend: `Front`, `ng serve` corriendo, puerto 4200.
- DB: `docker exec -it saas_postgres psql -U saas_user -d saas_inventario`.
- Playwright (`chromium`) instalado en este entorno vía `npx playwright
  install chromium` — antes no estaba, ahora sí se puede verificar visual.

**Catálogo público** (`public.forms`/`public.modules`): los 4 rubros tienen
ahora el ciclo completo — Inventario + Ventas + Compras (Belleza sin
Compras, no aplica) + Clientes/Proveedores/Empleados/Sucursales/Categorías/
Unidades/Tarifas IVA (universales). Todo con descuento de precio en ventas.
Organizados en el sidebar admin vía jerarquía real (`parent_id`, ver
ADR-024): 5 módulos contenedor (`RUBRO_TIENDA_BARRIO`/`RUBRO_MODA`/
`RUBRO_FERRETERIA`/`RUBRO_BELLEZA`/`CATALOGO`) con los 16 módulos de
negocio anidados adentro.

**Tenants reales:**
- `tenant_demo` (rubro `tienda_barrio`, corregido de un `rubro_id` erróneo):
  Inventario+Clientes+Proveedores+Categorías+Unidades ya sincronizados de
  antes; esta sesión completó Ventas+Compras+Empleados+Sucursales. Usuario
  de prueba: `admin@demo.com` / `password`.
- `tenant_acme` (rubro `moda`, asignado esta sesión — antes vacío pese a
  tener un `rubro_id` seteado sin sincronizar nada): catálogo completo del
  rubro sincronizado esta sesión. Tiene un usuario `admin@acme.com` pero
  **no tengo su contraseña** — sin verificar visualmente.

**Super admin real:** `jcabarcasjulio@gmail.com` (contraseña la conoce el
usuario, no la tengo yo — sin verificar visualmente el lado admin esta
sesión).

## Bugs abiertos

- `public.module_forms` no tiene la misma constraint única
  `UNIQUE(module_id, form_slug)` que ya tienen los schemas de tenant — riesgo
  bajo hoy (`setPublicModuleForms` siempre hace DELETE+INSERT).
- Huecos conocidos de `docs/adr/008-form-catalog-access-control.md`: sin poda
  retroactiva de asignaciones ya hechas, sin gate de runtime sobre datos ya
  asignados, `syncPublicModulesToTenant()` no pasa por el gate de acceso.
- `{schema}.module_forms.form_slug` sigue sin FK hacia `forms.slug` — mitigado
  para el camino normal (`deleteForm()` limpia dentro de la misma
  transacción), solo puede recurrir si algo borra `{schema}.forms` a mano.
- La búsqueda general de la grid (`filter.search`) incluye columnas `image`
  (TEXT/base64) en el `OR ILIKE` — correcto pero innecesariamente costoso.
- `producto_barrio`/`clientes`/`proveedores`/etc. ya sincronizados a un
  tenant **antes** de un enriquecimiento posterior en `public` (ej. Fase B
  de esta sesión: `marca`/`stock_minimo`/`ubicacion`) no reciben esos campos
  nuevos automáticamente — el sync es copy-if-missing por diseño. Si se
  quiere backfillear un tenant ya sincronizado, hay que actualizar su copia
  a mano (mismo criterio que se usó esta sesión para `display_mode`).

## Riesgos

- `FormGeneratorService.processForm()` no es transaccional (ver
  `docs/adr/003-dynamic-form-engine.md`) — un fallo a mitad de camino puede
  desincronizar `has_table`/`has_sp` del estado real de la DB.
- `grid_query` (SQL custom de la grid) solo tiene validación de superficie, no
  un sandbox real (ver `docs/adr/005-grid-datasource-architecture.md`).
- Tablas huérfanas en `public` (`users`, `roles`, `permissions`, `user_roles`,
  `role_permissions`, `refresh_tokens`) de un prototipo pre-multi-tenant, sin
  uso real pero tampoco borradas.
- `public.subscription_plans`/`public.tenant_subscriptions` — dead code
  completo, ningún endpoint ni componente los usa.
- `public.modules`/`module_forms`/`module_roles` no tienen script de creación
  documentado en `Back/database/` (drift preexistente).
- ~~`ensureFormsGenerated()` no garantiza el orden de dependencias entre
  forms con `relation` cruzada~~ — **resuelto**: `sortSlugsByDependencies()`
  hace un topological sort real antes de procesar. Ver "Último trabajo".

## Próximas prioridades

1. **Coordinar con el usuario (autor de `dforms`) los 2 cambios de
   librería** spec'd en `prompt-dforms.md` (scratchpad de esta sesión, no
   versionado acá): búsqueda remota real en `input-lupa` (`searchParamName`)
   y soporte de `'input-lupa'` como tipo de columna de `line-items`
   (producto/servicio en ventas/compras). El lado de `Sistema_inventario`
   ya está listo para consumirlo en cuanto se publique (`RemoteFormOptionsService`
   maneja `search`, backend ya soporta la búsqueda por texto).
2. Sincronizar Ferretería/Belleza a un tenant real cuando exista uno de ese
   rubro (el catálogo público ya está completo para los 4).
3. Agenda de citas: sigue con CRUD simple — falta vista de calendario visual
   (dforms no tiene ese componente todavía) y validación de doble-reserva.
4. Deploy a producción: dominio (`CORS_DOMAIN`/`apiBaseUrl` con placeholders
   todavía), estrategia de TLS, decidir Postgres auto-hospedado vs.
   administrado, confirmar arranque en caliente en máquina/CI real
   (Dockerfiles + compose ya están armados y build-verificados).
5. DIAN: perfil del emisor (NIT/razón social/resolución de facturación) y
   código UNSPSC del producto quedan fuera de alcance hasta encarar la
   integración real de facturación electrónica (ver ADR-018).
