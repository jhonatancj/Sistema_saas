import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, UnauthorizedException, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ModulesService } from './modules.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { SetFormsDto } from './dto/set-forms.dto';
import { SetRolesDto } from './dto/set-roles.dto';
import { SetModuleFormsDto } from './dto/set-module-forms.dto';
import { SetModuleRolesDto } from './dto/set-module-roles.dto';

@ApiTags('Modules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('modules')
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) { }

  private checkSuperAdmin(req: any) {
    if (!req.user.isSuperAdmin) throw new UnauthorizedException('Acceso denegado');
  }

  // ── Públicos (super admin) ────────────────────────────────────────
  @Get('public')
  @ApiOperation({ summary: 'Listar módulos públicos globales (solo super admin)' })
  @ApiResponse({ status: 200, description: 'Lista de módulos públicos.' })
  getPublicModules(@Request() req) {
    this.checkSuperAdmin(req);
    return this.modulesService.getPublicModules();
  }

  @Post('public')
  @ApiOperation({ summary: 'Crear un módulo público global (solo super admin)' })
  @ApiResponse({ status: 201, description: 'Módulo creado.' })
  createPublicModule(@Request() req, @Body() dto: CreateModuleDto) {
    this.checkSuperAdmin(req);
    return this.modulesService.createPublicModule(dto);
  }

  @Patch('public/:id')
  @ApiOperation({ summary: 'Actualizar un módulo público global (solo super admin)' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, description: 'Módulo actualizado.' })
  updatePublicModule(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateModuleDto) {
    this.checkSuperAdmin(req);
    return this.modulesService.updatePublicModule(id, dto);
  }

  @Delete('public/:id')
  @ApiOperation({ summary: 'Eliminar un módulo público del catálogo (solo super admin)' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, description: 'Módulo eliminado.' })
  deletePublicModule(@Request() req, @Param('id', ParseIntPipe) id: number) {
    this.checkSuperAdmin(req);
    return this.modulesService.deletePublicModule(id);
  }

  @Post('public/:id/forms')
  @ApiOperation({ summary: 'Asignar formularios a un módulo público (solo super admin)' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 201, description: 'Formularios asignados al módulo.' })
  setPublicModuleForms(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() dto: SetFormsDto) {
    this.checkSuperAdmin(req);
    return this.modulesService.setPublicModuleForms(id, dto.formSlugs);
  }

  @Post('public/:id/roles')
  @ApiOperation({ summary: 'Asignar permisos por rol a un módulo público (solo super admin)' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 201, description: 'Permisos asignados.' })
  setPublicModuleRoles(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() dto: SetRolesDto) {
    this.checkSuperAdmin(req);
    return this.modulesService.setPublicModuleRoles(id, dto.roles);
  }

  @Get('public/:id/roles')
  @ApiOperation({ summary: 'Permisos por rol de un módulo público (solo super admin)' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, description: 'Permisos del módulo, uno por cada rol estándar (ADMIN/SALES/WAREHOUSE).' })
  getPublicModuleRoles(@Request() req, @Param('id', ParseIntPipe) id: number) {
    this.checkSuperAdmin(req);
    return this.modulesService.getPublicModuleRoles(id);
  }

  @Get('public/menu')
  @ApiOperation({ summary: 'Listar módulos+formularios del catálogo público para el sidebar del super admin' })
  @ApiResponse({ status: 200, description: 'Módulos del catálogo, sin filtro de rol.' })
  getPublicModulesMenu(@Request() req) {
    this.checkSuperAdmin(req);
    return this.modulesService.getPublicModulesForMenu();
  }

  @Post('public/sync/:tenantSlug')
  @ApiOperation({ summary: 'Sincronizar módulos públicos hacia un tenant (solo super admin)' })
  @ApiParam({ name: 'tenantSlug', example: 'demo' })
  @ApiResponse({ status: 201, description: 'Módulos sincronizados al tenant.' })
  syncToTenant(@Request() req, @Param('tenantSlug') tenantSlug: string) {
    this.checkSuperAdmin(req);
    const schema = `tenant_${tenantSlug.replace(/-/g, '_')}`;
    return this.modulesService.syncPublicModulesToTenant(schema);
  }

  // ── Tenant (admin del tenant o super admin) ───────────────────────
  @Get()
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Listar módulos activos del tenant autenticado' })
  @ApiResponse({ status: 200, description: 'Lista de módulos del tenant.' })
  getTenantModules(@Request() req) {
    return this.modulesService.getTenantModules(req.user.schemaName);
  }

  @Get('by-role/:roleCode')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Listar módulos accesibles por un rol del tenant' })
  @ApiParam({ name: 'roleCode', example: 'ADMIN' })
  @ApiResponse({ status: 200, description: 'Módulos visibles para el rol.' })
  getTenantModulesByRole(@Request() req, @Param('roleCode') roleCode: string) {
    return this.modulesService.getTenantModulesByRole(req.user.schemaName, roleCode);
  }

  @Patch(':id')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Actualizar configuración de un módulo del tenant' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, description: 'Módulo del tenant actualizado.' })
  updateTenantModule(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateModuleDto) {
    return this.modulesService.updateTenantModule(req.user.schemaName, id, dto);
  }




  // Crear módulo custom del tenant
  @ApiOperation({ summary: 'Crear módulo personalizado del tenant' })
  @Post()
  @UseGuards(TenantGuard)
  createTenantModule(@Request() req, @Body() dto: CreateModuleDto) {
    return this.modulesService.createTenantModule(req.user.schemaName, dto);
  }

  // Asignar formularios a módulo
  @ApiOperation({ summary: 'Asignar formularios a módulo' })
  @ApiParam({ name: 'id' })
  @Post(':id/forms')
  @UseGuards(TenantGuard)
  setTenantModuleForms(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetModuleFormsDto,
  ) {
    return this.modulesService.setTenantModuleForms(req.user.schemaName, id, dto.form_slugs);
  }

  // Actualizar permisos de módulo
  @ApiOperation({ summary: 'Actualizar permisos de roles para módulo' })
  @ApiParam({ name: 'id' })
  @Post(':id/roles')
  @UseGuards(TenantGuard)
  setTenantModuleRoles(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetModuleRolesDto,
  ) {
    return this.modulesService.setTenantModuleRoles(req.user.schemaName, id, dto.roles);
  }

  @ApiOperation({ summary: 'Permisos de roles para un módulo' })
  @ApiParam({ name: 'id' })
  @Get(':id/roles')
  @UseGuards(TenantGuard)
  getTenantModuleRoles(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.modulesService.getTenantModuleRoles(req.user.schemaName, id);
  }
}
