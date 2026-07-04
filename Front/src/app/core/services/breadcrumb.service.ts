import { Injectable, signal } from '@angular/core';

export interface Crumb {
  label: string;
  route?: string;
}

@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  readonly crumbs = signal<Crumb[]>([]);

  set(crumbs: Crumb[]): void {
    this.crumbs.set(crumbs);
  }
}
