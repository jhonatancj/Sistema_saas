import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import '../../../core/ag-grid.init';
import { ApiService } from '../../../core/services/api.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../core/services/notification.service';

interface ApiResp<T> { success: boolean; data: T; message: string; errors: string[]; }

interface SuperAdmin {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  created_at: string;
  last_login_at?: string;
}

@Component({
  selector: 'app-super-admins',
  standalone: true,
  imports: [ReactiveFormsModule, AgGridAngular],
  templateUrl: './super-admins.component.html',
  styleUrl: './super-admins.component.scss',
})
export class SuperAdminsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);

  readonly loading = signal(false);
  readonly admins = signal<SuperAdmin[]>([]);
  readonly showModal = signal(false);
  readonly saving = signal(false);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
  });

  readonly defaultColDef: ColDef = { sortable: true, filter: true, resizable: true };

  readonly colDefs: ColDef<SuperAdmin>[] = [
    { headerName: 'Email', field: 'email', flex: 2, minWidth: 180 },
    {
      headerName: 'Nombre',
      flex: 1.5,
      minWidth: 140,
      valueGetter: (p: any) => `${p.data?.first_name ?? ''} ${p.data?.last_name ?? ''}`.trim(),
    },
    {
      headerName: 'Activo',
      field: 'is_active',
      width: 100,
      cellRenderer: (p: any) => {
        const span = document.createElement('span');
        span.textContent = p.value ? 'Activo' : 'Inactivo';
        span.style.cssText = p.value
          ? 'display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:600;background:#dcfce7;color:#15803d'
          : 'display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:600;background:#f3f4f6;color:#6b7280';
        return span;
      },
    },
    {
      headerName: 'Último login',
      field: 'last_login_at',
      flex: 1,
      minWidth: 120,
      valueFormatter: (p: any) =>
        p.value ? new Date(p.value).toLocaleDateString('es-CO') : '—',
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
      headerName: 'Acciones',
      sortable: false,
      filter: false,
      width: 130,
      cellRenderer: (p: any) => {
        if (!p.data?.is_active) return null;
        const btn = document.createElement('button');
        btn.textContent = 'Desactivar';
        btn.style.cssText =
          'padding:2px 10px;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:12px;background:#fff;color:#dc2626;font-family:inherit';
        btn.onclick = () => this.requestDeactivate(p.data.id);
        return btn;
      },
    },
  ];

  ngOnInit(): void {
    this.breadcrumbs.set([
      { label: 'Panel de Administración', route: '/admin/dashboard' },
      { label: 'Super Admins' },
    ]);
    this.loadAdmins();
  }

  loadAdmins(): void {
    this.loading.set(true);
    this.api.get<ApiResp<SuperAdmin[]>>('/admin/super-admins').subscribe({
      next: (res) => { this.admins.set(res.data ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openCreate(): void {
    this.form.reset();
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  submit(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const body = {
      email: this.form.value.email,
      password: this.form.value.password,
      first_name: this.form.value.firstName,
      last_name: this.form.value.lastName,
    };
    this.api.post<ApiResp<SuperAdmin>>('/admin/super-admins', body).subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.loadAdmins();
        this.notification.success('Super admin creado.');
      },
      error: (err) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'Error al crear');
      },
    });
  }

  async requestDeactivate(id: string): Promise<void> {
    const confirmed = await this.notification.confirm({
      title: '¿Desactivar este super admin?',
      text: 'Ya no podrá iniciar sesión en el panel de administración.',
      confirmText: 'Sí, desactivar',
      danger: true,
    });
    if (!confirmed) return;

    this.api.delete<ApiResp<void>>(`/admin/super-admins/${id}`).subscribe({
      next: () => { this.loadAdmins(); this.notification.success('Super admin desactivado.'); },
      error: () => this.notification.error('Error al desactivar.'),
    });
  }
}
