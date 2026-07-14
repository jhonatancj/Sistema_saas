-- Misma columna que Back/database/13_modules_parent_id.sql (versión public)
-- — ver docs/adr/024-jerarquia-modulos.md.
ALTER TABLE {{schema}}.modules ADD COLUMN IF NOT EXISTS parent_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_modules_parent' AND conrelid = '{{schema}}.modules'::regclass
  ) THEN
    ALTER TABLE {{schema}}.modules
      ADD CONSTRAINT fk_modules_parent FOREIGN KEY (parent_id) REFERENCES {{schema}}.modules(id) ON DELETE SET NULL;
  END IF;
END $$;
