import { Component, computed, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, GridSizeChangedEvent, IDatasource } from 'ag-grid-community';
import '../../../core/ag-grid.init';

@Component({
  selector: 'app-grid-form',
  standalone: true,
  imports: [AgGridAngular, FormsModule],
  templateUrl: './grid-form.component.html',
  styleUrl: './grid-form.component.scss',
})
export class GridFormComponent {
  readonly colDefs        = input<ColDef[]>([]);
  readonly datasource     = input<IDatasource | undefined>(undefined);
  readonly cacheBlockSize = input(25);
  readonly defaultColDef  = input<ColDef>({ sortable: true, filter: true, resizable: true });
  readonly paginationPageSizeSelector :number[] | boolean = [25, 50, 100];

  readonly editRow     = output<any>();
  readonly deleteRow   = output<number>();
  // Emite ya debounced (300ms) — el padre solo necesita reaccionar al
  // término final, no a cada tecla.
  readonly searchChange = output<string>();

  // Valor mostrado en el input — separado del emitido a propósito: se
  // actualiza en cada tecla (para que escribir se sienta responsive) aunque
  // searchChange recién dispare 300ms después.
  readonly search = signal('');
  private readonly searchInput$ = new Subject<string>();

  private gridApi: GridApi | null = null;
  // Ancho real del div del grid, informado por (gridSizeChanged) — se usa
  // para decidir si hace falta estirar las columnas (ver fitColumnsIfNeeded).
  private gridClientWidth = 0;

  constructor() {
    this.searchInput$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => this.searchChange.emit(term));
  }

  onSearchInput(term: string): void {
    this.search.set(term);
    this.searchInput$.next(term);
  }

  /** Limpia el input de búsqueda — llamar cuando el padre cambia de contexto
   * (ej. navegar a otro formulario) para no dejar un término stale visible. */
  resetSearch(): void {
    this.search.set('');
  }

  readonly allColDefs = computed<ColDef[]>(() => [
    ...this.colDefs(),
    {
      headerName: 'Acciones',
      sortable: false,
      filter: false,
      width: 120,
      minWidth: 110,
      maxWidth: 130,
      pinned: 'right' as const,
      cellRenderer: (p: any) => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:6px;align-items:center;height:100%';

        const edit = document.createElement('button');
        // edit.textContent = 'Editar';
        edit.innerHTML =`<i class="fa-regular fa-pen-to-square"></i>`;
        edit.className = 'btn btn--sm btn--edit-ghost';
        edit.onclick = () => this.editRow.emit(p.data);

        const del = document.createElement('button');
        del.innerHTML = `<i class="fa-regular fa-trash-can"></i>`;
        del.className = 'btn btn--sm btn--danger-ghost';
        del.onclick = () => this.deleteRow.emit(p.data.id);

        div.appendChild(edit);
        div.appendChild(del);
        return div;
      },
    },
  ]);

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
  }

  // Ancho automático por columna: sin esto, el ancho fijo configurado desde
  // el builder (o el default de 150px) corta nombres de columna largos en
  // unas y deja espacio vacío de sobra en otras, según el contenido real de
  // cada página. `modelUpdated` cubre carga inicial, cambio de página, sort,
  // filtro y búsqueda — cualquier momento en que cambian las filas
  // renderizadas y el ancho "ideal" por columna puede cambiar con ellas.
  onModelUpdated(): void {
    this.gridApi?.autoSizeAllColumns();
    this.fitColumnsIfNeeded();
  }

  onGridSizeChanged(event: GridSizeChangedEvent): void {
    this.gridClientWidth = event.clientWidth;
    this.fitColumnsIfNeeded();
  }

  // autoSizeAllColumns ajusta cada columna a su contenido, pero no llena el
  // ancho del grid si sobra espacio (pocas columnas visibles, contenido
  // corto) — eso dejaba un hueco vacío antes de la columna "Acciones"
  // pineada a la derecha. Si el total de columnas visibles no alcanza el
  // ancho real del grid, se estiran proporcionalmente con
  // sizeColumnsToFit(); si ya lo superan (muchas columnas anchas), no se
  // toca nada — evita volver a angostarlas por debajo de lo que necesita su
  // contenido (que fue justo el problema que resolvió autoSizeAllColumns).
  private fitColumnsIfNeeded(): void {
    const api = this.gridApi;
    if (!api || !this.gridClientWidth) return;
    const totalColsWidth = api.getAllDisplayedColumns()
      .reduce((sum, col) => sum + col.getActualWidth(), 0);
    if (totalColsWidth < this.gridClientWidth) {
      api.sizeColumnsToFit();
    }
  }

  /** Descarta la caché de bloques cargados y vuelve a pedirle datos al datasource. */
  refresh(): void {
    this.gridApi?.refreshInfiniteCache();
  }
}
