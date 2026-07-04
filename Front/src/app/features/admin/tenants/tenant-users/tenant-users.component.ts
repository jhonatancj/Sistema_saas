import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BreadcrumbService } from '../../../../core/services/breadcrumb.service';

@Component({
  selector: 'app-tenant-users',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './tenant-users.component.html',
  styleUrl: './tenant-users.component.scss',
})
export class TenantUsersComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly breadcrumbs = inject(BreadcrumbService);

  tenantId = '';

  ngOnInit(): void {
    this.tenantId = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumbs.set([
      { label: 'Panel de Administración', route: '/admin/dashboard' },
      { label: 'Tenants', route: '/admin/tenants' },
      { label: `Tenant ${this.tenantId}` },
    ]);
  }
}
