import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AdminService } from '../modules/admin/admin.service';
import { ModulesService } from '../modules/modules/modules.service';
import { Pool } from 'pg';
import { PG_MASTER_POOL } from '../database/database.module';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const adminService = app.get(AdminService);
  const modules = app.get(ModulesService);
  const pool = app.get<Pool>(PG_MASTER_POOL);

  const rubroRow = await pool.query(`SELECT id FROM public.tbl_rubro WHERE code = 'moda'`);
  const rubroId = rubroRow.rows[0].id;

  const tenant = await adminService.createTenant({
    slug: 'test-rubro-moda', name: 'Test Rubro Moda', maxUsers: 5, rubroId,
    adminEmail: 'admin@test-rubro-moda.com', adminPassword: 'Password123!',
    adminFirstName: 'Test', adminLastName: 'Admin',
  });
  console.log('tenant creado:', tenant.id, tenant.schema_name, 'rubro_id=', tenant.rubro_id);

  // Módulos: CLIENTES(2), PROVEEDORES(3), INVENTARIO_MODA(4), CATEGORIAS(7), UNIDADES_MEDIDA(8)
  const modIds = await pool.query(`SELECT id FROM public.modules WHERE code IN ('CLIENTES','PROVEEDORES','INVENTARIO_MODA','CATEGORIAS','UNIDADES_MEDIDA')`);
  const moduleIds = modIds.rows.map((r) => r.id);
  const result = await modules.syncPublicModulesToTenant(tenant.schema_name, moduleIds);
  console.log('sync result:', result);

  const schema = tenant.schema_name;
  const cats = await pool.query(`SELECT nombre, rubro FROM ${schema}.tbl_categorias ORDER BY nombre`);
  console.log(`${schema}.tbl_categorias (${cats.rowCount} filas):`, cats.rows.map((r) => `${r.nombre}(${r.rubro})`));

  const unidades = await pool.query(`SELECT nombre, rubro FROM ${schema}.tbl_unidades_medida ORDER BY nombre`);
  console.log(`${schema}.tbl_unidades_medida (${unidades.rowCount} filas):`, unidades.rows.map((r) => `${r.nombre}(${r.rubro})`));

  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
