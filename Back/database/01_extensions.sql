-- ============================================================
-- SISTEMA SAAS INVENTARIO Y VENTAS
-- Script: 01_extensions.sql
-- Descripción: Extensiones y configuración global de PostgreSQL
-- Motor: PostgreSQL 15+
-- ============================================================

-- ============================================================
-- EXTENSIONES REQUERIDAS
-- ============================================================

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid(), crypt(), digest()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- uuid_generate_v4() (compatibilidad)

-- Full-text search con trigramas (búsqueda de texto parcial sin LIKE completo)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Índices GIN con tipos compuestos
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Estadísticas extendidas (mejora el query planner en queries multi-columna)
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Encriptación adicional (para campos sensibles como MFA secrets)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- ya incluido arriba


-- ============================================================
-- CONFIGURACIÓN DE SESIÓN RECOMENDADA (postgresql.conf)
-- ============================================================
-- Agregar al postgresql.conf en producción:
--
-- # Performance
-- shared_buffers = 256MB               -- 25% de RAM disponible
-- effective_cache_size = 1GB           -- 75% de RAM disponible
-- work_mem = 16MB                      -- Por operación de sort/hash
-- maintenance_work_mem = 128MB         -- Para VACUUM, CREATE INDEX
--
-- # WAL y Durabilidad
-- wal_level = replica
-- archive_mode = on
-- archive_command = 'aws s3 cp %p s3://BUCKET/wal/%f'
-- archive_timeout = 300
--
-- # Logging
-- log_min_duration_statement = 1000   -- Log queries > 1 segundo
-- log_checkpoints = on
-- log_connections = on
-- log_lock_waits = on
-- log_temp_files = 0
--
-- # Autovacuum (crítico para tablas con muchos updates como stocks)
-- autovacuum_vacuum_scale_factor = 0.05   -- 5% de rows modificadas
-- autovacuum_analyze_scale_factor = 0.02  -- 2% para ANALYZE
-- ============================================================


-- ============================================================
-- FUNCIÓN UTILITARIA: Actualización automática de updated_at
-- ============================================================
-- Esta función se asocia como trigger a todas las tablas que
-- tienen columna updated_at. Evita olvidar actualizar el campo
-- en la aplicación.

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_set_updated_at() IS
  'Trigger function: actualiza updated_at automáticamente en cada UPDATE';


-- ============================================================
-- FUNCIÓN UTILITARIA: Siguiente número de documento
-- ============================================================
-- Genera números de documento correlativos de forma thread-safe
-- usando SELECT ... FOR UPDATE para evitar duplicados bajo concurrencia.

CREATE OR REPLACE FUNCTION fn_next_document_number(
  p_document_type VARCHAR(50)
)
RETURNS TEXT AS $$
DECLARE
  v_prefix      VARCHAR(10);
  v_suffix      VARCHAR(10);
  v_min_digits  SMALLINT;
  v_next_number INT;
  v_formatted   TEXT;
BEGIN
  -- Lock en la fila específica para evitar race conditions
  SELECT
    prefix,
    suffix,
    min_digits,
    current_number + 1
  INTO
    v_prefix,
    v_suffix,
    v_min_digits,
    v_next_number
  FROM document_sequences
  WHERE document_type = p_document_type
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secuencia no encontrada para tipo de documento: %', p_document_type;
  END IF;

  -- Actualizar el contador
  UPDATE document_sequences
  SET current_number = v_next_number,
      updated_at = NOW()
  WHERE document_type = p_document_type;

  -- Formatear: PREFIX-000001[-SUFFIX]
  v_formatted := v_prefix || '-' || LPAD(v_next_number::TEXT, v_min_digits, '0');

  IF v_suffix IS NOT NULL AND v_suffix != '' THEN
    v_formatted := v_formatted || '-' || v_suffix;
  END IF;

  RETURN v_formatted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_next_document_number(VARCHAR) IS
  'Genera el siguiente número correlativo de documento de forma atómica y thread-safe';


-- ============================================================
-- FUNCIÓN UTILITARIA: Validar email
-- ============================================================
CREATE OR REPLACE FUNCTION fn_is_valid_email(p_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN p_email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================
-- FUNCIÓN UTILITARIA: Slugify (texto → slug URL-safe)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_slugify(p_text TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(
    regexp_replace(
      regexp_replace(
        translate(p_text,
          'áéíóúàèìòùäëïöüÁÉÍÓÚÀÈÌÒÙÄËÏÖÜñÑçÇ',
          'aeiouaeiouaeiouAEIOUAEIOUAEIOUnncc'),
        '[^a-z0-9\-_\s]', '', 'gi'),
      '[\s\-]+', '-', 'g')
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
