import { Component, input } from '@angular/core';

@Component({
  selector: 'app-nav-icon',
  standalone: true,
  templateUrl: './nav-icon.component.html',
  styleUrl: './nav-icon.component.scss',
})
export class NavIconComponent {
  name = input.required<string>();
}
