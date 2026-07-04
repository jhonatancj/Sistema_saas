# ADR-011: Modo de visualización del registro configurable desde el builder

## Contexto
Todo formulario abría sus registros (crear/editar) en un modal de ancho fijo
(460px o 620px según el componente). Algunos formularios con muchos campos o
layouts anchos (varias columnas) se ven mejor a pantalla completa en la misma
vista, reemplazando la grid, que en un modal angosto.

## Decisión
Dos columnas nuevas en `{schema}.forms` (tenant y `public`, paridad completa
como el resto del motor — ver `docs/adr/003-dynamic-form-engine.md`):
- `display_mode VARCHAR(20) NOT NULL DEFAULT 'modal'`, `CHECK IN ('modal',
  'inline')`.
- `modal_width INT` (px, nullable — `NULL` = ancho por default del
  componente). Solo tiene efecto cuando `display_mode='modal'`;
  `FormGeneratorService.processForm()` fuerza `modal_width=NULL` al guardar
  si `display_mode='inline'`, para que no quede un valor huérfano sin uso.

Configurable desde el builder (`admin/builder`, panel avanzado — mismo lugar
que el ícono, aplica a formularios públicos y de tenant por igual): radio
Modal/En la vista + input numérico de ancho (solo visible en modo Modal).

En `FormDetailComponent`:
- `display_mode='modal'` (default): comportamiento histórico — modal
  flotante con backdrop. `modal_width` se aplica como `[style.max-width.px]`
  inline (gana sobre el `max-width` fijo del `.scss`, que queda como
  fallback); si es `NULL`, usa el default del componente (620px).
- `display_mode='inline'`: al abrir crear/editar, la grid se oculta y el
  formulario aparece en su lugar dentro de la misma card (sin backdrop, sin
  posición flotante) — un botón "← Volver a la grid" cierra el modo edición y
  vuelve a mostrar la grid.

## Consecuencias
- Ningún formulario existente cambia de comportamiento (`display_mode`
  default `'modal'`, `modal_width` default `NULL` = ancho de siempre).
- `GET /forms/:slug` y `GET /admin/forms/:slug` (y las variantes de tenant)
  devuelven `display_mode`/`modal_width` — cualquier consumidor que arme su
  propio modal a partir de estos endpoints debería respetarlos, igual que
  `FormDetailComponent`.
