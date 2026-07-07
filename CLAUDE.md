# CLAUDE.md — Sistema de Inventario y Ventas SaaS

> Multi-tenant · NestJS + PostgreSQL · Angular 22
>
> Esta guía contiene **solo** reglas de trabajo, arquitectura vigente y
> convenciones obligatorias. No es una bitácora: no contiene fechas de sesión,
> bugs históricos, ni backlog. Para eso existen `CURRENT_STATE.md`,
> `docs/adr/` y `docs/known-bugs.md` — ver "Flujo de documentación" abajo.

---

## Antes de cualquier tarea

1. Leer `CURRENT_STATE.md` — es el único archivo de estado vivo del proyecto.
2. Si vas a tocar un área con una decisión arquitectónica documentada, leer el
   ADR correspondiente en `docs/adr/` antes de modificar código.
3. Ejecutar CodeGraph según la política obligatoria de abajo.
4. Si el código contradice esta guía, **el código manda** — corregí la guía,
   no asumas que el código está mal.

Al terminar cualquier tarea:

- Actualizar `CURRENT_STATE.md` (último trabajo, estado, bugs abiertos,
  riesgos, próximas prioridades — sobrescribir, no acumular historial).
- Crear un ADR nuevo en `docs/adr/` si tomaste una decisión arquitectónica
  importante (nunca edites un ADR viejo para cambiar la decisión que ya tomó).
- Agregar una fila a `docs/known-bugs.md` si encontraste un bug con causa raíz
  reutilizable (algo que puede volver a pasar y vale la pena reconocer rápido).
- **No** agregues fechas, narrativa de sesión, ni backlog largo a este archivo.

---

## Política obligatoria de CodeGraph

Este repo está indexado por CodeGraph (`.codegraph/`). Herramienta:
`codegraph_explore` (MCP) o `codegraph explore "<símbolo o pregunta>"` (CLI).

**Obligatorio ejecutarlo antes de modificar:**
- Cualquier cambio en `Back/api/src/` (backend).
- Código compartido (servicios/guards/interceptors usados por más de un módulo).
- Refactors.
- Cambios arquitectónicos (nueva tabla, nuevo flujo de auth, nuevo patrón de
  schema).
- Módulos con dependencias cruzadas (ej. `forms`, `modules`, `form-access`,
  `admin-forms`, `admin-modules` — se importan entre sí constantemente).

**Acciones a revisar con CodeGraph antes de tocar el código:**
- Referencias entrantes (quién llama a lo que vas a cambiar).
- Referencias salientes (qué depende lo que vas a cambiar).
- Impacto real del cambio (blast radius).
- Efectos colaterales no obvios (ej. un servicio compartido entre el flujo de
  tenant y el de super admin).

**Opcional (se puede saltar):**
- Cambios pequeños (<10 líneas) sin tocar lógica de negocio.
- Estilos (SCSS, clases CSS).
- Textos/labels de UI.

---

## Arquitectura actual

**Stack:** NestJS (`Back/api/src/`) · Angular 22 standalone + signals
(`Front/src/`) · PostgreSQL · pnpm.

**Multi-tenancy — schema-per-tenant** (ver `docs/adr/001-multi-tenancy-schema-per-tenant.md`):
- `public` → super admins, catálogo de tenants, catálogo público de
  módulos/formularios (plantillas, y desde `docs/adr/009-...md` también
  ejecutable como sandbox del super admin).
- `tenant_<slug>` → schema completo por tenant (usuarios, roles, módulos,
  formularios, tablas de datos generadas).
- Resolución: subdominio en frontend (`{slug}.localhost`, `admin.localhost`),
  `schemaName` en el JWT en backend. Nunca por parámetro de request.

**No es un ERP de módulos fijos** — es un motor low-code: un builder
(`@jhonatancj/dforms`) arma un JSON de formulario, y
`FormGeneratorService` genera tabla + stored procedure reales. Ver
`docs/adr/003-dynamic-form-engine.md` para las reglas de evolución del schema
generado (obligatorio conocerlas antes de tocar `form-generator.service.ts`).

**Estructura de carpetas** (nombres reales — no `apps/api`/`apps/Front`):
```
Back/
├── api/src/
│   ├── database/database.module.ts       # PG_MASTER_POOL
│   ├── common/guards/                    # jwt-auth.guard, tenant.guard
│   └── modules/
│       ├── auth/                         # auth + admin-auth
│       ├── forms/                        # form-generator + form-executor
│       ├── modules/                      # módulos de tenant + roles + sync
│       ├── admin/                        # gestión de tenants (super admin)
│       ├── admin-forms/                  # forms públicos + por tenant (super admin)
│       ├── admin-modules/                # módulos de UN tenant (super admin)
│       ├── form-access/                  # allow-list de catálogo por tenant
│       └── security/                     # sesiones + password
│   └── scripts/run-tenant-migrations.js  # pnpm db:migrate
├── database/                             # 0N_*.sql — schema base + funciones
│   └── migrations/                       # NNN_*.sql — cambios al template de tenant
└── ARQUITECTURA.md                       # diseño aspiracional, NO vigente
Front/src/app/
├── core/services/     # api, auth, tenant (subdomain), menu, breadcrumb
├── core/guards/       # authGuard + superAdminGuard
├── layout/sidebar/    # menú dinámico
└── features/          # admin/, forms/, settings/
```

**JWT payload:**
```typescript
interface JwtPayload {
  sub: string; email: string;
  tenantId: string;     // null para super admin
  schemaName: string;   // null para super admin
  isSuperAdmin?: boolean;
  roles: string[];
}
```
Super admin nunca tiene `schemaName`. Cualquier código que lea
`req.user.schemaName` debe asumir que puede venir vacío.

**Respuesta estándar de la API** (todo endpoint, vía `response.interceptor.ts`
+ `http-exception.filter.ts` — nunca a mano por endpoint):
```typescript
{ success: boolean, status: number, message: string, data: any, errors: string[] }
```

**Módulos NestJS:** `auth` (+`admin-auth`), `forms`, `modules`, `admin`,
`admin-forms`, `admin-modules`, `security`, `form-access` (sin controller
propio, servicio compartido), `tenants`, `users`.

**Grid:** AG-Grid Infinite Row Model + filtro/orden vía SQL dinámico —
ver `docs/adr/005-grid-datasource-architecture.md`.

---

## Reglas Backend

- **Sin ORM** — SQL crudo vía `pg.Pool` (ver `docs/adr/002-no-orm-raw-sql.md`).
- **Nunca aceptar `schema` (ni nombre de tabla/columna) desde el body/query de
  un request sin validarlo contra `information_schema` primero.** El schema
  siempre se resuelve desde `req.user.schemaName` (JWT ya validado) o se
  hardcodea server-side (ej. `'public'` en los endpoints de catálogo).
- **`TenantGuard`** (`common/guards/tenant.guard.ts`) bloquea con 401 cualquier
  request de super admin (`isSuperAdmin` o sin `schemaName`) en rutas
  tenant-only. Aplicarlo a nivel de clase cuando el controller es 100%
  tenant-only; a nivel de método cuando el controller es mixto.
- **Rutas solo-super-admin nunca usan `TenantGuard`** (bloquearía al propio
  super admin, que no tiene `schemaName`) — usar un check manual
  (`if (!req.user.isSuperAdmin) throw new UnauthorizedException(...)`) al
  inicio del método.
- **Migraciones de schema de tenant** viven en `Back/database/migrations/`,
  convención `NNN_descripcion.sql`, idempotentes (`ADD COLUMN IF NOT EXISTS`,
  etc.), placeholder literal `{{schema}}`. Runner: `pnpm db:migrate` (soporta
  `--tenant=<schema>` y `--dry-run`). Ver `Back/database/migrations/README.md`.
- **Cambios al schema `public`** van directo en un script `0N_*.sql` de
  `Back/database/`, nunca en `migrations/` (esa carpeta es solo para
  `tenant_<slug>`).
- **Operaciones multi-paso que crean/alteran estado estructural** (crear un
  tenant, generar tabla+SP) deben envolverse en una transacción real
  (`pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK`) — un fallo a mitad de
  camino no puede dejar estado a medias. Excepción conocida y no resuelta:
  `FormGeneratorService.processForm()` (ver "Riesgos técnicos conocidos").
- **Todo formulario nuevo creado en `public` se siembra con datos de ejemplo
  reales** (vía `FormExecutorService.execute(schema, slug, 'INSERT', ...)`,
  script Nest de un solo uso, borrado al terminar — mismo patrón que
  cualquier otro script de este proyecto) antes de darlo por terminado —
  nunca se deja una tabla recién generada vacía. Sirve para verlo con
  contenido real en el builder/grid sin tener que cargar datos a mano desde
  la UI.
- **Sync público→tenant es copy-if-missing** para datos de formulario
  (`copyMissingFormsToTenant`) — nunca pisa un `json_form`/`grid_config` que
  el tenant ya haya personalizado. Los metadatos del módulo en sí (nombre,
  ícono, orden) sí se actualizan en cada sync.
- **Nunca regenerar el DDL de una tabla generada de forma destructiva** — ver
  las reglas de evolución en `docs/adr/003-dynamic-form-engine.md`. Solo se
  agregan columnas, nunca se borran ni se cambia su tipo.
- **Si cambia la firma de un stored procedure generado**, emitir
  `DROP FUNCTION IF EXISTS` de la firma vieja exacta antes del
  `CREATE OR REPLACE` — Postgres distingue funciones por firma completa, dos
  overloads con parámetros `DEFAULT` conviviendo produce
  `function ... is not unique`.
- **No asumir que una función de Postgres (`CREATE OR REPLACE FUNCTION`) en la
  DB coincide con el archivo `.sql` que la define** — puede haber quedado
  desactualizada si un intento previo de reaplicarla falló silenciosamente.
  Verificar con `pg_get_functiondef` contra el archivo si algo generado por
  esa función se comporta de forma incompleta.

---

## Reglas Frontend

| Regla | Correcto | NUNCA |
|-------|----------|-------|
| Inyección | `inject(Servicio)` | `constructor(private s)` |
| Estado | `signal()` | propiedades planas |
| Derivado | `computed()` | getters |
| Control flow | `@if` / `@for` / `@switch` | `*ngIf` / `*ngFor` |
| Módulos | standalone `imports: []` | NgModules |
| CommonModule | **NUNCA** importar | — |
| Interfaces de API | snake_case (tal cual llega) | transformar a camelCase |
| SCSS | `@use 'styles/tools/mixins' as m` | paths relativos con `../` |

- **Componente compartido entre contexto tenant y admin** (mismo componente,
  distinto endpoint/comportamiento según subdominio): inyectar
  `TenantService`, `isAdmin = computed(() => tenant.isAdminContext())`, y
  resolver la diferencia con ese flag — nunca duplicar el componente. Ejemplo
  de referencia: `SettingsSecurityComponent`, `FormDetailComponent`.
- **AG-Grid**: importar `core/ag-grid.init` en cada componente que use grid;
  el proyecto usa el theming viejo (`ag-theme-quartz.css` + clase), por eso
  `ag-grid.init.ts` fuerza `theme: 'legacy'` globalmente — no se puede omitir.
- **`<d-builder>` (`@jhonatancj/dforms`) debe permanecer siempre montado en el
  DOM** mientras el usuario está en la pantalla del builder, sin importar la
  pestaña activa — ocultar con CSS (`display:none`), nunca con `@if`. El botón
  "Guardar" dispara un trigger que solo `<d-builder>` escucha; si no está
  montado, no reacciona nadie, sin error visible.
- **Notificaciones**: nunca llamar a Toastr/SweetAlert2 directo desde un
  componente — siempre vía `NotificationService`. Ver
  `docs/adr/007-notification-policy.md` para cuándo usar cada mecanismo.
- **Patrones de UI reutilizados (`.btn`, `.modal`/`.backdrop`, `.pg`, `.card`,
  `.field`, `.grid`, `.badge`, `.tbl`) viven en `styles/components/`**, capa
  ITCSS global — ver `docs/adr/010-shared-component-styles.md`. Nunca
  redeclarar uno de estos desde cero en un componente nuevo; si necesita una
  variante (modal más ancho, card con padding, etc.), agregar solo el
  **override** puntual en el `.scss` del componente (gana automáticamente por
  el atributo de scoping de Angular, sin `!important`) — nunca copiar el
  bloque completo. Los colores de dominio de `.badge--*` sí quedan locales
  por componente (base de forma en `styles/components/_badge.scss`, colores
  en cada uno). El color de un botón siempre sale de `var(--primary)` vía
  `m.btn-primary`/`m.btn-outline`, nunca hardcodeado. Excepción: botones
  renderizados dentro de una celda de AG-Grid (`cellRenderer` con
  `document.createElement`) nunca reciben el atributo de scoping de Angular —
  esos SÍ necesitan su clase definida en un `.scss` verdaderamente global
  (ver `styles/elements/_ag-grid.scss`).

---

## Patrones obligatorios

- **Guard compuesto por controller**: `TenantGuard` a nivel de clase para
  controllers 100% tenant-only; check manual `isSuperAdmin` para rutas
  solo-admin; ambos combinados (guard por método) para controllers mixtos.
- **Nunca aceptar schema/tabla/columna del cliente sin whitelist** — ver
  regla de Reglas Backend arriba. Patrón de referencia:
  `FormExecutorService.selectPaged()` (valida contra `information_schema`
  antes de interpolar cualquier nombre de columna).
- **Single-source-of-truth para reglas de autorización compartidas** — ej.
  `FormAccessService.resolveAssignability()` es el único lugar que decide "¿es
  asignable este formulario?", usado tanto para filtrar listados como para
  rechazar escrituras. Si una regla de negocio se evalúa en más de un lugar,
  extraerla a un servicio así en vez de duplicar la condición.
- **Componente contextual admin/tenant** — ver Reglas Frontend.
- **Transacción explícita para operaciones multi-paso con efectos
  estructurales** — ver Reglas Backend. Referencia: `AdminService.createTenant()`.
- **DROP antes de CREATE OR REPLACE cuando cambia una firma de función** — ver
  Reglas Backend.

---

## Anti-patrones prohibidos

- Aceptar `schema`, nombre de tabla o nombre de columna directo desde el body
  o query de un request sin validarlo contra `information_schema` primero.
- Llamar a Toastr/SweetAlert2 directamente desde un componente.
- `*ngIf`/`*ngFor`, `constructor(private x)`, getters para estado derivado,
  NgModules — en código Angular nuevo.
- Generar efectos secundarios (crear tabla/SP, escribir en DB) dentro de un
  `GET` — la generación de tabla/SP es siempre una acción explícita
  (`POST`/`PATCH`), nunca lazy.
- Duplicar un componente para tenant y admin cuando la única diferencia es el
  endpoint o un detalle de comportamiento — usar el patrón contextual.
- Introducir un ORM sin antes escribir un ADR nuevo que reemplace
  `docs/adr/002-no-orm-raw-sql.md` (la decisión de no usar ORM fue deliberada,
  no un descuido).
- Alterar destructivamente una tabla generada por el motor de formularios
  (`DROP COLUMN`, `ALTER TYPE`) desde `processForm` — ver
  `docs/adr/003-dynamic-form-engine.md`.
- Escribir fechas de sesión, narrativa de "qué se hizo hoy", o backlog largo
  en este archivo — eso vive en `CURRENT_STATE.md`/`docs/`.

---

## Flujo de documentación

Cuatro lugares, cada hecho vive en uno solo (nunca duplicado):

| Archivo | Contiene | Se actualiza |
|---|---|---|
| `CLAUDE.md` (este) | Reglas de trabajo, arquitectura vigente, convenciones, patrones/anti-patrones | Solo cuando cambia una regla o la arquitectura misma |
| `CURRENT_STATE.md` | Último trabajo, estado actual, bugs abiertos, riesgos, próximas prioridades | Cada sesión — se sobrescribe, no se acumula |
| `docs/adr/NNN-titulo.md` | Una decisión arquitectónica importante + contexto + consecuencias | Un archivo nuevo por decisión — nunca se edita uno viejo para cambiar qué se decidió; si se reemplaza, el ADR nuevo dice a cuál supersede |
| `docs/known-bugs.md` | Síntoma → causa → fix, de bugs con patrón reutilizable | Se agrega fila al encontrar un bug así; se borra la fila si el patrón deja de poder ocurrir |

Si detectás que el código y `CLAUDE.md` no coinciden, corregí `CLAUDE.md` en el
momento (no lo dejes para después) y decilo explícitamente en tu respuesta.

---

## Riesgos técnicos conocidos

- `FormGeneratorService.processForm()` no es transaccional — ver
  `docs/adr/003-dynamic-form-engine.md`.
- `grid_query` (SQL custom de la grid) solo tiene validación de superficie,
  no es un sandbox real — ver `docs/adr/005-grid-datasource-architecture.md`.
- El catálogo (`public.modules`/`module_forms`/`module_roles`) no tiene script
  de creación documentado en `Back/database/` — es drift preexistente real,
  no solo de documentación.
- Existen tablas huérfanas en `public` (`users`, `roles`, `permissions`,
  `user_roles`, `role_permissions`, `refresh_tokens`) de un prototipo anterior
  al rediseño multi-tenant, sin uso en el código pero tampoco borradas.
- `public.subscription_plans`/`public.tenant_subscriptions` son dead code
  completo — no depender de esas tablas para nada nuevo sin antes confirmar
  con el usuario si se van a activar.
- ~~Redis está provisionado...~~ — **resuelto**: se quitó (`Back/docker-compose.yml`,
  `Back/.env`), no había ningún consumidor en el backend. Reintroducir el día
  que haya un caso de uso real (cache de sesión, rate limiting, colas).

---

## Referencias

- `CURRENT_STATE.md` — estado actual, bugs abiertos, próximas prioridades.
- `docs/adr/` — decisiones arquitectónicas con su razonamiento completo.
- `docs/known-bugs.md` — troubleshooting de patrones de bug conocidos.
- `Back/database/migrations/README.md` — convención completa de migraciones.
- Controllers reales (`Back/api/src/modules/*/*.controller.ts`) — fuente de
  verdad para el catálogo exhaustivo de endpoints. Este archivo no lista rutas
  una por una a propósito: esa lista queda desactualizada apenas cambia un
  controller, y CodeGraph/el propio código ya la responden mejor.
- `Back/ARQUITECTURA.md` — diseño aspiracional de una fase de diseño anterior
  (TypeORM/Nx/NgRx/Bull+Redis). **No refleja el código actual, no usar como
  referencia.**
