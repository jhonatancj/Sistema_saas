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

  // ── Jerarquía de módulos (hasta 4 niveles: módulo > submódulo >
  // submódulo > form — 3 niveles de módulo, el form es el 4º y último
  // peldaño) — ver docs/adr/024-jerarquia-modulos.md. Un solo helper
  // reusado por los 4 puntos de entrada (create/update × public/tenant).
  // `moduleId` es `null` al crear (todavía no existe, no puede haber ciclo
  // ni subárbol propio) y el id real al editar.
  private async validateModuleParent(
    schema: string, moduleId: number | null, parentId: number | null | undefined,
  ): Promise<void> {
    if (parentId == null) return; // raíz — siempre válido
    if (moduleId != null && parentId === moduleId) {
      throw new BadRequestException('Un módulo no puede ser su propio padre');
    }

    // Cadena de ancestros del padre propuesto (él mismo incluido) — sirve
    // tanto para detectar un ciclo (¿el módulo que edito aparece ahí?)
    // como para saber su profundidad (MAX(depth), raíz = 1).
    const ancestors = await this.pool.query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_id, 1 AS depth FROM ${schema}.modules WHERE id = $1
         UNION ALL
         SELECT m.id, m.parent_id, chain.depth + 1
         FROM ${schema}.modules m JOIN chain ON m.id = chain.parent_id
       )
       SELECT array_agg(id) AS ids, COALESCE(MAX(depth), 0) AS depth FROM chain`,
      [parentId],
    );
    const { ids, depth: parentDepth } = ancestors.rows[0];
    if ((ancestors.rowCount ?? 0) === 0 || parentDepth === 0) {
      throw new NotFoundException('El módulo padre elegido no existe');
    }
    // `.map(Number)`: `database.module.ts` normaliza BIGINT (OID 20) a
    // number, pero `array_agg(bigint)` es un tipo distinto (bigint[], OID
    // 1016) sin parser propio — sin esto, `ids` llega como strings y
    // `.includes(moduleId)` (number) nunca matchea, aunque sí haya ciclo.
    // Mismo patrón ya documentado en docs/known-bugs.md, esta vez vía
    // array_agg en vez de una columna simple.
    if (moduleId != null && (ids ?? []).map(Number).includes(moduleId)) {
      throw new BadRequestException('Ese módulo padre crearía un ciclo (es descendiente del módulo que estás editando)');
    }

    // Profundidad del propio subárbol del módulo que edito (0 si no tiene
    // submódulos todavía) — moverlo no solo lo afecta a él, también a
    // cualquier hijo/nieto que ya tenga.
    let subtreeDepth = 0;
    if (moduleId != null) {
      const subtree = await this.pool.query(
        `WITH RECURSIVE subtree AS (
           SELECT id, 0 AS depth FROM ${schema}.modules WHERE id = $1
           UNION ALL
           SELECT m.id, subtree.depth + 1
           FROM ${schema}.modules m JOIN subtree ON m.parent_id = subtree.id
         )
         SELECT COALESCE(MAX(depth), 0) AS depth FROM subtree`,
        [moduleId],
      );
      subtreeDepth = subtree.rows[0].depth;
    }

    const MAX_MODULE_DEPTH = 3;
    const newDepth = parentDepth + 1;
    if (newDepth + subtreeDepth > MAX_MODULE_DEPTH) {
      throw new BadRequestException(
        `Anidar acá supera el máximo de ${MAX_MODULE_DEPTH} niveles de módulo (el formulario es el 4º y último)`,
      );
    }
  }

  // ── Módulos públicos (plantillas) ────────────────────────────────
  // `name` es el nombre que ve el super admin en su propio catálogo/sidebar
  // (sirve para distinguir variantes, ej. "Inventario Restaurantes" vs
  // "Inventario Ferreterías"); `tenant_name` es el nombre que recibe
  // cualquier tenant al que se le asigne el módulo (NULL = usa `name` tal
  // cual). Ver docs/adr/012-module-tenant-name.md.
  async getPublicModules() {
    const result = await this.pool.query(
      `SELECT m.id, m.name, m.tenant_name, m.code, m.tenant_code, m.icon, m.description, m.sort_order, m.is_active, m.rubro_id, m.parent_id, m.created_at,
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
    tenantName?: string; tenantCode?: string; rubroId?: number; parentId?: number | null;
  }) {
    const existing = await this.pool.query(
      `SELECT id FROM public.modules WHERE code = $1`, [dto.code]
    );
    if ((existing.rowCount ?? 0) > 0) throw new ConflictException(`El código '${dto.code}' ya existe`);

    await this.validateModuleParent('public', null, dto.parentId);

    const result = await this.pool.query(
      `INSERT INTO public.modules (name, code, icon, description, sort_order, tenant_name, tenant_code, rubro_id, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [dto.name, dto.code, dto.icon ?? null, dto.description ?? null, dto.sortOrder ?? 0, dto.tenantName ?? null, dto.tenantCode ?? null, dto.rubroId ?? null, dto.parentId ?? null],
    );
    return result.rows[0];
  }

  async updatePublicModule(id: number, dto: {
    name?: string; icon?: string; description?: string; sortOrder?: number; isActive?: boolean;
    tenantName?: string; tenantCode?: string; rubroId?: number; parentId?: number | null;
  }) {
    const current = await this.pool.query(`SELECT parent_id FROM public.modules WHERE id = $1`, [id]);
    if ((current.rowCount ?? 0) === 0) throw new NotFoundException('Módulo no encontrado');
    // `undefined` (no vino en el dto) conserva el valor actual; `null`
    // explícito lo vuelve a la raíz — nunca un COALESCE acá, si no nunca se
    // podría "desanidar" un módulo de vuelta a la raíz.
    const resolvedParentId = dto.parentId !== undefined ? dto.parentId : current.rows[0].parent_id;
    await this.validateModuleParent('public', id, resolvedParentId);

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
        parent_id   = $9,
        updated_at  = NOW()
       WHERE id = $10 RETURNING *`,
      [dto.name ?? null, dto.icon ?? null, dto.description ?? null, dto.sortOrder ?? null, dto.isActive ?? null, dto.tenantName ?? null, dto.tenantCode ?? null, dto.rubroId ?? null, resolvedParentId, id],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Módulo no encontrado');
    return result.rows[0];
  }

  // Solo borra el módulo del catálogo (fk_pmf_module/fk_pmr_module tienen
  // ON DELETE CASCADE, así que module_forms/module_roles de este módulo se
  // limpian solos) — nunca toca los forms en sí (public.forms), que pueden
  // estar anidados en otros módulos (ej. `categorias` en varios
  // INVENTARIO_*, ver docs/adr/016-agrupacion-menu-inventario.md). Tampoco
  // afecta a tenants que ya hayan sincronizado este módulo — mismo criterio
  // "copy-if-missing, nunca retroactivo" que el resto del sync.
  async deletePublicModule(id: number) {
    const result = await this.pool.query(
      `DELETE FROM public.modules WHERE id = $1 RETURNING id`, [id],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Módulo no encontrado');
    return { message: 'Módulo eliminado' };
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
      `SELECT m.id, m.name, m.code, m.icon, m.description, m.sort_order, m.is_active, m.is_custom, m.parent_id,
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
      `SELECT m.id, m.name, m.code, m.icon, m.sort_order, m.parent_id,
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
  // `rubro_id`/`rubro_code`/`rubro_nombre` — agregado para que el sidebar del
  // super admin pueda agrupar los módulos por rubro (ver
  // docs/adr/023-agrupacion-sidebar-admin-por-rubro.md). `rubro_id` ya
  // viaja en `public.modules`, solo faltaba el JOIN a `tbl_rubro` para el
  // nombre/code legibles — un módulo universal (Clientes/Proveedores/etc.)
  // tiene `rubro_id NULL`, los 3 campos de rubro salen `NULL` también.
  // `rubro_code`/`rubro_nombre` (agregados en una sesión anterior para un
  // agrupamiento por rubro puramente calculado en el frontend) ya no se
  // leen en ningún lado — reemplazados por la jerarquía real de
  // `parent_id` (ver docs/adr/024-jerarquia-modulos.md). `rubro_id` se
  // deja, sigue siendo útil (ej. filtro de módulos al sincronizar un tenant).
  async getPublicModulesForMenu() {
    const result = await this.pool.query(
      `SELECT m.id, m.name, m.code, m.icon, m.sort_order, m.rubro_id, m.parent_id,
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
    parentId?: number | null;
  }) {
    const current = await this.pool.query(`SELECT parent_id FROM ${schema}.modules WHERE id = $1`, [id]);
    if ((current.rowCount ?? 0) === 0) throw new NotFoundException('Módulo no encontrado');
    const resolvedParentId = dto.parentId !== undefined ? dto.parentId : current.rows[0].parent_id;
    await this.validateModuleParent(schema, id, resolvedParentId);

    const result = await this.pool.query(
      `UPDATE ${schema}.modules SET
        name        = COALESCE($1, name),
        icon        = COALESCE($2, icon),
        description = COALESCE($3, description),
        sort_order  = COALESCE($4, sort_order),
        is_active   = COALESCE($5, is_active),
        parent_id   = $6,
        updated_at  = NOW()
       WHERE id = $7 RETURNING *`,
      [dto.name ?? null, dto.icon ?? null, dto.description ?? null, dto.sortOrder ?? null, dto.isActive ?? null, resolvedParentId, id],
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

    // Traduce la jerarquía (`parent_id`) de public a los ids locales del
    // tenant — `public.modules.parent_id` apunta a un id de `public`, el
    // tenant tiene los suyos propios (linkeados via `public_id`). Si el
    // padre público no se sincronizó a este tenant (todavía, o nunca), `tp`
    // no matchea y el módulo queda sin padre (raíz) — degradación segura,
    // sin error. Ver docs/adr/024-jerarquia-modulos.md.
    await this.pool.query(
      `UPDATE ${schema}.modules tm SET parent_id = tp.id
       FROM public.modules pm
       JOIN ${schema}.modules tp ON tp.public_id = pm.parent_id
       WHERE tm.public_id = pm.id AND pm.parent_id IS NOT NULL`,
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
    const slugs = assignedSlugs.rows.map((r) => r.form_slug);
    await this.copyMissingFormsToTenant(schema, slugs);

    // Barrido: `copyMissingFormsToTenant` solo copia la *definición*
    // (json_form) — nunca genera la tabla/SP real del tenant (ver
    // docs/adr/013-...md, "nota operativa"). Antes esto quedaba pendiente de
    // un paso manual (abrir el form en el builder "Por tenant" y guardar);
    // ahora el sync mismo se encarga de que todo form recién asignado a este
    // tenant termine con su tabla/SP generados, sin depender de qué módulo
    // sea ni de si el tenant tiene rubro.
    await this.ensureFormsGenerated(schema, slugs);

    await this.syncCatalogDataForRubro(schema);

    return { message: 'Módulos sincronizados' };
  }

  // ── Genera tabla+SP para cualquier form recién asignado que todavía no
  // los tenga en este tenant. Idempotente (salta los que ya tienen
  // has_table+has_sp) — no reprocesa forms que el tenant ya generó, solo
  // pone al día los que quedaron con la definición copiada pero sin tabla
  // real (el caso típico: un módulo sincronizado después de crear el tenant).
  // Procesa en orden de dependencias (ver sortSlugsByDependencies) — sin
  // esto, un form con `relation` hacia otro form todavía sin tabla (ej.
  // `empleados` → `sucursales`, `venta_barrio` → `clientes`/`empleados`/
  // `sucursales`/`producto_barrio`) puede fallar si Postgres devuelve el
  // slug dependiente antes que su prerequisito (ver docs/known-bugs.md).
  private async ensureFormsGenerated(schema: string, slugs: string[]): Promise<void> {
    const ordered = await this.sortSlugsByDependencies(schema, slugs);
    for (const slug of ordered) {
      const formResult = await this.pool.query(
        `SELECT json_form, has_table, has_sp, icon, display_mode, modal_width, name, table_name, sp_name
         FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`,
        [slug],
      );
      if ((formResult.rowCount ?? 0) === 0) continue;
      const form = formResult.rows[0];
      if (form.has_table && form.has_sp) continue;

      await this.formGenerator.processForm(schema, {
        slug, name: form.name, jsonForm: form.json_form,
        tableName: form.table_name, spName: form.sp_name,
        icon: form.icon, displayMode: form.display_mode, modalWidth: form.modal_width,
      });
    }
  }

  // ── Orden topológico (Kahn/DFS) de `slugs` según las dependencias
  // `relation` declaradas en cada `json_form` (campos ocultos de un
  // `input-lupa`, `select`+`relation`, o columnas de un `line-items`) — un
  // form solo se procesa después de los forms que referencia vía FK. Un
  // ciclo (no debería poder pasar con los patrones actuales del motor) se
  // corta sin bloquear el resto: se marca visitado y sigue, en vez de tirar
  // error y abortar todo el sync.
  private async sortSlugsByDependencies(schema: string, slugs: string[]): Promise<string[]> {
    if (slugs.length <= 1) return slugs;

    const slugSet = new Set(slugs);
    const dependsOn = new Map<string, Set<string>>();

    for (const slug of slugs) {
      const result = await this.pool.query(
        `SELECT json_form FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`,
        [slug],
      );
      const jsonForm = result.rows[0]?.json_form;
      const deps = new Set<string>();
      if (jsonForm?.root) {
        for (const f of this.formGenerator.extractFields(jsonForm.root)) {
          if (f.relation?.form && f.relation.form !== slug && slugSet.has(f.relation.form)) {
            deps.add(f.relation.form);
          }
        }
        const lineItemsNode = this.formGenerator.findLineItemsNode(jsonForm.root);
        for (const col of lineItemsNode?.lineItemColumns ?? []) {
          if (col.relation?.form && col.relation.form !== slug && slugSet.has(col.relation.form)) {
            deps.add(col.relation.form);
          }
        }
      }
      dependsOn.set(slug, deps);
    }

    const ordered: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (slug: string) => {
      if (visited.has(slug) || visiting.has(slug)) return;
      visiting.add(slug);
      for (const dep of dependsOn.get(slug) ?? []) visit(dep);
      visiting.delete(slug);
      visited.add(slug);
      ordered.push(slug);
    };

    for (const slug of slugs) visit(slug);
    return ordered;
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
  // copia datos (la tabla/SP igual se genera vía `ensureFormsGenerated`).
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
      const exists = await this.pool.query(
        `SELECT 1 FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL AND has_table = TRUE`,
        [slug],
      );
      if ((exists.rowCount ?? 0) === 0) continue; // no sincronizado a este tenant

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
      `INSERT INTO ${schema}.forms (slug, name, json_form, grid_config, icon, display_mode, modal_width)
       SELECT pf.slug, pf.name,
              COALESCE(pf.json_form, '{}'::jsonb),
              COALESCE(pf.grid_config, '[]'::jsonb),
              pf.icon, pf.display_mode, pf.modal_width
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

    await this.validateModuleParent(schema, null, dto.parentId);

    const result = await this.pool.query(
      `INSERT INTO ${schema}.modules (name, code, icon, description, sort_order, is_custom, parent_id)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING *`,
      [dto.name, dto.code, dto.icon ?? null, dto.description ?? null, dto.sort_order ?? 0, dto.parentId ?? null],
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