import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_MASTER_POOL } from '../../database/database.module';
import { FormGeneratorService } from '../forms/form-generator.service';
import { FormExecutorService } from '../forms/form-executor.service';

@Injectable()
export class AdminFormsService {
  constructor(
    @Inject(PG_MASTER_POOL) private readonly pool: Pool,
    private readonly formGenerator: FormGeneratorService,
    private readonly formExecutor: FormExecutorService,
  ) { }

  private tenantSchema(slug: string): string {
    return `tenant_${slug.replace(/-/g, '_')}`;
  }

  // Tablas core del template de tenant — nunca se ofrecen como "tabla de
  // datos" seleccionable en el bind de un formulario.
  private readonly CORE_TENANT_TABLES = new Set([
    'forms', 'form_submissions', 'users', 'roles', 'user_roles', 'permissions',
    'role_permissions', 'modules', 'module_forms', 'module_roles', 'refresh_tokens',
  ]);

  // Tablas core del schema public — nunca se ofrecen como "tabla de datos"
  // seleccionable en el bind de un formulario público. modules/module_forms/
  // module_roles no tienen script de creación documentado (drift preexistente,
  // igual que le pasaba a forms antes de la Fase 0) pero son tablas reales.
  // users/roles/permissions/user_roles/role_permissions/refresh_tokens:
  // drift real encontrado al verificar esta lista — existen en `public` sin
  // ningún uso en el código (restos de un prototipo previo al rediseño
  // multi-tenant; toda la auth real usa {tenant_schema}.users, nunca
  // public.users), pero son tablas reales y había que excluirlas explícitamente.
  private readonly CORE_PUBLIC_TABLES = new Set([
    'subscription_plans', 'tenants', 'tenant_subscriptions', 'super_admins',
    'super_admin_audit_logs', 'super_admin_refresh_tokens', 'tenant_allowed_forms',
    'forms', 'modules', 'module_forms', 'module_roles',
    'tenant_schema_migrations', 'schema_migrations',
    'users', 'roles', 'permissions', 'user_roles', 'role_permissions', 'refresh_tokens',
  ]);

  // ── Public forms ──────────────────────────────────────────────────

  async getPublicForms() {
    return this.formExecutor.getForms('public');
  }

  async getPublicForm(slug: string) {
    return this.formExecutor.getForm('public', slug);
  }

  async createPublicForm(dto: {
    slug: string; name: string; jsonForm?: any; icon?: string;
    tableName?: string; spName?: string; recreateSp?: boolean; gridQuery?: string;
    displayMode?: 'modal' | 'inline'; modalWidth?: number;
  }) {
    const existing = await this.pool.query(
      `SELECT id FROM public.forms WHERE slug = $1 AND deleted_at IS NULL`, [dto.slug],
    );
    if ((existing.rowCount ?? 0) > 0)
      throw new ConflictException(`El slug '${dto.slug}' ya existe`);

    return this.formGenerator.processForm('public', {
      slug: dto.slug,
      name: dto.name,
      jsonForm: dto.jsonForm ?? { version: 1, root: [] },
      tableName: dto.tableName ?? null,
      spName: dto.spName ?? null,
      recreateSp: dto.recreateSp ?? true,
      gridQuery: dto.gridQuery ?? null,
      icon: dto.icon ?? null,
      displayMode: dto.displayMode ?? null,
      modalWidth: dto.modalWidth ?? null,
    });
  }

  async updatePublicForm(slug: string, dto: {
    name?: string; jsonForm?: any; icon?: string;
    tableName?: string; spName?: string; recreateSp?: boolean; gridQuery?: string;
    displayMode?: 'modal' | 'inline'; modalWidth?: number;
  }) {
    const current = await this.formExecutor.getForm('public', slug); // 404 si no existe

    return this.formGenerator.processForm('public', {
      slug,
      name: dto.name ?? current.name,
      jsonForm: dto.jsonForm ?? current.json_form,
      tableName: dto.tableName !== undefined ? dto.tableName : current.table_name,
      spName: dto.spName !== undefined ? dto.spName : current.sp_name,
      recreateSp: dto.recreateSp ?? true,
      gridQuery: dto.gridQuery !== undefined ? dto.gridQuery : current.grid_query,
      icon: dto.icon !== undefined ? dto.icon : current.icon,
      displayMode: dto.displayMode !== undefined ? dto.displayMode : current.display_mode,
      modalWidth: dto.modalWidth !== undefined ? dto.modalWidth : current.modal_width,
    });
  }

  async executePublicForm(
    slug: string, action: string, id?: number, data?: any,
    limit?: number, offset?: number, filter?: any,
  ) {
    return this.formExecutor.execute('public', slug, action, id, data, limit, offset, filter);
  }

  async listPublicTables() {
    const result = await this.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    return result.rows
      .map((r) => r.table_name as string)
      .filter((t) => !this.CORE_PUBLIC_TABLES.has(t));
  }

  // ── Tenant forms ──────────────────────────────────────────────────

  async getTenantForms(tenantSlug: string) {
    const schema = this.tenantSchema(tenantSlug);
    const result = await this.pool.query(
      `SELECT id, slug, name, has_table, has_sp, table_name, sp_name, grid_query, icon,
              display_mode, modal_width, created_at, updated_at
       FROM ${schema}.forms WHERE deleted_at IS NULL ORDER BY name`,
    );
    return result.rows;
  }

  async getTenantForm(tenantSlug: string, slug: string) {
    const schema = this.tenantSchema(tenantSlug);
    const result = await this.pool.query(
      `SELECT id, slug, name, json_form, has_table, has_sp, table_name, sp_name, grid_query, icon,
              display_mode, modal_width, created_at, updated_at
       FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`,
      [slug],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException(`Formulario '${slug}' no encontrado`);
    return result.rows[0];
  }

  async listTenantTables(tenantSlug: string) {
    const schema = this.tenantSchema(tenantSlug);
    const result = await this.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [schema],
    );
    return result.rows
      .map((r) => r.table_name as string)
      .filter((t) => !this.CORE_TENANT_TABLES.has(t));
  }

  async createTenantForm(tenantSlug: string, dto: {
    slug: string; name: string; jsonForm?: any;
    tableName?: string; spName?: string; recreateSp?: boolean; gridQuery?: string; icon?: string;
    displayMode?: 'modal' | 'inline'; modalWidth?: number;
  }) {
    const schema = this.tenantSchema(tenantSlug);
    const existing = await this.pool.query(
      `SELECT id FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`, [dto.slug],
    );
    if ((existing.rowCount ?? 0) > 0)
      throw new ConflictException(`El slug '${dto.slug}' ya existe en este tenant`);

    return this.formGenerator.processForm(schema, {
      slug: dto.slug,
      name: dto.name,
      jsonForm: dto.jsonForm ?? { version: 1, root: [] },
      tableName: dto.tableName ?? null,
      spName: dto.spName ?? null,
      recreateSp: dto.recreateSp ?? true,
      gridQuery: dto.gridQuery ?? null,
      icon: dto.icon ?? null,
      displayMode: dto.displayMode ?? null,
      modalWidth: dto.modalWidth ?? null,
    });
  }

  async updateTenantForm(tenantSlug: string, slug: string, dto: {
    name?: string; jsonForm?: any;
    tableName?: string; spName?: string; recreateSp?: boolean; gridQuery?: string; icon?: string;
    displayMode?: 'modal' | 'inline'; modalWidth?: number;
  }) {
    const schema = this.tenantSchema(tenantSlug);
    const current = await this.getTenantForm(tenantSlug, slug); // 404 si no existe

    return this.formGenerator.processForm(schema, {
      slug,
      name: dto.name ?? current.name,
      jsonForm: dto.jsonForm ?? current.json_form,
      tableName: dto.tableName !== undefined ? dto.tableName : current.table_name,
      spName: dto.spName !== undefined ? dto.spName : current.sp_name,
      recreateSp: dto.recreateSp ?? true,
      gridQuery: dto.gridQuery !== undefined ? dto.gridQuery : current.grid_query,
      icon: dto.icon !== undefined ? dto.icon : current.icon,
      displayMode: dto.displayMode !== undefined ? dto.displayMode : current.display_mode,
      modalWidth: dto.modalWidth !== undefined ? dto.modalWidth : current.modal_width,
    });
  }

  async getGridConfig(slug: string, tenantSlug?: string) {
    const schema = tenantSlug ? this.tenantSchema(tenantSlug) : 'public';
    const result = await this.pool.query(
      `SELECT grid_config FROM ${schema}.forms WHERE slug = $1`,
      [slug],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Formulario no encontrado');
    return result.rows[0].grid_config ?? [];
  }

  async saveGridConfig(slug: string, columns: any[], tenantSlug?: string) {
    const schema = tenantSlug ? this.tenantSchema(tenantSlug) : 'public';
    const result = await this.pool.query(
      `UPDATE ${schema}.forms SET grid_config = $1, updated_at = NOW()
     WHERE slug = $2 RETURNING grid_config`,
      [JSON.stringify(columns), slug],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Formulario no encontrado');
    return result.rows[0].grid_config;
  }
}