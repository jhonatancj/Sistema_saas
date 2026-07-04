import { Controller, Get, Post, Patch, Body, Param, UseGuards, Request, UnauthorizedException, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { AdminModulesService } from './admin-modules.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateModuleDto } from '../modules/dto/create-module.dto';
import { UpdateModuleDto } from '../modules/dto/update-module.dto';
import { SetModuleFormsDto } from '../modules/dto/set-module-forms.dto';
import { SetModuleRolesDto } from '../modules/dto/set-module-roles.dto';

@ApiTags('Admin — Módulos de tenant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/tenants/:id/modules')
export class AdminModulesController {
  constructor(private readonly service: AdminModulesService) {}

  private checkSuperAdmin(req: any) {
    if (!req.user.isSuperAdmin) throw new UnauthorizedException('Solo super admin');
  }

  @Get()
  @ApiOperation({ summary: 'Listar módulos de un tenant (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 200, description: 'Lista de módulos del tenant.' })
  getModules(@Request() req, @Param('id') id: string) {
    this.checkSuperAdmin(req);
    return this.service.getTenantModules(id);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Sincronizar módulos públicos hacia el tenant, incluyendo copia de forms (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 201, description: 'Módulos y formularios sincronizados.' })
  syncModules(@Request() req, @Param('id') id: string) {
    this.checkSuperAdmin(req);
    return this.service.syncPublicModules(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear módulo personalizado para el tenant (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 201, description: 'Módulo creado.' })
  createModule(@Request() req, @Param('id') id: string, @Body() dto: CreateModuleDto) {
    this.checkSuperAdmin(req);
    return this.service.createModule(id, dto);
  }

  @Patch(':moduleId')
  @ApiOperation({ summary: 'Actualizar un módulo del tenant (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'moduleId', example: 1 })
  @ApiResponse({ status: 200, description: 'Módulo actualizado.' })
  updateModule(
    @Request() req,
    @Param('id') id: string,
    @Param('moduleId', ParseIntPipe) moduleId: number,
    @Body() dto: UpdateModuleDto,
  ) {
    this.checkSuperAdmin(req);
    return this.service.updateModule(id, moduleId, dto);
  }

  @Post(':moduleId/forms')
  @ApiOperation({ summary: 'Asignar formularios a un módulo del tenant (copia forms públicos faltantes) (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'moduleId', example: 1 })
  @ApiResponse({ status: 201, description: 'Formularios asignados.' })
  setModuleForms(
    @Request() req,
    @Param('id') id: string,
    @Param('moduleId', ParseIntPipe) moduleId: number,
    @Body() dto: SetModuleFormsDto,
  ) {
    this.checkSuperAdmin(req);
    return this.service.setModuleForms(id, moduleId, dto.form_slugs);
  }

  @Post(':moduleId/roles')
  @ApiOperation({ summary: 'Asignar permisos por rol a un módulo del tenant (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'moduleId', example: 1 })
  @ApiResponse({ status: 201, description: 'Permisos asignados.' })
  setModuleRoles(
    @Request() req,
    @Param('id') id: string,
    @Param('moduleId', ParseIntPipe) moduleId: number,
    @Body() dto: SetModuleRolesDto,
  ) {
    this.checkSuperAdmin(req);
    return this.service.setModuleRoles(id, moduleId, dto.roles);
  }

  @Get(':moduleId/roles')
  @ApiOperation({ summary: 'Permisos por rol de un módulo del tenant (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'moduleId', example: 1 })
  @ApiResponse({ status: 200, description: 'Permisos del módulo.' })
  getModuleRoles(
    @Request() req,
    @Param('id') id: string,
    @Param('moduleId', ParseIntPipe) moduleId: number,
  ) {
    this.checkSuperAdmin(req);
    return this.service.getModuleRoles(id, moduleId);
  }
}
