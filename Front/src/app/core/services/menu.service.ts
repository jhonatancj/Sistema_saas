import { Injectable, signal, inject } from '@angular/core';
import { ApiService } from './api.service';

export interface MenuFormRef {
  slug: string;
  name: string;
  icon: string | null;
}

export interface MenuModule {
  id: number;
  name: string;
  code: string;
  icon: string;
  sort_order: number;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  forms: MenuFormRef[];
  // Solo viene en el catálogo público (ver getPublicModulesForMenu) — un
  // módulo universal (Clientes/Proveedores/Empleados/Sucursales) lo trae
  // en null. Sigue siendo útil (ej. filtro al sincronizar un tenant), pero
  // ya no se usa para agrupar el sidebar — ver `parent_id`/ADR-024.
  rubro_id?: number | null;
  // Jerarquía real de módulos (hasta 4 niveles con el form incluido, ver
  // docs/adr/024-jerarquia-modulos.md) — `null`/ausente = raíz. Viene tanto
  // del catálogo público como de `/modules/by-role/:role` (un tenant
  // también puede armar su propia jerarquía desde Configuración > Módulos).
  parent_id?: number | null;
}

@Injectable({ providedIn: 'root' })
export class MenuService {
  private api = inject(ApiService);
  private readonly _modules = signal<MenuModule[]>([]);
  readonly modules = this._modules.asReadonly();

  load(roleCode: string): void {
    this.api.get<{ data: MenuModule[] }>(`/modules/by-role/${roleCode}`).subscribe({
      next: (res) => this._modules.set(res.data),
      error: () => this._modules.set([]),
    });
  }

  // Catálogo público completo, sin filtro de rol — usado por el sidebar del
  // super admin, que no tiene un role_code de tenant.
  loadAdminCatalog(): void {
    this.api.get<{ data: MenuModule[] }>(`/modules/public/menu`).subscribe({
      next: (res) => this._modules.set(res.data),
      error: () => this._modules.set([]),
    });
  }

  clear(): void {
    this._modules.set([]);
  }
}