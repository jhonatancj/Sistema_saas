import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import '../../../core/ag-grid.init';
import { ApiService } from '../../../core/services/api.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../core/services/notification.service';
import { NgSelectModule } from '@ng-select/ng-select';

interface ApiResp<T> { success: boolean; data: T; message: string; errors: string[]; }

interface TenantUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  roles: string[];
  last_login_at?: string;
}

export const AVAILABLE_ROLES = [
  { label: 'Administrador', value: 'ADMIN' },
  { label: 'Vendedor', value: 'SALES' },
  { label: 'Almacenista', value: 'WAREHOUSE' },
] as const;

@Component({
  selector: 'app-settings-users',
  standalone: true,
  imports: [ReactiveFormsModule, AgGridAngular, NgSelectModule],
  templateUrl: './settings-users.component.html',
  styleUrl: './settings-users.component.scss',
})
export class SettingsUsersComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);

  readonly ROLES = AVAILABLE_ROLES;
  readonly loading = signal(false);
  readonly users = signal<TenantUser[]>([]);
  readonly showModal = signal(false);
  readonly editingUser = signal<TenantUser | null>(null);
  readonly saving = signal(false);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.minLength(8)],
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    isActive: [true],
    roles: [[] as string[]],  // ← agrega este campo
  });

  readonly defaultColDef: ColDef = { sortable: true, filter: true, resizable: true };

  readonly colDefs: ColDef<TenantUser>[] = [
    { headerName: 'Email', field: 'email', flex: 2, minWidth: 180 },
    {
      headerName: 'Nombre',
      flex: 1.5,
      minWidth: 140,
      valueGetter: (p: any) => `${p.data?.first_name ?? ''} ${p.data?.last_name ?? ''}`.trim(),
    },
    {
      headerName: 'Roles',
      flex: 1,
      minWidth: 100,
      valueGetter: (p: any) => p.data?.roles?.join(', ') || '—',
    },
    {
      headerName: 'Activo',
      field: 'is_active',
      width: 90,
      cellRenderer: (p: any) => {
        const span = document.createElement('span');
        span.textContent = p.value ? 'Sí' : 'No';
        span.style.cssText = p.value
          ? 'color:#15803d;font-weight:600'
          : 'color:#6b7280;font-weight:600';
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
      headerName: 'Acciones',
      sortable: false,
      filter: false,
      width: 160,
      cellRenderer: (p: any) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:6px;align-items:center;height:100%';

        const edit = document.createElement('button');
        edit.textContent = 'Editar';
        edit.style.cssText =
          'padding:2px 10px;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;font-size:12px;background:#fff;color:#374151;font-family:inherit';
        edit.onclick = () => this.openEdit(p.data);

        const del = document.createElement('button');
        del.textContent = 'Eliminar';
        del.style.cssText =
          'padding:2px 10px;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:12px;background:#fff;color:#dc2626;font-family:inherit';
        del.onclick = () => this.requestDelete(p.data.id);

        wrap.append(edit, del);
        return wrap;
      },
    },
  ];

  ngOnInit(): void {
    this.breadcrumbs.set([
      { label: 'Configuración' },
      { label: 'Usuarios' },
    ]);
    this.loadUsers();
  }

  loadUsers(): void {
    this.loading.set(true);
    this.api.get<ApiResp<TenantUser[]>>('/users').subscribe({
      next: (res) => { this.users.set(res.data ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openCreate(): void {
    this.editingUser.set(null);
    this.form.reset({ isActive: true });
    this.form.get('email')?.enable();
    this.form.get('password')?.addValidators(Validators.required);
    this.form.get('password')?.updateValueAndValidity();
    this.showModal.set(true);
  }

  openEdit(user: TenantUser): void {
    this.editingUser.set(user);
    this.form.patchValue({
      email: user.email,
      password: '',
      firstName: user.first_name,
      lastName: user.last_name,
      isActive: user.is_active,
      roles: user.roles,  // ← agrega esto
    });
    this.form.get('email')?.disable();
    this.form.get('password')?.removeValidators(Validators.required);
    this.form.get('password')?.updateValueAndValidity();
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.editingUser.set(null);
  }





  submit(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);

    const editing = this.editingUser();
    if (editing) {
      const body: Record<string, unknown> = {
        first_name: this.form.value.firstName,
        last_name: this.form.value.lastName,
        is_active: this.form.value.isActive,
        roles: this.form.value.roles
      };
      if (this.form.value.password) body['password'] = this.form.value.password;
      this.api.patch<ApiResp<TenantUser>>(`/users/${editing.id}`, body).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeModal();
          this.loadUsers();
          this.notification.success('Usuario actualizado.');
        },
        error: (err) => { this.saving.set(false); this.notification.error(err?.error?.message ?? 'Error al guardar'); },
      });
    } else {
      const body = {
        email: this.form.getRawValue().email,
        password: this.form.value.password,
        first_name: this.form.value.firstName,
        last_name: this.form.value.lastName,
        roles: this.form.value.roles,
      };
      this.api.post<ApiResp<TenantUser>>('/users', body).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeModal();
          this.loadUsers();
          this.notification.success('Usuario creado.');
        },
        error: (err) => { this.saving.set(false); this.notification.error(err?.error?.message ?? 'Error al crear usuario'); },
      });
    }
  }

  async requestDelete(id: string): Promise<void> {
    const confirmed = await this.notification.confirm({
      title: '¿Eliminar este usuario?',
      text: 'Esta acción no se puede deshacer.',
      confirmText: 'Sí, eliminar',
      danger: true,
    });
    if (!confirmed) return;

    this.api.delete<ApiResp<void>>(`/users/${id}`).subscribe({
      next: () => { this.loadUsers(); this.notification.success('Usuario eliminado.'); },
      error: () => this.notification.error('Error al eliminar.'),
    });
  }

  rolesLabel(roles: string[]): string {
    return roles.length ? roles.join(', ') : '—';
  }
}
