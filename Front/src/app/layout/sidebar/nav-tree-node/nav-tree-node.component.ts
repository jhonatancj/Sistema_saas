import { Component, input, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { NavChild } from '../sidebar.component';

// Nodo recursivo del sidebar (niveles 2, 3 y 4 — hasta 4 en total contando
// el nivel 1 fijo del propio SidebarComponent) — ver
// docs/adr/024-jerarquia-modulos.md. Un nodo con `children` se renderiza
// como grupo expandible (se referencia a sí mismo para sus propios hijos);
// sin `children`, como link hoja. Estado de expansión **local** al
// componente (no un Map compartido) — al desmontarse junto con su padre
// (el `@if` de arriba se cierra), el estado se pierde solo, sin lógica de
// reseteo manual entre ramas.
@Component({
  selector: 'app-nav-tree-node',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NavIconComponent, NavTreeNodeComponent],
  templateUrl: './nav-tree-node.component.html',
  styleUrl: './nav-tree-node.component.scss',
})
export class NavTreeNodeComponent {
  node = input.required<NavChild>();
  depth = input(1);

  readonly expanded = signal(false);

  toggle(): void {
    this.expanded.update((v) => !v);
  }
}
