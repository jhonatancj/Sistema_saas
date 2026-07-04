# ADR-002: Sin ORM — SQL crudo vía `pg.Pool`

## Contexto
El backend NestJS necesita ejecutar queries contra un schema que varía en
tiempo de ejecución (uno por tenant) y, en el caso del motor de formularios,
contra tablas cuyo *nombre y columnas* se generan dinámicamente.

## Decisión
No se usa ningún ORM (TypeORM, Prisma, etc.). Todo el acceso a datos es SQL
crudo vía `pg.Pool` (`PG_MASTER_POOL`, `Back/api/src/database/database.module.ts`),
inyectado en cada servicio. El nombre de schema se interpola directamente en el
string SQL: `` `SELECT * FROM ${schema}.forms` ``.

`Back/ARQUITECTURA.md` describe una visión con TypeORM/Nx/NgRx — es un
documento aspiracional de una fase de diseño anterior y **no refleja el código
actual**. No usarlo como referencia.

## Consecuencias
- Un ORM estándar no modela bien "schema dinámico por request" ni "tabla
  generada en runtime con columnas arbitrarias" — el motor de formularios
  (ADR-003) sería mucho más difícil de construir sobre un ORM.
- Contrapartida: no hay protección de tipos en las queries ni migraciones
  automáticas — la validez de cada query depende de disciplina manual.
- La interpolación de `schema` en el SQL es seguro **solo** porque `schema`
  nunca viene directamente de un valor no confiable de un request — siempre se
  resuelve desde `req.user.schemaName` (JWT ya validado) o se hardcodea
  server-side (`'public'`). Ningún endpoint acepta `schema` como parámetro de
  body/query. Ver "Anti-patrones prohibidos" en `CLAUDE.md`.
- Los valores de columnas y filtros dinámicos (ej. filtros de grid) sí van
  siempre parametrizados (`$1`, `$2`...) — la interpolación directa está
  reservada exclusivamente para identificadores de schema/tabla/columna, y
  esos se validan contra `information_schema` antes de interpolarse cuando
  vienen de una fuente semi-confiable (ver `FormExecutorService.selectPaged`).
