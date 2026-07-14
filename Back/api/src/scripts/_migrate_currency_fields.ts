import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AdminFormsService } from '../modules/admin-forms/admin-forms.service';
import { FormGeneratorService } from '../modules/forms/form-generator.service';

const CURRENCY_DEFAULTS = {
  currencySymbol: '$',
  currencyPosition: 'prefix' as const,
  decimalPlaces: 0,
  locale: 'es-CO',
  allowNegative: false,
};

function toCurrency(nodes: any[], keys: Set<string>): boolean {
  let changed = false;
  for (const node of nodes) {
    if (keys.has(node.key) && node.type === 'number') {
      node.type = 'currency';
      Object.assign(node, CURRENCY_DEFAULTS);
      changed = true;
    }
    if (node.children?.length) {
      if (toCurrency(node.children, keys)) changed = true;
    }
  }
  return changed;
}

// slug -> claves de campos monetarios a convertir
const TARGETS: Record<string, string[]> = {
  clientes: ['limite_credito'],
  producto_barrio: ['precio_compra', 'precio_venta'],
  producto_moda: ['precio_compra', 'precio_venta'],
  producto_ferreteria: ['precio_compra', 'precio_venta'],
  servicio_belleza: ['precio'],
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const adminForms = app.get(AdminFormsService);
  const formGenerator = app.get(FormGeneratorService);

  for (const [slug, keys] of Object.entries(TARGETS)) {
    const current = await adminForms.getPublicForm(slug);
    const jsonForm = current.json_form;
    const keySet = new Set(keys);
    const changed = toCurrency(jsonForm.root, keySet);
    if (!changed) {
      console.log(`${slug}: SIN CAMBIOS (no se encontraron los campos esperados)`);
      continue;
    }

    await formGenerator.processForm('public', {
      slug,
      name: current.name,
      jsonForm,
      tableName: current.table_name,
      spName: current.sp_name,
      recreateSp: true,
      gridQuery: current.grid_query,
      icon: current.icon,
      displayMode: current.display_mode,
      modalWidth: current.modal_width,
    });

    const gridConfig = await adminForms.getGridConfig(slug);
    const updatedGrid = gridConfig.map((c: any) => keySet.has(c.key) ? { ...c, field_type: 'currency' } : c);
    await adminForms.saveGridConfig(slug, updatedGrid);

    console.log(`${slug}: migrado a currency ->`, keys.join(', '));
  }

  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('MIGRATION FAILED', e); process.exit(1); });
