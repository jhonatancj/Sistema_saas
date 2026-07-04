# ADR-005: Grid con AG-Grid Infinite Row Model + filtro/orden vía SQL dinámico

## Contexto
Las grids de formularios necesitan paginación, filtro y orden server-side
sobre tablas que pueden tener miles de filas, sin duplicar lógica de filtro
genérica dentro del stored procedure (PL/pgSQL) de cada formulario.

## Decisión
- Frontend: `GridFormComponent` usa `rowModelType="infinite"` de AG-Grid
  Community (no requiere Enterprise) con un `IDatasource` que traduce
  `startRow/endRow/filterModel/sortModel` al contrato
  `{ action: 'SELECT', limit, offset, filter: { filters, sorts, search } }` de
  `POST /forms/:slug/execute` (mismo contrato en `/admin/forms/:slug/execute`).
  `[pagination]="true"` + `[paginationPageSize]="cacheBlockSize()"` sobre el
  mismo Infinite Row Model activa el panel de paginación estándar de AG-Grid
  (prev/next/página) en vez de scroll infinito, sin tocar el datasource — es
  una combinación soportada nativamente por AG-Grid Community.
- El input de búsqueda general (un solo campo, sin elegir columna) vive
  **dentro de `GridFormComponent`** (toolbar propio arriba de la grilla, no en
  el header de la página) — el debounce (300ms) también vive ahí;
  `GridFormComponent` emite `searchChange` ya debounced. `FormDetailComponent`
  solo guarda el término final en un signal `search`, del que `datasource`
  depende igual que de `slug` (nueva referencia de datasource → AG-Grid
  descarta caché y vuelve a la página 1). `GridFormComponent.resetSearch()`
  (llamado explícitamente por el padre al cambiar de formulario, mismo patrón
  que `refresh()`) limpia el input visualmente — no se engancha a cambios de
  `datasource()` porque el propio término de búsqueda también cambia esa
  referencia, y eso crearía un loop que borra lo que el usuario escribió.
- Backend: cuando el body trae `filter` (o el formulario tiene `grid_query`),
  `FormExecutorService.selectPaged()` arma SQL dinámico **directo contra la
  tabla** (bypaseando el SP) — las columnas se validan contra
  `information_schema.columns` (whitelist), los valores van parametrizados.
  Sin `filter`, sigue pasando por el SP (`p_limit`/`p_offset`).
  `filter.search` (búsqueda general) hace `OR` de `ILIKE` contra todas las
  columnas de tipo `varchar`/`text` de la tabla (obtenidas de
  `information_schema.columns.data_type`, o de los OIDs de tipo del driver
  para una `grid_query` custom), combinado con `AND` a los filtros por
  columna si también vienen. No filtra por tipo de campo del builder (no hay
  acceso a `json_form` en `selectPaged`) — un campo `image` (TEXT/base64)
  queda incluido en la búsqueda, correcto pero algo menos eficiente.
- `to_jsonb()` se usa en ambos caminos (SP y `selectPaged`) para que los tipos
  numéricos salgan siempre como número JSON, nunca como string (Postgres
  devuelve `NUMERIC`/`BIGINT` crudos como string por precisión).
- **`action: 'SELECT'` sin `limit` explícito pagina a 25 por default** — antes
  devolvía la tabla completa como array plano si no se pedía paginación; ahora
  `FormExecutorService.execute()` fuerza `limit = 25` al principio del método
  cuando `action === 'SELECT'` y `limit` viene `null`/`undefined` (no aplica a
  `SELECT_BY_ID`). Protege contra traer una tabla entera sin querer desde
  cualquier consumidor que no mande límite explícito (el datasource de AG-Grid
  ya mandaba límite siempre, así que no lo afecta). Como consecuencia, **toda**
  llamada `SELECT` pasa a requerir la firma nueva del SP de 5 parámetros — ya
  no hay ningún camino que llame al SP con la firma vieja de 3. Verificado que
  ningún form real de la DB (`tenant_demo`, `public`) tiene todavía la firma
  vieja antes de aplicar este cambio. Riesgo aceptado y ya preexistente para
  un SP escrito a mano con `recreateSp:false` (ver ADR-003) — ese caso ya
  fallaba igual apenas alguien pedía paginación explícita.
- **Ancho de columna: auto-size a contenido + estirado si sobra espacio** —
  `GridFormComponent.onModelUpdated()` llama `gridApi.autoSizeAllColumns()`
  (evita que nombres/contenido largos queden cortados), y
  `fitColumnsIfNeeded()` compara el ancho total resultante contra el ancho
  real del div del grid (`gridClientWidth`, informado por
  `(gridSizeChanged)`) — si las columnas auto-ajustadas no llenan ese ancho
  (pocas columnas visibles o contenido corto), se estiran proporcionalmente
  con `sizeColumnsToFit()`; si ya lo superan, no se toca nada (evita volver a
  angostarlas por debajo de lo que pide su contenido). Sin este segundo paso,
  autoSize por sí solo dejaba un hueco vacío entre la última columna y
  "Acciones" (pineada a la derecha) cuando había pocas columnas visibles. La
  columna "Acciones" tiene `minWidth:110`/`maxWidth:130` para no participar
  del estirado proporcional — sus dos botones de ícono no necesitan más
  ancho aunque sobre espacio en el resto de la grid.
- **El editor SQL del builder (pestaña "SQL") se precarga con la consulta
  equivalente a la que usa hoy el formulario** cuando no tiene un
  `grid_query` propio guardado — `SELECT * FROM {schema}.{table} WHERE
  deleted_at IS NULL`, el mismo criterio que aplica por default tanto la rama
  SELECT del SP (`FormGeneratorService.buildSpDDL`) como `selectPaged()` sin
  `grid_query`. Antes el editor aparecía vacío, sin pista de qué se estaba
  reemplazando. `AdminBuilderComponent` guarda ese texto autogenerado en
  `suggestedGridQuery` y en `onExport()` compara contra el valor actual del
  editor: si el admin no lo tocó, manda `gridQuery: null` (no persiste nada
  nuevo) — evita que abrir el builder y guardar por cualquier otro motivo
  (ej. cambiar el ícono) fije silenciosamente un `grid_query` en un form que
  nunca tuvo uno. Si el admin edita el texto (agrega un JOIN, un WHERE, etc.),
  eso sí se guarda como `grid_query` real.
- **Pestaña Grid: columnas manuales para campos que no vienen del formulario
  visual** — antes, `AdminBuilderComponent.loadGridConfig()` armaba la lista
  de columnas ÚNICAMENTE a partir de `extractFieldsFromSchema()` (los campos
  del `d-builder`); cualquier columna que el admin hubiera agregado a mano
  (ej. un alias de un JOIN agregado en `grid_query`) se perdía en silencio en
  cada recarga de la pestaña, porque no había forma de declararla ni de
  conservarla. Ahora la pestaña Grid tiene un formulario "+ Agregar columna"
  (clave + etiqueta + tipo) que agrega una entrada marcada `is_custom: true`
  a `grid_config`; `loadGridConfig()` conserva esas entradas aunque no
  matcheen ningún campo extraído del schema visual (antes se descartaban). La
  clave debe coincidir exactamente con el alias de la columna en el SELECT
  custom — el backend no valida esto (`grid_config` es JSONB libre), es
  responsabilidad del admin. Columnas `is_custom` son las únicas que se
  pueden eliminar desde la UI (botón "✕") y las únicas con el campo "Tipo"
  editable (`<select>`, mismo set de tipos que los nodos del builder); las
  columnas de campos reales del formulario solo se ocultan (checkbox
  "Visible"), nunca se borran desde acá.

## Alternativas consideradas
- Filtro genérico dentro del SP en PL/pgSQL — descartado por ser mucho más
  difícil de mantener que TypeScript, y porque forzaría reprocesar cada
  formulario para tomar mejoras futuras del motor de filtros.
- Editor SQL con Monaco para `grid_query` — descartado: la versión actual del
  paquete no trae el loader AMD clásico, y no hay plugin oficial para el
  builder esbuild de Angular 22. Se usa un `<textarea>` simple
  (`shared/sql-editor/`). Reintentar solo si aparece un empaquetado ESM viable.

## Consecuencias
- La ruta con `filter` no requiere que el formulario haya sido reprocesado
  (no depende de la firma del SP) — la paginación simple sin `filter` sí.
- `grid_query` (SQL custom) solo tiene validación de superficie
  (single-statement, debe empezar con `SELECT`, denylist de palabras de
  escritura) — no es un sandbox real. Aceptado conscientemente porque solo
  super admin llega hasta ese campo, y ya tiene poder equivalente en el resto
  de la app.
