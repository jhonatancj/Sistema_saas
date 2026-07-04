import { Component, OnInit, inject } from '@angular/core';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss',
})
export class AdminDashboardComponent implements OnInit {
  private readonly breadcrumbs = inject(BreadcrumbService);

  ngOnInit(): void {
    this.breadcrumbs.set([{ label: 'Panel de Administración' }]);
  }
}
