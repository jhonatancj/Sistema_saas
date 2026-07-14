-- Declara formalmente public.forms (existía ad hoc en la DB real, sin script
-- de creación documentado — ver CLAUDE.md §7, drift señalado ahí). Este script
-- es idempotente para convivir con el entorno real ya existente (nombres de
-- constraint y tipos calcados de la tabla real vía \d public.forms).
CREATE TABLE IF NOT EXISTS public.forms (
  id          BIGINT       NOT NULL GENERATED ALWAYS AS IDENTITY,
  parent_id   BIGINT,
  slug        VARCHAR(100) NOT NULL,
  name        VARCHAR(200) NOT NULL,
  action      VARCHAR(255),
  json_form   JSONB,
  grid_config JSONB        DEFAULT '[]'::jsonb,
  has_table   BOOLEAN      NOT NULL DEFAULT FALSE,
  has_sp      BOOLEAN      NOT NULL DEFAULT FALSE,
  table_name  VARCHAR(100),
  sp_name     VARCHAR(100),
  grid_query  TEXT,
  icon        VARCHAR(100),
  display_mode VARCHAR(20) NOT NULL DEFAULT 'modal',
  modal_width  INT,
  recreate_sp BOOLEAN      NOT NULL DEFAULT TRUE,
  is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by  UUID,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  CONSTRAINT forms_pkey PRIMARY KEY (id),
  CONSTRAINT forms_slug_key UNIQUE (slug),
  CONSTRAINT chk_forms_display_mode CHECK (display_mode IN ('modal', 'inline'))
);

-- Ícono de formulario (clase FontAwesome, ej: 'fa-solid fa-box') — se copia
-- a la copia del tenant vía ModulesService.copyMissingFormsToTenant().
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS icon VARCHAR(100);

-- Paridad con {schema}.forms de tenant (ver 04_create_tenant.sql +
-- migrations/001_forms_generator_overrides.sql) — sin esto, FormGeneratorService
-- y FormExecutorService no pueden operar con schema='public' como si fuera un
-- tenant más. Sin FK de parent_id, mismo criterio que la migración de tenant
-- (ADD CONSTRAINT IF NOT EXISTS no existe en Postgres).
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS parent_id  BIGINT;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS action     VARCHAR(255);
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS has_table  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS has_sp     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS table_name VARCHAR(100);
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS sp_name    VARCHAR(100);
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS grid_query TEXT;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS is_system  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Modo de visualización del formulario desde el builder: modal (default,
-- comportamiento histórico) o inline (el form reemplaza la grid en la misma
-- vista en vez de abrir un modal). modal_width en px, NULL = ancho por
-- default del componente. Ver docs/adr/011-form-display-mode.md.
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS display_mode VARCHAR(20) NOT NULL DEFAULT 'modal';
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS modal_width  INT;

-- Ver Back/database/12_forms_recreate_sp.sql (misma columna, script dedicado
-- ya aplicado a la DB real — se agrega también acá para que un entorno nuevo
-- desde cero (`06_public_forms.sql` solo) nazca con la columna).
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS recreate_sp BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_forms_display_mode' AND conrelid = 'public.forms'::regclass
  ) THEN
    ALTER TABLE public.forms
      ADD CONSTRAINT chk_forms_display_mode CHECK (display_mode IN ('modal', 'inline'));
  END IF;
END $$;
