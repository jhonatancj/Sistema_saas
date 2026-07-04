import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_MASTER_POOL } from '../../database/database.module';

export interface FormAssignability {
  tenantId: string;
  mode: 'all' | 'restricted';
  // Único predicado de "¿este slug es asignable para este tenant?" — lo
  // usan tanto FormExecutorService.getForms() (filtrar listado) como
  // ModulesService.setTenantModuleForms() (validar escritura), así los dos
  // puntos de enforcement nunca pueden divergir en cómo interpretan
  // mode/allow-list.
  isAllowed(slug: string): boolean;
}

@Injectable()
export class FormAccessService {
  constructor(@Inject(PG_MASTER_POOL) private readonly pool: Pool) { }

  async resolveAssignability(schema: string): Promise<FormAssignability> {
    const tenantResult = await this.pool.query(
      `SELECT id, form_access_mode FROM public.tenants WHERE schema_name = $1 AND deleted_at IS NULL`,
      [schema],
    );
    if ((tenantResult.rowCount ?? 0) === 0) throw new NotFoundException('Tenant no encontrado');
    const tenantId = tenantResult.rows[0].id;
    const mode = tenantResult.rows[0].form_access_mode as 'all' | 'restricted';

    if (mode === 'all') {
      return { tenantId, mode, isAllowed: () => true };
    }

    const [catalogResult, allowedResult] = await Promise.all([
      this.pool.query(`SELECT slug FROM public.forms`),
      this.pool.query(`SELECT form_slug FROM public.tenant_allowed_forms WHERE tenant_id = $1`, [tenantId]),
    ]);
    const catalogSlugs = new Set<string>(catalogResult.rows.map((r) => r.slug));
    const allowedSlugs = new Set<string>(allowedResult.rows.map((r) => r.form_slug));

    return {
      tenantId,
      mode,
      isAllowed: (slug: string) => !catalogSlugs.has(slug) || allowedSlugs.has(slug),
    };
  }

  // ── Config CRUD para el panel de super admin ───────────────────────

  async getTenantFormAccess(tenantId: string) {
    const tenantResult = await this.pool.query(
      `SELECT form_access_mode FROM public.tenants WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    if ((tenantResult.rowCount ?? 0) === 0) throw new NotFoundException('Tenant no encontrado');

    const allowedResult = await this.pool.query(
      `SELECT form_slug FROM public.tenant_allowed_forms WHERE tenant_id = $1 ORDER BY form_slug`,
      [tenantId],
    );
    return {
      mode: tenantResult.rows[0].form_access_mode as 'all' | 'restricted',
      allowed_slugs: allowedResult.rows.map((r) => r.form_slug as string),
    };
  }

  async setTenantFormAccess(tenantId: string, mode: 'all' | 'restricted', allowedSlugs: string[]) {
    if (mode !== 'all' && mode !== 'restricted') {
      throw new BadRequestException(`form_access_mode inválido: '${mode}'`);
    }
    const slugs = [...new Set(allowedSlugs ?? [])];

    if (slugs.length > 0) {
      const existing = await this.pool.query(
        `SELECT slug FROM public.forms WHERE slug = ANY($1::text[])`,
        [slugs],
      );
      const existingSet = new Set(existing.rows.map((r) => r.slug));
      const missing = slugs.filter((s) => !existingSet.has(s));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Los siguientes slugs no existen en el catálogo público: ${missing.join(', ')}`,
        );
      }
    }

    const updateResult = await this.pool.query(
      `UPDATE public.tenants SET form_access_mode = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL RETURNING id`,
      [mode, tenantId],
    );
    if ((updateResult.rowCount ?? 0) === 0) throw new NotFoundException('Tenant no encontrado');

    await this.pool.query(`DELETE FROM public.tenant_allowed_forms WHERE tenant_id = $1`, [tenantId]);
    if (slugs.length > 0) {
      const values = slugs.map((_, i) => `($1, $${i + 2})`).join(', ');
      await this.pool.query(
        `INSERT INTO public.tenant_allowed_forms (tenant_id, form_slug) VALUES ${values}`,
        [tenantId, ...slugs],
      );
    }

    return this.getTenantFormAccess(tenantId);
  }
}
