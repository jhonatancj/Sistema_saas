import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ModulesService } from '../modules/modules/modules.service';
import { FormGeneratorService } from '../modules/forms/form-generator.service';
import { FormExecutorService } from '../modules/forms/form-executor.service';
import { AdminFormsService } from '../modules/admin-forms/admin-forms.service';

// select dinámico: optionsSource apunta al slug del form 'rubro' (ver
// RemoteFormOptionsService — endpointId = slug), valueKey/labelKey mapean
// el objeto crudo {id, nombre, code, activo} a {value, label}.
const rubroSelectField = (key: string) => ({
  key, type: 'select', label: 'Rubro', children: [], required: true,
  optionsSource: 'rubro', valueKey: 'code', labelKey: 'nombre',
});

const CATEGORIAS_FORM = {
  version: 1,
  root: [
    {
      key: 'row_categoria', type: 'column', columns: 2, children: [
        { key: 'col_nombre', span: 6, type: 'column', children: [
          { key: 'nombre', type: 'text', label: 'Nombre', children: [], required: true, validators: [{ type: 'maxLength', value: 100 }] },
        ] },
        { key: 'col_rubro', span: 6, type: 'column', children: [rubroSelectField('rubro')] },
      ],
    },
    { key: 'activo', type: 'checkbox', label: 'Categoría activa', children: [], required: false },
  ],
};

const UNIDADES_FORM = {
  version: 1,
  root: [
    {
      key: 'row_unidad', type: 'column', columns: 3, children: [
        { key: 'col_nombre', span: 4, type: 'column', children: [
          { key: 'nombre', type: 'text', label: 'Nombre', children: [], required: true, validators: [{ type: 'maxLength', value: 100 }] },
        ] },
        { key: 'col_abrev', span: 4, type: 'column', children: [
          { key: 'abreviatura', type: 'text', label: 'Abreviatura', children: [], required: false, validators: [{ type: 'maxLength', value: 10 }] },
        ] },
        { key: 'col_rubro', span: 4, type: 'column', children: [rubroSelectField('rubro')] },
      ],
    },
    { key: 'activo', type: 'checkbox', label: 'Unidad activa', children: [], required: false },
  ],
};

const COL = (key: string, label: string, field_type: string, sort_order: number) => ({
  key, label, field_type, width: 150, visible: true, sort_order, is_custom: false,
});
const CATEGORIAS_COLS = [COL('nombre', 'Nombre', 'text', 0), COL('rubro', 'Rubro', 'select', 1), COL('activo', 'Categoría activa', 'checkbox', 2)];
const UNIDADES_COLS = [COL('nombre', 'Nombre', 'text', 0), COL('abreviatura', 'Abreviatura', 'text', 1), COL('rubro', 'Rubro', 'select', 2), COL('activo', 'Unidad activa', 'checkbox', 3)];

const full = (roleCode: string) => ({ roleCode, canView: true, canCreate: true, canEdit: true, canDelete: true });
const viewOnly = (roleCode: string) => ({ roleCode, canView: true, canCreate: false, canEdit: false, canDelete: false });

// código de rubro -> nombre de categoría/unidad, para sembrar filas
// representativas (reemplazan las opciones fijas que tenían antes los
// formularios de producto).
const CATEGORIAS_SEED: Record<string, string[]> = {
  tienda_barrio: ['Abarrotes', 'Bebidas', 'Aseo', 'Snacks', 'Lácteos', 'Panadería', 'Cigarrería', 'Otros'],
  moda: ['Camisa', 'Pantalón', 'Vestido', 'Calzado', 'Accesorio', 'Otros'],
  ferreteria: ['Herramientas', 'Eléctrico', 'Plomería', 'Pintura', 'Ferretería general', 'Otros'],
  belleza: ['Corte', 'Color', 'Manicure', 'Pedicure', 'Tratamiento', 'Otros'],
};
const UNIDADES_SEED: Record<string, { nombre: string; abreviatura: string }[]> = {
  tienda_barrio: [
    { nombre: 'Unidad', abreviatura: 'und' }, { nombre: 'Paquete', abreviatura: 'paq' },
    { nombre: 'Caja', abreviatura: 'caja' }, { nombre: 'Gramo', abreviatura: 'g' },
    { nombre: 'Kilo', abreviatura: 'kg' }, { nombre: 'Litro', abreviatura: 'L' },
  ],
  ferreteria: [
    { nombre: 'Unidad', abreviatura: 'und' }, { nombre: 'Metro', abreviatura: 'm' },
    { nombre: 'Kilo', abreviatura: 'kg' }, { nombre: 'Litro', abreviatura: 'L' },
    { nombre: 'Galón', abreviatura: 'gal' }, { nombre: 'Rollo', abreviatura: 'rollo' },
    { nombre: 'Caja', abreviatura: 'caja' },
  ],
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const modules = app.get(ModulesService);
  const forms = app.get(FormGeneratorService);
  const formExecutor = app.get(FormExecutorService);
  const adminForms = app.get(AdminFormsService);

  await forms.processForm('public', {
    slug: 'categorias', name: 'Categorías', jsonForm: CATEGORIAS_FORM,
    icon: 'fa-solid fa-tag', displayMode: 'modal',
  });
  await adminForms.saveGridConfig('categorias', [...CATEGORIAS_COLS]);
  const categorias = await modules.createPublicModule({
    name: 'Categorías', code: 'CATEGORIAS', icon: 'fa-solid fa-tag',
    description: 'Categorías de productos/servicios (compartido, filtrado por rubro al sincronizar)',
    sortOrder: 30,
  });
  await modules.setPublicModuleForms(categorias.id, ['categorias']);
  await modules.setPublicModuleRoles(categorias.id, [full('ADMIN'), viewOnly('SALES'), viewOnly('WAREHOUSE')]);
  console.log('Categorías OK — module id', categorias.id);

  await forms.processForm('public', {
    slug: 'unidades_medida', name: 'Unidades de medida', jsonForm: UNIDADES_FORM,
    icon: 'fa-solid fa-ruler', displayMode: 'modal',
  });
  await adminForms.saveGridConfig('unidades_medida', [...UNIDADES_COLS]);
  const unidades = await modules.createPublicModule({
    name: 'Unidades de medida', code: 'UNIDADES_MEDIDA', icon: 'fa-solid fa-ruler',
    description: 'Unidades de medida de inventario (compartido, filtrado por rubro al sincronizar)',
    sortOrder: 40,
  });
  await modules.setPublicModuleForms(unidades.id, ['unidades_medida']);
  await modules.setPublicModuleRoles(unidades.id, [full('ADMIN'), viewOnly('SALES'), viewOnly('WAREHOUSE')]);
  console.log('Unidades de medida OK — module id', unidades.id);

  // Sembrar filas representativas
  for (const [rubro, nombres] of Object.entries(CATEGORIAS_SEED)) {
    for (const nombre of nombres) {
      await formExecutor.execute('public', 'categorias', 'INSERT', undefined, { nombre, rubro, activo: true });
    }
  }
  console.log('categorías sembradas OK');

  for (const [rubro, unidadesList] of Object.entries(UNIDADES_SEED)) {
    for (const u of unidadesList) {
      await formExecutor.execute('public', 'unidades_medida', 'INSERT', undefined, { ...u, rubro, activo: true });
    }
  }
  console.log('unidades sembradas OK');

  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('SEED FAILED', e); process.exit(1); });
