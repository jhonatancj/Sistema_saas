import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_MASTER_POOL } from '../../database/database.module';
import { ModulesService } from '../modules/modules.service';
import { CreateModuleDto } from '../modules/dto/create-module.dto';
import { ModuleRoleItemDto } from '../modules/dto/set-module-roles.dto';

@Injectable()
export class AdminModulesService {
  constructor(
    @Inject(PG_MASTER_POOL) private readonly pool: Pool,
    private readonly modulesService: ModulesService,
  ) {}

  private async resolveTenantSchema(tenantId: string): Promise<string> {
    const result = await this.pool.query(
      `SELECT schema_name FROM public.tenants WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Tenant no encontrado');
    return result.rows[0].schema_name;
  }

  async getTenantModules(tenantId: string) {
    const schema = await this.resolveTenantSchema(tenantId);
    return this.modulesService.getTenantModules(schema);
  }

  async syncPublicModules(tenantId: string, moduleIds?: number[]) {
    const schema = await this.resolveTenantSchema(tenantId);
    return this.modulesService.syncPublicModulesToTenant(schema, moduleIds);
  }

  async createModule(tenantId: string, dto: CreateModuleDto) {
    const schema = await this.resolveTenantSchema(tenantId);
    return this.modulesService.createTenantModule(schema, dto);
  }

  async updateModule(tenantId: string, moduleId: number, dto: {
    name?: string; icon?: string; description?: string; sortOrder?: number; isActive?: boolean;
    parentId?: number | null;
  }) {
    const schema = await this.resolveTenantSchema(tenantId);
    return this.modulesService.updateTenantModule(schema, moduleId, dto);
  }

  async setModuleForms(tenantId: string, moduleId: number, formSlugs: string[]) {
    const schema = await this.resolveTenantSchema(tenantId);
    return this.modulesService.setTenantModuleForms(schema, moduleId, formSlugs);
  }

  async setModuleRoles(tenantId: string, moduleId: number, roles: ModuleRoleItemDto[]) {
    const schema = await this.resolveTenantSchema(tenantId);
    return this.modulesService.setTenantModuleRoles(schema, moduleId, roles);
  }

  async getModuleRoles(tenantId: string, moduleId: number) {
    const schema = await this.resolveTenantSchema(tenantId);
    return this.modulesService.getTenantModuleRoles(schema, moduleId);
  }
}
