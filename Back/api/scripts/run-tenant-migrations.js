// Aplica los scripts numerados de database/migrations/ a todos los tenants activos.
// Uso: pnpm db:migrate [--tenant=tenant_demo] [--dry-run]
// Ver database/migrations/README.md para la convención de los archivos.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, '..', '.env'));

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'database', 'migrations');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tenantArg = args.find((a) => a.startsWith('--tenant='));
const onlyTenantSchema = tenantArg ? tenantArg.split('=')[1] : null;

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.tenant_schema_migrations (
      tenant_schema VARCHAR(100) NOT NULL,
      filename      VARCHAR(200) NOT NULL,
      applied_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_schema, filename)
    )
  `);

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    : [];

  if (files.length === 0) {
    console.log('No hay archivos .sql en database/migrations/. Nada que hacer.');
    await pool.end();
    return;
  }

  const tenantsResult = await pool.query(
    `SELECT slug, schema_name FROM public.tenants
     WHERE deleted_at IS NULL AND status != 'cancelled'
     ORDER BY created_at`,
  );
  const tenants = onlyTenantSchema
    ? tenantsResult.rows.filter((t) => t.schema_name === onlyTenantSchema)
    : tenantsResult.rows;

  if (tenants.length === 0) {
    console.log('No hay tenants activos que migrar.');
    await pool.end();
    return;
  }

  const summary = [];

  for (const tenant of tenants) {
    const appliedResult = await pool.query(
      `SELECT filename FROM public.tenant_schema_migrations WHERE tenant_schema = $1`,
      [tenant.schema_name],
    );
    const applied = new Set(appliedResult.rows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      summary.push({ tenant: tenant.schema_name, status: 'up-to-date' });
      continue;
    }

    for (const file of pending) {
      const sql = fs
        .readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
        .replace(/\{\{schema\}\}/g, tenant.schema_name);

      if (dryRun) {
        console.log(`[dry-run] ${tenant.schema_name} <- ${file}`);
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO public.tenant_schema_migrations (tenant_schema, filename) VALUES ($1, $2)`,
          [tenant.schema_name, file],
        );
        await client.query('COMMIT');
        console.log(`✓ ${tenant.schema_name} <- ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ ${tenant.schema_name} <- ${file}: ${err.message}`);
        summary.push({ tenant: tenant.schema_name, status: 'error', file, error: err.message });
        client.release();
        break; // no seguir con el siguiente script de este tenant
      }
      client.release();
    }

    if (!summary.find((s) => s.tenant === tenant.schema_name)) {
      summary.push({ tenant: tenant.schema_name, status: 'migrated' });
    }
  }

  console.log('\n--- Resumen ---');
  for (const s of summary) {
    console.log(`${s.tenant}: ${s.status}${s.file ? ` (falló en ${s.file}: ${s.error})` : ''}`);
  }

  await pool.end();

  if (summary.some((s) => s.status === 'error')) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
