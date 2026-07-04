import { Injectable, signal } from '@angular/core';

export interface Tenant {
  slug: string;
  name: string;
  isSuperAdmin: boolean;
}

@Injectable({ providedIn: 'root' })
export class TenantService {
  readonly current = signal<Tenant>(this.resolve());

  private resolve(): Tenant {
    const parts = window.location.hostname.split('.');
    const slug  = parts.length > 1 ? parts[0] : 'local';
    const isSuperAdmin = slug === 'admin';
    return {
      slug,
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
      isSuperAdmin,
    };
  }

  isAdminContext(): boolean {
    return this.current().isSuperAdmin;
  }
}