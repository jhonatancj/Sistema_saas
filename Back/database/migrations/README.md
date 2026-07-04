# database/migrations

Scripts SQL numerados para actualizar el schema de **tenants ya creados** cuando
el template (`04_create_tenant.sql`) cambia — por ejemplo, al agregar una columna
nueva a `forms` o una tabla nueva que los tenants existentes no tienen.

> Esto es distinto de `05_migration_strategy.sql`: esa función (`run_migration_on_all_tenants`)
> pertenece al diseño ERP aspiracional de `ARQUITECTURA.md` y referencia tablas que no
> existen en la implementación actual (`password_reset_tokens`, vistas materializadas, etc.).
> No está en uso. El runner de esta carpeta es el mecanismo real para el sistema actual.

## Convención

- Nombre de archivo: `NNN_descripcion_corta.sql` (`001_...`, `002_...`, ...). El número
  define el orden de ejecución — nunca reutilizar ni reordenar un número ya aplicado.
- Cada script debe ser **idempotente**: usar `ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, etc. Un tenant puede
  quedar a mitad de aplicar migraciones si un script previo falló, y el runner
  reintenta desde el primero pendiente.
- Usar el placeholder literal `{{schema}}` donde iría el nombre del schema — el runner
  lo reemplaza por `tenant_<slug>` antes de ejecutar. Ejemplo:

  ```sql
  -- 001_add_forms_description.sql
  ALTER TABLE {{schema}}.forms ADD COLUMN IF NOT EXISTS description TEXT;
  ```

- Un script solo debe tocar el schema de UN tenant a la vez (el runner itera tenant por
  tenant). No usar `public.` a menos que el cambio sea realmente global — en ese caso
  no pertenece a esta carpeta, va directo en un script `0N_*.sql` en `database/`.

## Ejecutar

Desde `Back/api`:

```bash
pnpm db:migrate              # aplica pendientes a todos los tenants activos
pnpm db:migrate --tenant=tenant_demo   # solo un tenant
pnpm db:migrate --dry-run    # lista qué se aplicaría sin ejecutar nada
```

El runner (`Back/api/scripts/run-tenant-migrations.js`):
1. Crea `public.tenant_schema_migrations (tenant_schema, filename, applied_at)` si no existe.
2. Lista los tenants activos (`public.tenants` con `deleted_at IS NULL` y `status != 'cancelled'`).
3. Para cada tenant, aplica en orden los `.sql` de esta carpeta que no estén ya registrados
   en `tenant_schema_migrations`, cada uno dentro de una transacción.
4. Si un script falla para un tenant, se detiene con ese tenant (no aplica los siguientes
   scripts para él) pero continúa con los demás tenants, y reporta un resumen al final.

## Cuándo NO usar esto

Los formularios generados dinámicamente (`tbl_{slug}`, `sp_{slug}`) no se gestionan aquí —
esos los crea/altera `FormGeneratorService` en tiempo de ejecución. Esta carpeta es solo para
cambios al **template fijo** del schema de tenant (tablas core: `users`, `roles`, `modules`,
`forms`, etc.).
