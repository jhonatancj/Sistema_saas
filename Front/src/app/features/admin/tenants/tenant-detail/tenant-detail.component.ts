import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GetRowIdParams, GridApi, GridReadyEvent, RowSelectionOptions } from 'ag-grid-community';
import '../../../../core/ag-grid.init';
import { ApiService } from '../../../../core/services/api.service';
import { BreadcrumbService } from '../../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../../core/services/notification.service';

interface ApiResp<T> { success: boolean; data: T; message: string; errors: string[]; }

interface FormAccessConfig { mode: 'all' | 'restricted'; allowed_slugs: string[]; }
interface CatalogFormItem { id: number; slug: string; name: string; icon?: string; }

interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  max_users: number;
  trialEndsAt?: string;
  createdAt: string;
  contactEmail?: string;
}

interface TenantUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  roles: string[];
}

export const STATUS_OPTIONS = ['trial', 'active', 'suspended', 'cancelled'] as const;

@Component({
  selector: 'app-tenant-detail',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, FormsModule, AgGridAngular],
  templateUrl: './tenant-detail.component.html',
  styleUrl: './tenant-detail.component.scss',
})
export class TenantDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);

  readonly STATUS_OPTIONS = STATUS_OPTIONS;
  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';

  readonly loading = signal(false);
  readonly tenant = signal<AdminTenant | null>(null);
  readonly users = signal<TenantUser[]>([]);
  readonly saving = signal(false);

  readonly formAccess = signal<FormAccessConfig | null>(null);
  readonly catalogForms = signal<CatalogFormItem[]>([]);
  readonly formAccessMode = signal<'all' | 'restricted'>('all');
  readonly selectedAllowedSlugs = signal<string[]>([]);
  readonly savingFormAccess = signal(false);

  private formAccessGridApi: GridApi<CatalogFormItem> | null = null;
  private syncingFormAccessSelection = false;

  readonly formAccessColDefs: ColDef<CatalogFormItem>[] = [
    { headerName: 'Nombre', field: 'name', flex: 2, minWidth: 160 },
    { headerName: 'Slug', field: 'slug', flex: 1, minWidth: 120 },
  ];
  readonly formAccessDefaultColDef: ColDef = { sortable: true, filter: true, resizable: true };
  readonly formAccessRowSelection: RowSelectionOptions = {
    mode: 'multiRow',
    checkboxes: true,
    headerCheckbox: true,
  };
  readonly getFormAccessRowId = (params: GetRowIdParams<CatalogFormItem>) => params.data.slug;

  readonly form = this.fb.group({
    status: ['', Validators.required],
    maxUsers: [1, [Validators.required, Validators.min(1)]],
    trialEndsAt: [''],
  });

  readonly syncingModules = signal(false);

  async syncModules(): Promise<void> {
    const confirmed = await this.notification.confirm({
      title: '¿Sincronizar módulos del catálogo?',
      text: 'Copia los módulos públicos activos (y sus formularios) a este tenant. Los módulos ya sincronizados se actualizan con los datos del catálogo (nombre, ícono, orden); los formularios y permisos por rol nunca se sobreescriben si el tenant ya los tiene.',
      confirmText: 'Sí, sincronizar',
    });
    if (!confirmed) return;
    this.syncingModules.set(true);
    this.api.post<ApiResp<any>>(`/admin/tenants/${this.tenantId}/modules/sync`, {}).subscribe({
      next: () => {
        this.syncingModules.set(false);
        this.notification.success('Módulos sincronizados correctamente.');
      },
      error: (err) => {
        this.syncingModules.set(false);
        this.notification.error(err?.error?.message ?? 'Error al sincronizar módulos.');
      },
    });
  }

  ngOnInit(): void {
    this.breadcrumbs.set([
      { label: 'Panel de Administración', route: '/admin/dashboard' },
      { label: 'Tenants', route: '/admin/tenants' },
      { label: 'Detalle' },
    ]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.get<ApiResp<AdminTenant>>(`/admin/tenants/${this.tenantId}`).subscribe({
      next: (res) => {
        this.tenant.set(res.data);
        this.form.patchValue({
          status: res.data.status,
          maxUsers: res.data.max_users,
          trialEndsAt: res.data.trialEndsAt ? res.data.trialEndsAt.substring(0, 10) : '',
        });
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.get<ApiResp<TenantUser[]>>(`/admin/tenants/${this.tenantId}/users`).subscribe({
      next: (res) => this.users.set(res.data ?? []),
      error: () => {},
    });
    this.api.get<ApiResp<FormAccessConfig>>(`/admin/tenants/${this.tenantId}/form-access`).subscribe({
      next: (res) => {
        this.formAccess.set(res.data);
        this.formAccessMode.set(res.data.mode);
        this.selectedAllowedSlugs.set([...res.data.allowed_slugs]);
        this.applyFormAccessSelection();
      },
      error: () => {},
    });
    this.api.get<ApiResp<CatalogFormItem[]>>('/admin/forms').subscribe({
      next: (res) => this.catalogForms.set(res.data ?? []),
      error: () => {},
    });
  }

  // ── Grid de formularios permitidos ──────────────────────────────────
  // La grid se puebla (catalogForms) y la selección guardada
  // (selectedAllowedSlugs) llegan por dos llamadas HTTP independientes que
  // pueden resolver en cualquier orden — se re-aplica la selección tanto
  // cuando cambian las filas (onRowDataUpdated) como cuando llega la config
  // guardada (acá), así ninguno de los dos órdenes deja la grid sin marcar.
  // syncingFormAccessSelection evita que la re-aplicación programática
  // dispare onSelectionChanged y sobreescriba la señal con el mismo valor.
  private applyFormAccessSelection(): void {
    if (!this.formAccessGridApi) return;
    this.syncingFormAccessSelection = true;
    const slugs = new Set(this.selectedAllowedSlugs());
    this.formAccessGridApi.forEachNode((node) => {
      if (node.data) node.setSelected(slugs.has(node.data.slug));
    });
    this.syncingFormAccessSelection = false;
  }

  onFormAccessGridReady(event: GridReadyEvent<CatalogFormItem>): void {
    this.formAccessGridApi = event.api;
    this.applyFormAccessSelection();
  }

  onFormAccessRowDataUpdated(): void {
    this.applyFormAccessSelection();
  }

  onFormAccessSelectionChanged(): void {
    if (this.syncingFormAccessSelection || !this.formAccessGridApi) return;
    this.selectedAllowedSlugs.set(this.formAccessGridApi.getSelectedRows().map((r) => r.slug));
  }

  saveFormAccess(): void {
    if (this.savingFormAccess()) return;
    this.savingFormAccess.set(true);
    const mode = this.formAccessMode();
    const allowedSlugs = mode === 'restricted' ? this.selectedAllowedSlugs() : [];
    this.api.patch<ApiResp<FormAccessConfig>>(`/admin/tenants/${this.tenantId}/form-access`, {
      mode, allowedSlugs,
    }).subscribe({
      next: (res) => {
        this.formAccess.set(res.data);
        this.savingFormAccess.set(false);
        this.notification.success('Acceso a formularios actualizado');
      },
      error: (err) => {
        this.savingFormAccess.set(false);
        this.notification.error(err?.error?.message ?? 'Error al guardar acceso a formularios');
      },
    });
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const body: Record<string, unknown> = {
      status: this.form.value.status,
      maxUsers: Number(this.form.value.maxUsers),
    };
    if (this.form.value.trialEndsAt) body['trialEndsAt'] = this.form.value.trialEndsAt;
    this.api.patch<ApiResp<AdminTenant>>(`/admin/tenants/${this.tenantId}`, body).subscribe({
      next: (res) => {
        this.tenant.set(res.data);
        this.saving.set(false);
        this.notification.success('Tenant actualizado correctamente');
      },
      error: (err) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'Error al guardar');
      },
    });
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      trial: 'Prueba', active: 'Activo', suspended: 'Suspendido', cancelled: 'Cancelado',
    };
    return map[status] ?? status;
  }

  formatDate(date: string): string {
    try { return new Date(date).toLocaleDateString('es-CO'); } catch { return date; }
  }
}
