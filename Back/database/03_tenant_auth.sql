-- ============================================================
-- 03_tenant_auth.sql
-- Tablas de autenticación para el schema de cada tenant.
-- Este script se ejecuta DENTRO del schema del tenant,
-- no en public.
-- ============================================================

-- ── users ────────────────────────────────────────────────────
CREATE TABLE users (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  email             VARCHAR(255)  NOT NULL,
  password_hash     VARCHAR(255)  NOT NULL,
  first_name        VARCHAR(100)  NOT NULL,
  last_name         VARCHAR(100)  NOT NULL,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  last_login_at     TIMESTAMPTZ,
  login_attempts    SMALLINT      NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,

  CONSTRAINT pk_users PRIMARY KEY (id)
);

CREATE UNIQUE INDEX uidx_users_email ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_active ON users (is_active) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


-- ── roles ────────────────────────────────────────────────────
CREATE TABLE roles (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  name        VARCHAR(100)  NOT NULL,
  code        VARCHAR(50)   NOT NULL,
  description TEXT,
  is_system   BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_roles PRIMARY KEY (id),
  CONSTRAINT uq_roles_code UNIQUE (code)
);

CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


-- ── permissions ──────────────────────────────────────────────
CREATE TABLE permissions (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  module      VARCHAR(50)   NOT NULL,
  action      VARCHAR(50)   NOT NULL,
  code        VARCHAR(100)  NOT NULL,
  description TEXT,

  CONSTRAINT pk_permissions PRIMARY KEY (id),
  CONSTRAINT uq_permissions_code UNIQUE (code)
);


-- ── user_roles ───────────────────────────────────────────────
CREATE TABLE user_roles (
  user_id     UUID  NOT NULL,
  role_id     UUID  NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_user_roles PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);


-- ── role_permissions ─────────────────────────────────────────
CREATE TABLE role_permissions (
  role_id       UUID  NOT NULL,
  permission_id UUID  NOT NULL,

  CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role       FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);


-- ── refresh_tokens ───────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id            UUID          NOT NULL DEFAULT gen_random_uuid(),
  user_id       UUID          NOT NULL,
  token_hash    VARCHAR(255)  NOT NULL,
  family        UUID          NOT NULL DEFAULT gen_random_uuid(),
  expires_at    TIMESTAMPTZ   NOT NULL,
  revoked_at    TIMESTAMPTZ,
  revoke_reason VARCHAR(50),
  ip_address    VARCHAR(45),
  user_agent    VARCHAR(500),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_refresh_tokens PRIMARY KEY (id),
  CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_rt_valid  ON refresh_tokens (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_rt_family ON refresh_tokens (family);
CREATE INDEX idx_rt_user   ON refresh_tokens (user_id, revoked_at);