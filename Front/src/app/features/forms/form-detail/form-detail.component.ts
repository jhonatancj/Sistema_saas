import { Component, inject, signal, computed, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ColDef, IDatasource, IGetRowsParams } from 'ag-grid-community';
import { Subject } from 'rxjs';
import { FormRendererComponent, BuilderSchema, FormSubmission, FORM_OPTIONS_PROVIDER } from '@jhonatancj/dforms';
import { ApiService } from '../../../core/services/api.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TenantService } from '../../../core/services/tenant.service';
import { RemoteFormOptionsService } from '../../../core/services/remote-form-options.service';
import { decodeFormRoute } from '../../../core/utils/route-obfuscation';
import { GridFormComponent } from '../grid-form/grid-form.component';

interface ApiResp<T> { success: boolean; data: T; message: string; }

interface FormRecord {
  id: number; slug: string; name: string;
  json_form: BuilderSchema; has_table: boolean; has_sp: boolean;
  display_mode?: 'modal' | 'inline' | null; modal_width?: number | null;
}

const DEFAULT_MODAL_WIDTH = 620;

interface GridColumn {
  key: string; label: string; width: number;
  visible: boolean; sort_order: number; field_type: string;
}

interface GridSelectResponse { rows: any[]; total: number; }

// Tipos de campo que no tienen un filtro de AG-Grid Community razonable
// (no hay filtro booleano en Community, y filtrar por base64 no aplica).
const UNFILTERABLE_FIELD_TYPES = new Set(['checkbox', 'image']);
// `currency` guarda un number puro en la DB (ver @jhonatancj/dforms) — mismo
// filtro numérico que `number`.
const NUMERIC_FIELD_TYPES = new Set(['number', 'currency']);
const currencyFormatter = new Intl.NumberFormat('es-CO');

@Component({
  selector: 'app-form-detail',
  standalone: true,
  imports: [GridFormComponent, FormRendererComponent],
  // Selects con optionsSource (categorías/unidades/rubro, ver
  // docs/adr/015-catalogo-rubro-categorias-unidades.md). Registrado acá (no
  // en app.config.ts) para no arrastrar dforms al bundle inicial: esta ruta
  // ya es lazy y ya importa la librería.
  providers: [{ provide: FORM_OPTIONS_PROVIDER, useClass: RemoteFormOptionsService }],
  templateUrl: './form-detail.component.html',
  styleUrl: './form-detail.component.scss',
})
export class FormDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);
  private readonly tenant = inject(TenantService);

  // Ruta /admin/m/... (catálogo público, ejecutado como super admin) vs
  // /app/m/... (tenant real) — mismo componente, distinto prefijo de API,
  // mismo patrón que SettingsSecurityComponent.isAdmin.
  private readonly isAdmin = computed(() => this.tenant.isAdminContext());
  private readonly formsBase = computed(() => this.isAdmin() ? '/admin/forms' : '/forms');

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly form = signal<FormRecord | null>(null);
  readonly gridConfig = signal<GridColumn[]>([]);
  readonly totalRows = signal<number | null>(null);
  readonly modalMode = signal<'create' | 'edit' | null>(null);
  readonly editingRow = signal<any | null>(null);

  // d-form-render (>=1.3.1) ya no renderiza su propio botón de guardado — el
  // envío se dispara desde acá vía [submitTrigger], mismo patrón que
  // exportTrigger$ en el builder.
  readonly submitTrigger$ = new Subject<void>();

  // Data inicial del formulario — ya no se inyecta en el JSON schema (ver
  // withPrefilledValues, eliminado); viaja vía [(submission)] (dforms
  // >=1.3.1). Se resetea en openCreate/openEdit.
  readonly submission = signal<FormSubmission>({ data: {} });

  private readonly gridRef = viewChild(GridFormComponent);

  readonly colDefs = computed<ColDef[]>(() =>
    this.gridConfig()
      .filter(c => c.visible)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(c => ({
        headerName: c.label,
        field: c.key,
        width: c.width || 150,
        filter: UNFILTERABLE_FIELD_TYPES.has(c.field_type)
          ? false
          : NUMERIC_FIELD_TYPES.has(c.field_type) ? 'agNumberColumnFilter'
          : c.field_type === 'date' ? 'agDateColumnFilter' : 'agTextColumnFilter',
        cellRenderer: c.field_type === 'image' ? (params: any) => {
          if (!params.value) return '';

          return `      <img src="${params.value}" alt="Imagen" style=" width:45px; height:45px; border-radius:6px; object-fit:cover; " /> `;
        } : c.field_type === 'currency' ? (params: any) => {
          if (params.value == null || params.value === '') return '';
          return `$ ${currencyFormatter.format(Number(params.value))}`;
        } : undefined

      }))
  );

  // minWidth/maxWidth acotan el ancho automático (ver
  // GridFormComponent.onModelUpdated) — sin maxWidth, una celda con texto
  // largo aislada (ej. una descripción) podría estirar su columna mucho más
  // de lo razonable a costa de las demás.
  readonly defaultColDef: ColDef = { sortable: true, resizable: true, minWidth: 90, maxWidth: 420 };

  // Búsqueda general — el input vive dentro de <app-grid-form> (ver
  // GridFormComponent.searchChange, ya debounced); acá solo se guarda el
  // término final para que datasource() lo incluya en el request. Signal (no
  // campo plano) a propósito: datasource() depende de esto para reconstruirse.
  readonly search = signal('');

  // Datasource de AG-Grid (Infinite Row Model + paginación, ver
  // GridFormComponent): traduce startRow/endRow + filterModel + sortModel de
  // AG-Grid al contrato { limit, offset, filter: { filters, sorts, search } }
  // de POST /forms/:slug/execute. Es un computed sobre slug() y search() a
  // propósito: cuando cambia el form o el término de búsqueda, cambia la
  // identidad del datasource, y AG-Grid detecta el cambio de referencia y
  // descarta su caché sola, volviendo a la primera página (sin esto quedaría
  // mostrando datos del form/búsqueda anterior).
  readonly datasource = computed<IDatasource>(() => {
    const slug = this.slug();
    const search = this.search();
    return {
      getRows: (params: IGetRowsParams) => {
        const filters = Object.entries<any>(params.filterModel ?? {}).map(([field, cond]) => ({
          field,
          operator: cond.type,
          value: cond.filter,
          valueTo: cond.filterTo,
        }));
        const sorts = (params.sortModel ?? []).map((s) => ({ field: s.colId, sort: s.sort }));

        const body: Record<string, any> = {
          action: 'SELECT',
          limit: params.endRow - params.startRow,
          offset: params.startRow,
        };
        if (filters.length > 0 || sorts.length > 0 || search.trim()) {
          body['filter'] = { filters, sorts, search: search.trim() || undefined };
        }

        this.api.post<ApiResp<GridSelectResponse>>(`${this.formsBase()}/${slug}/execute`, body).subscribe({
          next: (res) => {
            this.totalRows.set(res.data.total);
            params.successCallback(res.data.rows, res.data.total);
          },
          error: () => params.failCallback(),
        });
      },
    };
  });

  readonly modalSchema = computed<BuilderSchema | null>(() => this.form()?.json_form ?? null);

  // Modo de visualización configurado desde el builder — 'modal' (default)
  // abre el registro en un modal flotante; 'inline' oculta la grid y muestra
  // el form en su lugar dentro de la misma vista.
  readonly isInline = computed(() => this.form()?.display_mode === 'inline');
  readonly modalWidthPx = computed(() => this.form()?.modal_width || DEFAULT_MODAL_WIDTH);

  // Signal (no plain field) a propósito: el datasource() computed depende
  // de esto para reconstruirse — ver el comentario ahí arriba.
  private readonly slug = signal('');
  private moduleCode = '';

  // Angular reutiliza esta misma instancia de componente al navegar entre
  // rutas que matchean el mismo patrón (/app/m con distinto query param
  // `data`) — ngOnInit NO se vuelve a disparar en ese caso. Por eso hay que
  // suscribirse a queryParamMap (reactivo) en vez de leer route.snapshot una
  // sola vez. `data` viaja ofuscado en base64 (ver
  // core/utils/route-obfuscation.ts) para no exponer el code/slug interno
  // en la URL — nunca es cifrado real, solo evita que se vea a simple vista.
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const decoded = decodeFormRoute(params.get('data'));
      this.slug.set(decoded?.formSlug ?? '');
      const modulo = decoded?.moduleCode ?? '';
      this.moduleCode = modulo.charAt(0).toUpperCase() + modulo.slice(1);
      this.resetState();
      if (decoded) this.loadForm();
      else this.loading.set(false);
    });
  }

  private resetState(): void {
    this.form.set(null);
    this.gridConfig.set([]);
    this.totalRows.set(null);
    this.modalMode.set(null);
    this.editingRow.set(null);
    this.submission.set({ data: {} });
    this.search.set('');
    this.gridRef()?.resetSearch();
  }

  openCreate(): void {
    this.editingRow.set(null);
    this.submission.set({ data: {} });
    this.modalMode.set('create');
    this.autoFillCurrentEmployee();
  }

  // Busca un campo input-lupa marcado con `autoFillCurrentEmployee: true`
  // (convención propia de este proyecto, opaca para dforms — ver
  // docs/adr/019, sección de autocompletado) — ej. "vendedor" en Ventas.
  private findAutoFillEmployeeField(schema: BuilderSchema | null): any | null {
    if (!schema) return null;
    const walk = (nodes: any[]): any | null => {
      for (const n of nodes) {
        if (n.type === 'input-lupa' && n.autoFillCurrentEmployee === true) return n;
        if (n.children?.length) {
          const found = walk(n.children);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(schema.root ?? []);
  }

  // Si el form tiene ese campo, resuelve el empleado cuyo email coincide con
  // el usuario logueado y precarga el campo + sus assignments — igual que
  // haría el usuario seleccionándolo a mano en el modal de la lupa. Sin
  // match (usuario sin fila en empleados), no hace nada — el campo queda
  // buscable a mano, no bloquea la creación del registro.
  private autoFillCurrentEmployee(): void {
    const field = this.findAutoFillEmployeeField(this.modalSchema());
    if (!field) return;

    this.api.get<ApiResp<{ id: number; nombre: string } | null>>(`${this.formsBase()}/me/empleado`).subscribe({
      next: (res) => {
        const empleado = res.data;
        if (!empleado) return;
        const patch: Record<string, any> = { [field.key]: empleado.nombre };
        for (const a of field.assignments ?? []) {
          patch[a.formProperty] = (empleado as any)[a.responseProperty];
        }
        this.submission.update((s) => ({ data: { ...s.data, ...patch } }));
      },
      error: () => {},
    });
  }

  // Un form con un campo 'line-items' (ver docs/adr/017-tabla-detalle-line-items.md)
  // guarda sus líneas en una tabla de detalle aparte — la fila que trae la
  // grid (selectPaged(), solo columnas del encabezado) no las incluye. Para
  // esos forms, reabrir un registro pide SELECT_BY_ID (sí pasa por el SP,
  // que devuelve el encabezado + su array de líneas anidado) antes de abrir
  // el modal. Genérico: cualquier form futuro con line-items lo hereda gratis.
  private hasLineItemsField(schema: BuilderSchema | null): boolean {
    if (!schema) return false;
    const walk = (nodes: any[]): boolean =>
      nodes.some((n) => n.type === 'line-items' || (n.children?.length && walk(n.children)));
    return walk(schema.root ?? []);
  }

  openEdit(row: any): void {
    this.editingRow.set(row);

    if (!this.hasLineItemsField(this.form()?.json_form ?? null)) {
      this.submission.set({ data: row });
      this.modalMode.set('edit');
      return;
    }

    // <d-form-render> solo se monta vía @if (modalMode()) — si seteamos
    // modalMode ANTES de tener el detalle, el campo line-items se
    // inicializa vacío y una actualización posterior de `submission` no lo
    // vuelve a poblar (ya montado). Por eso se espera la respuesta completa
    // de SELECT_BY_ID antes de abrir el modal, para que monte una sola vez
    // con los datos ya completos.
    this.api.post<ApiResp<any>>(`${this.formsBase()}/${this.slug()}/execute`, { action: 'SELECT_BY_ID', id: row.id })
      .subscribe({
        next: (res) => {
          this.submission.set({ data: res.data ?? row });
          this.modalMode.set('edit');
        },
        error: () => {
          this.submission.set({ data: row });
          this.modalMode.set('edit');
        },
      });
  }

  closeModal(): void {
    this.modalMode.set(null);
    this.editingRow.set(null);
  }

  requestSubmit(): void {
    this.submitTrigger$.next();
  }

  onSubmit(data: Record<string, any>): void {
    const mode = this.modalMode();
    const action = mode === 'edit' ? 'UPDATE' : 'INSERT';
    const id = mode === 'edit' ? this.editingRow()?.id : undefined;

    this.saving.set(true);
    this.api.post<ApiResp<any>>(`${this.formsBase()}/${this.slug()}/execute`, { action, id, data })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closeModal();
          this.gridRef()?.refresh();
          this.notification.success(mode === 'edit' ? 'Registro actualizado.' : 'Registro creado.');
        },
        error: () => { this.saving.set(false); this.notification.error('Error al guardar.'); },
      });
  }

  async requestDelete(id: number): Promise<void> {
    const confirmed = await this.notification.confirm({
      title: '¿Eliminar este registro?',
      text: 'Esta acción no se puede deshacer.',
      confirmText: 'Sí, eliminar',
      danger: true,
    });
    if (!confirmed) return;

    this.api.post<ApiResp<any>>(`${this.formsBase()}/${this.slug()}/execute`, { action: 'DELETE', id })
      .subscribe({
        next: () => {
          this.gridRef()?.refresh();
          this.notification.success('Registro eliminado.');
        },
        error: () => this.notification.error('Error al eliminar.'),
      });
  }

  private loadForm(): void {
    this.loading.set(true);
    this.api.get<ApiResp<FormRecord>>(`${this.formsBase()}/${this.slug()}`).subscribe({
      next: (res) => {
        this.form.set(res.data);
        this.breadcrumbs.set([{ label: this.moduleCode }, { label: res.data.name }]);
        this.loading.set(false);
        this.loadGridConfig();
      },
      error: () => this.loading.set(false),
    });
  }

  private loadGridConfig(): void {
    this.api.get<ApiResp<GridColumn[]>>(`${this.formsBase()}/${this.slug()}/grid`).subscribe({
      next: (res) => this.gridConfig.set(res.data ?? []),
    });
  }
}
