-- Bug real encontrado al verificar la sincronización de módulos públicos →
-- tenant (Fase 13, feature "migrar módulos al tenant"): module_forms solo
-- tenía PK sobre `id` (surrogate, siempre distinto) — "ON CONFLICT DO NOTHING"
-- sin una constraint que matchee (module_id, form_slug) no evita nada, así que
-- cada sincronización duplicaba la fila de asignación completa. Confirmado
-- reproduciendo el bug real en tenant_qa_test_tenant durante la verificación.
--
-- 1. Dedup: conserva la fila más antigua (menor id) por (module_id, form_slug).
DELETE FROM {{schema}}.module_forms a
USING {{schema}}.module_forms b
WHERE a.id > b.id AND a.module_id = b.module_id AND a.form_slug = b.form_slug;

-- 2. Constraint única — idempotente (Postgres no soporta
--    ADD CONSTRAINT IF NOT EXISTS nativo).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_module_forms_module_slug'
      AND conrelid = '{{schema}}.module_forms'::regclass
  ) THEN
    ALTER TABLE {{schema}}.module_forms
      ADD CONSTRAINT uq_module_forms_module_slug UNIQUE (module_id, form_slug);
  END IF;
END $$;
