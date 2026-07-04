-- ============================================================
-- SISTEMA SAAS INVENTARIO Y VENTAS
-- Script: 07_tenant_form_access.sql
-- Descripción: Allow-list por tenant de qué formularios del catálogo
-- público (public.forms) puede asignar a sus módulos.
-- Debe ejecutarse DESPUÉS de 06_public_forms.sql — tenant_allowed_forms
-- referencia public.forms(slug) por FK.
-- Idempotente — seguro de correr sobre la DB real ya provisionada.
-- ============================================================

-- Safety net para la DB real (02_schema_public.sql ya la define inline
-- para instalaciones nuevas; en la DB real ya provisionada la tabla
-- tenants existe sin esta columna todavía).
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS form_access_mode VARCHAR(20) NOT NULL DEFAULT 'all'
  CONSTRAINT chk_tenants_form_access_mode CHECK (form_access_mode IN ('all','restricted'));

CREATE TABLE IF NOT EXISTS public.tenant_allowed_forms (
  tenant_id  UUID         NOT NULL,
  form_slug  VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_tenant_allowed_forms PRIMARY KEY (tenant_id, form_slug),
  CONSTRAINT fk_taf_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_taf_form   FOREIGN KEY (form_slug) REFERENCES public.forms(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_taf_tenant ON public.tenant_allowed_forms (tenant_id);

COMMENT ON TABLE public.tenant_allowed_forms IS
  'Allow-list explícita por tenant de qué formularios del catálogo public.forms puede asignar a sus módulos, cuando tenants.form_access_mode = ''restricted''. Un form del catálogo sin fila acá para un tenant restricted NO es asignable. Forms propios del tenant (que no existen en public.forms) nunca pasan por esta tabla.';
