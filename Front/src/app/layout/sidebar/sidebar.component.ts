import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TenantService } from '../../core/services/tenant.service';
import { NavIconComponent } from './nav-icon/nav-icon.component';
import { LayoutStateService } from '../../core/services/layout-state.service';
import { AuthService } from '../../core/services/auth.service';
import { MenuModule, MenuService } from '../../core/services/menu.service';
import { encodeFormRoute } from '../../core/utils/route-obfuscation';

export interface NavChild {
  label: string;
  route: string;
  queryParams?: Record<string, string>;
  badge?: number;
  icon?: string | null;
}

export interface NavItem {
  label: string;
  icon: string;
  route?: string;
  queryParams?: Record<string, string>;
  children?: NavChild[];
  badge?: number;
  exact?: boolean;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NavIconComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  readonly tenantService = inject(TenantService);
  readonly layout = inject(LayoutStateService);
  readonly menuService = inject(MenuService);

  readonly isAdmin = computed(() => this.tenantService.isAdminContext());

  openGroup = signal<string | null>(null);

  // Módulos dinámicos del catálogo público (public.modules/module_forms/forms)
  // insertados entre los ítems fijos — mismo mapeo que tenantNavItems, pero
  // apuntando a /admin/m/... para que FormDetailComponent (Fase 7) resuelva
  // el contexto admin.
  readonly adminNavItems = computed<NavItem[]>(() => [
    { label: 'Dashboard', icon: 'fa-solid fa-gauge', route: '/admin/dashboard', exact: true },
    ...this.menuService.modules().map((m) => ({
      label: m.name,
      icon: m.icon || 'fa-solid fa-cube',
      children: (m.forms ?? []).map((f) => ({
        label: f.name || f.slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        route: '/admin/m',
        queryParams: { data: encodeFormRoute(m.code, f.slug) },
        icon: f.icon,
      })),
    })),
    // Ítems de sistema, agrupados aparte de los módulos dinámicos de negocio
    // — mismo patrón que "Configuración" en tenantNavItems. "Rubros" no es
    // un módulo dinámico (nunca se sincroniza a ningún tenant, ver
    // docs/adr/015-catalogo-rubro-categorias-unidades.md) pero reusa la
    // misma ruta ofuscada /admin/m que los forms de un módulo real.
    {
      label: 'Administración', icon: 'fa-solid fa-toolbox',
      children: [
        { label: 'Tenants', route: '/admin/tenants' },
        { label: 'Super Admins', route: '/admin/super-admins' },
        { label: 'Módulos', route: '/admin/modules' },
        { label: 'Rubros', route: '/admin/m', queryParams: { data: encodeFormRoute('SISTEMA', 'rubro') } },
        { label: 'Builder', route: '/admin/builder' },
        { label: 'Seguridad', route: '/admin/settings/security' },
      ],
    },
  ]);

  // Mapea módulos del backend → NavItem con children (formularios, cada uno
  // con su propio ícono FontAwesome — ver MenuService.MenuFormRef)
  readonly tenantNavItems = computed<NavItem[]>(() => [
    {
      label: 'Dashboard',
      icon: 'fa-solid fa-gauge',
      route: '/dashboard',
      exact: true
    },
    // Módulos dinámicos del backend
    ...this.menuService.modules().map((m) => ({
      label: m.name,
      icon: m.icon || 'fa-solid fa-cube',
      children: (m.forms ?? []).map((f) => ({
        label: f.name || f.slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        route: '/app/m',
        queryParams: { data: encodeFormRoute(m.code, f.slug) },
        icon: f.icon,
      })),
    })),
    // Siempre al final
    {
      label: 'Configuración',
      icon: 'fa-solid fa-gear',
      children: [
        { label: 'General', route: '/settings/general' },
        { label: 'Usuarios', route: '/settings/users' },
        { label: 'Seguridad', route: '/settings/security' },
        { label: 'Módulos', route: '/settings/modules' },
      ],
    },
  ]);

  readonly activeNavItems = computed<NavItem[]>(() =>
    this.isAdmin() ? this.adminNavItems() : this.tenantNavItems()
  );


  get userInitials(): string {
    const u = this.auth.getUser();
    const first = (u?.firstName ?? '')[0] ?? '';
    const last = (u?.lastName ?? '')[0] ?? '';
    return `${first}${last}`.toUpperCase() || 'SA';
  }

  get userName(): string {
    const u = this.auth.getUser();
    return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || 'Usuario';
  }

  constructor() {
    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.layout.closeMobile());
  }

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.menuService.loadAdminCatalog();
      return;
    }
    const user = this.auth.getUser();
    const role = user?.roles?.[0] ?? 'SALES';
    this.menuService.load(role);
  }

  toggle(): void {
    this.layout.toggleCollapsed();
    if (this.layout.collapsed()) this.openGroup.set(null);
  }

  toggleGroup(label: string): void {
    if (this.layout.collapsed()) {
      this.layout.toggleCollapsed();
      this.openGroup.set(label);
      return;
    }
    this.openGroup.update(v => (v === label ? null : label));
  }

  isOpen(label: string): boolean {
    return this.openGroup() === label;
  }

  logout(): void {
    this.auth.logout();
  }

}
