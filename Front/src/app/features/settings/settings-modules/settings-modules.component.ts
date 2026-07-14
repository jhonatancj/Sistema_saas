import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { ApiService } from '../../../core/services/api.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TenantService } from '../../../core/services/tenant.service';
import { Router } from '@angular/router';

interface ApiResp<T> { success: boolean; data: T; }

interface Module {
  id: number; name: string; code: string; icon: string; description?: string;
  sort_order: number; is_active: boolean; is_custom: boolean;
  forms: string[]; parent_id?: number | null;
}

interface FormItem { id: number; slug: string; name: string; }

interface RoleRow {
  role_code: string; name: string;
  can_view: boolean; can_create: boolean; can_edit: boolean;
  can_delete: boolean; can_export: boolean; can_import: boolean;
}

type PermKey = 'can_view' | 'can_create' | 'can_edit' | 'can_delete' | 'can_export' | 'can_import';

const PERMISSIONS: { key: PermKey; label: string }[] = [
  { key: 'can_view', label: 'Ver' },
  { key: 'can_create', label: 'Crear' },
  { key: 'can_edit', label: 'Editar' },
  { key: 'can_delete', label: 'Eliminar' },
  { key: 'can_export', label: 'Exportar' },
  { key: 'can_import', label: 'Importar' },
];

@Component({
  selector: 'app-settings-modules',
  standalone: true,
  imports: [FormsModule, NgSelectModule],
  templateUrl: './settings-modules.component.html',
  styleUrl: './settings-modules.component.scss',
})
export class SettingsModulesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);
  private readonly tenant = inject(TenantService);
  private readonly router = inject(Router);

  readonly PERMISSIONS = PERMISSIONS;

  readonly modules = signal<Module[]>([]);
  readonly availableForms = signal<FormItem[]>([]);
  readonly selected = signal<Module | null>(null);
  readonly roles = signal<RoleRow[]>([]);
  readonly activeTab = signal<'forms' | 'roles' | 'edit'>('forms');
  readonly selectedForms = signal<string[]>([]);
  readonly saving = signal(false);

  // Estado para crear módulo
  readonly showCreate = signal(false);
  newName = ''; newCode = ''; newIcon = '';

  // Edición de un módulo ya existente — mismo patrón que AdminModulesComponent
  editName = ''; editIcon = ''; editDescription = ''; editSortOrder = 0; editIsActive = true;
  editParentId: number | null = null;
  readonly savingEdit = signal(false);

  // Opciones del selector "Módulo padre" — cualquier módulo salvo el que se
  // está editando (la validación real de ciclo/profundidad la hace el
  // backend).
  readonly parentOptions = computed(() =>
    this.modules().filter((m) => m.id !== this.selected()?.id),
  );

  ngOnInit(): void {
    if (this.tenant.isAdminContext()) {
      this.router.navigate(['/admin/dashboard']);
      return;
    }
    this.breadcrumbs.set([{ label: 'Configuración' }, { label: 'Módulos' }]);
    this.loadModules();
    this.loadForms();
  }

  selectModule(m: Module): void {
    this.selected.set(m);
    this.selectedForms.set([...(m.forms ?? [])]);
    this.editName = m.name;
    this.editIcon = m.icon ?? '';
    this.editDescription = m.description ?? '';
    this.editSortOrder = m.sort_order;
    this.editIsActive = m.is_active;
    this.editParentId = m.parent_id ?? null;
    this.activeTab.set('forms');
    this.loadRoles(m.id);
  }

  saveEdit(): void {
    const m = this.selected();
    if (!m) return;
    this.savingEdit.set(true);
    this.api.patch<ApiResp<Module>>(`/modules/${m.id}`, {
      name: this.editName,
      icon: this.editIcon || undefined,
      description: this.editDescription || undefined,
      sortOrder: this.editSortOrder,
      isActive: this.editIsActive,
      parentId: this.editParentId,
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

  togglePermission(role: RoleRow, key: PermKey): void {
    role[key] = !role[key];
    this.roles.update(r => [...r]);
  }

  saveForms(): void {
    const m = this.selected();
    if (!m) return;
    this.saving.set(true);
    this.api.post<ApiResp<any>>(`/modules/${m.id}/forms`, { form_slugs: this.selectedForms() })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.notification.success('Formularios guardados.');
          this.loadModules();
        },
        error: () => { this.saving.set(false); this.notification.error('Error al guardar.'); },
      });
  }

  saveRoles(): void {
    const m = this.selected();
    if (!m) return;
    this.saving.set(true);
    this.api.post<ApiResp<any>>(`/modules/${m.id}/roles`, { roles: this.roles() })
      .subscribe({
        next: () => { this.saving.set(false); this.notification.success('Permisos guardados.'); },
        error: () => { this.saving.set(false); this.notification.error('Error al guardar.'); },
      });
  }

  createModule(): void {
    if (!this.newName || !this.newCode) return;
    this.api.post<ApiResp<Module>>('/modules', {
      name: this.newName, code: this.newCode, icon: this.newIcon,
    }).subscribe({
      next: (res) => {
        this.modules.update(m => [...m, res.data]);
        this.showCreate.set(false);
        this.newName = ''; this.newCode = ''; this.newIcon = '';
        this.selectModule(res.data);
      },
      error: () => this.notification.error('Error al crear módulo.'),
    });
  }

  private loadModules(): void {
    this.api.get<ApiResp<Module[]>>('/modules').subscribe({
      next: (res) => {
        this.modules.set(res.data ?? []);
        const cur = this.selected();
        if (cur) {
          const updated = res.data.find(m => m.id === cur.id);
          if (updated) this.selected.set(updated);
        }
      },
    });
  }

  private loadForms(): void {
    this.api.get<ApiResp<FormItem[]>>('/forms').subscribe({
      next: (res) => this.availableForms.set(res.data ?? []),
    });
  }

  private loadRoles(moduleId: number): void {
    this.api.get<ApiResp<RoleRow[]>>(`/modules/${moduleId}/roles`).subscribe({
      next: (res) => this.roles.set(res.data ?? []),
    });
  }
}