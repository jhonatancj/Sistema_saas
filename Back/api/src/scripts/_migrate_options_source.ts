import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AdminFormsService } from '../modules/admin-forms/admin-forms.service';
import { FormGeneratorService } from '../modules/forms/form-generator.service';

// key -> { optionsSource, valueKey, labelKey } — reemplaza `options` estático
// por selects dinámicos (ver docs/adr/015-catalogo-rubro-categorias-unidades.md).
const FIELD_SOURCES: Record<string, { optionsSource: string; valueKey: string; labelKey: string }> = {
  categoria: { optionsSource: 'categorias', valueKey: 'nombre', labelKey: 'nombre' },
  unidad: { optionsSource: 'unidades_medida', valueKey: 'nombre', labelKey: 'nombre' },
  unidad_medida: { optionsSource: 'unidades_medida', valueKey: 'nombre', labelKey: 'nombre' },
};

function toOptionsSource(nodes: any[], keys: Set<string>): boolean {
  let changed = false;
  for (const node of nodes) {
    if (keys.has(node.key) && node.type === 'select' && !node.optionsSource) {
      const src = FIELD_SOURCES[node.key];
      delete node.options;
      delete node.defaultValue;
      node.optionsSource = src.optionsSource;
      node.valueKey = src.valueKey;
      node.labelKey = src.labelKey;
      changed = true;
    }
    if (node.children?.length) {
      if (toOptionsSource(node.children, keys)) changed = true;
    }
  }
  return changed;
}

const TARGETS: Record<string, string[]> = {
  producto_barrio: ['categoria', 'unidad'],
  producto_moda: ['categoria'],
  producto_ferreteria: ['categoria', 'unidad_medida'],
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const adminForms = app.get(AdminFormsService);
  const formGenerator = app.get(FormGeneratorService);

  for (const [slug, keys] of Object.entries(TARGETS)) {
    const current = await adminForms.getPublicForm(slug);
    const jsonForm = current.json_form;
    const keySet = new Set(keys);
    const changed = toOptionsSource(jsonForm.root, keySet);
    if (!changed) { console.log(`${slug}: SIN CAMBIOS`); continue; }

    await formGenerator.processForm('public', {
      slug, name: current.name, jsonForm,
      tableName: current.table_name, spName: current.sp_name, recreateSp: true,
      gridQuery: current.grid_query, icon: current.icon,
      displayMode: current.display_mode, modalWidth: current.modal_width,
    });
    console.log(`${slug}: migrado a optionsSource ->`, keys.join(', '));
  }

  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('MIGRATION FAILED', e); process.exit(1); });
