import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import '../../../../core/ag-grid.init';
import { ApiService } from '../../../../core/services/api.service';
import { BreadcrumbService } from '../../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../../core/services/notification.service';

interface ApiResp<T> { success: boolean; data: T; message: string; errors: string[]; }

interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  max_users: number;
  trial_ends_at?: string;
  created_at: string;
}

@Component({
  selector: 'app-tenants-list',
  standalone: true,
  imports: [AgGridAngular, ReactiveFormsModule],
  templateUrl: './tenants-list.component.html',
  styleUrl: './tenants-list.component.scss',
})
export class TenantsListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);

  readonly loading = signal(false);
  readonly tenants = signal<AdminTenant[]>([]);
  readonly showModal = signal(false);
  readonly saving = signal(false);

  readonly form = this.fb.group({
    slug: ['', [Validators.required, Validators.pattern(/^[a-z0-9][a-z0-9-]{2,98}[a-z0-9]$/)]],
    name: ['', Validators.required],
    contactEmail: ['', Validators.email],
    maxUsers: [5, [Validators.required, Validators.min(1)]],
    adminEmail: ['', [Validators.required, Validators.email]],
    adminPassword: ['', [Validators.required, Validators.minLength(8)]],
    adminFirstName: ['', Validators.required],
    adminLastName: ['', Validators.required],
  });

  readonly defaultColDef: ColDef = { sortable: true, filter: true, resizable: true };

  readonly colDefs: ColDef<AdminTenant>[] = [
    { headerName: 'Nombre', field: 'name', flex: 1.5, minWidth: 160 },
    {
      headerName: 'Slug',
      field: 'slug',
      width: 140,
      cellStyle: { fontFamily: 'monospace', fontSize: '12px', color: 'var(--color-text-secondary, #6b7280)' },
    },
    {
      headerName: 'Estado',
      field: 'status',
      width: 120,
      valueFormatter: (p: any) => this.statusLabel(p.value),
      cellRenderer: (p: any) => {
        const span = document.createElement('span');
        span.textContent = this.statusLabel(p.data?.status);
        const styleMap: Record<string, string> = {
          trial: 'background:#fef9c3;color:#a16207',
          active: 'background:#dcfce7;color:#15803d',
          suspended: 'background:#fef2f2;color:#dc2626',
          cancelled: 'background:#f3f4f6;color:#6b7280',
        };
        span.style.cssText = `display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:600;${styleMap[p.data?.status] ?? ''}`;
        return span;
      },
    },
    { headerName: 'Max usuarios', field: 'max_users', width: 130 },
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
        const btn = document.createElement('button');
        btn.textContent = 'Ver detalle';
        btn.style.cssText =
          'padding:2px 10px;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;font-size:12px;background:#fff;color:#374151;font-family:inherit';
        btn.onclick = () => this.router.navigate(['/admin/tenants', p.data.id]);
        return btn;
      },
    },
  ];

  ngOnInit(): void {
    this.breadcrumbs.set([
      { label: 'Panel de Administración', route: '/admin/dashboard' },
      { label: 'Tenants' },
    ]);
    this.loadTenants();
  }

  private loadTenants(): void {
    this.loading.set(true);
    this.api.get<ApiResp<AdminTenant[]>>('/admin/tenants').subscribe({
      next: (res) => { this.tenants.set(res.data ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openCreate(): void {
    this.form.reset({ maxUsers: 5 });
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  submit(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const v = this.form.value;
    const body = {
      slug: v.slug,
      name: v.name,
      contactEmail: v.contactEmail || undefined,
      maxUsers: Number(v.maxUsers),
      adminEmail: v.adminEmail,
      adminPassword: v.adminPassword,
      adminFirstName: v.adminFirstName,
      adminLastName: v.adminLastName,
    };
    this.api.post<ApiResp<AdminTenant>>('/admin/tenants', body).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.closeModal();
        this.notification.success('Tenant creado correctamente.');
        this.router.navigate(['/admin/tenants', res.data.id]);
      },
      error: (err) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'Error al crear tenant');
      },
    });
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      trial: 'Prueba', active: 'Activo', suspended: 'Suspendido', cancelled: 'Cancelado',
    };
    return map[status] ?? status;
  }
}
