-- Jerarquía real de módulos (hasta 4 niveles: módulo > submódulo > submódulo
-- > form — 3 niveles de módulo, validados en ModulesService.validateModuleParent()).
-- ON DELETE SET NULL (no CASCADE): borrar un módulo contenedor no debe borrar
-- a sus hijos, los vuelve a la raíz. Ver docs/adr/024-jerarquia-modulos.md.
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS parent_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_modules_parent' AND conrelid = 'public.modules'::regclass
  ) THEN
    ALTER TABLE public.modules
      ADD CONSTRAINT fk_modules_parent FOREIGN KEY (parent_id) REFERENCES public.modules(id) ON DELETE SET NULL;
  END IF;
END $$;
