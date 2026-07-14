-- Misma columna que Back/database/12_forms_recreate_sp.sql (versión public) —
-- ver docs/known-bugs.md "Un SP a mano ... pierde su lógica de negocio".
ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS recreate_sp BOOLEAN NOT NULL DEFAULT TRUE;
