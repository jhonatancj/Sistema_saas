# ADR-006: Campo `image` como `TEXT` (base64), no `bytea` ni almacenamiento externo

## Contexto
`@jhonatancj/dforms` no sube archivos por multipart — convierte la imagen a
`data:image/xxx;base64,...` en el navegador y la manda como string dentro del
JSON de `/execute`. El motor de formularios (ADR-003) genera el tipo de
columna genéricamente a partir del tipo de campo del builder.

## Decisión
El campo `image` mapea a `TEXT` en la tabla generada (no `VARCHAR(500)`, que
es insuficiente para cualquier imagen real en base64).

## Alternativas consideradas
- `bytea` (BLOB nativo de Postgres) — descartado porque el SP generado trata
  todos los campos de forma genérica vía `p_data->>'campo'`; `bytea`
  requeriría `encode()`/`decode()` especial solo para este tipo, rompiendo el
  patrón uniforme del generador.
- Almacenamiento de archivos externo (disco/S3) con solo la URL en la DB — es
  la opción correcta si el overhead de base64 (~33%) llega a ser un problema
  real de tamaño de DB, pero es un cambio de arquitectura mayor no evaluado a
  fondo. No implementado.

## Consecuencias
- `main.ts` necesita un límite de body mayor al default de Express
  (`app.use(json({ limit: '10mb' }))`) — cualquier imagen cercana a ese límite
  fallará con `413`.
- El fix de `TEXT` solo aplica a tablas generadas **después** de este cambio —
  `ALTER TABLE ADD COLUMN` (reproceso) nunca corrige el tipo de una columna ya
  existente. Cualquier tabla vieja con un campo `image` en `VARCHAR(500)`
  necesita `ALTER TABLE ... ALTER COLUMN ... TYPE TEXT` manual. Ver
  `docs/known-bugs.md`.
