-- ============================================================
-- SISTEMA SAAS INVENTARIO Y VENTAS
-- Script: 04_functions_and_tenant_creation.sql
-- Descripción: Función principal de creación de schema por tenant
--              y funciones auxiliares de negocio
-- Motor: PostgreSQL 15+
-- ============================================================


-- ============================================================
-- FUNCIÓN PRINCIPAL: create_tenant_schema
-- ============================================================
-- Crea el schema PostgreSQL de un nuevo tenant y ejecuta todo
-- el DDL del schema de tenant (03_schema_tenant.sql).
-- Retorna TRUE si fue exitoso.
--
-- USO:
--   SELECT create_tenant_schema(
--     'uuid-del-tenant',
--     'acme-corp'
--   );
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_tenant_schema(
  p_tenant_id   UUID,
  p_slug        TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_schema_name TEXT;
BEGIN
  -- Sanitizar el slug para nombre de schema válido
  v_schema_name := 'tenant_' || regexp_replace(lower(p_slug), '[^a-z0-9]', '_', 'g');

  -- Verificar que el tenant existe en public.tenants
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant % no encontrado en public.tenants', p_tenant_id;
  END IF;

  -- Crear el schema
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_schema_name);

  -- Establecer el search_path para las siguientes operaciones
  PERFORM set_config('search_path', v_schema_name || ', public', TRUE);

  -- Establecer el tenant_id como variable de sesión para los DEFAULTs
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, TRUE);

  -- Actualizar schema_name en public.tenants si no está configurado
  UPDATE public.tenants
  SET schema_name = v_schema_name
  WHERE id = p_tenant_id AND (schema_name IS NULL OR schema_name = '');

  RAISE NOTICE 'Schema % creado exitosamente para tenant %', v_schema_name, p_tenant_id;

  RETURN TRUE;

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error creando schema para tenant %: % - %',
      p_tenant_id, SQLSTATE, SQLERRM;
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.create_tenant_schema(UUID, TEXT) IS
  'Crea el schema PostgreSQL de un nuevo tenant. Ejecutar después las migraciones del tenant vía TypeORM.';


-- ============================================================
-- FUNCIÓN: drop_tenant_schema (USO EXCLUSIVO SUPER ADMIN)
-- ============================================================
-- PELIGROSO: Elimina PERMANENTEMENTE todos los datos de un tenant.
-- Requiere confirmación explícita.
-- Solo ejecutable por superuser o rol específico.

CREATE OR REPLACE FUNCTION public.drop_tenant_schema(
  p_tenant_id       UUID,
  p_confirmation    TEXT  -- Debe ser exactamente 'CONFIRMAR_ELIMINACION'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_schema_name TEXT;
  v_tenant_name TEXT;
BEGIN
  -- Verificar confirmación
  IF p_confirmation != 'CONFIRMAR_ELIMINACION' THEN
    RAISE EXCEPTION 'Confirmación incorrecta. Debes pasar exactamente: CONFIRMAR_ELIMINACION';
  END IF;

  -- Obtener datos del tenant
  SELECT schema_name, name
  INTO v_schema_name, v_tenant_name
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant % no encontrado', p_tenant_id;
  END IF;

  -- Soft delete del tenant primero
  UPDATE public.tenants
  SET deleted_at = NOW(), status = 'cancelled'
  WHERE id = p_tenant_id;

  -- Log en super admin audit
  INSERT INTO public.super_admin_audit_logs
    (action, target_type, target_id, target_name, new_values)
  VALUES
    ('DELETE', 'tenant', p_tenant_id, v_tenant_name,
     jsonb_build_object('schema_name', v_schema_name, 'action', 'schema_dropped'));

  -- Eliminar el schema con todos sus objetos
  EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_schema_name);

  RAISE NOTICE 'Schema % eliminado para tenant % (%)', v_schema_name, v_tenant_name, p_tenant_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.drop_tenant_schema(UUID, TEXT) IS
  'PELIGROSO: Elimina permanentemente el schema de un tenant. Requiere confirmación explícita.';


-- ============================================================
-- FUNCIÓN: fn_reserve_stock
-- ============================================================
-- Reserva stock para una orden de venta de forma atómica.
-- Verifica disponibilidad antes de reservar.
-- Retorna TRUE si se pudo reservar, FALSE si no hay suficiente stock.

CREATE OR REPLACE FUNCTION fn_reserve_stock(
  p_product_id    UUID,
  p_variant_id    UUID,
  p_warehouse_id  UUID,
  p_quantity      NUMERIC(15,4)
)
RETURNS BOOLEAN AS $$
DECLARE
  v_available NUMERIC(15,4);
BEGIN
  -- Lock exclusivo en la fila de stock para evitar race conditions
  SELECT available_qty
  INTO v_available
  FROM stocks
  WHERE product_id = p_product_id
    AND warehouse_id = p_warehouse_id
    AND (variant_id = p_variant_id OR (variant_id IS NULL AND p_variant_id IS NULL))
  FOR UPDATE;

  IF NOT FOUND OR v_available < p_quantity THEN
    RETURN FALSE;
  END IF;

  UPDATE stocks
  SET reserved_qty = reserved_qty + p_quantity
  WHERE product_id = p_product_id
    AND warehouse_id = p_warehouse_id
    AND (variant_id = p_variant_id OR (variant_id IS NULL AND p_variant_id IS NULL));

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_reserve_stock IS
  'Reserva stock atómicamente para una orden. Usa FOR UPDATE para evitar overselling.';


-- ============================================================
-- FUNCIÓN: fn_release_stock_reservation
-- ============================================================
-- Libera stock reservado (cuando una orden se cancela).

CREATE OR REPLACE FUNCTION fn_release_stock_reservation(
  p_product_id    UUID,
  p_variant_id    UUID,
  p_warehouse_id  UUID,
  p_quantity      NUMERIC(15,4)
)
RETURNS VOID AS $$
BEGIN
  UPDATE stocks
  SET reserved_qty = GREATEST(0, reserved_qty - p_quantity)
  WHERE product_id = p_product_id
    AND warehouse_id = p_warehouse_id
    AND (variant_id = p_variant_id OR (variant_id IS NULL AND p_variant_id IS NULL));
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- FUNCIÓN: fn_get_product_price
-- ============================================================
-- Obtiene el precio de un producto para un cliente específico,
-- respetando lista de precios, vigencia y precio por volumen.

CREATE OR REPLACE FUNCTION fn_get_product_price(
  p_product_id    UUID,
  p_variant_id    UUID,
  p_price_list_id UUID,
  p_quantity      NUMERIC(15,4) DEFAULT 1,
  p_date          DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC(15,4) AS $$
DECLARE
  v_price NUMERIC(15,4);
BEGIN
  -- Buscar precio específico en la lista con vigencia y cantidad
  SELECT price
  INTO v_price
  FROM product_prices
  WHERE product_id = p_product_id
    AND price_list_id = p_price_list_id
    AND (variant_id = p_variant_id OR (variant_id IS NULL AND p_variant_id IS NULL))
    AND valid_from <= p_date
    AND (valid_to IS NULL OR valid_to >= p_date)
    AND min_quantity <= p_quantity
  ORDER BY min_quantity DESC  -- Precio por mayor volumen primero
  LIMIT 1;

  IF FOUND THEN
    RETURN v_price;
  END IF;

  -- Fallback: precio base del producto o variante
  IF p_variant_id IS NOT NULL THEN
    SELECT sale_price INTO v_price
    FROM product_variants WHERE id = p_variant_id;
  ELSE
    SELECT sale_price INTO v_price
    FROM products WHERE id = p_product_id;
  END IF;

  RETURN COALESCE(v_price, 0);
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- FUNCIÓN: fn_calculate_customer_balance
-- ============================================================
-- Calcula el saldo pendiente de un cliente (CxC).

CREATE OR REPLACE FUNCTION fn_calculate_customer_balance(p_customer_id UUID)
RETURNS TABLE (
  total_invoiced    NUMERIC(15,4),
  total_paid        NUMERIC(15,4),
  total_balance     NUMERIC(15,4),
  overdue_amount    NUMERIC(15,4),
  overdue_invoices  INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(total), 0)         AS total_invoiced,
    COALESCE(SUM(paid_amount), 0)   AS total_paid,
    COALESCE(SUM(balance), 0)       AS total_balance,
    COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN balance ELSE 0 END), 0) AS overdue_amount,
    COUNT(CASE WHEN due_date < CURRENT_DATE AND balance > 0 THEN 1 END)::INT AS overdue_invoices
  FROM invoices
  WHERE customer_id = p_customer_id
    AND status NOT IN ('cancelled', 'voided', 'draft');
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- FUNCIÓN: fn_get_stock_summary
-- ============================================================
-- Resumen de stock de un producto en todos los almacenes.

CREATE OR REPLACE FUNCTION fn_get_stock_summary(p_product_id UUID)
RETURNS TABLE (
  warehouse_id    UUID,
  warehouse_name  TEXT,
  quantity        NUMERIC(15,4),
  reserved_qty    NUMERIC(15,4),
  available_qty   NUMERIC(15,4),
  avg_cost        NUMERIC(15,4)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.warehouse_id,
    w.name::TEXT,
    s.quantity,
    s.reserved_qty,
    s.available_qty,
    s.avg_cost
  FROM stocks s
  JOIN warehouses w ON w.id = s.warehouse_id
  WHERE s.product_id = p_product_id
    AND w.deleted_at IS NULL
  ORDER BY w.name;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- FUNCIÓN: fn_update_overdue_invoices
-- ============================================================
-- Job periódico: marca como 'overdue' las facturas vencidas.
-- Ejecutar diariamente con pg_cron o job externo.

CREATE OR REPLACE FUNCTION fn_update_overdue_invoices()
RETURNS INT AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE invoices
  SET status = 'overdue', updated_at = NOW()
  WHERE status IN ('issued', 'partially_paid')
    AND due_date < CURRENT_DATE
    AND balance > 0;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RAISE NOTICE 'fn_update_overdue_invoices: % facturas marcadas como vencidas', v_updated;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_update_overdue_invoices() IS
  'Ejecutar diariamente. Actualiza status a overdue en facturas vencidas con saldo pendiente.';


-- ============================================================
-- FUNCIÓN: fn_get_sales_kpis
-- ============================================================
-- KPIs de ventas para el dashboard. Optimizada para uso frecuente.

CREATE OR REPLACE FUNCTION fn_get_sales_kpis(
  p_date_from DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::DATE,
  p_date_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  total_invoiced    NUMERIC(15,4),
  total_paid        NUMERIC(15,4),
  total_pending     NUMERIC(15,4),
  invoice_count     BIGINT,
  new_customers     BIGINT,
  avg_ticket        NUMERIC(15,4)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(i.total), 0)                               AS total_invoiced,
    COALESCE(SUM(i.paid_amount), 0)                         AS total_paid,
    COALESCE(SUM(i.balance), 0)                             AS total_pending,
    COUNT(i.id)                                              AS invoice_count,
    (SELECT COUNT(*) FROM customers
     WHERE created_at::DATE BETWEEN p_date_from AND p_date_to
     AND deleted_at IS NULL)                                 AS new_customers,
    CASE WHEN COUNT(i.id) > 0 THEN SUM(i.total) / COUNT(i.id) ELSE 0 END AS avg_ticket
  FROM invoices i
  WHERE i.issue_date BETWEEN p_date_from AND p_date_to
    AND i.status NOT IN ('draft', 'cancelled', 'voided');
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- VISTAS MATERIALIZADAS — Dashboard
-- ============================================================

-- Vista: Resumen de CxC por cliente
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_accounts_receivable AS
SELECT
  c.id                  AS customer_id,
  c.code                AS customer_code,
  c.name                AS customer_name,
  COUNT(i.id)           AS invoice_count,
  SUM(i.total)          AS total_invoiced,
  SUM(i.paid_amount)    AS total_paid,
  SUM(i.balance)        AS total_balance,
  SUM(CASE WHEN i.due_date < CURRENT_DATE THEN i.balance ELSE 0 END) AS overdue_amount,
  MIN(CASE WHEN i.due_date < CURRENT_DATE AND i.balance > 0
      THEN i.due_date END) AS oldest_overdue_date,
  NOW()                 AS calculated_at
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
  AND i.status NOT IN ('cancelled', 'voided', 'draft')
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.code, c.name;

CREATE UNIQUE INDEX ON mv_accounts_receivable (customer_id);
CREATE INDEX ON mv_accounts_receivable (total_balance DESC);
CREATE INDEX ON mv_accounts_receivable (overdue_amount DESC);

COMMENT ON MATERIALIZED VIEW mv_accounts_receivable IS
  'Refrescar con: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_accounts_receivable';


-- Vista: Resumen de CxP por proveedor
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_accounts_payable AS
SELECT
  s.id                  AS supplier_id,
  s.code                AS supplier_code,
  s.name                AS supplier_name,
  COUNT(b.id)           AS bill_count,
  SUM(b.total)          AS total_billed,
  SUM(b.paid_amount)    AS total_paid,
  SUM(b.balance)        AS total_balance,
  SUM(CASE WHEN b.due_date < CURRENT_DATE THEN b.balance ELSE 0 END) AS overdue_amount,
  NOW()                 AS calculated_at
FROM suppliers s
LEFT JOIN supplier_bills b ON b.supplier_id = s.id
  AND b.status NOT IN ('cancelled')
WHERE s.deleted_at IS NULL
GROUP BY s.id, s.code, s.name;

CREATE UNIQUE INDEX ON mv_accounts_payable (supplier_id);


-- Vista: Stock por producto (todos los almacenes)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_stock_summary AS
SELECT
  p.id              AS product_id,
  p.code            AS product_code,
  p.name            AS product_name,
  p.min_stock,
  SUM(s.quantity)   AS total_quantity,
  SUM(s.reserved_qty)  AS total_reserved,
  SUM(s.available_qty) AS total_available,
  AVG(s.avg_cost)   AS avg_cost,
  CASE
    WHEN SUM(s.available_qty) <= 0 THEN 'out_of_stock'
    WHEN SUM(s.available_qty) <= p.min_stock THEN 'low_stock'
    ELSE 'in_stock'
  END               AS stock_status,
  NOW()             AS calculated_at
FROM products p
LEFT JOIN stocks s ON s.product_id = p.id
WHERE p.deleted_at IS NULL AND p.track_inventory = TRUE
GROUP BY p.id, p.code, p.name, p.min_stock;

CREATE UNIQUE INDEX ON mv_stock_summary (product_id);
CREATE INDEX ON mv_stock_summary (stock_status);
CREATE INDEX ON mv_stock_summary (total_available ASC) WHERE stock_status != 'in_stock';

COMMENT ON MATERIALIZED VIEW mv_stock_summary IS
  'Vista de stock consolidado. Refrescar cada 5-15 min. Usar CONCURRENTLY para no bloquear.';


-- ============================================================
-- SEEDS DE DATOS BASE (ejecutados al crear cada tenant)
-- ============================================================
-- Establecer un tenant_id placeholder para que los DEFAULTs funcionen.
-- En producción, create_tenant_schema() establece el valor real antes de correr estos seeds.
SET app.current_tenant_id = '00000000-0000-0000-0000-000000000000';

-- ── Roles base del sistema ────────────────────────────────────
INSERT INTO roles (name, code, description, is_system) VALUES
  ('Administrador',   'ADMIN',       'Acceso total al sistema del tenant',    TRUE),
  ('Gerente',         'MANAGER',     'Acceso gerencial sin configuración',     TRUE),
  ('Vendedor',        'SALES',       'Gestión de ventas y clientes',           TRUE),
  ('Comprador',       'PURCHASING',  'Gestión de compras y proveedores',       TRUE),
  ('Almacenista',     'WAREHOUSE',   'Gestión de inventario y almacenes',      TRUE),
  ('Contador',        'ACCOUNTANT',  'Gestión financiera y facturación',       TRUE),
  ('Auditor',         'AUDITOR',     'Solo lectura — acceso a auditoría',      TRUE)
ON CONFLICT (code, tenant_id) DO NOTHING;


-- ── Permisos del sistema ──────────────────────────────────────
INSERT INTO permissions (module, action, resource, code, description) VALUES
  -- Usuarios
  ('users',           'read',     NULL,        'users:read',              'Ver usuarios'),
  ('users',           'create',   NULL,        'users:create',            'Crear usuarios'),
  ('users',           'update',   NULL,        'users:update',            'Editar usuarios'),
  ('users',           'delete',   NULL,        'users:delete',            'Eliminar usuarios'),
  ('users',           'assign_roles', NULL,    'users:assign_roles',      'Asignar roles a usuarios'),
  -- Roles
  ('roles',           'read',     NULL,        'roles:read',              'Ver roles'),
  ('roles',           'manage',   NULL,        'roles:manage',            'Crear y editar roles'),
  -- Almacenes
  ('warehouses',      'read',     NULL,        'warehouses:read',         'Ver almacenes'),
  ('warehouses',      'manage',   NULL,        'warehouses:manage',       'Crear y editar almacenes'),
  -- Categorías
  ('categories',      'read',     NULL,        'categories:read',         'Ver categorías'),
  ('categories',      'manage',   NULL,        'categories:manage',       'Gestionar categorías'),
  -- Marcas
  ('brands',          'read',     NULL,        'brands:read',             'Ver marcas'),
  ('brands',          'manage',   NULL,        'brands:manage',           'Gestionar marcas'),
  -- Productos
  ('products',        'read',     NULL,        'products:read',           'Ver productos'),
  ('products',        'create',   NULL,        'products:create',         'Crear productos'),
  ('products',        'update',   NULL,        'products:update',         'Editar productos'),
  ('products',        'delete',   NULL,        'products:delete',         'Eliminar productos'),
  ('products',        'export',   NULL,        'products:export',         'Exportar productos'),
  ('products',        'import',   NULL,        'products:import',         'Importar productos'),
  -- Precios
  ('prices',          'read',     NULL,        'prices:read',             'Ver precios'),
  ('prices',          'manage',   NULL,        'prices:manage',           'Gestionar listas de precios'),
  -- Inventario
  ('inventory',       'read',     NULL,        'inventory:read',          'Ver inventario'),
  ('inventory',       'adjust',   NULL,        'inventory:adjust',        'Hacer ajustes de inventario'),
  ('inventory',       'transfer', NULL,        'inventory:transfer',      'Transferir entre almacenes'),
  ('inventory',       'export',   NULL,        'inventory:export',        'Exportar reporte de inventario'),
  -- Proveedores
  ('suppliers',       'read',     NULL,        'suppliers:read',          'Ver proveedores'),
  ('suppliers',       'manage',   NULL,        'suppliers:manage',        'Gestionar proveedores'),
  -- Clientes
  ('customers',       'read',     NULL,        'customers:read',          'Ver clientes'),
  ('customers',       'manage',   NULL,        'customers:manage',        'Gestionar clientes'),
  -- Cotizaciones
  ('quotations',      'read',     NULL,        'quotations:read',         'Ver cotizaciones'),
  ('quotations',      'create',   NULL,        'quotations:create',       'Crear cotizaciones'),
  ('quotations',      'update',   NULL,        'quotations:update',       'Editar cotizaciones'),
  ('quotations',      'delete',   NULL,        'quotations:delete',       'Eliminar cotizaciones'),
  ('quotations',      'approve',  NULL,        'quotations:approve',      'Aprobar cotizaciones'),
  -- Ventas
  ('sales_orders',    'read',     NULL,        'sales_orders:read',       'Ver órdenes de venta'),
  ('sales_orders',    'create',   NULL,        'sales_orders:create',     'Crear órdenes de venta'),
  ('sales_orders',    'update',   NULL,        'sales_orders:update',     'Editar órdenes de venta'),
  ('sales_orders',    'approve',  NULL,        'sales_orders:approve',    'Confirmar órdenes'),
  ('sales_orders',    'cancel',   NULL,        'sales_orders:cancel',     'Cancelar órdenes'),
  -- Facturas
  ('invoices',        'read',     NULL,        'invoices:read',           'Ver facturas'),
  ('invoices',        'create',   NULL,        'invoices:create',         'Crear facturas'),
  ('invoices',        'void',     NULL,        'invoices:void',           'Anular facturas'),
  ('invoices',        'export',   NULL,        'invoices:export',         'Exportar facturas'),
  -- Pagos (CxC)
  ('payments',        'read',     NULL,        'payments:read',           'Ver pagos'),
  ('payments',        'create',   NULL,        'payments:create',         'Registrar pagos'),
  -- Compras
  ('purchase_orders', 'read',     NULL,        'purchase_orders:read',    'Ver órdenes de compra'),
  ('purchase_orders', 'create',   NULL,        'purchase_orders:create',  'Crear órdenes de compra'),
  ('purchase_orders', 'approve',  NULL,        'purchase_orders:approve', 'Aprobar órdenes de compra'),
  ('purchase_orders', 'cancel',   NULL,        'purchase_orders:cancel',  'Cancelar órdenes de compra'),
  -- Recepciones
  ('purchase_receipts','read',    NULL,        'purchase_receipts:read',  'Ver recepciones'),
  ('purchase_receipts','create',  NULL,        'purchase_receipts:create','Registrar recepciones'),
  -- Cuentas por pagar
  ('supplier_bills',  'read',     NULL,        'supplier_bills:read',     'Ver facturas de proveedores'),
  ('supplier_bills',  'manage',   NULL,        'supplier_bills:manage',   'Gestionar facturas de proveedores'),
  ('supplier_payments','read',    NULL,        'supplier_payments:read',  'Ver pagos a proveedores'),
  ('supplier_payments','create',  NULL,        'supplier_payments:create','Registrar pagos a proveedores'),
  -- Caja
  ('cash_registers',  'read',     NULL,        'cash_registers:read',     'Ver cajas'),
  ('cash_registers',  'open',     NULL,        'cash_registers:open',     'Abrir/cerrar caja'),
  ('cash_registers',  'manage',   NULL,        'cash_registers:manage',   'Gestionar movimientos de caja'),
  -- Reportes
  ('reports',         'view',     'sales',     'reports:view:sales',      'Ver reportes de ventas'),
  ('reports',         'view',     'purchases', 'reports:view:purchases',  'Ver reportes de compras'),
  ('reports',         'view',     'inventory', 'reports:view:inventory',  'Ver reportes de inventario'),
  ('reports',         'view',     'financial', 'reports:view:financial',  'Ver reportes financieros'),
  ('reports',         'export',   'sales',     'reports:export:sales',    'Exportar reportes de ventas'),
  ('reports',         'export',   'financial', 'reports:export:financial','Exportar reportes financieros'),
  -- Auditoría
  ('audit',           'read',     NULL,        'audit:read',              'Ver log de auditoría'),
  -- Configuración
  ('configuration',   'read',     NULL,        'configuration:read',      'Ver configuración del sistema'),
  ('configuration',   'manage',   NULL,        'configuration:manage',    'Modificar configuración del sistema'),
  -- Dashboard
  ('dashboard',       'view',     NULL,        'dashboard:view',          'Ver dashboard')
ON CONFLICT (code) DO NOTHING;


-- ── Unidades de medida base ───────────────────────────────────
INSERT INTO units_of_measure (name, abbreviation, type, is_base, conversion_factor) VALUES
  ('Unidad',      'UN',   'unit',   TRUE,  1),
  ('Docena',      'DOC',  'unit',   FALSE, 12),
  ('Caja',        'CJ',   'unit',   FALSE, 1),
  ('Kilogramo',   'KG',   'weight', TRUE,  1),
  ('Gramo',       'GR',   'weight', FALSE, 0.001),
  ('Libra',       'LB',   'weight', FALSE, 0.453592),
  ('Litro',       'LT',   'volume', TRUE,  1),
  ('Mililitro',   'ML',   'volume', FALSE, 0.001),
  ('Metro',       'MT',   'length', TRUE,  1),
  ('Centímetro',  'CM',   'length', FALSE, 0.01)
ON CONFLICT (abbreviation, tenant_id) DO NOTHING;


-- ── Monedas base ──────────────────────────────────────────────
INSERT INTO currencies (code, name, symbol, decimal_places, is_default) VALUES
  ('USD', 'Dólar Estadounidense',  '$',   2, TRUE),
  ('EUR', 'Euro',                  '€',   2, FALSE),
  ('PEN', 'Sol Peruano',           'S/',  2, FALSE),
  ('COP', 'Peso Colombiano',       '$',   2, FALSE),
  ('MXN', 'Peso Mexicano',         '$',   2, FALSE),
  ('CLP', 'Peso Chileno',          '$',   0, FALSE),
  ('ARS', 'Peso Argentino',        '$',   2, FALSE),
  ('BRL', 'Real Brasileño',        'R$',  2, FALSE),
  ('GBP', 'Libra Esterlina',       '£',   2, FALSE)
ON CONFLICT (code) DO NOTHING;


-- ── Términos de pago base ─────────────────────────────────────
INSERT INTO payment_terms (name, code, days, is_default) VALUES
  ('Contado',    'CASH',  0,   TRUE),
  ('15 días',    'NET15', 15,  FALSE),
  ('30 días',    'NET30', 30,  FALSE),
  ('45 días',    'NET45', 45,  FALSE),
  ('60 días',    'NET60', 60,  FALSE),
  ('90 días',    'NET90', 90,  FALSE)
ON CONFLICT (code, tenant_id) DO NOTHING;


-- ── Configuración inicial del sistema ─────────────────────────
INSERT INTO system_configurations (key, value, value_type, "group", label, description) VALUES
  ('general.company_name',          '',          'string',  'general',   'Nombre de la empresa',         'Razón social para documentos'),
  ('general.company_tax_id',        '',          'string',  'general',   'RUC/NIT',                      'Número de identificación fiscal'),
  ('general.currency',              'USD',       'string',  'general',   'Moneda predeterminada',        'ISO 4217'),
  ('general.timezone',              'UTC',       'string',  'general',   'Zona horaria',                 'IANA timezone'),
  ('general.date_format',           'DD/MM/YYYY','string',  'general',   'Formato de fecha',             ''),
  ('invoice.prefix',                'FAC',       'string',  'invoice',   'Prefijo de facturas',          ''),
  ('invoice.next_number',           '1',         'number',  'invoice',   'Siguiente número de factura',  ''),
  ('quotation.prefix',              'COT',       'string',  'invoice',   'Prefijo de cotizaciones',      ''),
  ('sales_order.prefix',            'OV',        'string',  'invoice',   'Prefijo de órdenes de venta',  ''),
  ('purchase_order.prefix',         'OC',        'string',  'invoice',   'Prefijo de órdenes de compra', ''),
  ('inventory.allow_negative_stock','false',     'boolean', 'inventory', 'Permitir stock negativo',      'Si TRUE, permite vender sin stock suficiente'),
  ('inventory.cost_method',         'avg',       'string',  'inventory', 'Método de costeo',             'avg = Promedio ponderado, fifo = FIFO'),
  ('email.from_name',               '',          'string',  'email',     'Nombre del remitente',         ''),
  ('email.from_address',            '',          'string',  'email',     'Email del remitente',          '')
ON CONFLICT (key, tenant_id) DO NOTHING;


-- ── Secuencias de documentos ──────────────────────────────────
INSERT INTO document_sequences (document_type, prefix, min_digits) VALUES
  ('invoice',           'FAC',  8),
  ('credit_note',       'NC',   8),
  ('debit_note',        'ND',   8),
  ('quotation',         'COT',  8),
  ('sales_order',       'OV',   8),
  ('delivery',          'GR',   8),
  ('purchase_order',    'OC',   8),
  ('purchase_receipt',  'RE',   8),
  ('supplier_bill',     'FP',   8),
  ('supplier_payment',  'PP',   8),
  ('payment',           'PAY',  8),
  ('stock_transfer',    'TRF',  8),
  ('adjustment',        'AJU',  8),
  ('cash_payment',      'EGR',  8),
  ('cash_income',       'ING',  8)
ON CONFLICT (document_type, tenant_id) DO NOTHING;
