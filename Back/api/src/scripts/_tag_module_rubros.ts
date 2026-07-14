import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ModulesService } from '../modules/modules/modules.service';
import { Pool } from 'pg';
import { PG_MASTER_POOL } from '../database/database.module';

const MODULE_TO_RUBRO_CODE: Record<string, string> = {
  INVENTARIO_BARRIO: 'tienda_barrio',
  INVENTARIO_MODA: 'moda',
  INVENTARIO_FERRETERIA: 'ferreteria',
  SERVICIOS_BELLEZA: 'belleza',
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const modules = app.get(ModulesService);
  const pool = app.get<Pool>(PG_MASTER_POOL);

  for (const [code, rubroCode] of Object.entries(MODULE_TO_RUBRO_CODE)) {
    const rubroRow = await pool.query(`SELECT id FROM public.tbl_rubro WHERE code = $1`, [rubroCode]);
    const rubroId = rubroRow.rows[0]?.id;
    if (!rubroId) { console.log(`SKIP ${code}: rubro ${rubroCode} no encontrado`); continue; }

    const moduleRow = await pool.query(`SELECT id FROM public.modules WHERE code = $1`, [code]);
    const moduleId = moduleRow.rows[0]?.id;
    if (!moduleId) { console.log(`SKIP ${code}: módulo no encontrado`); continue; }

    await modules.updatePublicModule(moduleId, { rubroId });
    console.log(`${code} -> rubro_id ${rubroId} (${rubroCode})`);
  }

  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('TAG FAILED', e); process.exit(1); });
