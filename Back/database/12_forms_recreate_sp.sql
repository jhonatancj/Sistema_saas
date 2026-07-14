-- Persiste `recreate_sp` (antes un parámetro transitorio de cada llamada a
-- processForm(), nunca guardado) — cualquier updatePublicForm/updateTenantForm
-- posterior sobre un form con SP a mano (recreateSp:false) que no repitiera el
-- flag terminaba pisando el SP a mano con el genérico. Ver docs/known-bugs.md.
-- FormGeneratorService.processForm() ahora usa el valor guardado como default
-- cuando el DTO no lo especifica explícitamente.
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS recreate_sp BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.forms SET recreate_sp = FALSE WHERE slug IN ('venta_barrio', 'compra_barrio');
