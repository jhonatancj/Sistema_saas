# ADR-001: Multi-tenancy vía schema-per-tenant

## Contexto
El sistema necesita aislar datos de múltiples empresas (tenants) en una sola
base de datos PostgreSQL, con la posibilidad de que cada tenant tenga sus
propios formularios/módulos personalizados sin afectar a los demás.

## Decisión
Aislamiento por **schema de PostgreSQL**, no por columna `tenant_id` en tablas
compartidas:
- `public` → super admins, catálogo de tenants, catálogo público de
  módulos/formularios (plantillas).
- `tenant_<slug>` → un schema completo por tenant, con sus propias tablas
  `users`, `roles`, `modules`, `forms`, `tbl_{slug}` (datos de cada formulario).

El schema se crea con la función de Postgres `create_tenant_schema(tenant_id,
slug)` (`Back/database/04_create_tenant.sql`), que además clona el catálogo
público activo hacia el tenant nuevo.

Resolución de tenant: por subdominio en el frontend (`{slug}.localhost`,
`admin.localhost`) y por `schemaName` embebido en el JWT en el backend — nunca
por parámetro de request.

## Consecuencias
- Aislamiento fuerte a nivel de motor de base de datos (un query mal escrito
  no puede filtrar datos de otro tenant por accidente de `WHERE`).
- Todas las queries del backend interpolan el nombre de schema directamente en
  el SQL (`` `${schema}.forms` ``) — es el patrón establecido, no un descuido
  (ver `docs/adr/002-no-orm-raw-sql.md`).
- Costo: cualquier cambio al schema "template" de tenant (`04_create_tenant.sql`)
  no se propaga solo a tenants ya creados — requiere una migración explícita en
  `Back/database/migrations/` (ver `CLAUDE.md` § Reglas Backend).
- Un tenant nuevo queda completamente roto si `create_tenant_schema()` (la
  función viva en Postgres) queda desincronizada del archivo `.sql` que la
  define — no hay chequeo automático de esto. Ver `docs/known-bugs.md`.
