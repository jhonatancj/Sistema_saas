import { AllCommunityModule, ModuleRegistry, provideGlobalGridOptions } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

provideGlobalGridOptions({
  // El proyecto usa el theming viejo por CSS (ag-theme-quartz.css + clase
  // ag-theme-quartz en el template) — sin esto, v33+ intenta usar la nueva
  // Theming API en paralelo y choca con el CSS legacy (error #239).
  theme: 'legacy',
  rowHeight: 32,
  headerHeight: 33,
  // Textos del panel de paginación (GridFormComponent usa [pagination]="true"
  // con Infinite Row Model) — sin esto AG-Grid muestra el panel en inglés.
  localeText: {
    page: 'Página',
    more: 'más',
    to: 'a',
    of: 'de',
    next: 'Siguiente',
    last: 'Última',
    first: 'Primera',
    previous: 'Anterior',
    loadingOoo: 'Cargando...',
    noRowsToShow: 'Sin registros',
    pageSizeSelectorLabel: 'Registros por página:',
  },
});
