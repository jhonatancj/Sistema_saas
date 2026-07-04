# ADR-010: Capa `styles/components/` para patrones de UI reutilizados

## Contexto
El proyecto sigue ITCSS (`settings` → `generic` → `elements` → `objects` →
`utilities`, ver `styles.scss`). Patrones de UI genéricos usados en casi toda
pantalla de `features/` (botón, modal/backdrop, wrapper de página, card,
campo de formulario, badge, tabla simple) no tenían una capa propia — cada
componente los redeclaraba completos en su propio `.scss`, porque los
estilos de componente de Angular están encapsulados por default
(`ViewEncapsulation.Emulated`) y no hay nada global que los cubriera.

Encontrado real: 8+ componentes duplicaban `.btn`/`.modal`/`.field`/`.pg`
byte por byte; en 4 de ellos alguien copió el HTML de otro componente
(`class="btn btn--primary"`) pero **no** el bloque de estilos correspondiente
— esas clases no hacían nada, los botones salían con el estilo por defecto
del navegador. Ver `docs/known-bugs.md`.

## Decisión
Nueva capa ITCSS `styles/components/` (entre `objects` y `utilities` en
`styles.scss`), con un archivo por patrón: `_buttons.scss`, `_modal.scss`,
`_page.scss` (incluye `.pg` y `.card` base), `_form-field.scss` (`.field` +
`.grid`), `_badge.scss` (solo forma, sin colores), `_table.scss`. Sin prefijo
nuevo (`.btn`, no `.c-btn`) para no forzar un rename masivo de templates ya
existentes — es una decisión pragmática, no ideológica: `objects`/`utilities`
sí usan prefijo (`.o-`/`.u-`) pero estos patrones ya tenían nombres
establecidos en toda la app.

Los colores específicos de dominio (ej. `.badge--trial`/`--suspended` de
estado de tenant, vs `.badge--ok`/`--off` de activo/inactivo) **se quedan
locales** por componente — solo la forma/tipografía base es compartida.
Cuando un componente necesita una variante genuina (modal más ancho, card con
padding en vez de sin padding, grid con `auto-fill` en vez de `--2`), la
declara localmente **como override**, no redeclarando el bloque completo —
Angular añade un atributo de scoping a los estilos de componente, que le da
más especificidad que la clase global equivalente, así que el override local
siempre gana sin necesitar `!important` ni duplicar el resto del bloque.

## Consecuencias
- Antes de duplicar `.btn`/`.modal`/`.field`/`.pg`/`.card`/`.badge`/`.tbl` en
  un componente nuevo, usar la clase compartida — ver
  `CLAUDE.md` → Reglas Frontend.
- Los botones renderizados dinámicamente dentro de AG-Grid (`cellRenderer`,
  DOM creado con `document.createElement`) nunca reciben el atributo de
  scoping de Angular — para esos, el estilo **tiene** que ser global de
  todas formas. Esto ya existía antes de este ADR en
  `styles/elements/_ag-grid.scss` (`ag-grid-angular .btn--edit-ghost`, etc.),
  con mayor especificidad que `styles/components/_buttons.scss` gracias al
  selector de tipo `ag-grid-angular` — ambas capas conviven sin conflicto.
