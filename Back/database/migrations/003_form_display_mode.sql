-- Modo de visualización del registro configurable desde el builder: modal
-- (default, comportamiento histórico) o inline (el form reemplaza la grid en
-- la misma vista en vez de abrir un modal). modal_width en px, NULL = ancho
-- por default del componente. Ver docs/adr/011-form-display-mode.md.
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS display_mode VARCHAR(20) NOT NULL DEFAULT 'modal';
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS modal_width  INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_forms_display_mode' AND conrelid = '{{schema}}.forms'::regclass
  ) THEN
    ALTER TABLE {{schema}}.forms
      ADD CONSTRAINT chk_forms_display_mode CHECK (display_mode IN ('modal', 'inline'));
  END IF;
END $$;
