import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_MASTER_POOL } from '../../database/database.module';
import { CreateModuleDto } from './dto/create-module.dto';
import { ModuleRoleItemDto } from './dto/set-module-roles.dto';
import { FormAccessService } from '../form-access/form-access.service';
import { FormGeneratorService } from '../forms/form-generator.service';

@Injectable()
export class ModulesService {
  constructor(
    @Inject(PG_MASTER_POOL) private readonly pool: Pool,
    private readonly formAccess: FormAccessService,
    private readonly formGenerator: FormGeneratorService,
  ) { }

  // ── Módulos públicos (plantillas) ────────────────────────────────
  // `name` es el nombre que ve el super admin en su propio catálogo/sidebar
  // (sirve para distinguir variantes, ej. "Inventario Restaurantes" vs
  // "Inventario Ferreterías"); `tenant_name` es el nombre que recibe
  // cualquier tenant al que se le asigne el módulo (NULL = usa `name` tal
  // cual). Ver docs/adr/012-module-tenant-name.md.
  async getPublicModules() {
    const result = await this.pool.query(
      `SELECT m.id, m.name, m.tenant_name, m.code, m.tenant_code, m.icon, m.description, m.sort_order, m.is_active, m.rubro_id,
              array_agg(mf.form_slug ORDER BY mf.sort_order) FILTER (WHERE mf.form_slug IS NOT NULL) as forms
       FROM public.modules m
       LEFT JOIN public.module_forms mf ON mf.module_id = m.id
       GROUP BY m.id
       ORDER BY m.sort_order`,
    );
    return result.rows.map(r => ({ ...r, forms: r.forms ?? [] }));
  }

  async createPublicModule(dto: {
    name: string; code: string; icon?: string; description?: string; sortOrder?: number;
    tenantName?: string; tenantCode?: string; rubroId?: number;
  }) {
    const existing = await this.pool.query(
      `SELECT id FROM public.modules WHERE code = $1`, [dto.code]
    );
    if ((existing.rowCount ?? 0) > 0) throw new ConflictException(`El código '${dto.code}' ya existe`);

    const result = await this.pool.query(
      `INSERT INTO public.modules (name, code, icon, description, sort_order, tenant_name, tenant_code, rubro_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [dto.name, dto.code, dto.icon ?? null, dto.description ?? null, dto.sortOrder ?? 0, dto.tenantName ?? null, dto.tenantCode ?? null, dto.rubroId ?? null],
    );
    return result.rows[0];
  }

  async updatePublicModule(id: number, dto: {
    name?: string; icon?: string; description?: string; sortOrder?: number; isActive?: boolean;
    tenantName?: string; tenantCode?: string; rubroId?: number;
  }) {
    const result = await this.pool.query(
      `UPDATE public.modules SET
        name        = COALESCE($1, name),
        icon        = COALESCE($2, icon),
        description = COALESCE($3, description),
        sort_order  = COALESCE($4, sort_order),
        is_active   = COALESCE($5, is_active),
        tenant_name = COALESCE($6, tenant_name),
        tenant_code = COALESCE($7, tenant_code),
        rubro_id    = COALESCE($8, rubro_id),
        updated_at  = NOW()
       WHERE id = $9 RETURNING *`,
      [dto.name ?? null, dto.icon ?? null, dto.description ?? null, dto.sortOrder ?? null, dto.isActive ?? null, dto.tenantName ?? null, dto.tenantCode ?? null, dto.rubroId ?? null, id],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Módulo no encontrado');
    return result.rows[0];
  }

  async setPublicModuleForms(moduleId: number, formSlugs: string[]) {
    await this.pool.query(`DELETE FROM public.module_forms WHERE module_id = $1`, [moduleId]);
    if (formSlugs.length > 0) {
      const values = formSlugs.map((slug, i) => `($1, $${i + 2}, ${i})`).join(', ');
      await this.pool.query(
        `INSERT INTO public.module_forms (module_id, form_slug, sort_order) VALUES ${values}`,
        [moduleId, ...formSlugs],
      );
    }
    return { message: 'Formularios actualizados' };
  }

  async setPublicModuleRoles(moduleId: number, roles: {
    roleCode: string; canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean;
  }[]) {
    await this.pool.query(`DELETE FROM public.module_roles WHERE module_id = $1`, [moduleId]);
    for (const r of roles) {
      await this.pool.query(
        `INSERT INTO public.module_roles (module_id, role_code, can_view, can_create, can_edit, can_delete)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [moduleId, r.roleCode, r.canView, r.canCreate, r.canEdit, r.canDelete],
      );
    }
    return { message: 'Roles actualizados' };
  }

  // public no tiene tabla `roles` (a diferencia de un tenant) — los 3 códigos
  // son la convención fija sembrada igual en todo tenant nuevo
  // (04_create_tenant.sql). Se hardcodean acá y se hace el LEFT JOIN en
  // memoria contra module_roles, en vez de un JOIN SQL contra una tabla que
  // no existe en este schema.
  private readonly STANDARD_ROLE_CODES = [
    { code: 'ADMIN', name: 'Administrador' },
    { code: 'SALES', name: 'Vendedor' },
    { code: 'WAREHOUSE', name: 'Almacenista' },
  ];

  async getPublicModuleRoles(moduleId: number) {
    const result = await this.pool.query(
      `SELECT role_code, can_view, can_create, can_edit, can_delete
       FROM public.module_roles WHERE module_id = $1`,
      [moduleId],
    );
    const existing = new Map(result.rows.map((r) => [r.role_code, r]));
    return this.STANDARD_ROLE_CODES.map(({ code, name }) => {
      const r = existing.get(code);
      return {
        role_code: code, name,
        can_view: r?.can_view ?? false, can_create: r?.can_create ?? false,
        can_edit: r?.can_edit ?? false, can_delete: r?.can_delete ?? false,
      };
    });
  }

  // ── Módulos del tenant ────────────────────────────────────────────
  async getTenantModules(schema: string) {
    const result = await this.pool.query(
      `SELECT m.id, m.name, m.code, m.icon, m.description, m.sort_order, m.is_active, m.is_custom,
              array_agg(mf.form_slug ORDER BY mf.sort_order) FILTER (WHERE mf.form_slug IS NOT NULL) as forms
       FROM ${schema}.modules m
       LEFT JOIN ${schema}.module_forms mf ON mf.module_id = m.id
       GROUP BY m.id
       ORDER BY m.sort_order`,
    );
    return result.rows.map(r => ({ ...r, forms: r.forms ?? [] }));
  }

  async getTenantModulesByRole(schema: string, roleCode: string) {
    const result = await this.pool.query(
      `SELECT m.id, m.name, m.code, m.icon, m.sort_order,
              mr.can_view, mr.can_create, mr.can_edit, mr.can_delete,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object('slug', mf.form_slug, 'name', f.name, 'icon', f.icon)
                  ORDER BY mf.sort_order
                ) FILTER (WHERE mf.form_slug IS NOT NULL),
                '[]'::jsonb
              ) AS forms
       FROM ${schema}.modules m
       INNER JOIN ${schema}.module_roles mr ON mr.module_id = m.id AND mr.role_code = $1
       LEFT JOIN ${schema}.module_forms mf ON mf.module_id = m.id
       LEFT JOIN ${schema}.forms f ON f.slug = mf.form_slug AND f.deleted_at IS NULL
       WHERE m.is_active = TRUE AND mr.can_view = TRUE
       GROUP BY m.id, mr.can_view, mr.can_create, mr.can_edit, mr.can_delete
       ORDER BY m.sort_order`,
      [roleCode],
    );
    return result.rows;
  }

  // Menú del catálogo público para el sidebar del super admin — sin filtro de
  // rol (el super admin no tiene role_code de tenant y ya bypasea permisos en
  // el resto de la app), CRUD completo implícito.
  async getPublicModulesForMenu() {
    const result = await this.pool.query(
      `SELECT m.id, m.name, m.code, m.icon, m.sort_order,
              TRUE AS can_view, TRUE AS can_create, TRUE AS can_edit, TRUE AS can_delete,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object('slug', mf.form_slug, 'name', f.name, 'icon', f.icon)
                  ORDER BY mf.sort_order
                ) FILTER (WHERE mf.form_slug IS NOT NULL),
                '[]'::jsonb
              ) AS forms
       FROM public.modules m
       LEFT JOIN public.module_forms mf ON mf.module_id = m.id
       LEFT JOIN public.forms f ON f.slug = mf.form_slug AND f.deleted_at IS NULL
       WHERE m.is_active = TRUE
       GROUP BY m.id
       ORDER BY m.sort_order`,
    );
    return result.rows;
  }

  async updateTenantModule(schema: string, id: number, dto: {
    name?: string; icon?: string; description?: string; sortOrder?: number; isActive?: boolean;
  }) {
    const result = await this.pool.query(
      `UPDATE ${schema}.modules SET
        name        = COALESCE($1, name),
        icon        = COALESCE($2, icon),
        description = COALESCE($3, description),
        sort_order  = COALESCE($4, sort_order),
        is_active   = COALESCE($5, is_active),
        updated_at  = NOW()
       WHERE id = $6 RETURNING *`,
      [dto.name ?? null, dto.icon ?? null, dto.description ?? null, dto.sortOrder ?? null, dto.isActive ?? null, id],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Módulo no encontrado');
    return result.rows[0];
  }



  // ── Sincronizar módulos de public al tenant ───────────────────────
  // COALESCE(tenant_name, name): el tenant recibe el nombre genérico
  // (tenant_name) si el super admin definió uno distinto al de su propio
  // catálogo — mismo criterio que create_tenant_schema() en
  // 04_create_tenant.sql (ver docs/adr/012-module-tenant-name.md).
  // COALESCE(tenant_code, code): mismo criterio pero para el `code` que
  // termina expuesto en la URL del tenant (`/app/m/:moduleCode/...`) — ver
  // docs/adr/014-module-tenant-code.md. Sin esto, un `code` interno
  // específico de rubro (ej. `INVENTARIO_BARRIO`) se filtraría tal cual a la
  // URL que ve el usuario final del tenant.
  //
  // `moduleIds`: si se pasa un array (incluso vacío), acota el sync a esos
  // `public.modules.id` exactos — es lo que usa el modal de selección del
  // builder de tenants. `undefined` (nunca invocado desde el modal, sí desde
  // `ModulesController.syncToTenant`) conserva el comportamiento histórico de
  // sincronizar todo el catálogo activo.
  async syncPublicModulesToTenant(schema: string, moduleIds?: number[]) {
    const hasFilter = Array.isArray(moduleIds);
    const filterParams = hasFilter ? [moduleIds] : [];

    await this.pool.query(
      `INSERT INTO ${schema}.modules (public_id, name, code, icon, description, sort_order)
       SELECT id, COALESCE(tenant_name, name), COALESCE(tenant_code, code), icon, description, sort_order
       FROM public.modules
       WHERE is_active = TRUE ${hasFilter ? 'AND id = ANY($1)' : ''}
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, icon = EXCLUDED.icon,
         description = EXCLUDED.description, sort_order = EXCLUDED.sort_order`,
      filterParams,
    );
    // ON CONFLICT (module_id, form_slug) — bug real encontrado al verificar
    // este fix: sin un target explícito, "ON CONFLICT DO NOTHING" no evita
    // nada si no hay una constraint única que matchee (module_forms solo
    // tenía PK sobre `id`, un surrogate siempre distinto) — cada sync
    // duplicaba la asignación completa. `uq_module_forms_module_slug` agregada
    // en 04_create_tenant.sql (tenants nuevos) y en la migración
    // 002_module_forms_unique.sql (tenants existentes).
    await this.pool.query(
      `INSERT INTO ${schema}.module_forms (module_id, form_slug, sort_order)
       SELECT tm.id, pmf.form_slug, pmf.sort_order
       FROM public.module_forms pmf
       INNER JOIN ${schema}.modules tm ON tm.public_id = pmf.module_id
       ${hasFilter ? 'WHERE pmf.module_id = ANY($1)' : ''}
       ON CONFLICT (module_id, form_slug) DO NOTHING`,
      filterParams,
    );

    // Sin esto, un módulo sincronizado DESPUÉS de la creación del tenant (a
    // diferencia de create_tenant_schema(), que sí clona module_roles al
    // crear el tenant) queda sin ninguna fila en {schema}.module_roles —
    // getTenantModulesByRole() nunca lo devuelve (INNER JOIN module_roles
    // WHERE can_view=TRUE), así que el módulo "sincronizado" jamás aparece en
    // el sidebar de ningún usuario del tenant. ON CONFLICT DO NOTHING (no
    // overwrite) para no pisar permisos que el tenant ya haya personalizado a
    // mano en un módulo re-sincronizado.
    await this.pool.query(
      `INSERT INTO ${schema}.module_roles (module_id, role_code, can_view, can_create, can_edit, can_delete)
       SELECT tm.id, pmr.role_code, pmr.can_view, pmr.can_create, pmr.can_edit, pmr.can_delete
       FROM public.module_roles pmr
       INNER JOIN ${schema}.modules tm ON tm.public_id = pmr.module_id
       ${hasFilter ? 'WHERE pmr.module_id = ANY($1)' : ''}
       ON CONFLICT (module_id, role_code) DO NOTHING`,
      filterParams,
    );

    const assignedSlugs = await this.pool.query(
      `SELECT DISTINCT form_slug FROM ${schema}.module_forms`,
    );
    await this.copyMissingFormsToTenant(schema, assignedSlugs.rows.map((r) => r.form_slug));

    await this.syncCatalogDataForRubro(schema);

    return { message: 'Módulos sincronizados' };
  }

  // ── Sync de DATOS (no solo definición) para Categorías/Unidades de medida ──
  // Primer caso de sync de filas reales (no metadata) en el sistema — ver
  // docs/adr/015-catalogo-rubro-categorias-unidades.md. `public.tbl_categorias`/
  // `tbl_unidades_medida` tienen filas de los 4 rubros mezcladas (el super
  // admin gestiona todo desde un solo catálogo) — `nombre` se repite a
  // propósito entre rubros (ej. "Otros" en los 4), así que NO hay
  // `UNIQUE(nombre)` real en la tabla generada; el filtro de duplicados es
  // `NOT EXISTS` contra el nombre ya presente en el tenant, no `ON CONFLICT`.
  // Un tenant real solo debe quedarse con las filas de su propio rubro. Se
  // corre siempre que se sincroniza, sin depender de qué moduleIds se
  // eligieron — es idempotente y no pisa filas que el tenant ya haya
  // agregado/editado a mano, y no falla si el tenant no tiene rubro (tenants
  // viejos como demo/acme, creados antes de este feature): simplemente no
  // hace nada.
  private async syncCatalogDataForRubro(schema: string): Promise<void> {
    const tenantResult = await this.pool.query(
      `SELECT rubro_id FROM public.tenants WHERE schema_name = $1 AND deleted_at IS NULL`,
      [schema],
    );
    const rubroId = tenantResult.rows[0]?.rubro_id;
    if (!rubroId) return;

    const rubroResult = await this.pool.query(
      `SELECT code FROM public.tbl_rubro WHERE id = $1`, [rubroId],
    );
    const rubroCode = rubroResult.rows[0]?.code;
    if (!rubroCode) return;

    for (const slug of ['categorias', 'unidades_medida']) {
      const formResult = await this.pool.query(
        `SELECT json_form, has_table, has_sp, icon, display_mode, modal_width, name
         FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`,
        [slug],
      );
      if ((formResult.rowCount ?? 0) === 0) continue; // módulo no sincronizado a este tenant
      const form = formResult.rows[0];

      if (!form.has_table || !form.has_sp) {
        await this.formGenerator.processForm(schema, {
          slug, name: form.name, jsonForm: form.json_form, icon: form.icon,
          displayMode: form.display_mode, modalWidth: form.modal_width,
        });
      }

      const tableName = `tbl_${slug}`;
      const columns = slug === 'unidades_medida'
        ? 'nombre, abreviatura, rubro, activo'
        : 'nombre, rubro, activo';
      await this.pool.query(
        `INSERT INTO ${schema}.${tableName} (${columns})
         SELECT src.nombre, ${slug === 'unidades_medida' ? 'src.abreviatura,' : ''} src.rubro, src.activo
         FROM public.${tableName} src
         WHERE src.rubro = $1
           AND NOT EXISTS (
             SELECT 1 FROM ${schema}.${tableName} t WHERE t.nombre = src.nombre
           )`,
        [rubroCode],
      );
    }
  }

  /**
   * Copia a {schema}.forms los formularios públicos referenciados por slug que el
   * tenant todavía no tiene. Nunca sobreescribe un form ya existente en el tenant
   * (evita pisar personalizaciones locales de json_form/grid_config).
   */
  async copyMissingFormsToTenant(schema: string, formSlugs: string[]) {
    if (formSlugs.length === 0) return { copied: 0 };

    const result = await this.pool.query(
      `INSERT INTO ${schema}.forms (slug, name, json_form, grid_config, icon)
       SELECT pf.slug, pf.name,
              COALESCE(pf.json_form, '{}'::jsonb),
              COALESCE(pf.grid_config, '[]'::jsonb),
              pf.icon
       FROM public.forms pf
       WHERE pf.slug = ANY($1::text[])
       ON CONFLICT (slug) DO NOTHING
       RETURNING slug`,
      [formSlugs],
    );
    return { copied: result.rowCount ?? 0 };
  }

  // createTenantModule — nuevo
  async createTenantModule(schema: string, dto: CreateModuleDto) {
    const existing = await this.pool.query(
      `SELECT id FROM ${schema}.modules WHERE code = $1`, [dto.code]
    );
    if ((existing.rowCount ?? 0) > 0)
      throw new ConflictException(`El código '${dto.code}' ya existe`);

    const result = await this.pool.query(
      `INSERT INTO ${schema}.modules (name, code, icon, description, sort_order, is_custom)
     VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
      [dto.name, dto.code, dto.icon ?? null, dto.description ?? null, dto.sort_order ?? 0],
    );
    return result.rows[0];
  }

  // setTenantModuleForms — nuevo
  async setTenantModuleForms(schema: string, moduleId: number, formSlugs: string[]) {
    const access = await this.formAccess.resolveAssignability(schema);
    const disallowed = formSlugs.filter((slug) => !access.isAllowed(slug));
    if (disallowed.length > 0) {
      throw new BadRequestException(
        `Los siguientes formularios no están permitidos para este tenant: ${disallowed.join(', ')}`,
      );
    }

    await this.copyMissingFormsToTenant(schema, formSlugs);
    await this.pool.query(
      `DELETE FROM ${schema}.module_forms WHERE module_id = $1`, [moduleId]
    );
    for (let i = 0; i < formSlugs.length; i++) {
      await this.pool.query(
        `INSERT INTO ${schema}.module_forms (module_id, form_slug, sort_order)
       VALUES ($1, $2, $3)`,
        [moduleId, formSlugs[i], i],
      );
    }
    return { message: 'Formularios actualizados' };
  }

  // setTenantModuleRoles — actualizar con nuevas columnas
  async setTenantModuleRoles(schema: string, moduleId: number, roles: ModuleRoleItemDto[]) {
    await this.pool.query(
      `DELETE FROM ${schema}.module_roles WHERE module_id = $1`, [moduleId]
    );
    for (const r of roles) {
      await this.pool.query(
        `INSERT INTO ${schema}.module_roles
         (module_id, role_code, can_view, can_create, can_edit, can_delete, can_export, can_import)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [moduleId, r.role_code, r.can_view, r.can_create, r.can_edit,
          r.can_delete, r.can_export, r.can_import],
      );
    }
    return { message: 'Permisos actualizados' };
  }

async getTenantModuleRoles(schema: string, moduleId: number) {
  const result = await this.pool.query(
    `SELECT r.code as role_code, r.name,   -- ← alias aquí
            COALESCE(mr.can_view,   false) as can_view,
            COALESCE(mr.can_create, false) as can_create,
            COALESCE(mr.can_edit,   false) as can_edit,
            COALESCE(mr.can_delete, false) as can_delete,
            COALESCE(mr.can_export, false) as can_export,
            COALESCE(mr.can_import, false) as can_import
     FROM ${schema}.roles r
     LEFT JOIN ${schema}.module_roles mr
            ON mr.module_id = $1 AND mr.role_code = r.code
     ORDER BY r.name`,
    [moduleId],
  );
  return result.rows;
}
}