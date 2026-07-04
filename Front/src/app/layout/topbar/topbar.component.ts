import { Component, ElementRef, HostListener, ViewChild, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BreadcrumbService } from '../../core/services/breadcrumb.service';
import { LayoutStateService } from '../../core/services/layout-state.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.scss',
})
export class TopbarComponent {
  private readonly breadcrumbService = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly el = inject(ElementRef);
  readonly layout = inject(LayoutStateService);

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  readonly crumbs = this.breadcrumbService.crumbs;
  showUserMenu = signal(false);
  notificationCount = signal(3);

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      this.searchInput?.nativeElement.focus();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent): void {
    if (!this.el.nativeElement.contains(e.target)) {
      this.showUserMenu.set(false);
    }
  }

  toggleUserMenu(): void {
    this.showUserMenu.update(v => !v);
  }

  logout(): void {
    this.auth.logout();
  }
}
