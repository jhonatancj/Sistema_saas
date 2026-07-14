import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormOptionsProvider } from '@jhonatancj/dforms';
import { ApiService } from './api.service';
import { TenantService } from './tenant.service';

interface ApiResp<T> { success: boolean; data: T; }
interface SelectExecuteResult { rows: any[]; total: number; }

// Implementación real de FormOptionsProvider — reemplaza a
// FormOptionsMockService. `endpointId` es directamente el slug de un form
// (ej. 'categorias', 'unidades_medida', 'rubro') — reusa el endpoint
// `execute` que ya existe para cualquier form del motor low-code, en vez de
// necesitar un endpoint nuevo por catálogo. `limit: 1000` porque estos son
// catálogos de referencia chicos (no se pagina un combo de opciones);
// `execute()` con limit/offset explícitos siempre devuelve la forma paginada
// { rows, total } — ver FormExecutorService.execute().
//
// `params` viene de `optionsParams` de dforms (selects dependientes, ej. la
// columna "Producto" de un line-items filtrada por el proveedor elegido en
// el encabezado) — cada entrada se manda como filtro `equals` de
// FormExecutorService.selectPaged(), que ya valida el nombre de columna
// contra `information_schema` antes de interpolarlo (whitelist real, no
// texto libre). Entradas con valor `null`/`undefined` se descartan: dforms
// ya bloquea la llamada mientras un param `required` no tenga valor, así
// que si algo llega sin valor es porque no es obligatorio — no filtrar por
// esa columna en ese caso, no filtrar por "IS NULL".
//
// `search`: reservado para cuando dforms agregue `searchParamName` a
// `input-lupa`/`select` (búsqueda remota real mientras el usuario escribe,
// en vez del filtro client-side actual sobre los resultados ya cargados —
// ver prompt-dforms.md de esta sesión). Se manda como `filter.search`
// (texto libre, OR ILIKE contra todas las columnas de texto de la tabla —
// ya cubre nombre Y cualquier columna de código/documento sin cambios de
// backend) en vez de un filtro de igualdad exacta.
// `sourceType`: metadata opaca que `input-lupa` siempre manda junto a los
// parámetros reales — no es una columna, se ignora a propósito.
const RESERVED_PARAM_KEYS = new Set(['search', 'sourceType']);

@Injectable({ providedIn: 'root' })
export class RemoteFormOptionsService implements FormOptionsProvider {
  private readonly api = inject(ApiService);
  private readonly tenant = inject(TenantService);

  async loadOptions(endpointId: string, params?: Record<string, any>): Promise<any[]> {
    const base = this.tenant.isAdminContext() ? '/admin/forms' : '/forms';
    const filters = Object.entries(params ?? {})
      .filter(([key, value]) => !RESERVED_PARAM_KEYS.has(key) && value !== null && value !== undefined && value !== '')
      .map(([field, value]) => ({ field, operator: 'equals', value }));
    const search = typeof params?.['search'] === 'string' ? params['search'].trim() : '';

    const res = await firstValueFrom(
      this.api.post<ApiResp<SelectExecuteResult>>(`${base}/${endpointId}/execute`, {
        action: 'SELECT', limit: 1000, offset: 0,
        ...(filters.length > 0 || search ? { filter: { ...(filters.length > 0 ? { filters } : {}), ...(search ? { search } : {}) } } : {}),
      }),
    );
    return res.data.rows ?? [];
  }
}
