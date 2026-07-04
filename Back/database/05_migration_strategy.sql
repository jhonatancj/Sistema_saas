-- ============================================================
-- SISTEMA SAAS INVENTARIO Y VENTAS
-- Script: 05_migration_strategy.sql
-- Descripción: Infraestructura de control de migraciones
--              y scripts de mantenimiento
-- Motor: PostgreSQL 15+
-- ============================================================


-- ============================================================
-- TABLA DE CONTROL DE MIGRACIONES (schema public)
-- ============================================================
-- Una por el schema global, una equivalente en cada tenant schema.

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version       VARCHAR(50)   NOT NULL,
  name          VARCHAR(200)  NOT NULL,
  scope         VARCHAR(20)   NOT NULL DEFAULT 'global'
                CONSTRAINT chk_sm_scope CHECK (scope IN ('global','tenant')),
  applied_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  applied_by    VARCHAR(100),
  execution_ms  INT,
  checksum      VARCHAR(64),

  CONSTRAINT pk_schema_migrations PRIMARY KEY (version, scope)
);

CREATE INDEX idx_sm_applied ON public.schema_migrations (applied_at DESC);

COMMENT ON TABLE public.schema_migrations IS
  'Control de migraciones ejecutadas. scope=global para public schema, scope=tenant para schemas de tenants.';


-- ============================================================
-- FUNCIÓN: Ejecutar migración de tenant en todos los schemas
-- ============================================================
-- Uso: SELECT run_migration_on_all_tenants('mi_migration_sql', '1706150930', 'AddColumnToProducts');

CREATE OR REPLACE FUNCTION public.run_migration_on_all_tenants(
  p_sql         TEXT,
  p_version     VARCHAR(50),
  p_name        VARCHAR(200)
)
RETURNS TABLE(schema_name TEXT, success BOOLEAN, error_msg TEXT) AS $$
DECLARE
  v_tenant RECORD;
  v_start  TIMESTAMPTZ;
  v_ms     INT;
BEGIN
  FOR v_tenant IN
    SELECT t.schema_name, t.id, t.slug
    FROM public.tenants t
    WHERE t.status != 'cancelled'
      AND t.deleted_at IS NULL
    ORDER BY t.created_at
  LOOP
    BEGIN
      v_start := clock_timestamp();

      -- Configurar contexto del tenant
      PERFORM set_config('search_path', v_tenant.schema_name || ', public', TRUE);
      PERFORM set_config('app.current_tenant_id', v_tenant.id::TEXT, TRUE);

      -- Ejecutar la migración
      EXECUTE p_sql;

      v_ms := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::INT;

      -- Registrar éxito en schema_migrations del tenant
      EXECUTE format(
        'INSERT INTO %I.schema_migrations (version, name, scope, applied_by, execution_ms)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING',
        v_tenant.schema_name
      ) USING p_version, p_name, 'tenant', 'system', v_ms;

      schema_name := v_tenant.schema_name;
      success := TRUE;
      error_msg := NULL;
      RETURN NEXT;

    EXCEPTION WHEN OTHERS THEN
      schema_name := v_tenant.schema_name;
      success := FALSE;
      error_msg := SQLSTATE || ': ' || SQLERRM;
      RETURN NEXT;
      -- Continuar con el siguiente tenant en lugar de abortar todo
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.run_migration_on_all_tenants IS
  'Ejecuta un bloque SQL de migración en todos los schemas de tenants activos. Continúa si un tenant falla.';


-- ============================================================
-- FUNCIÓN: Crear particiones futuras de audit_logs
-- ============================================================
-- Ejecutar mensualmente (primer día del mes) con pg_cron

CREATE OR REPLACE FUNCTION fn_create_next_audit_partitions()
RETURNS VOID AS $$
DECLARE
  v_next_month DATE;
  v_partition_name TEXT;
  v_start DATE;
  v_end DATE;
BEGIN
  -- Crear particiones para los próximos 3 meses
  FOR i IN 1..3 LOOP
    v_next_month := date_trunc('month', CURRENT_DATE + (i || ' months')::INTERVAL)::DATE;
    v_start := v_next_month;
    v_end := (v_next_month + INTERVAL '1 month')::DATE;
    v_partition_name := 'audit_logs_' || to_char(v_next_month, 'YYYY_MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = v_partition_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
        v_partition_name, v_start, v_end
      );
      RAISE NOTICE 'Partición creada: %', v_partition_name;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_create_next_audit_partitions() IS
  'Crea particiones de audit_logs para los próximos 3 meses. Ejecutar mensualmente con pg_cron.';


-- ============================================================
-- FUNCIÓN: Crear particiones futuras de stock_movements
-- ============================================================
CREATE OR REPLACE FUNCTION fn_create_next_stock_movement_partitions()
RETURNS VOID AS $$
DECLARE
  v_year INT;
  v_semester INT;
  v_start DATE;
  v_end DATE;
  v_partition_name TEXT;
BEGIN
  -- Crear partición para el próximo semestre si no existe
  v_year := EXTRACT(YEAR FROM CURRENT_DATE + INTERVAL '6 months')::INT;
  v_semester := CASE
    WHEN EXTRACT(MONTH FROM CURRENT_DATE + INTERVAL '6 months') <= 6 THEN 1
    ELSE 2
  END;

  v_partition_name := 'stock_movements_' || v_year || '_s' || v_semester;

  v_start := make_date(v_year, CASE WHEN v_semester = 1 THEN 1 ELSE 7 END, 1);
  v_end   := make_date(v_year, CASE WHEN v_semester = 1 THEN 7 ELSE 1 END,
                       CASE WHEN v_semester = 1 THEN 1 ELSE 1 END);
  IF v_semester = 2 THEN v_end := make_date(v_year + 1, 1, 1); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = v_partition_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF stock_movements FOR VALUES FROM (%L) TO (%L)',
      v_partition_name, v_start, v_end
    );
    RAISE NOTICE 'Partición creada: %', v_partition_name;
  END IF;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- FUNCIÓN: Mantenimiento programado
-- ============================================================
-- Ejecutar diariamente

CREATE OR REPLACE FUNCTION fn_daily_maintenance()
RETURNS VOID AS $$
BEGIN
  -- 1. Actualizar facturas vencidas
  PERFORM fn_update_overdue_invoices();

  -- 2. Limpiar refresh tokens expirados (más de 30 días)
  DELETE FROM refresh_tokens
  WHERE (expires_at < NOW() - INTERVAL '30 days')
     OR (revoked_at < NOW() - INTERVAL '30 days');

  -- 3. Limpiar password reset tokens viejos
  DELETE FROM password_reset_tokens
  WHERE expires_at < NOW() - INTERVAL '24 hours';

  -- 4. Refrescar vistas materializadas
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_accounts_receivable;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_accounts_payable;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stock_summary;

  RAISE NOTICE 'Mantenimiento diario completado: %', NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_daily_maintenance() IS
  'Mantenimiento diario. Configurar con pg_cron: SELECT cron.schedule(''daily-maintenance'', ''0 3 * * *'', ''SELECT fn_daily_maintenance()'');';


-- ============================================================
-- SCRIPT DE BACKUP POR TENANT (ejemplo de uso en bash)
-- ============================================================
/*
Backup de schema individual:

  DATE=$(date +%Y%m%d_%H%M%S)
  TENANT_SLUG="acme-corp"
  SCHEMA_NAME="tenant_acme_corp"

  pg_dump \
    --host=$DB_HOST \
    --username=$DB_USER \
    --dbname=$DB_NAME \
    --schema=$SCHEMA_NAME \
    --format=custom \
    --compress=9 \
    --file=/tmp/backup_${TENANT_SLUG}_${DATE}.pgdump

  aws s3 cp /tmp/backup_${TENANT_SLUG}_${DATE}.pgdump \
    s3://mi-bucket/backups/tenants/${TENANT_SLUG}/${DATE}.pgdump

Restore de schema individual (en ambiente de staging):

  TENANT_SLUG="acme-corp"
  SCHEMA_NAME="tenant_acme_corp"

  psql --host=$DB_HOST --username=$DB_USER --dbname=$DB_NAME \
    --command="DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE"

  psql --host=$DB_HOST --username=$DB_USER --dbname=$DB_NAME \
    --command="CREATE SCHEMA ${SCHEMA_NAME}"

  pg_restore \
    --host=$DB_HOST \
    --username=$DB_USER \
    --dbname=$DB_NAME \
    --schema=$SCHEMA_NAME \
    /tmp/backup_${TENANT_SLUG}_${DATE}.pgdump
*/


-- ============================================================
-- QUERY DE DIAGNÓSTICO: Estado de schemas de tenants
-- ============================================================
/*
-- Ver qué tablas existen en cada schema de tenant:
SELECT
  schemaname,
  COUNT(*) AS table_count
FROM pg_tables
WHERE schemaname LIKE 'tenant_%'
GROUP BY schemaname
ORDER BY schemaname;

-- Ver tamaño por schema:
SELECT
  schema_name,
  pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||tablename))::BIGINT) AS total_size
FROM information_schema.tables t
JOIN public.tenants tn ON tn.schema_name = t.table_schema
WHERE t.table_schema LIKE 'tenant_%'
GROUP BY schema_name
ORDER BY SUM(pg_total_relation_size(schemaname||'.'||tablename)) DESC;

-- Ver queries lentas (requiere pg_stat_statements):
SELECT
  calls,
  mean_exec_time::INT AS avg_ms,
  max_exec_time::INT  AS max_ms,
  LEFT(query, 120)    AS query_preview
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Ver índices sin usar:
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan AS scans_since_last_reset
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND schemaname LIKE 'tenant_%'
ORDER BY schemaname, tablename;
*/


-- ============================================================
-- CONFIGURACIÓN pg_cron (instalar con CREATE EXTENSION pg_cron)
-- ============================================================
/*
-- Reemplazar 'mydb' con el nombre de tu base de datos

-- Mantenimiento diario a las 3am UTC
SELECT cron.schedule('daily-maintenance',
  '0 3 * * *',
  'SELECT fn_daily_maintenance()');

-- Crear particiones el día 25 de cada mes
SELECT cron.schedule('create-partitions',
  '0 4 25 * *',
  'SELECT fn_create_next_audit_partitions(); SELECT fn_create_next_stock_movement_partitions()');

-- Refresh de vistas materializadas cada 15 minutos
SELECT cron.schedule('refresh-mv-stock',
  '*/15 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stock_summary');
*/
