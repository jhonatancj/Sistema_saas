-- Soporte para: bind a tabla existente (table_name), SP personalizado
-- (sp_name), query SQL custom para la grid (grid_query), e ícono de menú
-- (icon) en formularios de tenant. Todas NULL por defecto — NULL preserva
-- el comportamiento actual (convención tbl_{slug}/sp_{slug}, sin query
-- custom, sin ícono) para cualquier formulario existente.
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS table_name  VARCHAR(100);
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS sp_name     VARCHAR(100);
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS grid_query  TEXT;
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS icon        VARCHAR(100);

-- Cierre de schema drift preexistente: algunos tenants (ej. tenant_acme)
-- fueron creados con una versión más vieja de create_tenant_schema() que
-- no tenía estas columnas de 04_create_tenant.sql. Sin deleted_at, todo
-- filtro "WHERE deleted_at IS NULL" (usado en FormGeneratorService,
-- FormExecutorService y admin-forms.service.ts) rompe para esos tenants.
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS parent_id  BIGINT;
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS action     VARCHAR(255);
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS is_system  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
