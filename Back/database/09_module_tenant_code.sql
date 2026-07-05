-- Código que recibe el tenant al sincronizar el módulo — puede diferir del
-- `code` interno del catálogo del super admin. Mismo criterio que
-- tenant_name (08_module_tenant_name.sql): varios módulos del catálogo
-- pueden ser "la misma idea" para el rubro que sea (ej. `INVENTARIO_BARRIO`,
-- `INVENTARIO_MODA`, `INVENTARIO_FERRETERIA`), cada uno con su propio `code`
-- único porque tienen formularios distintos — pero el tenant que recibe
-- cualquiera de ellos no tiene por qué ver ese detalle interno en su propia
-- URL (`/app/m/:moduleCode/:formSlug`). NULL = usa `code` tal cual.
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS tenant_code VARCHAR(50);
