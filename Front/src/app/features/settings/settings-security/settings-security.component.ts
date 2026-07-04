import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule, AbstractControl, ValidatorFn } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import '../../../core/ag-grid.init';
import { ApiService } from '../../../core/services/api.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TenantService } from '../../../core/services/tenant.service';

interface ApiResp<T> { success: boolean; data: T; message: string; errors: string[]; }

interface Session {
  id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
}

function passwordsMatch(): ValidatorFn {
  return (group: AbstractControl) => {
    const nw = group.get('newPassword')?.value;
    const cf = group.get('confirmPassword')?.value;
    return nw && cf && nw !== cf ? { mismatch: true } : null;
  };
}

@Component({
  selector: 'app-settings-security',
  standalone: true,
  imports: [ReactiveFormsModule, AgGridAngular],
  templateUrl: './settings-security.component.html',
  styleUrl: './settings-security.component.scss',
})
export class SettingsSecurityComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);
  private readonly tenant = inject(TenantService);

  readonly isAdmin = computed(() => this.tenant.isAdminContext());

  readonly sessions = signal<Session[]>([]);
  readonly sessionsLoading = signal(false);
  readonly pwSaving = signal(false);

  readonly pwForm = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch() },
  );

  readonly defaultColDef: ColDef = { sortable: true, filter: true, resizable: true };

  readonly colDefs: ColDef<Session>[] = [
    { headerName: 'IP', field: 'ip_address', width: 140 },
    {
      headerName: 'Dispositivo',
      field: 'user_agent',
      flex: 2,
      minWidth: 160,
      cellStyle: { color: 'var(--color-text-secondary, #6b7280)', fontSize: '12px' },
    },
    {
      headerName: 'Inicio',
      field: 'created_at',
      flex: 1,
      minWidth: 130,
      valueFormatter: (p: any) =>
        p.value
          ? new Date(p.value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
          : '—',
    },
    {
      headerName: 'Expira',
      field: 'expires_at',
      flex: 1,
      minWidth: 130,
      valueFormatter: (p: any) =>
        p.value
          ? new Date(p.value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
          : '—',
    },
    {
      headerName: '',
      sortable: false,
      filter: false,
      width: 100,
      cellRenderer: (p: any) => {
        const btn = document.createElement('button');
        btn.textContent = 'Revocar';
        btn.style.cssText =
          'padding:2px 10px;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:12px;background:#fff;color:#dc2626;font-family:inherit';
        btn.onclick = () => this.revokeSession(p.data.id);
        return btn;
      },
    },
  ];

  ngOnInit(): void {
    this.breadcrumbs.set(
      this.isAdmin()
        ? [{ label: 'Seguridad' }]
        : [{ label: 'Configuración' }, { label: 'Seguridad' }],
    );
    if (!this.isAdmin()) this.loadSessions();
  }

  loadSessions(): void {
    this.sessionsLoading.set(true);
    this.api.get<ApiResp<Session[]>>('/security/sessions').subscribe({
      next: (res) => { this.sessions.set(res.data ?? []); this.sessionsLoading.set(false); },
      error: () => this.sessionsLoading.set(false),
    });
  }

  changePassword(): void {
    if (this.pwForm.invalid || this.pwSaving()) return;
    this.pwSaving.set(true);
    const { currentPassword, newPassword } = this.pwForm.value;
    const url = this.isAdmin() ? '/security/admin/password' : '/security/password';
    this.api.patch<ApiResp<void>>(url, { currentPassword, newPassword }).subscribe({
      next: () => {
        this.pwForm.reset();
        this.pwSaving.set(false);
        this.notification.success('Contraseña actualizada correctamente');
      },
      error: (err) => {
        this.pwSaving.set(false);
        this.notification.error(err?.error?.message ?? 'Contraseña actual incorrecta');
      },
    });
  }

  async revokeSession(id: string): Promise<void> {
    const confirmed = await this.notification.confirm({
      title: '¿Cerrar esta sesión?',
      text: 'El dispositivo tendrá que iniciar sesión de nuevo.',
      confirmText: 'Sí, cerrar sesión',
      danger: true,
    });
    if (!confirmed) return;

    this.api.delete<ApiResp<void>>(`/security/sessions/${id}`).subscribe({
      next: () => { this.loadSessions(); this.notification.success('Sesión cerrada.'); },
      error: () => this.notification.error('Error al cerrar la sesión.'),
    });
  }

  async revokeAll(): Promise<void> {
    const confirmed = await this.notification.confirm({
      title: '¿Cerrar todas las sesiones?',
      text: 'Todos los dispositivos (menos este) tendrán que iniciar sesión de nuevo.',
      confirmText: 'Sí, cerrar todas',
      danger: true,
    });
    if (!confirmed) return;

    const currentToken = localStorage.getItem('access_token') ?? '';
    this.api.delete<ApiResp<void>>('/security/sessions', { currentToken }).subscribe({
      next: () => { this.loadSessions(); this.notification.success('Sesiones cerradas.'); },
      error: () => this.notification.error('Error al cerrar las sesiones.'),
    });
  }

  get hasMismatch(): boolean {
    return !!this.pwForm.errors?.['mismatch'] && !!this.pwForm.get('confirmPassword')?.touched;
  }
}
