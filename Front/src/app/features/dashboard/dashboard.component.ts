import { Component, OnInit, inject } from '@angular/core';
import { BreadcrumbService } from '../../core/services/breadcrumb.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly breadcrumbs = inject(BreadcrumbService);

  ngOnInit(): void {
    this.breadcrumbs.set([{ label: 'Dashboard' }]);
  }
}
