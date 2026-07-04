import { Component, HostListener, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar/sidebar.component';
import { TopbarComponent } from './topbar/topbar.component';
import { LayoutStateService } from '../core/services/layout-state.service';
import { TenantService } from '../core/services/tenant.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
})
export class LayoutComponent {
  readonly layout = inject(LayoutStateService);
  private readonly tenantService = inject(TenantService);

  readonly isAdmin = computed(() => this.tenantService.isAdminContext());

  @HostListener('window:resize')
  onResize(): void {
    if (window.innerWidth >= 1024) {
      this.layout.closeMobile();
    }
  }
}
