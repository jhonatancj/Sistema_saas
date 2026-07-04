-- ============================================================
-- 04_create_tenant.sql
-- Función que crea el schema de un tenant y ejecuta
-- las tablas de auth dentro de él.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_tenant_schema(
  p_tenant_id   UUID,
  p_slug        TEXT
)
RETURNS VOID AS $$
DECLARE
  v_schema_name TEXT := 'tenant_' || replace(p_slug, '-', '_');
BEGIN
  -- 1. Crear el schema
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_schema_name);

  -- 2. Apuntar el search_path al schema del tenant
  EXECUTE format('SET search_path TO %I, public', v_schema_name);

  -- 3. Crear las tablas de auth dentro del schema
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.users (
      id             UUID         NOT NULL DEFAULT gen_random_uuid(),
      email          VARCHAR(255) NOT NULL,
      password_hash  VARCHAR(255) NOT NULL,
      first_name     VARCHAR(100) NOT NULL,
      last_name      VARCHAR(100) NOT NULL,
      is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
      last_login_at  TIMESTAMPTZ,
      login_attempts SMALLINT     NOT NULL DEFAULT 0,
      locked_until   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at     TIMESTAMPTZ,
      CONSTRAINT pk_users PRIMARY KEY (id)
    )', v_schema_name);

  EXECUTE format('
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_users_email
      ON %I.users (email) WHERE deleted_at IS NULL',
    v_schema_name);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.roles (
      id          UUID         NOT NULL DEFAULT gen_random_uuid(),
      name        VARCHAR(100) NOT NULL,
      code        VARCHAR(50)  NOT NULL,
      description TEXT,
      is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
      is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT pk_roles PRIMARY KEY (id),
      CONSTRAINT uq_roles_code UNIQUE (code)
    )', v_schema_name);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.permissions (
      id          UUID         NOT NULL DEFAULT gen_random_uuid(),
      module      VARCHAR(50)  NOT NULL,
      action      VARCHAR(50)  NOT NULL,
      code        VARCHAR(100) NOT NULL,
      description TEXT,
      CONSTRAINT pk_permissions PRIMARY KEY (id),
      CONSTRAINT uq_permissions_code UNIQUE (code)
    )', v_schema_name);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.user_roles (
      user_id     UUID        NOT NULL,
      role_id     UUID        NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT pk_user_roles PRIMARY KEY (user_id, role_id),
      CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES %I.users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES %I.roles(id) ON DELETE CASCADE
    )', v_schema_name, v_schema_name, v_schema_name);

    -- Tablas de módulos
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.modules (
      id          BIGINT       NOT NULL GENERATED ALWAYS AS IDENTITY,
      public_id   BIGINT,
      name        VARCHAR(100) NOT NULL,
      code        VARCHAR(50)  NOT NULL,
      icon        VARCHAR(50),
      description TEXT,
      sort_order  SMALLINT     NOT NULL DEFAULT 0,
      is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
      is_custom   BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT pk_modules PRIMARY KEY (id),
      CONSTRAINT uq_modules_code UNIQUE (code)
    )', v_schema_name);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.module_forms (
      id         BIGINT       NOT NULL GENERATED ALWAYS AS IDENTITY,
      module_id  BIGINT       NOT NULL,
      form_slug  VARCHAR(100) NOT NULL,
      sort_order SMALLINT     NOT NULL DEFAULT 0,
      CONSTRAINT pk_module_forms PRIMARY KEY (id),
      CONSTRAINT uq_module_forms_module_slug UNIQUE (module_id, form_slug),
      CONSTRAINT fk_mf_module FOREIGN KEY (module_id) REFERENCES %I.modules(id) ON DELETE CASCADE
    )', v_schema_name, v_schema_name);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.module_roles (
      module_id  BIGINT NOT NULL REFERENCES %I.modules(id) ON DELETE CASCADE,
      role_code  VARCHAR(50) NOT NULL,
      can_view   BOOLEAN     NOT NULL DEFAULT TRUE,
      can_create BOOLEAN     NOT NULL DEFAULT FALSE,
      can_edit   BOOLEAN     NOT NULL DEFAULT FALSE,
      can_delete BOOLEAN     NOT NULL DEFAULT FALSE,
      can_export  BOOLEAN DEFAULT FALSE,
      can_import  BOOLEAN DEFAULT FALSE,
      CONSTRAINT pk_module_roles PRIMARY KEY (module_id, role_code),
      CONSTRAINT fk_mr_module FOREIGN KEY (module_id) REFERENCES %I.modules(id) ON DELETE CASCADE
    )', v_schema_name, v_schema_name, v_schema_name);

  -- Clonar módulos de public al tenant. COALESCE(tenant_name, name): el
  -- tenant recibe el nombre "genérico" (tenant_name) si el super admin
  -- definió uno distinto al de su propio catálogo/sidebar (ver
  -- docs/adr/012-module-tenant-name.md) — si no, usa `name` tal cual.
  EXECUTE format('
    INSERT INTO %I.modules (public_id, name, code, icon, description, sort_order)
    SELECT id, COALESCE(tenant_name, name), code, icon, description, sort_order
    FROM public.modules WHERE is_active = TRUE
    ON CONFLICT (code) DO NOTHING',
    v_schema_name);

  -- Clonar module_forms
  EXECUTE format('
    INSERT INTO %I.module_forms (module_id, form_slug, sort_order)
    SELECT tm.id, pmf.form_slug, pmf.sort_order
    FROM public.module_forms pmf
    INNER JOIN %I.modules tm ON tm.public_id = pmf.module_id
    ON CONFLICT (module_id, form_slug) DO NOTHING',
    v_schema_name, v_schema_name);

  -- Clonar module_roles
  EXECUTE format('
    INSERT INTO %I.module_roles (module_id, role_code, can_view, can_create, can_edit, can_delete)
    SELECT tm.id, pmr.role_code, pmr.can_view, pmr.can_create, pmr.can_edit, pmr.can_delete
    FROM public.module_roles pmr
    INNER JOIN %I.modules tm ON tm.public_id = pmr.module_id',
    v_schema_name, v_schema_name);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.role_permissions (
      role_id       UUID NOT NULL,
      permission_id UUID NOT NULL,
      CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_id),
      CONSTRAINT fk_rp_role       FOREIGN KEY (role_id)       REFERENCES %I.roles(id)       ON DELETE CASCADE,
      CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES %I.permissions(id) ON DELETE CASCADE
    )', v_schema_name, v_schema_name, v_schema_name);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.refresh_tokens (
      id            UUID         NOT NULL DEFAULT gen_random_uuid(),
      user_id       UUID         NOT NULL,
      token_hash    VARCHAR(255) NOT NULL,
      family        UUID         NOT NULL DEFAULT gen_random_uuid(),
      expires_at    TIMESTAMPTZ  NOT NULL,
      revoked_at    TIMESTAMPTZ,
      revoke_reason VARCHAR(50),
      ip_address    VARCHAR(45),
      user_agent    VARCHAR(500),
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT pk_refresh_tokens PRIMARY KEY (id),
      CONSTRAINT uq_rt_hash UNIQUE (token_hash),
      CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES %I.users(id) ON DELETE CASCADE
    )', v_schema_name, v_schema_name);

  EXECUTE format('
    CREATE INDEX IF NOT EXISTS idx_rt_valid
      ON %I.refresh_tokens (token_hash) WHERE revoked_at IS NULL',
    v_schema_name);

    -- 4. Crear tablas de formularios
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.forms (
        id          BIGINT       NOT NULL GENERATED ALWAYS AS IDENTITY,
        parent_id   BIGINT,
        slug        VARCHAR(100) NOT NULL,
        name        VARCHAR(255) NOT NULL,
        action      VARCHAR(255),
        json_form   JSONB        NOT NULL DEFAULT ''{}''::jsonb,
        grid_config JSONB NOT NULL DEFAULT ''[]''::jsonb,
        has_table   BOOLEAN      NOT NULL DEFAULT FALSE,
        has_sp      BOOLEAN      NOT NULL DEFAULT FALSE,
        table_name  VARCHAR(100),
        sp_name     VARCHAR(100),
        grid_query  TEXT,
        icon        VARCHAR(100),
        display_mode VARCHAR(20) NOT NULL DEFAULT ''modal'',
        modal_width  INT,
        is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
        created_by  UUID,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ,
        CONSTRAINT pk_forms PRIMARY KEY (id),
        CONSTRAINT uq_forms_slug UNIQUE (slug),
        CONSTRAINT fk_forms_parent FOREIGN KEY (parent_id) REFERENCES %I.forms(id),
        CONSTRAINT chk_forms_display_mode CHECK (display_mode IN (''modal'', ''inline''))
      )', v_schema_name, v_schema_name);

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.form_submissions (
        id            BIGINT      NOT NULL GENERATED ALWAYS AS IDENTITY,
        form_id       BIGINT      NOT NULL,
        submitted_by  UUID,
        data          JSONB       NOT NULL,
        metadata      JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_form_submissions PRIMARY KEY (id),
        CONSTRAINT fk_fs_form FOREIGN KEY (form_id) REFERENCES %I.forms(id)
      )', v_schema_name, v_schema_name);

    EXECUTE format('
      CREATE INDEX IF NOT EXISTS idx_forms_active
        ON %I.forms (is_system) WHERE deleted_at IS NULL',
      v_schema_name);

    EXECUTE format('
      CREATE INDEX IF NOT EXISTS idx_fs_form_id
        ON %I.form_submissions (form_id)',
      v_schema_name);

    -- 5. Seed: roles base
    EXECUTE format('
      INSERT INTO %I.roles (name, code, is_system) VALUES
        (''Administrador'', ''ADMIN'',     TRUE),
        (''Vendedor'',      ''SALES'',     TRUE),
        (''Almacenista'',   ''WAREHOUSE'', TRUE)
      ON CONFLICT (code) DO NOTHING',
      v_schema_name);

  -- 6. Actualizar tenants con el schema_name
  UPDATE public.tenants
    SET schema_name = v_schema_name
    WHERE id = p_tenant_id;

  RAISE NOTICE 'Schema % creado correctamente para tenant %', v_schema_name, p_tenant_id;
END;
$$ LANGUAGE plpgsql;