-- Rubro (vertical de negocio: tienda de barrio, moda, ferretería, belleza)
-- del tenant y del módulo. Sin FK real a propósito: `tbl_rubro` la crea el
-- motor de formularios en runtime (public.forms, ver
-- docs/adr/015-catalogo-rubro-categorias-unidades.md), no existe todavía
-- cuando corre este script de bootstrap — se valida a nivel de aplicación,
-- mismo criterio que table_name/sp_name en FormGeneratorService.
--
-- tenants.rubro_id: a qué rubro pertenece el tenant (NULL = tenant viejo,
-- creado antes de este feature — demo/acme).
-- modules.rubro_id: a qué rubro aplica el módulo (NULL = universal/core,
-- se ofrece para cualquier tenant al sincronizar — ej. CLIENTES,
-- PROVEEDORES, CATEGORIAS, UNIDADES_MEDIDA).
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS rubro_id BIGINT;
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS rubro_id BIGINT;