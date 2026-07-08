import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_MASTER_POOL } from '../../database/database.module';
import { FormAccessService } from '../form-access/form-access.service';

// filter = { filters: [condiciones de columna], sorts: [orden] } — un solo
// objeto en el body de /execute que cubre filtro y orden de la grid.
// `operator` es `string` (no un union literal) para no acoplar el tipo con
// el DTO del controller; el switch de abajo ignora silenciosamente
// cualquier operator que no reconozca.
interface GridFilterCondition {
  field: string;
  operator: string;
  value?: string | number;
  valueTo?: number; // solo para 'inRange'
}
interface GridSortItem {
  field: string;
  sort: 'asc' | 'desc';
}
interface GridFilter {
  filters?: GridFilterCondition[];
  sorts?: GridSortItem[];
  // Búsqueda general (un solo input, sin elegir columna) — hace OR de
  // ILIKE contra todas las columnas de texto (varchar/text) de la tabla,
  // combinado con AND al resto de `filters`. Ver selectPaged().
  search?: string;
}

@Injectable()
export class FormExecutorService {
  constructor(
    @Inject(PG_MASTER_POOL) private readonly pool: Pool,
    private readonly formAccess: FormAccessService,
  ) { }

  async getForms(schema: string) {
    // 'public' es el catálogo en sí, no un tenant que lo consume — no aplica
    // "assignability" contra sí mismo (esa lógica es "¿qué puede usar tal
    // tenant?"). resolveAssignability() buscaría una fila en public.tenants
    // con schema_name='public', que no existe, y tiraría 404.
    const isAllowed = schema === 'public'
      ? () => true
      : (await this.formAccess.resolveAssignability(schema)).isAllowed;
    const result = await this.pool.query(
      `SELECT id, slug, name, has_table, has_sp, table_name, sp_name, grid_query, icon,
              display_mode, modal_width, created_at
       FROM ${schema}.forms WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return result.rows.filter((row) => isAllowed(row.slug));
  }

  async getForm(schema: string, slug: string) {
    const result = await this.pool.query(
      `SELECT id, slug, name, action, json_form, has_table, has_sp, table_name, sp_name, grid_query, icon,
              display_mode, modal_width, created_at
       FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`,
      [slug],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Formulario no encontrado');
    return result.rows[0];
  }

  // Resuelve el empleado (id + nombre) cuyo email coincide con el del
  // usuario logueado — usado para autocompletar campos input-lupa marcados
  // con `autoFillCurrentEmployee` (ver docs/adr/019, sección de
  // autocompletado). `null` es un resultado válido (el usuario no tiene fila
  // en empleados, ej. el super admin en su propio sandbox) — no es un error.
  // Defensivo ante schemas sin `tbl_empleados` (tenant que no sincronizó ese
  // form todavía): cualquier error de la query cae a `null`, nunca rompe el
  // form que lo está pidiendo.
  async findEmpleadoByEmail(schema: string, email: string): Promise<{ id: number; nombre: string } | null> {
    try {
      const result = await this.pool.query(
        `SELECT id, nombre FROM ${schema}.tbl_empleados WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
        [email],
      );
      return result.rows[0] ?? null;
    } catch {
      return null;
    }
  }

  async getGridConfig(schema: string, slug: string) {
    const result = await this.pool.query(
      `SELECT grid_config FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`,
      [slug],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Formulario no encontrado');
    return result.rows[0].grid_config ?? [];
  }

  async saveGridConfig(schema: string, slug: string, gridConfig: any[]) {
    const result = await this.pool.query(
      `UPDATE ${schema}.forms SET grid_config = $1, updated_at = NOW()
     WHERE slug = $2 AND deleted_at IS NULL RETURNING grid_config`,
      [JSON.stringify(gridConfig), slug],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Formulario no encontrado');
    return result.rows[0].grid_config;
  }
  
  async execute(
    schema: string,
    slug: string,
    action: string,
    id?: number,
    data?: any,
    limit?: number,
    offset?: number,
    filter?: GridFilter,
  ) {
    // Default de paginación: cualquier SELECT (listado, no SELECT_BY_ID) sin
    // `limit` explícito pagina a 25 en vez de devolver todas las filas. El
    // datasource de AG-Grid ya manda limit siempre (no lo toca esto) — este
    // default protege a cualquier otro consumidor (curl, integraciones
    // futuras) de traer una tabla entera sin querer.
    if (action === 'SELECT' && limit == null) {
      limit = 25;
    }

    // Verificar que el formulario existe y tiene SP
    const formResult = await this.pool.query(
      `SELECT has_table, has_sp, table_name, sp_name, grid_query FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`,
      [slug],
    );

    if ((formResult.rowCount ?? 0) === 0) {
      throw new NotFoundException(`Formulario '${slug}' no encontrado`);
    }

    const { has_table, has_sp, table_name, sp_name, grid_query } = formResult.rows[0];

    const wantsFiltering = ((filter?.filters?.length ?? 0) > 0) || ((filter?.sorts?.length ?? 0) > 0) || !!filter?.search?.trim();
    const useCustomQuery = !!grid_query;

    // Filtros/orden de la grid no pasan por el SP — armar y validar SQL
    // dinámico por columna es más simple y legible en TS que en plpgsql
    // genérico. El SP sigue siendo la única vía para INSERT/UPDATE/DELETE.
    // `useCustomQuery` también fuerza esta rama aunque no haya filter/sort:
    // el Infinite Row Model de AG-Grid manda limit/offset siempre pero
    // filter recién cuando el usuario filtra — sin este chequeo, la
    // primera página de un form con grid_query ignoraría la query custom.
    if (action === 'SELECT' && (wantsFiltering || useCustomQuery)) {
      if (!has_table && !useCustomQuery) {
        throw new NotFoundException(`El formulario '${slug}' no tiene tabla generada`);
      }
      return this.selectPaged(schema, slug, { limit, offset, filter, tableName: table_name, gridQuery: grid_query });
    }

    if (!has_sp) {
      throw new NotFoundException(`El formulario '${slug}' no tiene SP generado`);
    }

    // Solo se manda p_limit/p_offset cuando el caller realmente los pide.
    // Si el SP del form todavía no fue reprocesado con la firma nueva de 5
    // parámetros (ver FormGeneratorService.buildSpDDL), esta llamada de 3
    // args sigue funcionando igual que siempre — evita romper cualquier
    // form/tenant existente que no haya vuelto a guardar su formulario
    // desde que se agregó paginación.
    const spFn = `${schema}.${sp_name || `sp_${slug}`}`;
    const wantsPagination = limit != null || offset != null;
    const query = wantsPagination
      ? `SELECT ${spFn}($1::VARCHAR, $2::BIGINT, $3::JSONB, $4::BIGINT, $5::BIGINT) AS result`
      : `SELECT ${spFn}($1::VARCHAR, $2::BIGINT, $3::JSONB) AS result`;
    const params = wantsPagination
      ? [action, id ?? null, data ? JSON.stringify(data) : null, limit ?? null, offset ?? null]
      : [action, id ?? null, data ? JSON.stringify(data) : null];

    const result = await this.pool.query(query, params);

    return result.rows[0].result;
  }

  // ── SELECT con filtros/orden dinámicos (grid, AG-Grid Infinite Row Model) ──
  private async selectPaged(
    schema: string,
    slug: string,
    opts: { limit?: number; offset?: number; filter?: GridFilter; tableName?: string | null; gridQuery?: string | null },
  ): Promise<{ rows: any[]; total: number }> {
    const usingCustomQuery = !!opts.gridQuery;
    const realTableName = opts.tableName || `tbl_${slug}`;
    const source = usingCustomQuery ? `(${opts.gridQuery})` : `${schema}.${realTableName}`;

    // Whitelist de columnas — nunca interpolar un nombre de columna que no
    // venga de acá (previene inyección SQL vía field). Para una tabla real
    // se usa information_schema; para una query custom (subquery arbitraria,
    // no una tabla) se hace un probe LIMIT 0 y se leen los nombres reales
    // que devuelve el driver.
    // searchableColumns: subset de validColumns usado por la búsqueda general
    // (filter.search) — solo columnas de texto (varchar/text). Postgres OIDs
    // 25=text, 1043=varchar, 1042=bpchar; para una tabla real se usa
    // information_schema.columns.data_type, equivalente pero legible.
    const TEXT_TYPE_OIDS = new Set([25, 1043, 1042]);
    let validColumns: Set<string>;
    let searchableColumns: string[];
    if (usingCustomQuery) {
      const probe = await this.pool.query(`SELECT * FROM ${source} __probe LIMIT 0`);
      validColumns = new Set(probe.fields.map((f) => f.name));
      searchableColumns = probe.fields.filter((f) => TEXT_TYPE_OIDS.has(f.dataTypeID)).map((f) => f.name);
    } else {
      const colsResult = await this.pool.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [schema, realTableName],
      );
      validColumns = new Set(colsResult.rows.map((r) => r.column_name));
      searchableColumns = colsResult.rows
        .filter((r) => r.data_type === 'character varying' || r.data_type === 'text')
        .map((r) => r.column_name);
    }

    const params: any[] = [];
    // El filtro base de soft-delete solo aplica a la tabla real generada —
    // una query custom puede no tener columna deleted_at, y de todos modos
    // el admin que la escribió es responsable de sus propios filtros.
    const whereClauses: string[] = usingCustomQuery ? [] : ['deleted_at IS NULL'];

    for (const cond of opts.filter?.filters ?? []) {
      if (!cond?.field || !validColumns.has(cond.field)) continue;
      const col = `"${cond.field}"`;

      switch (cond.operator) {
        case 'contains': params.push(String(cond.value ?? '')); whereClauses.push(`${col} ILIKE '%' || $${params.length} || '%'`); break;
        case 'notContains': params.push(String(cond.value ?? '')); whereClauses.push(`${col} NOT ILIKE '%' || $${params.length} || '%'`); break;
        case 'startsWith': params.push(String(cond.value ?? '')); whereClauses.push(`${col} ILIKE $${params.length} || '%'`); break;
        case 'endsWith': params.push(String(cond.value ?? '')); whereClauses.push(`${col} ILIKE '%' || $${params.length}`); break;
        case 'equals': params.push(cond.value); whereClauses.push(`${col} = $${params.length}`); break;
        case 'notEqual': params.push(cond.value); whereClauses.push(`${col} != $${params.length}`); break;
        case 'greaterThan': params.push(cond.value); whereClauses.push(`${col} > $${params.length}`); break;
        case 'greaterThanOrEqual': params.push(cond.value); whereClauses.push(`${col} >= $${params.length}`); break;
        case 'lessThan': params.push(cond.value); whereClauses.push(`${col} < $${params.length}`); break;
        case 'lessThanOrEqual': params.push(cond.value); whereClauses.push(`${col} <= $${params.length}`); break;
        case 'inRange': {
          params.push(cond.value);
          const from = params.length;
          params.push(cond.valueTo);
          const to = params.length;
          whereClauses.push(`${col} BETWEEN $${from} AND $${to}`);
          break;
        }
        case 'blank': whereClauses.push(`${col} IS NULL`); break;
        case 'notBlank': whereClauses.push(`${col} IS NOT NULL`); break;
      }
    }

    // Búsqueda general — un solo término, OR contra todas las columnas de
    // texto de la tabla, AND con los filtros por columna de arriba (si hay).
    // Nota: si el form tiene un campo `image` (TEXT con base64), esa columna
    // queda dentro de searchableColumns — el ILIKE sigue siendo correcto,
    // solo algo menos eficiente contra un blob grande. No se filtra por tipo
    // de campo del builder porque selectPaged no tiene acceso a json_form.
    const searchTerm = opts.filter?.search?.trim();
    if (searchTerm && searchableColumns.length > 0) {
      params.push(searchTerm);
      const p = params.length;
      const orGroup = searchableColumns.map((c) => `"${c}" ILIKE '%' || $${p} || '%'`).join(' OR ');
      whereClauses.push(`(${orGroup})`);
    }

    const orderClauses = (opts.filter?.sorts ?? [])
      .filter((s) => s?.field && validColumns.has(s.field))
      .map((s) => `"${s.field}" ${s.sort === 'desc' ? 'DESC' : 'ASC'}`);
    if (orderClauses.length === 0) orderClauses.push('id ASC');

    params.push(opts.limit ?? null);
    const limitParam = params.length;
    params.push(opts.offset ?? null);
    const offsetParam = params.length;

    // to_jsonb (no "SELECT *" crudo) a propósito: el driver de node-pg
    // devuelve NUMERIC/BIGINT como string por seguridad de precisión, pero
    // el SP (que usa to_jsonb internamente) los serializa como número JSON.
    // Sin esto, las mismas columnas salían con tipos distintos según el
    // request tuviera filtro/orden o no — bug real encontrado probando la
    // grid en el navegador (precio "50.00" en vez de 50).
    const sql = `
      SELECT to_jsonb(paged.*) AS row_json, COUNT(*) OVER() AS __total
      FROM (
        SELECT * FROM ${source} __src
        ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
        ORDER BY ${orderClauses.join(', ')}
        LIMIT $${limitParam}::BIGINT OFFSET $${offsetParam}::BIGINT
      ) paged
    `;

    const result = await this.pool.query(sql, params);
    const total = result.rows.length > 0 ? Number(result.rows[0].__total) : 0;
    const rows = result.rows.map((r) => r.row_json);

    return { rows, total };
  }
}