-- ============================================================
-- SISTEMA SAAS INVENTARIO Y VENTAS
-- Script: 02_schema_public.sql
-- Descripción: Schema PUBLIC — Tablas globales del sistema SaaS
-- Motor: PostgreSQL 15+
-- Ejecutar: Una sola vez en la instancia PostgreSQL
-- ============================================================

SET search_path TO public;

-- ============================================================
-- TABLA: subscription_plans
-- Propósito: Catálogo de planes de suscripción disponibles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id              UUID            NOT NULL DEFAULT gen_random_uuid(),
  name            VARCHAR(100)    NOT NULL,
  code            VARCHAR(50)     NOT NULL,
  description     TEXT,
  max_users       INT             NOT NULL DEFAULT 5
                  CONSTRAINT chk_plans_max_users CHECK (max_users = -1 OR max_users > 0),
  max_warehouses  INT             NOT NULL DEFAULT 1
                  CONSTRAINT chk_plans_max_warehouses CHECK (max_warehouses = -1 OR max_warehouses > 0),
  max_products    INT             NOT NULL DEFAULT 100
                  CONSTRAINT chk_plans_max_products CHECK (max_products = -1 OR max_products > 0),
  max_storage_gb  NUMERIC(8,2)    NOT NULL DEFAULT 5.00
                  CONSTRAINT chk_plans_storage CHECK (max_storage_gb > 0),
  price_monthly   NUMERIC(10,2)   NOT NULL DEFAULT 0
                  CONSTRAINT chk_plans_price_monthly CHECK (price_monthly >= 0),
  price_yearly    NUMERIC(10,2)   NOT NULL DEFAULT 0
                  CONSTRAINT chk_plans_price_yearly CHECK (price_yearly >= 0),
  features        JSONB,
  is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
  sort_order      INT             NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_subscription_plans PRIMARY KEY (id),
  CONSTRAINT uq_subscription_plans_code UNIQUE (code)
);

CREATE INDEX idx_subscription_plans_active ON public.subscription_plans (is_active);
CREATE INDEX idx_subscription_plans_sort ON public.subscription_plans (sort_order) WHERE is_active = TRUE;

CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE public.subscription_plans IS 'Catálogo de planes de suscripción SaaS';
COMMENT ON COLUMN public.subscription_plans.max_users IS '-1 = ilimitado';
COMMENT ON COLUMN public.subscription_plans.features IS 'JSON con features habilitadas: {"reports": true, "api_access": false}';


-- ============================================================
-- TABLA: tenants
-- Propósito: Registro maestro de todas las empresas suscritas
-- TABLA CENTRAL DEL SISTEMA MULTI-TENANT
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenants (
  id              UUID            NOT NULL DEFAULT gen_random_uuid(),
  slug            VARCHAR(100)    NOT NULL,
  name            VARCHAR(255)    NOT NULL,
  trade_name      VARCHAR(255),
  tax_id          VARCHAR(50),
  country_code    CHAR(2)         NOT NULL DEFAULT 'US',
  timezone        VARCHAR(50)     NOT NULL DEFAULT 'UTC',
  locale          VARCHAR(10)     NOT NULL DEFAULT 'en-US',
  status          VARCHAR(20)     NOT NULL DEFAULT 'trial'
                  CONSTRAINT chk_tenants_status
                    CHECK (status IN ('trial','active','suspended','cancelled')),
  schema_name     VARCHAR(100)    NOT NULL,
  contact_email   VARCHAR(255)
                  CONSTRAINT chk_tenants_email CHECK (
                    contact_email IS NULL OR
                    contact_email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
                  ),
  contact_phone   VARCHAR(30),
  logo_url        VARCHAR(500),
  max_users       INT             NOT NULL DEFAULT 5,
  trial_ends_at   TIMESTAMPTZ,
  form_access_mode VARCHAR(20)    NOT NULL DEFAULT 'all'
                  CONSTRAINT chk_tenants_form_access_mode
                    CHECK (form_access_mode IN ('all','restricted')),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT pk_tenants PRIMARY KEY (id),
  CONSTRAINT uq_tenants_slug UNIQUE (slug),
  CONSTRAINT uq_tenants_schema_name UNIQUE (schema_name),
  CONSTRAINT chk_tenants_slug CHECK (slug ~* '^[a-z0-9][a-z0-9\-]{2,98}[a-z0-9]$')
);

CREATE INDEX idx_tenants_status ON public.tenants (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tenants_created_at ON public.tenants (created_at DESC);
CREATE INDEX idx_tenants_trial ON public.tenants (trial_ends_at) WHERE status = 'trial';

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE public.tenants IS 'Registro maestro de empresas suscritas al SaaS';
COMMENT ON COLUMN public.tenants.slug IS 'Identificador URL-safe único. Se usa como subdominio: slug.app.com';
COMMENT ON COLUMN public.tenants.schema_name IS 'Nombre del schema PostgreSQL de este tenant: tenant_{slug_sanitized}';
COMMENT ON COLUMN public.tenants.status IS 'trial→active→suspended|cancelled';
COMMENT ON COLUMN public.tenants.form_access_mode IS 'all = sin restricción (default, comportamiento histórico: cualquier form de public.forms es asignable a un módulo del tenant). restricted = solo los slugs listados en tenant_allowed_forms, más cualquier form propio del tenant que no exista en public.forms (nunca se gatea un form custom).';


-- ============================================================
-- TABLA: tenant_subscriptions
-- Propósito: Suscripción activa e historial de planes por tenant
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id              UUID            NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID            NOT NULL,
  plan_id         UUID            NOT NULL,
  status          VARCHAR(20)     NOT NULL DEFAULT 'active'
                  CONSTRAINT chk_tenant_subs_status
                    CHECK (status IN ('active','past_due','cancelled','expired','trialing')),
  billing_cycle   VARCHAR(10)     NOT NULL DEFAULT 'monthly'
                  CONSTRAINT chk_tenant_subs_cycle
                    CHECK (billing_cycle IN ('monthly','yearly','lifetime')),
  amount          NUMERIC(10,2)   NOT NULL DEFAULT 0
                  CONSTRAINT chk_tenant_subs_amount CHECK (amount >= 0),
  currency_code   CHAR(3)         NOT NULL DEFAULT 'USD',
  started_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  external_ref    VARCHAR(100),
  metadata        JSONB,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_tenant_subscriptions PRIMARY KEY (id),
  CONSTRAINT fk_tenant_subs_tenant
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_subs_plan
    FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE RESTRICT
);

CREATE INDEX idx_tenant_subs_tenant ON public.tenant_subscriptions (tenant_id, status);
CREATE INDEX idx_tenant_subs_expires ON public.tenant_subscriptions (expires_at)
  WHERE status IN ('active','trialing');

CREATE TRIGGER trg_tenant_subscriptions_updated_at
  BEFORE UPDATE ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE public.tenant_subscriptions IS 'Historial de suscripciones de cada tenant. Un tenant puede tener múltiples registros (cambios de plan, renovaciones)';


-- ============================================================
-- TABLA: super_admins
-- Propósito: Administradores de la plataforma SaaS
-- SEPARADOS COMPLETAMENTE de los users de cada tenant
-- ============================================================
CREATE TABLE IF NOT EXISTS public.super_admins (
  id              UUID            NOT NULL DEFAULT gen_random_uuid(),
  email           VARCHAR(255)    NOT NULL,
  password_hash   VARCHAR(255)    NOT NULL,
  first_name      VARCHAR(100)    NOT NULL,
  last_name       VARCHAR(100)    NOT NULL,
  is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
  mfa_secret      VARCHAR(100),
  mfa_enabled     BOOLEAN         NOT NULL DEFAULT FALSE,
  last_login_at   TIMESTAMPTZ,
  last_login_ip   VARCHAR(45),
  login_attempts  SMALLINT        NOT NULL DEFAULT 0
                  CONSTRAINT chk_super_admins_attempts CHECK (login_attempts >= 0),
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT pk_super_admins PRIMARY KEY (id),
  CONSTRAINT uq_super_admins_email UNIQUE (email) -- Hard unique, sin soft delete bypass
);

CREATE TRIGGER trg_super_admins_updated_at
  BEFORE UPDATE ON public.super_admins
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE public.super_admins IS
  'Administradores de la plataforma. NO son usuarios de ningún tenant. MFA obligatorio en producción.';

-- Usuario super admin
INSERT INTO public.super_admins (email, password_hash, first_name, last_name)
VALUES (
  'jcabarcasjulio@gmail.com',
  '$2b$10$Z70TQf7P54uR9FKhc1yTduKkJfUlnhD2ipVJRB9Hx/giYsUbuddWi',
  'Jhonatan',
  'Cabarcas'
) ON CONFLICT DO NOTHING;


-- ============================================================
-- TABLA: super_admin_audit_logs
-- Propósito: Auditoría de acciones del Super Admin
-- Separada del audit_logs de cada tenant
-- ============================================================
CREATE TABLE IF NOT EXISTS public.super_admin_audit_logs (
  id              UUID            NOT NULL DEFAULT gen_random_uuid(),
  admin_id        UUID,
  admin_email     VARCHAR(255),
  action          VARCHAR(50)     NOT NULL,
  target_type     VARCHAR(50),
  target_id       UUID,
  target_name     VARCHAR(255),
  old_values      JSONB,
  new_values      JSONB,
  ip_address      VARCHAR(45),
  user_agent      VARCHAR(500),
  request_id      UUID,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_super_admin_audit_logs PRIMARY KEY (id),
  CONSTRAINT fk_super_audit_admin
    FOREIGN KEY (admin_id) REFERENCES public.super_admins(id) ON DELETE SET NULL
);

CREATE INDEX idx_super_audit_admin ON public.super_admin_audit_logs (admin_id, created_at DESC);
CREATE INDEX idx_super_audit_target ON public.super_admin_audit_logs (target_type, target_id);
CREATE INDEX idx_super_audit_created ON public.super_admin_audit_logs (created_at DESC);

COMMENT ON TABLE public.super_admin_audit_logs IS
  'Auditoría inmutable de todas las acciones del Super Admin. Append-only.';


-- ============================================================
-- TABLA: super_admin_refresh_tokens
-- Propósito: Refresh tokens para Super Admins (aislados de tenant tokens)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.super_admin_refresh_tokens (
  id            UUID          NOT NULL DEFAULT gen_random_uuid(),
  admin_id      UUID          NOT NULL,
  token_hash    VARCHAR(255)  NOT NULL,
  family        UUID          NOT NULL DEFAULT gen_random_uuid(),
  expires_at    TIMESTAMPTZ   NOT NULL,
  revoked_at    TIMESTAMPTZ,
  revoke_reason VARCHAR(50),
  ip_address    VARCHAR(45),
  user_agent    VARCHAR(500),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_super_admin_rt PRIMARY KEY (id),
  CONSTRAINT uq_super_admin_rt_hash UNIQUE (token_hash),
  CONSTRAINT fk_super_admin_rt_admin
    FOREIGN KEY (admin_id) REFERENCES public.super_admins(id) ON DELETE CASCADE
);

CREATE INDEX idx_super_admin_rt_valid
  ON public.super_admin_refresh_tokens (token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_super_admin_rt_family
  ON public.super_admin_refresh_tokens (family);


-- ============================================================
-- VISTA: tenant_status_summary
-- Propósito: Dashboard del Super Admin con estado de tenants
-- ============================================================
CREATE OR REPLACE VIEW public.v_tenant_summary AS
SELECT
  t.id,
  t.slug,
  t.name,
  t.country_code,
  t.status,
  t.created_at,
  t.trial_ends_at,
  sp.name         AS plan_name,
  sp.code         AS plan_code,
  ts.status       AS subscription_status,
  ts.expires_at   AS subscription_expires_at,
  ts.billing_cycle
FROM public.tenants t
LEFT JOIN public.tenant_subscriptions ts
  ON ts.tenant_id = t.id
  AND ts.status IN ('active','trialing')
LEFT JOIN public.subscription_plans sp
  ON sp.id = ts.plan_id
WHERE t.deleted_at IS NULL;

COMMENT ON VIEW public.v_tenant_summary IS
  'Vista resumen de tenants con su suscripción activa. Para uso del Super Admin.';
