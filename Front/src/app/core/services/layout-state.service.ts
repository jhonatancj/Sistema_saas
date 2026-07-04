import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutStateService {
  /** Sidebar visible como overlay en mobile */
  readonly mobileOpen = signal(false);

  /** Sidebar colapsado (solo iconos) — solo aplica en desktop */
  readonly collapsed = signal(false);

  toggleMobile(): void {
    this.mobileOpen.update(v => !v);
  }

  closeMobile(): void {
    this.mobileOpen.set(false);
  }

  toggleCollapsed(): void {
    this.collapsed.update(v => !v);
  }
}
