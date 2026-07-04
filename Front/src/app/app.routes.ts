import { Routes } from '@angular/router';
import { authGuard, superAdminGuard } from './core/guards/auth.guard';
import { LayoutComponent } from './layout/layout.component';
import { LoginComponent } from './login/login.component';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },

  { path: 'admin/login', component: LoginComponent },

  {
    path: 'admin',
    component: LayoutComponent,
    canActivate: [superAdminGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/admin/admin-dashboard/admin-dashboard.component').then(m => m.AdminDashboardComponent),
      },
      {
        path: 'tenants',
        loadComponent: () =>
          import('./features/admin/tenants/tenants-list/tenants-list.component').then(m => m.TenantsListComponent),
      },
      {
        path: 'tenants/:id',
        loadComponent: () =>
          import('./features/admin/tenants/tenant-detail/tenant-detail.component').then(m => m.TenantDetailComponent),
      },
      {
        path: 'tenants/:id/users',
        loadComponent: () =>
          import('./features/admin/tenants/tenant-users/tenant-users.component').then(m => m.TenantUsersComponent),
      },
      {
        path: 'super-admins',
        loadComponent: () =>
          import('./features/admin/super-admins/super-admins.component').then(m => m.SuperAdminsComponent),
      },
      {
        path: 'builder',
        loadComponent: () =>
          import('./features/admin/builder/builder.component').then(m => m.AdminBuilderComponent),
      },
      {
        path: 'modules',
        loadComponent: () =>
          import('./features/admin/modules/admin-modules.component').then(m => m.AdminModulesComponent),
      },
      {
        path: 'settings/security',
        loadComponent: () =>
          import('./features/settings/settings-security/settings-security.component').then(m => m.SettingsSecurityComponent),
      },
      {
        path: 'm/:moduleCode/:formSlug',
        loadComponent: () =>
          import('./features/forms/form-detail/form-detail.component').then(m => m.FormDetailComponent),
      },
    ],
  },

  // ── Rutas tenant normal ────────────────────────────────────────
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
      },
      {
        path: 'settings',
        redirectTo: 'settings/general',
        pathMatch: 'full',
      },
      {
        path: 'settings/general',
        loadComponent: () =>
          import('./features/settings/settings-general/settings-general.component').then(m => m.SettingsGeneralComponent),
      },
      {
        path: 'settings/users',
        loadComponent: () =>
          import('./features/settings/settings-users/settings-users.component').then(m => m.SettingsUsersComponent),
      },
      {
        path: 'settings/security',
        loadComponent: () =>
          import('./features/settings/settings-security/settings-security.component').then(m => m.SettingsSecurityComponent),
      },
      {
        path: 'app/m/:moduleCode/:formSlug',
        loadComponent: () =>
          import('./features/forms/form-detail/form-detail.component').then(m => m.FormDetailComponent),
      },
      {
        path: 'settings/modules',
        loadComponent: () =>
          import('./features/settings/settings-modules/settings-modules.component')
            .then(m => m.SettingsModulesComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
