import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { NgSelectModule } from '@ng-select/ng-select';
import { FormsModule } from '@angular/forms';
import { BuilderComponent, BuilderSchema, FORM_OPTIONS_PROVIDER } from '@jhonatancj/dforms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import '../../../core/ag-grid.init';
import { ApiService } from '../../../core/services/api.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RemoteFormOptionsService } from '../../../core/services/remote-form-options.service';
import { SqlEditorComponent } from '../../../shared/sql-editor/sql-editor.component';
import { Subject } from 'rxjs';

interface ApiResp<T> { success: boolean; data: T; message: string; }
interface FormItem {
  id: number; slug: string; name: string;
  has_table?: boolean; has_sp?: boolean; created_at: string;
  table_name?: string | null; sp_name?: string | null; grid_query?: string | null; icon?: string | null;
  display_mode?: 'modal' | 'inline' | null; modal_width?: number | null;
}
interface TenantItem { id: string; slug: string; name: string; }

const EMPTY_SCHEMA: BuilderSchema = { version: 1, root: [] };

// Interfaces nuevas
interface GridColumn {
  key: string;
  label: string;
  width: number;
  visible: boolean;
  sort_order: number;
  field_type: string;
  // true = agregada a mano desde la pestaña Grid (no viene de ningún campo
  // del formulario visual) — típicamente una columna que sale de un JOIN
  // en la pestaña SQL. Editable/eliminable libremente; una columna de campo
  // real solo se oculta (checkbox "Visible"), nunca se borra desde acá.
  is_custom?: boolean;
}

const CUSTOM_COLUMN_TYPES = ['text', 'number', 'select', 'textarea', 'checkbox', 'image', 'currency'];
@Component({
  selector: 'app-builder',
  standalone: true,
  imports: [NgSelectModule, FormsModule, BuilderComponent, AgGridAngular, SqlEditorComponent],
  // Selects con optionsSource (categorías/unidades/rubro, ver
  // docs/adr/015-catalogo-rubro-categorias-unidades.md). Registrado acá (no
  // en app.config.ts) para no arrastrar dforms al bundle inicial: esta ruta
  // ya es lazy y ya importa la librería.
  providers: [{ provide: FORM_OPTIONS_PROVIDER, useClass: RemoteFormOptionsService }],
  templateUrl: './builder.component.html',
  styleUrl: './builder.component.scss',
})
export class AdminBuilderComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);

  readonly view = signal<'grid' | 'builder'>('grid');
  readonly mode = signal<'public' | 'tenant'>('public');
  readonly tenants = signal<TenantItem[]>([]);
  readonly forms = signal<FormItem[]>([]);
  readonly selectedTenant = signal<string | null>(null);
  readonly activeForm = signal<FormItem | null>(null);
  readonly schema = signal<BuilderSchema>(EMPTY_SCHEMA);
  readonly isNew = signal(false);
  readonly loadingForms = signal(false);
  readonly saving = signal(false);
  // Validación inline junto al campo (política de notificaciones — CLAUDE.md
  // §19: nunca Toastr para "campo obligatorio").
  readonly nameError = signal(false);
  readonly slugError = signal(false);


  // Señales nuevas (agrega a las existentes)
  readonly builderTab = signal<'design' | 'grid' | 'sql'>('design');
  readonly gridColumns = signal<GridColumn[]>([]);
  readonly savingGrid = signal(false);
  readonly customColumnTypes = CUSTOM_COLUMN_TYPES;

  // Estado del formulario para agregar una columna manual (ver addCustomColumn)
  newCustomColKey = '';
  newCustomColLabel = '';
  newCustomColType = 'text';

  // Tabla/SP/ícono/query custom — solo aplican en modo tenant (ver §Fase 5 del plan)
  readonly existingTables = signal<string[]>([]);
  readonly tableMode = signal<'new' | 'existing'>('new');
  readonly selectedExistingTable = signal<string | null>(null);
  readonly recreateSp = signal(true);
  readonly spNameOverride = signal('');
  readonly formIcon = signal('');
  readonly gridQueryText = signal('');
  // Snapshot del SELECT autogenerado que se precarga en gridQueryText cuando
  // el form no tiene grid_query propio (ver resolveGridQueryText) — permite
  // distinguir en onExport() "el admin no tocó nada" de "el admin escribió
  // esto a propósito", para no convertir cada Guardar en una fijación
  // silenciosa de grid_query sobre un form que nunca tuvo uno.
  private suggestedGridQuery = '';

  // Modo de visualización del registro: modal (default) o inline (el form
  // reemplaza la grid en la misma vista, ver FormDetailComponent). Aplica a
  // formularios públicos y de tenant por igual, igual que el ícono.
  readonly displayMode = signal<'modal' | 'inline'>('modal');
  readonly modalWidth = signal<number | null>(null);


  // Como propiedad de la clase:
  readonly exportTrigger$ = new Subject<void>();

  // Campos del header del builder
  formName = '';
  formSlug = '';

  readonly isTenantMode = computed(() => this.mode() === 'tenant');

  readonly colDefs: ColDef<FormItem>[] = [
    { headerName: 'Nombre', field: 'name', flex: 2, minWidth: 160 },
    { headerName: 'Slug', field: 'slug', flex: 2, minWidth: 160 },
    {
      headerName: 'Tabla',
      field: 'has_table',
      width: 90,
      cellRenderer: (p: any) =>
        p.value === true ? '✅' : p.value === false ? '❌' : '—',
    },
    {
      headerName: 'SP',
      field: 'has_sp',
      width: 80,
      cellRenderer: (p: any) =>
        p.value === true ? '✅' : p.value === false ? '❌' : '—',
    },
    {
      headerName: 'Creado',
      field: 'created_at',
      flex: 1,
      minWidth: 120,
      valueFormatter: (p: any) =>
        p.value ? new Date(p.value).toLocaleDateString('es-CO') : '—',
    },
    {
      headerName: '',
      sortable: false,
      filter: false,
      width: 120,
      cellRenderer: (p: any) => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:6px;align-items:center;height:100%';

        const edit = document.createElement('button');
        edit.innerHTML = `<i class="fa-regular fa-pen-to-square"></i>`;
        edit.className = 'btn btn--sm btn--edit-ghost';
        edit.onclick = () => this.openBuilder(p.data);

        const del = document.createElement('button');
        del.innerHTML = `<i class="fa-regular fa-trash-can"></i>`;
        del.className = 'btn btn--sm btn--danger-ghost';
        del.onclick = () => this.requestDeleteForm(p.data);

        div.appendChild(edit);
        div.appendChild(del);
        return div;
      },
    },
  ];

  readonly defaultColDef: ColDef = { sortable: true, filter: true, resizable: true };

  ngOnInit(): void {
    this.breadcrumbs.set([{ label: 'Builder' }]);
    this.loadTenants();
    this.loadForms();
    this.loadExistingTables();
  }

  // Método del botón Guardar en toolbar:
  requestSave(): void {
    if (!this.validateNameSlug()) return;
    this.exportTrigger$.next();
  }

  private validateNameSlug(): boolean {
    this.nameError.set(!this.formName);
    this.slugError.set(!this.formSlug);
    return !!this.formName && !!this.formSlug;
  }

  setMode(m: 'public' | 'tenant'): void {
    this.mode.set(m);
    this.selectedTenant.set(null);
    this.forms.set([]);
    this.existingTables.set([]);
    if (m === 'public') {
      this.loadForms();
      this.loadExistingTables();
    }
  }

  onTenantChange(slug: string | null): void {
    this.selectedTenant.set(slug);
    this.forms.set([]);
    this.existingTables.set([]);
    if (slug) {
      this.loadForms();
      this.loadExistingTables();
    }
  }

  private loadExistingTables(): void {
    const tenant = this.selectedTenant();
    const url = this.isTenantMode()
      ? (tenant ? `/admin/forms/tenant/${tenant}/tables` : null)
      : `/admin/forms/public/tables`;
    if (!url) { this.existingTables.set([]); return; }
    this.api.get<ApiResp<string[]>>(url).subscribe({
      next: (res) => this.existingTables.set(res.data ?? []),
    });
  }

  private resetAdvancedFields(form: FormItem | null): void {
    this.tableMode.set(form?.table_name ? 'existing' : 'new');
    this.selectedExistingTable.set(form?.table_name ?? null);
    this.recreateSp.set(true);
    this.spNameOverride.set(form?.sp_name ?? '');
    this.formIcon.set(form?.icon ?? '');
    this.gridQueryText.set(this.resolveGridQueryText(form));
    this.displayMode.set(form?.display_mode ?? 'modal');
    this.modalWidth.set(form?.modal_width ?? null);
  }

  // Si el form ya tiene un `grid_query` guardado, se respeta tal cual (nunca
  // se pisa una query custom del admin). Si no tiene uno guardado pero sí
  // tiene tabla real, se prellena con el SELECT equivalente al que usa hoy
  // el SP para listar (ver FormGeneratorService.buildSpDDL, rama SELECT sin
  // paginación, y FormExecutorService.selectPaged, que agrega `deleted_at IS
  // NULL` por default cuando no hay grid_query) — así el admin ve "lo que
  // hay" y parte de ahí para modificarlo, en vez de un editor vacío.
  private resolveGridQueryText(form: FormItem | null): string {
    this.suggestedGridQuery = '';
    if (form?.grid_query) return form.grid_query;
    if (!form?.has_table) return '';
    const table = form.table_name || `tbl_${form.slug}`;
    const schema = this.isTenantMode() && this.selectedTenant()
      ? `tenant_${this.selectedTenant()!.replace(/-/g, '_')}`
      : 'public';
    this.suggestedGridQuery = `SELECT * FROM ${schema}.${table} WHERE deleted_at IS NULL`;
    return this.suggestedGridQuery;
  }

  openBuilder(form: FormItem): void {
    this.isNew.set(false);
    this.activeForm.set(form);
    this.formName = form.name;
    this.formSlug = form.slug;
    this.schema.set(EMPTY_SCHEMA);
    this.nameError.set(false);
    this.slugError.set(false);
    this.resetAdvancedFields(form);
    this.loadSchema(form.slug);
    this.view.set('builder');
    this.breadcrumbs.set([{ label: 'Builder' }, { label: form.name }]);
  }

  openNew(): void {
    this.isNew.set(true);
    this.activeForm.set(null);
    this.formName = '';
    this.formSlug = '';
    this.schema.set(EMPTY_SCHEMA);
    this.nameError.set(false);
    this.slugError.set(false);
    this.resetAdvancedFields(null);
    this.view.set('builder');
    this.breadcrumbs.set([{ label: 'Builder' }, { label: 'Nuevo formulario' }]);
  }

  async requestDeleteForm(form: FormItem): Promise<void> {
    const confirmed = await this.notification.confirm({
      title: `¿Eliminar "${form.name}"?`,
      text: 'Esto elimina la tabla y el SP generados (si aplica) y quita el formulario de los módulos donde esté registrado. Esta acción no se puede deshacer.',
      confirmText: 'Sí, eliminar',
      danger: true,
    });
    if (!confirmed) return;

    const tenant = this.selectedTenant();
    const url = this.isTenantMode() && tenant
      ? `/admin/forms/tenant/${tenant}/${form.slug}`
      : `/admin/forms/${form.slug}`;

    this.api.delete<ApiResp<any>>(url).subscribe({
      next: () => {
        this.forms.update(list => list.filter(f => f.slug !== form.slug));
        if (this.activeForm()?.slug === form.slug) this.backToGrid();
        this.notification.success('Formulario eliminado.');
      },
      error: (err) => this.notification.error(err?.error?.message ?? 'Error al eliminar el formulario.'),
    });
  }

  backToGrid(): void {
    this.view.set('grid');
    this.activeForm.set(null);
    this.schema.set(EMPTY_SCHEMA);
    this.breadcrumbs.set([{ label: 'Builder' }]);
  }

  onExport(schema: BuilderSchema): void {
    if (!this.validateNameSlug()) return;

    this.saving.set(true);

    const tenantScoped = this.isTenantMode() && !!this.selectedTenant();
    // tableName/spName/recreateSp/gridQuery se mandan siempre (público y
    // tenant) — desde que public.forms tiene paridad de columnas con
    // {schema}.forms de tenant, el modo público también genera tabla/SP real.
    const payload: Record<string, any> = {
      name: this.formName,
      jsonForm: schema,
      icon: this.formIcon() || null,
      tableName: this.tableMode() === 'existing' ? this.selectedExistingTable() : null,
      spName: this.spNameOverride() || null,
      recreateSp: this.recreateSp(),
      // Si el admin no tocó el SELECT autogenerado (ver resolveGridQueryText),
      // no se persiste — evita que abrir el builder y guardar por cualquier
      // otro motivo (ej. cambiar el ícono) fije silenciosamente un
      // grid_query en un form que nunca tuvo uno.
      gridQuery: this.gridQueryText() === this.suggestedGridQuery ? null : (this.gridQueryText() || null),
      displayMode: this.displayMode(),
      modalWidth: this.displayMode() === 'modal' ? (this.modalWidth() || null) : null,
    };

    if (this.isNew()) {
      const url = tenantScoped ? `/admin/forms/tenant/${this.selectedTenant()}` : '/admin/forms';
      this.api.post<ApiResp<FormItem>>(url, { slug: this.formSlug, ...payload }).subscribe({
        next: (res) => {
          this.isNew.set(false);
          this.activeForm.set(res.data);
          this.forms.update(f => [...f, res.data]);
          this.saving.set(false);
          this.notification.success('Formulario creado.');
        },
        error: (err) => { this.saving.set(false); this.notification.error(err?.error?.message ?? 'Error al crear.'); },
      });
    } else {
      const url = tenantScoped
        ? `/admin/forms/tenant/${this.selectedTenant()}/${this.formSlug}`
        : `/admin/forms/${this.formSlug}`;

      this.api.patch<ApiResp<any>>(url, payload).subscribe({
        next: (res) => {
          this.saving.set(false);
          this.activeForm.set(res.data);
          this.notification.success('Guardado.');
        },
        error: (err) => { this.saving.set(false); this.notification.error(err?.error?.message ?? 'Error al guardar.'); },
      });
    }
  }

  private loadTenants(): void {
    this.api.get<ApiResp<TenantItem[]>>('/admin/tenants').subscribe({
      next: (res) => this.tenants.set(res.data ?? []),
    });
  }

  private loadForms(): void {
    this.loadingForms.set(true);
    const url = this.isTenantMode() && this.selectedTenant()
      ? `/admin/forms/tenant/${this.selectedTenant()}`
      : `/admin/forms`;

    this.api.get<ApiResp<FormItem[]>>(url).subscribe({
      next: (res) => { this.forms.set(res.data ?? []); this.loadingForms.set(false); },
      error: () => this.loadingForms.set(false),
    });
  }

  private loadSchema(slug: string): void {
    const url = this.isTenantMode() && this.selectedTenant()
      ? `/admin/forms/tenant/${this.selectedTenant()}/${slug}`
      : `/admin/forms/${slug}`;

    this.api.get<ApiResp<any>>(url).subscribe({
      next: (res) => {
        this.schema.set(res.data?.json_form ?? EMPTY_SCHEMA);
        this.activeForm.set(res.data);
        this.resetAdvancedFields(res.data ?? null);
      },
    });
  }

  switchToGrid(): void {
    this.builderTab.set('grid');
    this.loadGridConfig();
  }

  toggleVisible(col: GridColumn): void {
    col.visible = !col.visible;
    this.gridColumns.update(cols => [...cols]);
  }

  moveUp(col: GridColumn): void {
    const cols = [...this.gridColumns()];
    const i = cols.findIndex(c => c.key === col.key);
    if (i === 0) return;
    [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]];
    cols.forEach((c, idx) => c.sort_order = idx);
    this.gridColumns.set(cols);
  }

  moveDown(col: GridColumn): void {
    const cols = [...this.gridColumns()];
    const i = cols.findIndex(c => c.key === col.key);
    if (i === cols.length - 1) return;
    [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]];
    cols.forEach((c, idx) => c.sort_order = idx);
    this.gridColumns.set(cols);
  }
  saveGridConfig(): void {
    const form = this.activeForm();
    if (!form) return;
    this.savingGrid.set(true);

    const url = this.isTenantMode() && this.selectedTenant()
      ? `/admin/forms/${form.slug}/grid?tenant=${this.selectedTenant()}`
      : `/admin/forms/${form.slug}/grid`;

    this.api.post<ApiResp<any>>(url, { columns: this.gridColumns() }).subscribe({
      next: () => { this.savingGrid.set(false); this.notification.success('Grid guardada.'); },
      error: () => { this.savingGrid.set(false); this.notification.error('Error al guardar grid.'); },
    });
  }

  private loadGridConfig(): void {
    const form = this.activeForm();
    if (!form) return;

    const url = this.isTenantMode() && this.selectedTenant()
      ? `/admin/forms/${form.slug}/grid?tenant=${this.selectedTenant()}`
      : `/admin/forms/${form.slug}/grid`;

    this.api.get<ApiResp<GridColumn[]>>(url).subscribe({
      next: (res) => {
        const saved = res.data ?? [];
        const extracted = this.extractFieldsFromSchema(this.schema());
        const extractedKeys = new Set(extracted.map(f => f.key));

        // Columnas del formulario visual — se agregan si son nuevas, se
        // conserva su config si ya existían.
        const fromSchema: GridColumn[] = extracted.map((f, idx) => {
          const existing = saved.find(s => s.key === f.key);
          return existing
            ? { ...existing, is_custom: false }
            : { key: f.key, label: f.label, field_type: f.type, width: 150, visible: true, sort_order: idx, is_custom: false };
        });

        // Columnas guardadas que NO corresponden a ningún campo visual
        // actual — ej. una columna agregada a mano porque sale de un JOIN en
        // la pestaña SQL (ver docs/adr/005-...). Antes se perdían en cada
        // recarga de esta pestaña porque `merged` solo se armaba desde
        // `extracted`; ahora se conservan tal cual, editables/eliminables
        // desde la UI (ver addCustomColumn/removeCustomColumn).
        const custom: GridColumn[] = saved
          .filter(s => !extractedKeys.has(s.key))
          .map(s => ({ ...s, is_custom: true }));

        const merged = [...fromSchema, ...custom].sort((a, b) => a.sort_order - b.sort_order);
        this.gridColumns.set(merged);
      },
    });
  }

  // Columna que no viene de ningún campo del formulario visual — típicamente
  // una columna que sale de un JOIN agregado en la pestaña SQL (ver
  // docs/adr/005-grid-datasource-architecture.md). `key` debe coincidir
  // exactamente con el alias de esa columna en el SELECT.
  addCustomColumn(): void {
    const key = this.newCustomColKey.trim();
    if (!key) return;
    if (this.gridColumns().some(c => c.key === key)) {
      this.notification.error(`Ya existe una columna con la clave '${key}'.`);
      return;
    }
    const col: GridColumn = {
      key,
      label: this.newCustomColLabel.trim() || key,
      field_type: this.newCustomColType,
      width: 150,
      visible: true,
      sort_order: this.gridColumns().length,
      is_custom: true,
    };
    this.gridColumns.update(cols => [...cols, col]);
    this.newCustomColKey = '';
    this.newCustomColLabel = '';
    this.newCustomColType = 'text';
  }

  removeCustomColumn(col: GridColumn): void {
    this.gridColumns.update(cols =>
      cols.filter(c => c.key !== col.key).map((c, idx) => ({ ...c, sort_order: idx })),
    );
  }

  private extractFieldsFromSchema(schema: BuilderSchema): { key: string; label: string; type: string }[] {
    const extract = (nodes: any[]): any[] => {
      const result: any[] = [];
      for (const node of nodes) {
        if (node.type === 'column') {
          if (node.children?.length) result.push(...extract(node.children));
          continue;
        }
        if (node.children?.length) result.push(...extract(node.children));
        if (['text', 'number', 'select', 'textarea', 'checkbox', 'image', 'currency'].includes(node.type)) {
          result.push({ key: node.key, label: node.label ?? node.key, type: node.type });
        }
      }
      return result;
    };
    return extract((schema as any).root ?? []);
  }
}