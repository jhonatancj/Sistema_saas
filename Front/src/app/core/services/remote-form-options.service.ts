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
@Injectable({ providedIn: 'root' })
export class RemoteFormOptionsService implements FormOptionsProvider {
  private readonly api = inject(ApiService);
  private readonly tenant = inject(TenantService);

  async loadOptions(endpointId: string, _params?: Record<string, any>): Promise<any[]> {
    const base = this.tenant.isAdminContext() ? '/admin/forms' : '/forms';
    const res = await firstValueFrom(
      this.api.post<ApiResp<SelectExecuteResult>>(`${base}/${endpointId}/execute`, {
        action: 'SELECT', limit: 1000, offset: 0,
      }),
    );
    return res.data.rows ?? [];
  }
}
