-- Nombre que ve el tenant al recibir el módulo (al crear el tenant o al
-- sincronizar el catálogo) — puede diferir del nombre que usa el super admin
-- en su propio catálogo/sidebar. Ej: "Inventario Restaurantes" en el catálogo
-- del super admin (para distinguirlo de "Inventario Ferreterías", ambos
-- módulos de inventario pero con formularios/campos distintos), pero
-- "Inventario" a secas en el sidebar de cualquier tenant al que se le asigne.
-- NULL = usa `name` tal cual (mismo nombre en ambos lados, caso más común).
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS tenant_name VARCHAR(100);
