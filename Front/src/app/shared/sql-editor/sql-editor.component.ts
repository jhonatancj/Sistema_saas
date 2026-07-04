import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-sql-editor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './sql-editor.component.html',
  styleUrl: './sql-editor.component.scss',
})
export class SqlEditorComponent {
  value = input<string>('');
  valueChange = output<string>();
}
