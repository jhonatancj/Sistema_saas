-- ============================================================
-- SISTEMA SAAS INVENTARIO Y VENTAS
-- Script: 03_schema_tenant.sql
-- Descripción: DDL completo del schema por tenant
--              Se ejecuta UNA VEZ por cada nuevo tenant
--              vía la función create_tenant_schema()
-- Motor: PostgreSQL 15+
-- ============================================================
--
-- USO:
--   SELECT create_tenant_schema('acme-corp', 'uuid-del-tenant');
--
-- Este script es la FUENTE DE VERDAD del schema de cada tenant.
-- La función create_tenant_schema() ejecuta estas sentencias
-- después de hacer SET search_path al schema recién creado.
--
-- CONVENCIONES:
--   - tenant_id UUID NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID
--     Se asigna automáticamente desde la variable de sesión PostgreSQL.
--     La aplicación ejecuta: SET app.current_tenant_id = '...';
--   - Todos los índices usan el prefijo del schema implícitamente (por search_path)
-- ============================================================


-- ============================================================
-- SECCIÓN 1: AUTH & USUARIOS
-- ============================================================

-- ── users ────────────────────────────────────────────────────
CREATE TABLE users (
  id                  UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  email               VARCHAR(255)  NOT NULL,
  password_hash       VARCHAR(255)  NOT NULL,
  first_name          VARCHAR(100)  NOT NULL,
  last_name           VARCHAR(100)  NOT NULL,
  phone               VARCHAR(30),
  avatar_url          VARCHAR(500),
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  email_verified_at   TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  login_attempts      SMALLINT      NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  created_by          UUID,

  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT uq_users_email
    UNIQUE (email, tenant_id),                   -- Partial enforced via app logic + check below
  CONSTRAINT chk_users_email
    CHECK (email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT chk_users_attempts
    CHECK (login_attempts >= 0)
);

-- Unique de email solo sobre registros activos (no eliminados)
CREATE UNIQUE INDEX uidx_users_email_active
  ON users (email, tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_users_tenant ON users (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_active ON users (is_active, tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_created_by ON users (created_by);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- RLS: un usuario solo puede ver datos de su tenant
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

COMMENT ON TABLE users IS 'Usuarios con acceso al sistema del tenant';
COMMENT ON COLUMN users.tenant_id IS 'Redundante con schema isolation — defensa en profundidad';
COMMENT ON COLUMN users.login_attempts IS 'Se resetea a 0 en login exitoso. Lockout tras 5 intentos.';


-- ── roles ────────────────────────────────────────────────────
CREATE TABLE roles (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  name        VARCHAR(100)  NOT NULL,
  code        VARCHAR(50)   NOT NULL,
  description TEXT,
  is_system   BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_roles PRIMARY KEY (id),
  CONSTRAINT uq_roles_code UNIQUE (code, tenant_id)
);

CREATE INDEX idx_roles_tenant ON roles (tenant_id) WHERE is_active = TRUE;

CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON COLUMN roles.is_system IS 'TRUE = roles pre-configurados del sistema, no editables por el tenant';


-- ── permissions ──────────────────────────────────────────────
-- Catálogo fijo, seed al crear el tenant, no editable por el tenant
CREATE TABLE permissions (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  module      VARCHAR(100)  NOT NULL,
  action      VARCHAR(50)   NOT NULL,
  resource    VARCHAR(100),
  code        VARCHAR(200)  NOT NULL,
  description VARCHAR(255),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_permissions PRIMARY KEY (id),
  CONSTRAINT uq_permissions_code UNIQUE (code)
);

CREATE INDEX idx_permissions_module ON permissions (module);
CREATE INDEX idx_permissions_code ON permissions (code);

COMMENT ON TABLE permissions IS 'Catálogo de permisos del sistema. Read-only para el tenant. Solo el Super Admin puede modificar.';
COMMENT ON COLUMN permissions.code IS 'Formato: {modulo}:{accion}[:{recurso}]. Ej: products:create, reports:export:financial';


-- ── user_roles ───────────────────────────────────────────────
CREATE TABLE user_roles (
  user_id     UUID        NOT NULL,
  role_id     UUID        NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID,

  CONSTRAINT pk_user_roles PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_assigned_by
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_roles_role ON user_roles (role_id);
CREATE INDEX idx_user_roles_user ON user_roles (user_id);


-- ── role_permissions ─────────────────────────────────────────
CREATE TABLE role_permissions (
  role_id         UUID    NOT NULL,
  permission_id   UUID    NOT NULL,

  CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);


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
  CONSTRAINT fk_refresh_tokens_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_rt_revoke_reason
    CHECK (revoke_reason IS NULL OR
           revoke_reason IN ('used','logout','security','expired','admin_revoke'))
);

CREATE INDEX idx_refresh_tokens_valid
  ON refresh_tokens (token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family);
CREATE INDEX idx_refresh_tokens_user   ON refresh_tokens (user_id, revoked_at);

COMMENT ON COLUMN refresh_tokens.family IS 'Familia de tokens para rotación. Si se detecta reutilización, revocar toda la familia.';


-- ── password_reset_tokens ────────────────────────────────────
CREATE TABLE password_reset_tokens (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  user_id     UUID          NOT NULL,
  token_hash  VARCHAR(255)  NOT NULL,
  expires_at  TIMESTAMPTZ   NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_password_reset PRIMARY KEY (id),
  CONSTRAINT fk_prt_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_prt_hash   ON password_reset_tokens (token_hash);
CREATE INDEX idx_prt_user   ON password_reset_tokens (user_id, used_at);
CREATE INDEX idx_prt_expiry ON password_reset_tokens (expires_at) WHERE used_at IS NULL;


-- ── audit_logs ───────────────────────────────────────────────
-- TABLA INMUTABLE — Solo INSERT, nunca UPDATE ni DELETE
CREATE TABLE audit_logs (
  id            UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  user_id       UUID,
  user_email    VARCHAR(255),
  action        VARCHAR(50)   NOT NULL,
  entity_type   VARCHAR(100)  NOT NULL,
  entity_id     UUID,
  entity_label  VARCHAR(255),
  old_values    JSONB,
  new_values    JSONB,
  ip_address    VARCHAR(45),
  user_agent    VARCHAR(500),
  request_id    UUID,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_audit_logs PRIMARY KEY (id, created_at),
  CONSTRAINT fk_audit_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_audit_action
    CHECK (action IN ('CREATE','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT',
                      'APPROVE','REJECT','CANCEL','VOID','RESTORE','VIEW'))
)
PARTITION BY RANGE (created_at);  -- Particionar por mes para tablas grandes

-- Particiones iniciales (crear particiones futuras con script periódico)
CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit_logs_2026_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_logs_2026_07 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_logs_2026_08 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_logs_default  PARTITION OF audit_logs DEFAULT;

CREATE INDEX idx_audit_entity   ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_user     ON audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_tenant   ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_action   ON audit_logs (action, created_at DESC);
CREATE INDEX idx_audit_date     ON audit_logs (created_at DESC);

COMMENT ON TABLE audit_logs IS 'Log inmutable de auditoría. Particionado por mes. Sin UPDATE ni DELETE.';


-- ============================================================
-- SECCIÓN 2: CONFIGURACIÓN
-- ============================================================

-- ── system_configurations ────────────────────────────────────
CREATE TABLE system_configurations (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  key         VARCHAR(150)  NOT NULL,
  value       TEXT,
  value_type  VARCHAR(20)   NOT NULL DEFAULT 'string'
              CONSTRAINT chk_config_type
                CHECK (value_type IN ('string','number','boolean','json','array')),
  "group"     VARCHAR(50)   NOT NULL DEFAULT 'general',
  label       VARCHAR(150),
  description TEXT,
  is_public   BOOLEAN       NOT NULL DEFAULT FALSE,
  is_readonly BOOLEAN       NOT NULL DEFAULT FALSE,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_system_configurations PRIMARY KEY (id),
  CONSTRAINT uq_system_configurations_key UNIQUE (key, tenant_id),
  CONSTRAINT fk_config_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_config_group  ON system_configurations ("group", tenant_id);
CREATE INDEX idx_config_tenant ON system_configurations (tenant_id);

COMMENT ON COLUMN system_configurations.key IS 'Ejemplos: general.company_name, invoice.prefix, inventory.allow_negative_stock';


-- ── currencies ────────────────────────────────────────────────
CREATE TABLE currencies (
  code            CHAR(3)         NOT NULL,
  name            VARCHAR(50)     NOT NULL,
  symbol          VARCHAR(5)      NOT NULL,
  decimal_places  SMALLINT        NOT NULL DEFAULT 2
                  CONSTRAINT chk_currency_decimals CHECK (decimal_places BETWEEN 0 AND 4),
  is_default      BOOLEAN         NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_currencies PRIMARY KEY (code)
);

-- Solo puede haber un currency default
CREATE UNIQUE INDEX uidx_currencies_default
  ON currencies (is_default)
  WHERE is_default = TRUE;

COMMENT ON TABLE currencies IS 'Catálogo de monedas disponibles para el tenant';


-- ── exchange_rates ────────────────────────────────────────────
CREATE TABLE exchange_rates (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  base_currency   CHAR(3)       NOT NULL,
  target_currency CHAR(3)       NOT NULL,
  rate            NUMERIC(18,8) NOT NULL
                  CONSTRAINT chk_exchange_rate_positive CHECK (rate > 0),
  rate_date       DATE          NOT NULL,
  source          VARCHAR(50)   DEFAULT 'manual',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_exchange_rates PRIMARY KEY (id),
  CONSTRAINT uq_exchange_rates UNIQUE (base_currency, target_currency, rate_date),
  CONSTRAINT fk_exchange_base
    FOREIGN KEY (base_currency) REFERENCES currencies(code),
  CONSTRAINT fk_exchange_target
    FOREIGN KEY (target_currency) REFERENCES currencies(code),
  CONSTRAINT chk_exchange_different
    CHECK (base_currency != target_currency)
);

CREATE INDEX idx_exchange_rates_lookup
  ON exchange_rates (base_currency, target_currency, rate_date DESC);


-- ── tax_rates ─────────────────────────────────────────────────
CREATE TABLE tax_rates (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  name        VARCHAR(100)  NOT NULL,
  code        VARCHAR(20)   NOT NULL,
  rate        NUMERIC(7,4)  NOT NULL
              CONSTRAINT chk_tax_rate_range CHECK (rate >= 0 AND rate <= 100),
  type        VARCHAR(20)   NOT NULL DEFAULT 'percentage'
              CONSTRAINT chk_tax_type CHECK (type IN ('percentage','fixed')),
  is_default  BOOLEAN       NOT NULL DEFAULT FALSE,
  applies_to  VARCHAR(20)   NOT NULL DEFAULT 'all'
              CONSTRAINT chk_tax_applies CHECK (applies_to IN ('all','products','services')),
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_tax_rates PRIMARY KEY (id),
  CONSTRAINT uq_tax_rates_code UNIQUE (code, tenant_id)
);

CREATE UNIQUE INDEX uidx_tax_rates_default
  ON tax_rates (tenant_id, is_default)
  WHERE is_default = TRUE;

CREATE TRIGGER trg_tax_rates_updated_at
  BEFORE UPDATE ON tax_rates
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── payment_terms ─────────────────────────────────────────────
CREATE TABLE payment_terms (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  name            VARCHAR(100)  NOT NULL,
  code            VARCHAR(20)   NOT NULL,
  days            INT           NOT NULL DEFAULT 0
                  CONSTRAINT chk_payment_terms_days CHECK (days >= 0),
  discount_pct    NUMERIC(7,4)  NOT NULL DEFAULT 0
                  CONSTRAINT chk_payment_terms_discount CHECK (discount_pct >= 0 AND discount_pct < 100),
  discount_days   INT           NOT NULL DEFAULT 0
                  CONSTRAINT chk_payment_terms_disc_days CHECK (discount_days >= 0),
  is_default      BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_payment_terms PRIMARY KEY (id),
  CONSTRAINT uq_payment_terms_code UNIQUE (code, tenant_id)
);


-- ── units_of_measure ─────────────────────────────────────────
CREATE TABLE units_of_measure (
  id                  UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  name                VARCHAR(50)   NOT NULL,
  abbreviation        VARCHAR(10)   NOT NULL,
  type                VARCHAR(20)   NOT NULL DEFAULT 'unit'
                      CONSTRAINT chk_uom_type
                        CHECK (type IN ('unit','weight','volume','length','area','time')),
  is_base             BOOLEAN       NOT NULL DEFAULT FALSE,
  conversion_factor   NUMERIC(15,8) NOT NULL DEFAULT 1
                      CONSTRAINT chk_uom_factor CHECK (conversion_factor > 0),
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_units_of_measure PRIMARY KEY (id),
  CONSTRAINT uq_uom_abbreviation UNIQUE (abbreviation, tenant_id)
);


-- ── document_sequences ────────────────────────────────────────
CREATE TABLE document_sequences (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  document_type   VARCHAR(50)   NOT NULL,
  prefix          VARCHAR(10)   NOT NULL DEFAULT '',
  suffix          VARCHAR(10),
  current_number  INT           NOT NULL DEFAULT 0
                  CONSTRAINT chk_doc_seq_positive CHECK (current_number >= 0),
  min_digits      SMALLINT      NOT NULL DEFAULT 6
                  CONSTRAINT chk_doc_seq_digits CHECK (min_digits BETWEEN 1 AND 10),
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_document_sequences PRIMARY KEY (id),
  CONSTRAINT uq_document_sequences UNIQUE (document_type, tenant_id)
);

COMMENT ON TABLE document_sequences IS 'Numeradores de documentos. Actualizar via fn_next_document_number() para garantizar atomicidad.';


-- ============================================================
-- SECCIÓN 3: ALMACENES
-- ============================================================

CREATE TABLE warehouses (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  code              VARCHAR(20)   NOT NULL,
  name              VARCHAR(150)  NOT NULL,
  address           TEXT,
  city              VARCHAR(100),
  state             VARCHAR(100),
  country_code      CHAR(2),
  postal_code       VARCHAR(20),
  phone             VARCHAR(30),
  email             VARCHAR(255),
  is_default        BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  allows_sales      BOOLEAN       NOT NULL DEFAULT TRUE,
  allows_purchases  BOOLEAN       NOT NULL DEFAULT TRUE,
  manager_id        UUID,
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  created_by        UUID,

  CONSTRAINT pk_warehouses PRIMARY KEY (id),
  CONSTRAINT fk_warehouses_manager
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_warehouses_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uidx_warehouses_code
  ON warehouses (code, tenant_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uidx_warehouses_default
  ON warehouses (tenant_id, is_default)
  WHERE is_default = TRUE AND deleted_at IS NULL;

CREATE INDEX idx_warehouses_tenant ON warehouses (tenant_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_warehouses_updated_at
  BEFORE UPDATE ON warehouses
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ============================================================
-- SECCIÓN 4: CATÁLOGO
-- ============================================================

-- ── categories ───────────────────────────────────────────────
CREATE TABLE categories (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  parent_id   UUID,
  code        VARCHAR(50)   NOT NULL,
  name        VARCHAR(150)  NOT NULL,
  description TEXT,
  image_url   VARCHAR(500),
  level       SMALLINT      NOT NULL DEFAULT 0,
  path        TEXT,
  sort_order  INT           NOT NULL DEFAULT 0,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,

  CONSTRAINT pk_categories PRIMARY KEY (id),
  CONSTRAINT fk_categories_parent
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uidx_categories_code
  ON categories (code, tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_categories_parent ON categories (parent_id);
CREATE INDEX idx_categories_path   ON categories (path) WHERE deleted_at IS NULL;
CREATE INDEX idx_categories_tenant ON categories (tenant_id, is_active) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON COLUMN categories.path IS 'Ruta materializada para queries de árbol: /uuid-raiz/uuid-sub/uuid-hoja';
COMMENT ON COLUMN categories.level IS '0 = categoría raíz, incrementa por nivel';


-- ── brands ────────────────────────────────────────────────────
CREATE TABLE brands (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  code        VARCHAR(50)   NOT NULL,
  name        VARCHAR(150)  NOT NULL,
  logo_url    VARCHAR(500),
  website     VARCHAR(255),
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,

  CONSTRAINT pk_brands PRIMARY KEY (id)
);

CREATE UNIQUE INDEX uidx_brands_code
  ON brands (code, tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_brands_tenant ON brands (tenant_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_brands_updated_at
  BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── attributes ───────────────────────────────────────────────
CREATE TABLE attributes (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  name        VARCHAR(100)  NOT NULL,
  code        VARCHAR(50)   NOT NULL,
  type        VARCHAR(20)   NOT NULL DEFAULT 'text'
              CONSTRAINT chk_attributes_type CHECK (type IN ('text','color','number','boolean')),
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order  INT           NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_attributes PRIMARY KEY (id),
  CONSTRAINT uq_attributes_code UNIQUE (code, tenant_id)
);


-- ── attribute_values ─────────────────────────────────────────
CREATE TABLE attribute_values (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  attribute_id    UUID          NOT NULL,
  value           VARCHAR(100)  NOT NULL,
  code            VARCHAR(50)   NOT NULL,
  color_hex       CHAR(7),
  sort_order      INT           NOT NULL DEFAULT 0,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,

  CONSTRAINT pk_attribute_values PRIMARY KEY (id),
  CONSTRAINT fk_attr_values_attribute
    FOREIGN KEY (attribute_id) REFERENCES attributes(id) ON DELETE CASCADE,
  CONSTRAINT uq_attr_values_code UNIQUE (attribute_id, code),
  CONSTRAINT chk_attr_color_hex
    CHECK (color_hex IS NULL OR color_hex ~* '^#[0-9A-Fa-f]{6}$')
);

CREATE INDEX idx_attr_values_attribute ON attribute_values (attribute_id);


-- ── products ─────────────────────────────────────────────────
CREATE TABLE products (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  code              VARCHAR(50)   NOT NULL,
  sku               VARCHAR(100),
  barcode           VARCHAR(100),
  name              VARCHAR(255)  NOT NULL,
  description       TEXT,
  short_description VARCHAR(500),
  category_id       UUID          NOT NULL,
  brand_id          UUID,
  unit_id           UUID          NOT NULL,
  tax_rate_id       UUID,
  type              VARCHAR(20)   NOT NULL DEFAULT 'product'
                    CONSTRAINT chk_products_type
                      CHECK (type IN ('product','service','kit','digital')),
  track_inventory   BOOLEAN       NOT NULL DEFAULT TRUE,
  min_stock         NUMERIC(15,4) NOT NULL DEFAULT 0,
  max_stock         NUMERIC(15,4),
  reorder_point     NUMERIC(15,4) NOT NULL DEFAULT 0,
  cost_price        NUMERIC(15,4) NOT NULL DEFAULT 0
                    CONSTRAINT chk_products_cost CHECK (cost_price >= 0),
  sale_price        NUMERIC(15,4) NOT NULL DEFAULT 0
                    CONSTRAINT chk_products_sale CHECK (sale_price >= 0),
  has_variants      BOOLEAN       NOT NULL DEFAULT FALSE,
  weight            NUMERIC(10,4),
  image_url         VARCHAR(500),
  notes             TEXT,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  is_featured       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  created_by        UUID,
  updated_by        UUID,

  CONSTRAINT pk_products PRIMARY KEY (id),
  CONSTRAINT fk_products_category
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_products_brand
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
  CONSTRAINT fk_products_unit
    FOREIGN KEY (unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  CONSTRAINT fk_products_tax
    FOREIGN KEY (tax_rate_id) REFERENCES tax_rates(id) ON DELETE SET NULL,
  CONSTRAINT fk_products_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_products_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uidx_products_code
  ON products (code, tenant_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uidx_products_sku
  ON products (sku, tenant_id)
  WHERE sku IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_products_barcode  ON products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_products_category ON products (category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_brand    ON products (brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX idx_products_tenant   ON products (tenant_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_type     ON products (type, tenant_id) WHERE deleted_at IS NULL;

-- Índice para búsqueda de texto (requiere extensión pg_trgm)
CREATE INDEX idx_products_name_trgm
  ON products USING GIN (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON COLUMN products.track_inventory IS 'FALSE para servicios y productos digitales que no requieren control de stock';


-- ── product_variants ─────────────────────────────────────────
CREATE TABLE product_variants (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  product_id  UUID          NOT NULL,
  sku         VARCHAR(100)  NOT NULL,
  barcode     VARCHAR(100),
  name        VARCHAR(255),
  attributes  JSONB         NOT NULL DEFAULT '{}',
  cost_price  NUMERIC(15,4) NOT NULL DEFAULT 0
              CONSTRAINT chk_variants_cost CHECK (cost_price >= 0),
  sale_price  NUMERIC(15,4) NOT NULL DEFAULT 0
              CONSTRAINT chk_variants_sale CHECK (sale_price >= 0),
  weight      NUMERIC(10,4),
  image_url   VARCHAR(500),
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order  INT           NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_product_variants PRIMARY KEY (id),
  CONSTRAINT fk_variants_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uidx_variants_sku
  ON product_variants (sku, tenant_id)
  WHERE is_active = TRUE;

CREATE INDEX idx_variants_product    ON product_variants (product_id);
CREATE INDEX idx_variants_attributes ON product_variants USING GIN (attributes);

CREATE TRIGGER trg_variants_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── price_lists ───────────────────────────────────────────────
CREATE TABLE price_lists (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  name            VARCHAR(100)  NOT NULL,
  code            VARCHAR(30)   NOT NULL,
  currency_code   CHAR(3)       NOT NULL DEFAULT 'USD',
  is_default      BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_price_lists PRIMARY KEY (id),
  CONSTRAINT uq_price_lists_code UNIQUE (code, tenant_id),
  CONSTRAINT fk_price_lists_currency
    FOREIGN KEY (currency_code) REFERENCES currencies(code)
);

CREATE UNIQUE INDEX uidx_price_lists_default
  ON price_lists (tenant_id, is_default)
  WHERE is_default = TRUE;


-- ── product_prices ────────────────────────────────────────────
CREATE TABLE product_prices (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  price_list_id   UUID          NOT NULL,
  price           NUMERIC(15,4) NOT NULL
                  CONSTRAINT chk_product_prices_price CHECK (price >= 0),
  min_quantity    NUMERIC(15,4) NOT NULL DEFAULT 1
                  CONSTRAINT chk_product_prices_qty CHECK (min_quantity > 0),
  valid_from      DATE          NOT NULL DEFAULT CURRENT_DATE,
  valid_to        DATE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by      UUID,

  CONSTRAINT pk_product_prices PRIMARY KEY (id),
  CONSTRAINT fk_pp_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_pp_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
  CONSTRAINT fk_pp_price_list
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE,
  CONSTRAINT fk_pp_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_pp_dates
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX idx_product_prices_product
  ON product_prices (product_id, price_list_id, valid_from DESC);
CREATE INDEX idx_product_prices_variant
  ON product_prices (variant_id, price_list_id) WHERE variant_id IS NOT NULL;
CREATE INDEX idx_product_prices_validity
  ON product_prices (valid_from, valid_to);


-- ── product_images ────────────────────────────────────────────
CREATE TABLE product_images (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  product_id  UUID          NOT NULL,
  variant_id  UUID,
  url         VARCHAR(500)  NOT NULL,
  alt_text    VARCHAR(255),
  sort_order  INT           NOT NULL DEFAULT 0,
  is_primary  BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_product_images PRIMARY KEY (id),
  CONSTRAINT fk_pi_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
);

CREATE INDEX idx_product_images_product ON product_images (product_id, sort_order);


-- ============================================================
-- SECCIÓN 5: CONTACTOS (PROVEEDORES Y CLIENTES)
-- ============================================================

-- ── suppliers ─────────────────────────────────────────────────
CREATE TABLE suppliers (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  code              VARCHAR(30)   NOT NULL,
  name              VARCHAR(255)  NOT NULL,
  trade_name        VARCHAR(255),
  tax_id            VARCHAR(50),
  email             VARCHAR(255),
  phone             VARCHAR(30),
  website           VARCHAR(255),
  address           TEXT,
  city              VARCHAR(100),
  state             VARCHAR(100),
  country_code      CHAR(2),
  postal_code       VARCHAR(20),
  currency_code     CHAR(3)       NOT NULL DEFAULT 'USD',
  payment_term_id   UUID,
  credit_limit      NUMERIC(15,4) NOT NULL DEFAULT 0,
  credit_days       INT           NOT NULL DEFAULT 0,
  bank_name         VARCHAR(100),
  bank_account      VARCHAR(50),
  bank_routing      VARCHAR(50),
  notes             TEXT,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  created_by        UUID,

  CONSTRAINT pk_suppliers PRIMARY KEY (id),
  CONSTRAINT fk_suppliers_currency
    FOREIGN KEY (currency_code) REFERENCES currencies(code),
  CONSTRAINT fk_suppliers_payment_term
    FOREIGN KEY (payment_term_id) REFERENCES payment_terms(id) ON DELETE SET NULL,
  CONSTRAINT fk_suppliers_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uidx_suppliers_code
  ON suppliers (code, tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_suppliers_tenant ON suppliers (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_suppliers_tax_id ON suppliers (tax_id) WHERE tax_id IS NOT NULL;
CREATE INDEX idx_suppliers_name_trgm
  ON suppliers USING GIN (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── supplier_contacts ─────────────────────────────────────────
CREATE TABLE supplier_contacts (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  supplier_id UUID          NOT NULL,
  name        VARCHAR(150)  NOT NULL,
  position    VARCHAR(100),
  email       VARCHAR(255),
  phone       VARCHAR(30),
  is_primary  BOOLEAN       NOT NULL DEFAULT FALSE,
  notes       TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_supplier_contacts PRIMARY KEY (id),
  CONSTRAINT fk_sc_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
);

CREATE INDEX idx_sc_supplier ON supplier_contacts (supplier_id);


-- ── customers ─────────────────────────────────────────────────
CREATE TABLE customers (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  code              VARCHAR(30)   NOT NULL,
  type              VARCHAR(20)   NOT NULL DEFAULT 'company'
                    CONSTRAINT chk_customers_type CHECK (type IN ('person','company')),
  name              VARCHAR(255)  NOT NULL,
  trade_name        VARCHAR(255),
  tax_id            VARCHAR(50),
  email             VARCHAR(255),
  phone             VARCHAR(30),
  website           VARCHAR(255),
  address           TEXT,
  city              VARCHAR(100),
  state             VARCHAR(100),
  country_code      CHAR(2),
  postal_code       VARCHAR(20),
  currency_code     CHAR(3)       NOT NULL DEFAULT 'USD',
  price_list_id     UUID,
  payment_term_id   UUID,
  credit_limit      NUMERIC(15,4) NOT NULL DEFAULT 0,
  credit_days       INT           NOT NULL DEFAULT 0,
  credit_used       NUMERIC(15,4) NOT NULL DEFAULT 0,
  notes             TEXT,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  created_by        UUID,

  CONSTRAINT pk_customers PRIMARY KEY (id),
  CONSTRAINT fk_customers_currency
    FOREIGN KEY (currency_code) REFERENCES currencies(code),
  CONSTRAINT fk_customers_price_list
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE SET NULL,
  CONSTRAINT fk_customers_payment_term
    FOREIGN KEY (payment_term_id) REFERENCES payment_terms(id) ON DELETE SET NULL,
  CONSTRAINT fk_customers_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_customers_credit
    CHECK (credit_limit >= 0 AND credit_used >= 0)
);

CREATE UNIQUE INDEX uidx_customers_code
  ON customers (code, tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_customers_tenant ON customers (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_tax_id ON customers (tax_id) WHERE tax_id IS NOT NULL;
CREATE INDEX idx_customers_name_trgm
  ON customers USING GIN (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── customer_contacts ─────────────────────────────────────────
CREATE TABLE customer_contacts (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  customer_id UUID          NOT NULL,
  name        VARCHAR(150)  NOT NULL,
  position    VARCHAR(100),
  email       VARCHAR(255),
  phone       VARCHAR(30),
  is_primary  BOOLEAN       NOT NULL DEFAULT FALSE,
  notes       TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_customer_contacts PRIMARY KEY (id),
  CONSTRAINT fk_cc_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX idx_cc_customer ON customer_contacts (customer_id);


-- ── customer_addresses ────────────────────────────────────────
CREATE TABLE customer_addresses (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  customer_id     UUID          NOT NULL,
  address_type    VARCHAR(20)   NOT NULL DEFAULT 'shipping'
                  CONSTRAINT chk_addr_type CHECK (address_type IN ('billing','shipping','other')),
  name            VARCHAR(100),
  address         TEXT          NOT NULL,
  city            VARCHAR(100),
  state           VARCHAR(100),
  country_code    CHAR(2),
  postal_code     VARCHAR(20),
  phone           VARCHAR(30),
  is_default      BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_customer_addresses PRIMARY KEY (id),
  CONSTRAINT fk_ca_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX idx_ca_customer ON customer_addresses (customer_id, address_type);


-- ============================================================
-- SECCIÓN 6: INVENTARIO
-- ============================================================

-- ── stocks ────────────────────────────────────────────────────
-- Estado actual del stock — actualizado por triggers en stock_movements
CREATE TABLE stocks (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  warehouse_id    UUID          NOT NULL,
  quantity        NUMERIC(15,4) NOT NULL DEFAULT 0,
  reserved_qty    NUMERIC(15,4) NOT NULL DEFAULT 0,
  available_qty   NUMERIC(15,4) NOT NULL DEFAULT 0,  -- quantity - reserved_qty (trigger)
  avg_cost        NUMERIC(15,4) NOT NULL DEFAULT 0,
  last_movement_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_stocks PRIMARY KEY (id),
  CONSTRAINT uq_stocks_location UNIQUE (product_id, warehouse_id, variant_id),
  CONSTRAINT fk_stocks_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stocks_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stocks_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT chk_stocks_qty
    CHECK (quantity >= 0 AND reserved_qty >= 0)
  -- Nota: available_qty puede ser negativo si se permite stock negativo.
  -- Controlar via system_configurations: inventory.allow_negative_stock
);

CREATE INDEX idx_stocks_product    ON stocks (product_id);
CREATE INDEX idx_stocks_warehouse  ON stocks (warehouse_id);
CREATE INDEX idx_stocks_available
  ON stocks (product_id, warehouse_id)
  WHERE available_qty > 0;
CREATE INDEX idx_stocks_below_min
  ON stocks (product_id, tenant_id, quantity);

-- Trigger: mantener available_qty actualizado
CREATE OR REPLACE FUNCTION fn_update_available_qty()
RETURNS TRIGGER AS $$
BEGIN
  NEW.available_qty := NEW.quantity - NEW.reserved_qty;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stocks_available_qty
  BEFORE INSERT OR UPDATE OF quantity, reserved_qty ON stocks
  FOR EACH ROW EXECUTE FUNCTION fn_update_available_qty();

COMMENT ON TABLE stocks IS 'Estado actual de stock. Actualizado por trigger al insertar en stock_movements.';
COMMENT ON COLUMN stocks.avg_cost IS 'Costo promedio ponderado. Recalculado con cada entrada de mercancía.';


-- ── stock_movements ───────────────────────────────────────────
-- TABLA INMUTABLE: Solo INSERT. Fuente de verdad del inventario.
CREATE TABLE stock_movements (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  warehouse_id    UUID          NOT NULL,
  type            VARCHAR(30)   NOT NULL
                  CONSTRAINT chk_sm_type CHECK (type IN (
                    'PURCHASE_RECEIPT','SALE_DISPATCH','TRANSFER_IN','TRANSFER_OUT',
                    'ADJUSTMENT_IN','ADJUSTMENT_OUT','RETURN_CUSTOMER','RETURN_SUPPLIER',
                    'OPENING_BALANCE','DAMAGE','EXPIRY'
                  )),
  direction       CHAR(3)       NOT NULL
                  CONSTRAINT chk_sm_direction CHECK (direction IN ('IN','OUT')),
  quantity        NUMERIC(15,4) NOT NULL
                  CONSTRAINT chk_sm_qty_positive CHECK (quantity > 0),
  unit_cost       NUMERIC(15,4) NOT NULL DEFAULT 0,
  total_cost      NUMERIC(15,4) NOT NULL DEFAULT 0,
  stock_before    NUMERIC(15,4) NOT NULL,
  stock_after     NUMERIC(15,4) NOT NULL,
  reference_type  VARCHAR(50),
  reference_id    UUID,
  lot_number      VARCHAR(50),
  expiry_date     DATE,
  notes           TEXT,
  created_by      UUID          NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_stock_movements PRIMARY KEY (id, created_at),
  CONSTRAINT fk_sm_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sm_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sm_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sm_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
)
PARTITION BY RANGE (created_at);

-- Particiones por semestre (movimientos son muy frecuentes)
CREATE TABLE stock_movements_2026_s1 PARTITION OF stock_movements
  FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE stock_movements_2026_s2 PARTITION OF stock_movements
  FOR VALUES FROM ('2026-07-01') TO ('2027-01-01');
CREATE TABLE stock_movements_default PARTITION OF stock_movements DEFAULT;

CREATE INDEX idx_sm_product_warehouse
  ON stock_movements (product_id, warehouse_id, created_at DESC);
CREATE INDEX idx_sm_reference
  ON stock_movements (reference_type, reference_id) WHERE reference_type IS NOT NULL;
CREATE INDEX idx_sm_tenant_date
  ON stock_movements (tenant_id, created_at DESC);
CREATE INDEX idx_sm_type
  ON stock_movements (type, created_at DESC);

-- Trigger: actualizar stocks table después de cada movimiento
CREATE OR REPLACE FUNCTION fn_update_stock_after_movement()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO stocks (product_id, variant_id, warehouse_id, tenant_id, quantity, avg_cost, last_movement_at)
  VALUES (NEW.product_id, NEW.variant_id, NEW.warehouse_id, NEW.tenant_id, 0, 0, NOW())
  ON CONFLICT (product_id, warehouse_id, variant_id) DO NOTHING;

  IF NEW.direction = 'IN' THEN
    UPDATE stocks
    SET
      avg_cost = CASE
        WHEN quantity + NEW.quantity = 0 THEN 0
        ELSE (quantity * avg_cost + NEW.quantity * NEW.unit_cost) / (quantity + NEW.quantity)
      END,
      quantity = quantity + NEW.quantity,
      last_movement_at = NOW()
    WHERE product_id = NEW.product_id
      AND warehouse_id = NEW.warehouse_id
      AND (variant_id = NEW.variant_id OR (variant_id IS NULL AND NEW.variant_id IS NULL));
  ELSE
    UPDATE stocks
    SET
      quantity = quantity - NEW.quantity,
      last_movement_at = NOW()
    WHERE product_id = NEW.product_id
      AND warehouse_id = NEW.warehouse_id
      AND (variant_id = NEW.variant_id OR (variant_id IS NULL AND NEW.variant_id IS NULL));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_update_stocks
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_update_stock_after_movement();

COMMENT ON TABLE stock_movements IS 'Ledger inmutable. Solo INSERT. stock_before/stock_after son snapshots al momento del movimiento.';


-- ── stock_transfers ───────────────────────────────────────────
CREATE TABLE stock_transfers (
  id                  UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  transfer_number     VARCHAR(30)   NOT NULL,
  from_warehouse_id   UUID          NOT NULL,
  to_warehouse_id     UUID          NOT NULL,
  status              VARCHAR(20)   NOT NULL DEFAULT 'draft'
                      CONSTRAINT chk_st_status
                        CHECK (status IN ('draft','approved','shipped','received','cancelled')),
  notes               TEXT,
  requested_by        UUID          NOT NULL,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  shipped_by          UUID,
  shipped_at          TIMESTAMPTZ,
  received_by         UUID,
  received_at         TIMESTAMPTZ,
  cancelled_by        UUID,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_stock_transfers PRIMARY KEY (id),
  CONSTRAINT uq_st_number UNIQUE (transfer_number, tenant_id),
  CONSTRAINT fk_st_from_warehouse
    FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_st_to_warehouse
    FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_st_requested_by
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_st_approved_by
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_st_shipped_by
    FOREIGN KEY (shipped_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_st_received_by
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_st_different_warehouses
    CHECK (from_warehouse_id != to_warehouse_id)
);

CREATE INDEX idx_st_tenant    ON stock_transfers (tenant_id, status, created_at DESC);
CREATE INDEX idx_st_from_wh   ON stock_transfers (from_warehouse_id);
CREATE INDEX idx_st_to_wh     ON stock_transfers (to_warehouse_id);

CREATE TRIGGER trg_st_updated_at
  BEFORE UPDATE ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── stock_transfer_items ──────────────────────────────────────
CREATE TABLE stock_transfer_items (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  transfer_id     UUID          NOT NULL,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  requested_qty   NUMERIC(15,4) NOT NULL
                  CONSTRAINT chk_sti_requested CHECK (requested_qty > 0),
  shipped_qty     NUMERIC(15,4)
                  CONSTRAINT chk_sti_shipped CHECK (shipped_qty IS NULL OR shipped_qty >= 0),
  received_qty    NUMERIC(15,4)
                  CONSTRAINT chk_sti_received CHECK (received_qty IS NULL OR received_qty >= 0),
  notes           TEXT,

  CONSTRAINT pk_stock_transfer_items PRIMARY KEY (id),
  CONSTRAINT fk_sti_transfer
    FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
  CONSTRAINT fk_sti_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sti_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT
);

CREATE INDEX idx_sti_transfer ON stock_transfer_items (transfer_id);


-- ── inventory_adjustments ─────────────────────────────────────
CREATE TABLE inventory_adjustments (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  adjustment_number VARCHAR(30)   NOT NULL,
  warehouse_id      UUID          NOT NULL,
  type              VARCHAR(20)   NOT NULL
                    CONSTRAINT chk_ia_type
                      CHECK (type IN ('physical_count','damage','expiry','correction','opening','theft')),
  status            VARCHAR(20)   NOT NULL DEFAULT 'draft'
                    CONSTRAINT chk_ia_status
                      CHECK (status IN ('draft','approved','applied','cancelled')),
  reason            TEXT,
  notes             TEXT,
  created_by        UUID          NOT NULL,
  approved_by       UUID,
  approved_at       TIMESTAMPTZ,
  applied_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_inventory_adjustments PRIMARY KEY (id),
  CONSTRAINT uq_ia_number UNIQUE (adjustment_number, tenant_id),
  CONSTRAINT fk_ia_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ia_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ia_approved_by
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_ia_tenant ON inventory_adjustments (tenant_id, status, created_at DESC);

CREATE TRIGGER trg_ia_updated_at
  BEFORE UPDATE ON inventory_adjustments
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── inventory_adjustment_items ────────────────────────────────
CREATE TABLE inventory_adjustment_items (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  adjustment_id   UUID          NOT NULL,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  system_qty      NUMERIC(15,4) NOT NULL,
  physical_qty    NUMERIC(15,4) NOT NULL,
  difference_qty  NUMERIC(15,4) NOT NULL,
  unit_cost       NUMERIC(15,4) NOT NULL DEFAULT 0,
  notes           TEXT,

  CONSTRAINT pk_iai PRIMARY KEY (id),
  CONSTRAINT fk_iai_adjustment
    FOREIGN KEY (adjustment_id) REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
  CONSTRAINT fk_iai_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_iai_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT
);

CREATE INDEX idx_iai_adjustment ON inventory_adjustment_items (adjustment_id);


-- ============================================================
-- SECCIÓN 7: VENTAS
-- ============================================================

-- ── quotations ────────────────────────────────────────────────
CREATE TABLE quotations (
  id                      UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  quote_number            VARCHAR(30)   NOT NULL,
  customer_id             UUID          NOT NULL,
  warehouse_id            UUID,
  price_list_id           UUID,
  currency_code           CHAR(3)       NOT NULL DEFAULT 'USD',
  exchange_rate           NUMERIC(10,6) NOT NULL DEFAULT 1,
  status                  VARCHAR(20)   NOT NULL DEFAULT 'draft'
                          CONSTRAINT chk_quo_status
                            CHECK (status IN ('draft','sent','viewed','approved','rejected','converted','expired')),
  subtotal                NUMERIC(15,4) NOT NULL DEFAULT 0,
  discount_amount         NUMERIC(15,4) NOT NULL DEFAULT 0,
  tax_amount              NUMERIC(15,4) NOT NULL DEFAULT 0,
  total                   NUMERIC(15,4) NOT NULL DEFAULT 0,
  valid_until             DATE,
  notes                   TEXT,
  terms                   TEXT,
  converted_to_order_id   UUID,
  converted_at            TIMESTAMPTZ,
  created_by              UUID          NOT NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,

  CONSTRAINT pk_quotations PRIMARY KEY (id),
  CONSTRAINT uq_quotations_number UNIQUE (quote_number, tenant_id),
  CONSTRAINT fk_quo_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_quo_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL,
  CONSTRAINT fk_quo_price_list
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE SET NULL,
  CONSTRAINT fk_quo_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_quo_totals
    CHECK (subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total >= 0),
  CONSTRAINT chk_quo_exchange_rate
    CHECK (exchange_rate > 0)
);

CREATE INDEX idx_quo_customer  ON quotations (customer_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_quo_status    ON quotations (status, tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_quo_valid     ON quotations (valid_until) WHERE status = 'sent' AND deleted_at IS NULL;

CREATE TRIGGER trg_quo_updated_at
  BEFORE UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── quotation_items ───────────────────────────────────────────
CREATE TABLE quotation_items (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  quotation_id    UUID          NOT NULL,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  description     VARCHAR(500)  NOT NULL,
  quantity        NUMERIC(15,4) NOT NULL CONSTRAINT chk_qi_qty CHECK (quantity > 0),
  unit_price      NUMERIC(15,4) NOT NULL CONSTRAINT chk_qi_price CHECK (unit_price >= 0),
  discount_pct    NUMERIC(7,4)  NOT NULL DEFAULT 0,
  discount_amount NUMERIC(15,4) NOT NULL DEFAULT 0,
  tax_rate_id     UUID,
  tax_rate        NUMERIC(7,4)  NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(15,4) NOT NULL DEFAULT 0,
  total           NUMERIC(15,4) NOT NULL DEFAULT 0,
  sort_order      INT           NOT NULL DEFAULT 0,
  notes           TEXT,

  CONSTRAINT pk_quotation_items PRIMARY KEY (id),
  CONSTRAINT fk_qi_quotation
    FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
  CONSTRAINT fk_qi_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_qi_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT,
  CONSTRAINT fk_qi_tax_rate
    FOREIGN KEY (tax_rate_id) REFERENCES tax_rates(id) ON DELETE SET NULL,
  CONSTRAINT chk_qi_discount
    CHECK (discount_pct >= 0 AND discount_pct <= 100)
);

CREATE INDEX idx_qi_quotation ON quotation_items (quotation_id);


-- ── sales_orders ──────────────────────────────────────────────
CREATE TABLE sales_orders (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  order_number      VARCHAR(30)   NOT NULL,
  quotation_id      UUID,
  customer_id       UUID          NOT NULL,
  warehouse_id      UUID          NOT NULL,
  price_list_id     UUID,
  payment_term_id   UUID,
  currency_code     CHAR(3)       NOT NULL DEFAULT 'USD',
  exchange_rate     NUMERIC(10,6) NOT NULL DEFAULT 1,
  status            VARCHAR(20)   NOT NULL DEFAULT 'draft'
                    CONSTRAINT chk_so_status
                      CHECK (status IN ('draft','confirmed','processing','shipped','completed','cancelled')),
  subtotal          NUMERIC(15,4) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(15,4) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(15,4) NOT NULL DEFAULT 0,
  total             NUMERIC(15,4) NOT NULL DEFAULT 0,
  delivery_date     DATE,
  delivery_address  TEXT,
  notes             TEXT,
  terms             TEXT,
  created_by        UUID          NOT NULL,
  confirmed_by      UUID,
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,

  CONSTRAINT pk_sales_orders PRIMARY KEY (id),
  CONSTRAINT uq_so_number UNIQUE (order_number, tenant_id),
  CONSTRAINT fk_so_quotation
    FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE SET NULL,
  CONSTRAINT fk_so_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_so_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_so_price_list
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE SET NULL,
  CONSTRAINT fk_so_payment_term
    FOREIGN KEY (payment_term_id) REFERENCES payment_terms(id) ON DELETE SET NULL,
  CONSTRAINT fk_so_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_so_confirmed_by
    FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_so_customer ON sales_orders (customer_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_so_status   ON sales_orders (status, tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_so_date     ON sales_orders (created_at DESC, tenant_id);

CREATE TRIGGER trg_so_updated_at
  BEFORE UPDATE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── sales_order_items ─────────────────────────────────────────
CREATE TABLE sales_order_items (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  order_id        UUID          NOT NULL,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  description     VARCHAR(500)  NOT NULL,
  quantity        NUMERIC(15,4) NOT NULL CONSTRAINT chk_soi_qty CHECK (quantity > 0),
  unit_price      NUMERIC(15,4) NOT NULL CONSTRAINT chk_soi_price CHECK (unit_price >= 0),
  discount_pct    NUMERIC(7,4)  NOT NULL DEFAULT 0,
  discount_amount NUMERIC(15,4) NOT NULL DEFAULT 0,
  tax_rate_id     UUID,
  tax_rate        NUMERIC(7,4)  NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(15,4) NOT NULL DEFAULT 0,
  total           NUMERIC(15,4) NOT NULL DEFAULT 0,
  shipped_qty     NUMERIC(15,4) NOT NULL DEFAULT 0,
  invoiced_qty    NUMERIC(15,4) NOT NULL DEFAULT 0,
  sort_order      INT           NOT NULL DEFAULT 0,
  notes           TEXT,

  CONSTRAINT pk_sales_order_items PRIMARY KEY (id),
  CONSTRAINT fk_soi_order
    FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_soi_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_soi_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT,
  CONSTRAINT fk_soi_tax
    FOREIGN KEY (tax_rate_id) REFERENCES tax_rates(id) ON DELETE SET NULL
);

CREATE INDEX idx_soi_order ON sales_order_items (order_id);


-- ── deliveries ────────────────────────────────────────────────
CREATE TABLE deliveries (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  delivery_number VARCHAR(30)   NOT NULL,
  order_id        UUID          NOT NULL,
  warehouse_id    UUID          NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'draft'
                  CONSTRAINT chk_del_status
                    CHECK (status IN ('draft','ready','shipped','delivered','cancelled')),
  carrier         VARCHAR(100),
  tracking_number VARCHAR(100),
  delivery_address TEXT,
  notes           TEXT,
  dispatched_by   UUID,
  dispatched_at   TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_by      UUID          NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_deliveries PRIMARY KEY (id),
  CONSTRAINT uq_del_number UNIQUE (delivery_number, tenant_id),
  CONSTRAINT fk_del_order
    FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_del_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_del_dispatched_by
    FOREIGN KEY (dispatched_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_del_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_del_order ON deliveries (order_id);

CREATE TRIGGER trg_del_updated_at
  BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── delivery_items ────────────────────────────────────────────
CREATE TABLE delivery_items (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  delivery_id     UUID          NOT NULL,
  order_item_id   UUID          NOT NULL,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  quantity        NUMERIC(15,4) NOT NULL CONSTRAINT chk_di_qty CHECK (quantity > 0),

  CONSTRAINT pk_delivery_items PRIMARY KEY (id),
  CONSTRAINT fk_di_delivery
    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  CONSTRAINT fk_di_order_item
    FOREIGN KEY (order_item_id) REFERENCES sales_order_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_di_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX idx_di_delivery ON delivery_items (delivery_id);


-- ── invoices ──────────────────────────────────────────────────
CREATE TABLE invoices (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  invoice_number  VARCHAR(30)   NOT NULL,
  series          VARCHAR(10),
  type            VARCHAR(20)   NOT NULL DEFAULT 'invoice'
                  CONSTRAINT chk_inv_type
                    CHECK (type IN ('invoice','credit_note','debit_note')),
  order_id        UUID,
  customer_id     UUID          NOT NULL,
  currency_code   CHAR(3)       NOT NULL DEFAULT 'USD',
  exchange_rate   NUMERIC(10,6) NOT NULL DEFAULT 1,
  status          VARCHAR(20)   NOT NULL DEFAULT 'draft'
                  CONSTRAINT chk_inv_status
                    CHECK (status IN ('draft','issued','partially_paid','paid','overdue','cancelled','voided')),
  subtotal        NUMERIC(15,4) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(15,4) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,
  total           NUMERIC(15,4) NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(15,4) NOT NULL DEFAULT 0,
  balance         NUMERIC(15,4) NOT NULL DEFAULT 0,   -- trigger: total - paid_amount
  payment_term_id UUID,
  issue_date      DATE          NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE          NOT NULL,
  notes           TEXT,
  terms           TEXT,
  electronic_ref  VARCHAR(100),
  voided_reason   TEXT,
  created_by      UUID          NOT NULL,
  issued_by       UUID,
  issued_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_invoices PRIMARY KEY (id),
  CONSTRAINT uq_inv_number UNIQUE (invoice_number, tenant_id),
  CONSTRAINT fk_inv_order
    FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inv_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inv_payment_term
    FOREIGN KEY (payment_term_id) REFERENCES payment_terms(id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inv_issued_by
    FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_inv_totals
    CHECK (subtotal >= 0 AND total >= 0 AND paid_amount >= 0),
  CONSTRAINT chk_inv_due_date
    CHECK (due_date >= issue_date)
);

CREATE INDEX idx_inv_customer  ON invoices (customer_id, created_at DESC);
CREATE INDEX idx_inv_status    ON invoices (status, tenant_id);
CREATE INDEX idx_inv_due       ON invoices (due_date, tenant_id)
  WHERE status NOT IN ('paid','cancelled','voided');
CREATE INDEX idx_inv_overdue   ON invoices (due_date, customer_id)
  WHERE status IN ('issued','partially_paid');
CREATE INDEX idx_inv_date      ON invoices (issue_date DESC, tenant_id);

-- Trigger: mantener balance actualizado
CREATE OR REPLACE FUNCTION fn_update_invoice_balance()
RETURNS TRIGGER AS $$
BEGIN
  NEW.balance := NEW.total - NEW.paid_amount;
  IF NEW.balance <= 0 AND NEW.status = 'partially_paid' THEN
    NEW.status := 'paid';
  ELSIF NEW.paid_amount > 0 AND NEW.status = 'issued' THEN
    NEW.status := 'partially_paid';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_balance
  BEFORE INSERT OR UPDATE OF total, paid_amount ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_update_invoice_balance();


-- ── invoice_items ─────────────────────────────────────────────
CREATE TABLE invoice_items (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  invoice_id      UUID          NOT NULL,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  description     VARCHAR(500)  NOT NULL,
  quantity        NUMERIC(15,4) NOT NULL CONSTRAINT chk_ii_qty CHECK (quantity != 0),
  unit_price      NUMERIC(15,4) NOT NULL CONSTRAINT chk_ii_price CHECK (unit_price >= 0),
  discount_pct    NUMERIC(7,4)  NOT NULL DEFAULT 0,
  discount_amount NUMERIC(15,4) NOT NULL DEFAULT 0,
  tax_rate_id     UUID,
  tax_rate        NUMERIC(7,4)  NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(15,4) NOT NULL DEFAULT 0,
  total           NUMERIC(15,4) NOT NULL DEFAULT 0,
  sort_order      INT           NOT NULL DEFAULT 0,

  CONSTRAINT pk_invoice_items PRIMARY KEY (id),
  CONSTRAINT fk_ii_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_ii_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX idx_ii_invoice ON invoice_items (invoice_id);


-- ── cash_registers ────────────────────────────────────────────
CREATE TABLE cash_registers (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  code            VARCHAR(20)   NOT NULL,
  name            VARCHAR(100)  NOT NULL,
  warehouse_id    UUID,
  currency_code   CHAR(3)       NOT NULL DEFAULT 'USD',
  status          VARCHAR(20)   NOT NULL DEFAULT 'closed'
                  CONSTRAINT chk_cr_status CHECK (status IN ('closed','open')),
  current_balance NUMERIC(15,4) NOT NULL DEFAULT 0,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_cash_registers PRIMARY KEY (id),
  CONSTRAINT uq_cr_code UNIQUE (code, tenant_id),
  CONSTRAINT fk_cr_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL
);

CREATE INDEX idx_cr_tenant ON cash_registers (tenant_id, status);

CREATE TRIGGER trg_cr_updated_at
  BEFORE UPDATE ON cash_registers
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── cash_register_sessions ────────────────────────────────────
CREATE TABLE cash_register_sessions (
  id                        UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                 UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  cash_register_id          UUID          NOT NULL,
  opened_by                 UUID          NOT NULL,
  opening_amount            NUMERIC(15,4) NOT NULL DEFAULT 0,
  opened_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  closed_by                 UUID,
  closing_amount_system     NUMERIC(15,4),
  closing_amount_declared   NUMERIC(15,4),
  difference                NUMERIC(15,4),
  notes                     TEXT,
  closed_at                 TIMESTAMPTZ,

  CONSTRAINT pk_cr_sessions PRIMARY KEY (id),
  CONSTRAINT fk_crs_register
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crs_opened_by
    FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crs_closed_by
    FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_crs_register ON cash_register_sessions (cash_register_id, opened_at DESC);
CREATE INDEX idx_crs_open     ON cash_register_sessions (cash_register_id, closed_at)
  WHERE closed_at IS NULL;


-- ── payments ──────────────────────────────────────────────────
CREATE TABLE payments (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  payment_number    VARCHAR(30)   NOT NULL,
  customer_id       UUID          NOT NULL,
  method            VARCHAR(30)   NOT NULL
                    CONSTRAINT chk_pay_method
                      CHECK (method IN ('cash','card','bank_transfer','check','online','other')),
  amount            NUMERIC(15,4) NOT NULL
                    CONSTRAINT chk_pay_amount CHECK (amount > 0),
  currency_code     CHAR(3)       NOT NULL DEFAULT 'USD',
  exchange_rate     NUMERIC(10,6) NOT NULL DEFAULT 1,
  reference         VARCHAR(100),
  cash_register_id  UUID,
  bank_account      VARCHAR(100),
  notes             TEXT,
  paid_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by        UUID          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_payments PRIMARY KEY (id),
  CONSTRAINT uq_pay_number UNIQUE (payment_number, tenant_id),
  CONSTRAINT fk_pay_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pay_cash_register
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id) ON DELETE SET NULL,
  CONSTRAINT fk_pay_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_pay_customer ON payments (customer_id, paid_at DESC);
CREATE INDEX idx_pay_date     ON payments (paid_at DESC, tenant_id);


-- ── payment_allocations ───────────────────────────────────────
-- Un pago puede aplicarse a múltiples facturas, y una factura puede
-- recibir múltiples pagos parciales.
CREATE TABLE payment_allocations (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  payment_id      UUID          NOT NULL,
  invoice_id      UUID          NOT NULL,
  amount_applied  NUMERIC(15,4) NOT NULL
                  CONSTRAINT chk_pa_amount CHECK (amount_applied > 0),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_payment_allocations PRIMARY KEY (id),
  CONSTRAINT fk_pa_payment
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
  CONSTRAINT uq_pa UNIQUE (payment_id, invoice_id)
);

CREATE INDEX idx_pa_payment ON payment_allocations (payment_id);
CREATE INDEX idx_pa_invoice ON payment_allocations (invoice_id);


-- ============================================================
-- SECCIÓN 8: COMPRAS
-- ============================================================

-- ── purchase_orders ───────────────────────────────────────────
CREATE TABLE purchase_orders (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  order_number      VARCHAR(30)   NOT NULL,
  supplier_id       UUID          NOT NULL,
  warehouse_id      UUID          NOT NULL,
  payment_term_id   UUID,
  currency_code     CHAR(3)       NOT NULL DEFAULT 'USD',
  exchange_rate     NUMERIC(10,6) NOT NULL DEFAULT 1,
  status            VARCHAR(30)   NOT NULL DEFAULT 'draft'
                    CONSTRAINT chk_po_status
                      CHECK (status IN ('draft','pending_approval','approved','sent','partially_received','received','cancelled')),
  subtotal          NUMERIC(15,4) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(15,4) NOT NULL DEFAULT 0,
  shipping_cost     NUMERIC(15,4) NOT NULL DEFAULT 0,
  total             NUMERIC(15,4) NOT NULL DEFAULT 0,
  expected_date     DATE,
  notes             TEXT,
  terms             TEXT,
  supplier_ref      VARCHAR(100),
  created_by        UUID          NOT NULL,
  approved_by       UUID,
  approved_at       TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,

  CONSTRAINT pk_purchase_orders PRIMARY KEY (id),
  CONSTRAINT uq_po_number UNIQUE (order_number, tenant_id),
  CONSTRAINT fk_po_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_po_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_po_payment_term
    FOREIGN KEY (payment_term_id) REFERENCES payment_terms(id) ON DELETE SET NULL,
  CONSTRAINT fk_po_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_po_approved_by
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_po_supplier ON purchase_orders (supplier_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_po_status   ON purchase_orders (status, tenant_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_po_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── purchase_order_items ──────────────────────────────────────
CREATE TABLE purchase_order_items (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  order_id        UUID          NOT NULL,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  description     VARCHAR(500)  NOT NULL,
  quantity        NUMERIC(15,4) NOT NULL CONSTRAINT chk_poi_qty CHECK (quantity > 0),
  unit_cost       NUMERIC(15,4) NOT NULL CONSTRAINT chk_poi_cost CHECK (unit_cost >= 0),
  tax_rate_id     UUID,
  tax_rate        NUMERIC(7,4)  NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(15,4) NOT NULL DEFAULT 0,
  total           NUMERIC(15,4) NOT NULL DEFAULT 0,
  received_qty    NUMERIC(15,4) NOT NULL DEFAULT 0,
  billed_qty      NUMERIC(15,4) NOT NULL DEFAULT 0,
  sort_order      INT           NOT NULL DEFAULT 0,
  notes           TEXT,

  CONSTRAINT pk_purchase_order_items PRIMARY KEY (id),
  CONSTRAINT fk_poi_order
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_poi_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX idx_poi_order ON purchase_order_items (order_id);


-- ── purchase_receipts ─────────────────────────────────────────
CREATE TABLE purchase_receipts (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  receipt_number  VARCHAR(30)   NOT NULL,
  order_id        UUID          NOT NULL,
  supplier_id     UUID          NOT NULL,
  warehouse_id    UUID          NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'draft'
                  CONSTRAINT chk_pr_status
                    CHECK (status IN ('draft','completed','cancelled')),
  notes           TEXT,
  received_by     UUID          NOT NULL,
  received_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_purchase_receipts PRIMARY KEY (id),
  CONSTRAINT uq_pr_number UNIQUE (receipt_number, tenant_id),
  CONSTRAINT fk_pr_order
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pr_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pr_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pr_received_by
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_pr_order    ON purchase_receipts (order_id);
CREATE INDEX idx_pr_supplier ON purchase_receipts (supplier_id, received_at DESC);

CREATE TRIGGER trg_pr_updated_at
  BEFORE UPDATE ON purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── purchase_receipt_items ────────────────────────────────────
CREATE TABLE purchase_receipt_items (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  receipt_id      UUID          NOT NULL,
  order_item_id   UUID          NOT NULL,
  product_id      UUID          NOT NULL,
  variant_id      UUID,
  quantity        NUMERIC(15,4) NOT NULL CONSTRAINT chk_pri_qty CHECK (quantity > 0),
  unit_cost       NUMERIC(15,4) NOT NULL CONSTRAINT chk_pri_cost CHECK (unit_cost >= 0),
  total_cost      NUMERIC(15,4) NOT NULL DEFAULT 0,
  lot_number      VARCHAR(50),
  expiry_date     DATE,
  notes           TEXT,

  CONSTRAINT pk_purchase_receipt_items PRIMARY KEY (id),
  CONSTRAINT fk_pri_receipt
    FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  CONSTRAINT fk_pri_order_item
    FOREIGN KEY (order_item_id) REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pri_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX idx_pri_receipt ON purchase_receipt_items (receipt_id);


-- ── supplier_bills ────────────────────────────────────────────
CREATE TABLE supplier_bills (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  bill_number     VARCHAR(30)   NOT NULL,
  supplier_ref    VARCHAR(100),
  supplier_id     UUID          NOT NULL,
  receipt_id      UUID,
  currency_code   CHAR(3)       NOT NULL DEFAULT 'USD',
  exchange_rate   NUMERIC(10,6) NOT NULL DEFAULT 1,
  status          VARCHAR(20)   NOT NULL DEFAULT 'received'
                  CONSTRAINT chk_sb_status
                    CHECK (status IN ('received','partially_paid','paid','overdue','disputed','cancelled')),
  subtotal        NUMERIC(15,4) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,
  total           NUMERIC(15,4) NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(15,4) NOT NULL DEFAULT 0,
  balance         NUMERIC(15,4) NOT NULL DEFAULT 0,
  issue_date      DATE          NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE          NOT NULL,
  notes           TEXT,
  created_by      UUID          NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_supplier_bills PRIMARY KEY (id),
  CONSTRAINT uq_sb_number UNIQUE (bill_number, tenant_id),
  CONSTRAINT fk_sb_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sb_receipt
    FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id) ON DELETE SET NULL,
  CONSTRAINT fk_sb_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_sb_supplier ON supplier_bills (supplier_id, created_at DESC);
CREATE INDEX idx_sb_due      ON supplier_bills (due_date, tenant_id)
  WHERE status NOT IN ('paid','cancelled');

CREATE TRIGGER trg_sb_updated_at
  BEFORE UPDATE ON supplier_bills
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ── supplier_bill_items ───────────────────────────────────────
CREATE TABLE supplier_bill_items (
  id          UUID          NOT NULL DEFAULT gen_random_uuid(),
  bill_id     UUID          NOT NULL,
  product_id  UUID,
  description VARCHAR(500)  NOT NULL,
  quantity    NUMERIC(15,4) NOT NULL,
  unit_cost   NUMERIC(15,4) NOT NULL,
  tax_rate    NUMERIC(7,4)  NOT NULL DEFAULT 0,
  tax_amount  NUMERIC(15,4) NOT NULL DEFAULT 0,
  subtotal    NUMERIC(15,4) NOT NULL DEFAULT 0,
  total       NUMERIC(15,4) NOT NULL DEFAULT 0,
  sort_order  INT           NOT NULL DEFAULT 0,

  CONSTRAINT pk_supplier_bill_items PRIMARY KEY (id),
  CONSTRAINT fk_sbi_bill
    FOREIGN KEY (bill_id) REFERENCES supplier_bills(id) ON DELETE CASCADE
);

CREATE INDEX idx_sbi_bill ON supplier_bill_items (bill_id);


-- ── supplier_payments ─────────────────────────────────────────
CREATE TABLE supplier_payments (
  id                UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  payment_number    VARCHAR(30)   NOT NULL,
  supplier_id       UUID          NOT NULL,
  bill_id           UUID          NOT NULL,
  method            VARCHAR(30)   NOT NULL
                    CONSTRAINT chk_sp_method
                      CHECK (method IN ('cash','bank_transfer','check','online','other')),
  amount            NUMERIC(15,4) NOT NULL CONSTRAINT chk_sp_amount CHECK (amount > 0),
  currency_code     CHAR(3)       NOT NULL DEFAULT 'USD',
  exchange_rate     NUMERIC(10,6) NOT NULL DEFAULT 1,
  reference         VARCHAR(100),
  cash_register_id  UUID,
  notes             TEXT,
  paid_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by        UUID          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_supplier_payments PRIMARY KEY (id),
  CONSTRAINT uq_sp_number UNIQUE (payment_number, tenant_id),
  CONSTRAINT fk_sp_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sp_bill
    FOREIGN KEY (bill_id) REFERENCES supplier_bills(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sp_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_sp_supplier ON supplier_payments (supplier_id, paid_at DESC);
CREATE INDEX idx_sp_bill     ON supplier_payments (bill_id);


-- ============================================================
-- SECCIÓN 9: FINANZAS — CAJA
-- (cash_registers y cash_register_sessions definidas antes de payments)
-- ============================================================


-- ── cash_movements ────────────────────────────────────────────
CREATE TABLE cash_movements (
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL DEFAULT current_setting('app.current_tenant_id')::UUID,
  session_id      UUID          NOT NULL,
  type            VARCHAR(20)   NOT NULL
                  CONSTRAINT chk_cm_type
                    CHECK (type IN ('income','expense','opening','closing',
                                    'transfer_in','transfer_out','correction')),
  amount          NUMERIC(15,4) NOT NULL CONSTRAINT chk_cm_amount CHECK (amount > 0),
  description     VARCHAR(255)  NOT NULL,
  reference_type  VARCHAR(50),
  reference_id    UUID,
  created_by      UUID          NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_cash_movements PRIMARY KEY (id),
  CONSTRAINT fk_cm_session
    FOREIGN KEY (session_id) REFERENCES cash_register_sessions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cm_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_cm_session   ON cash_movements (session_id, created_at DESC);
CREATE INDEX idx_cm_reference ON cash_movements (reference_type, reference_id)
  WHERE reference_type IS NOT NULL;
CREATE INDEX idx_cm_type      ON cash_movements (type, tenant_id, created_at DESC);
