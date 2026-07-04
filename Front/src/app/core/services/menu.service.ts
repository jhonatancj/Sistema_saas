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