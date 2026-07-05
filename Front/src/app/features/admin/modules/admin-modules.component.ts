import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { ApiService } from '../../../core/services/api.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../core/services/notification.service';

interface ApiResp<T> { success: boolean; data: T; }

interface PublicModule {
  id: number; name: string; code: string; icon: string; description?: string;
  tenant_name?: string | null; tenant_code?: string | null;
  sort_order: number; is_active: boolean; forms: string[];
}

interface FormItem { id: number; slug: string; name: string; }

interface RoleRow {
  role_code: string; name: string;
  can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean;
}

type PermKey = 'can_view' | 'can_create' | 'can_edit' | 'can_delete';

const PERMISSIONS: { key: PermKey; label: string }[] = [
  { key: 'can_view', label: 'Ver' },
  { key: 'can_create', label: 'Crear' },
  { key: 'can_edit', label: 'Editar' },
  { key: 'can_delete', label: 'Eliminar' },
];

@Component({
  selector: 'app-admin-modules',
  standalone: true,
  imports: [FormsModule, NgSelectModule],
  templateUrl: './admin-modules.component.html',
  styleUrl: './admin-modules.component.scss',
})
export class AdminModulesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);

  readonly PERMISSIONS = PERMISSIONS;

  readonly modules = signal<PublicModule[]>([]);
  readonly availableForms = signal<FormItem[]>([]);
  readonly selected = signal<PublicModule | null>(null);
  readonly roles = signal<RoleRow[]>([]);
  readonly activeTab = signal<'forms' | 'roles' | 'edit'>('forms');
  readonly selectedForms = signal<string[]>([]);
  readonly saving = signal(false);

  // Estado para crear módulo
  readonly showCreate = signal(false);
  newName = ''; newCode = ''; newIcon = ''; newDescription = ''; newTenantName = ''; newTenantCode = '';

  // Edición de un módulo ya existente
  editName = ''; editIcon = ''; editDescription = ''; editSortOrder = 0; editIsActive = true;
  editTenantName = ''; editTenantCode = '';
  readonly savingEdit = signal(false);

  ngOnInit(): void {
    this.breadcrumbs.set([
      { label: 'Panel de Administración', route: '/admin/dashboard' },
      { label: 'Módulos' },
    ]);
    this.loadModules();
    this.loadForms();
  }

  selectModule(m: PublicModule): void {
    this.selected.set(m);
    this.selectedForms.set([...(m.forms ?? [])]);
    this.editName = m.name;
    this.editIcon = m.icon ?? '';
    this.editDescription = m.description ?? '';
    this.editSortOrder = m.sort_order;
    this.editIsActive = m.is_active;
    this.editTenantName = m.tenant_name ?? '';
    this.editTenantCode = m.tenant_code ?? '';
    this.activeTab.set('forms');
    this.loadRoles(m.id);
  }

  createModule(): void {
    if (!this.newName || !this.newCode) return;
    this.api.post<ApiResp<PublicModule>>('/modules/public', {
      name: this.newName, code: this.newCode, icon: this.newIcon || undefined,
      description: this.newDescription || undefined,
      tenantName: this.newTenantName || undefined,
      tenantCode: this.newTenantCode || undefined,
    }).subscribe({
      next: (res) => {
        this.modules.update((m) => [...m, { ...res.data, forms: [] }]);
        this.showCreate.set(false);
        this.newName = ''; this.newCode = ''; this.newIcon = ''; this.newDescription = ''; this.newTenantName = ''; this.newTenantCode = '';
        this.notification.success('Módulo creado.');
        this.selectModule({ ...res.data, forms: [] });
      },
      error: (err) => this.notification.error(err?.error?.message ?? 'Error al crear módulo.'),
    });
  }

  saveEdit(): void {
    const m = this.selected();
    if (!m) return;
    this.savingEdit.set(true);
    this.api.patch<ApiResp<PublicModule>>(`/modules/public/${m.id}`, {
      name: this.editName,
      icon: this.editIcon || undefined,
      description: this.editDescription || undefined,
      sortOrder: this.editSortOrder,
      isActive: this.editIsActive,
      tenantName: this.editTenantName || undefined,
      tenantCode: this.editTenantCode || undefined,
    }).subscribe({
      next: () => {
        this.savingEdit.set(false);
        this.notification.success('Módulo actualizado.');
        this.loadModules();
      },
      error: (err) => {
        this.savingEdit.set(false);
        this.notification.error(err?.error?.message ?? 'Error al actualizar módulo.');
      },
    });
  }

  saveForms(): void {
    const m = this.selected();
    if (!m) return;
    this.saving.set(true);
    this.api.post<ApiResp<any>>(`/modules/public/${m.id}/forms`, { formSlugs: this.selectedForms() })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.notification.success('Formularios guardados.');
          this.loadModules();
        },
        error: (err) => {
          this.saving.set(false);
          this.notification.error(err?.error?.message ?? 'Error al guardar.');
        },
      });
  }

  togglePermission(role: RoleRow, key: PermKey): void {
    role[key] = !role[key];
    this.roles.update((r) => [...r]);
  }

  saveRoles(): void {
    const m = this.selected();
    if (!m) return;
    this.saving.set(true);
    const roles = this.roles().map((r) => ({
      roleCode: r.role_code,
      canView: r.can_view,
      canCreate: r.can_create,
      canEdit: r.can_edit,
      canDelete: r.can_delete,
    }));
    this.api.post<ApiResp<any>>(`/modules/public/${m.id}/roles`, { roles }).subscribe({
      next: () => { this.saving.set(false); this.notification.success('Permisos guardados.'); },
      error: (err) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'Error al guardar.');
      },
    });
  }

  private loadModules(): void {
    this.api.get<ApiResp<PublicModule[]>>('/modules/public').subscribe({
      next: (res) => {
        this.modules.set(res.data ?? []);
        const cur = this.selected();
        if (cur) {
          const updated = res.data.find((m) => m.id === cur.id);
          if (updated) this.selected.set(updated);
        }
      },
    });
  }

  private loadForms(): void {
    this.api.get<ApiResp<FormItem[]>>('/admin/forms').subscribe({
      next: (res) => this.availableForms.set(res.data ?? []),
    });
  }

  private loadRoles(moduleId: number): void {
    this.api.get<ApiResp<RoleRow[]>>(`/modules/public/${moduleId}/roles`).subscribe({
      next: (res) => this.roles.set(res.data ?? []),
    });
  }
}
