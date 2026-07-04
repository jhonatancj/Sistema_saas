-- ============================================================
-- 05_seed_dev.sql
-- Datos iniciales para desarrollo local
-- ============================================================

-- Plan
INSERT INTO public.subscription_plans (name, code, max_users, max_products, price_monthly)
VALUES ('Trial', 'TRIAL', 5, 100, 0)
ON CONFLICT (code) DO NOTHING;

-- Tenant demo
INSERT INTO public.tenants (slug, name, country_code, status, schema_name)
VALUES ('demo', 'Empresa Demo', 'CO', 'trial', 'pending')
ON CONFLICT (slug) DO NOTHING;

-- Crear schema del tenant
SELECT public.create_tenant_schema(
  (SELECT id FROM public.tenants WHERE slug = 'demo'),
  'demo'
);

-- Usuario admin
INSERT INTO tenant_demo.users (email, password_hash, first_name, last_name)
VALUES (
  'admin@demo.com',
  '$2b$10$c4qETcHL7jZeYuXc.D8.g.9U3VMLzasrVCRDbkfPnyfzlqGpHpjR2',
  'Admin',
  'Demo'
)
ON CONFLICT DO NOTHING;

-- Rol ADMIN al usuario
INSERT INTO tenant_demo.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM tenant_demo.users u, tenant_demo.roles r
WHERE u.email = 'admin@demo.com'
  AND r.code = 'ADMIN'
ON CONFLICT DO NOTHING;