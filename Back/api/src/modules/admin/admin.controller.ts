import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateSuperAdminDto } from './dto/create-super-admin.dto';
import { SetTenantFormAccessDto } from './dto/set-tenant-form-access.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private checkSuperAdmin(req: any) {
    if (!req.user.isSuperAdmin) throw new UnauthorizedException('Acceso denegado');
  }

  @Get('tenants')
  @ApiOperation({ summary: 'Listar todos los tenants (solo super admin)' })
  @ApiResponse({ status: 200, description: 'Lista de tenants.' })
  getTenants(@Request() req) {
    this.checkSuperAdmin(req);
    return this.adminService.getTenants();
  }

  @Post('tenants')
  @ApiOperation({ summary: 'Crear un nuevo tenant con su usuario administrador inicial (solo super admin)' })
  @ApiResponse({ status: 201, description: 'Tenant creado correctamente.' })
  createTenant(@Request() req, @Body() dto: CreateTenantDto) {
    this.checkSuperAdmin(req);
    return this.adminService.createTenant(dto);
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Obtener un tenant por ID (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 200, description: 'Datos del tenant.' })
  getTenant(@Request() req, @Param('id') id: string) {
    this.checkSuperAdmin(req);
    return this.adminService.getTenant(id);
  }

  @Patch('tenants/:id')
  @ApiOperation({ summary: 'Actualizar estado o límites de un tenant (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 200, description: 'Tenant actualizado.' })
  updateTenant(@Request() req, @Param('id') id: string, @Body() dto: UpdateTenantDto) {
    this.checkSuperAdmin(req);
    return this.adminService.updateTenant(id, dto);
  }

  @Get('tenants/:id/users')
  @ApiOperation({ summary: 'Listar usuarios de un tenant (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 200, description: 'Lista de usuarios del tenant.' })
  getTenantUsers(@Request() req, @Param('id') id: string) {
    this.checkSuperAdmin(req);
    return this.adminService.getTenantUsers(id);
  }

  @Get('tenants/:id/form-access')
  @ApiOperation({ summary: 'Configuración de acceso a formularios del catálogo público de un tenant (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 200, description: 'Modo de acceso y slugs permitidos.' })
  getTenantFormAccess(@Request() req, @Param('id') id: string) {
    this.checkSuperAdmin(req);
    return this.adminService.getTenantFormAccess(id);
  }

  @Patch('tenants/:id/form-access')
  @ApiOperation({ summary: 'Configurar modo de acceso y allow-list de formularios del catálogo público para un tenant (solo super admin)' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 200, description: 'Configuración actualizada.' })
  setTenantFormAccess(@Request() req, @Param('id') id: string, @Body() dto: SetTenantFormAccessDto) {
    this.checkSuperAdmin(req);
    return this.adminService.setTenantFormAccess(id, dto.mode, dto.allowedSlugs ?? []);
  }

  @Get('super-admins')
  @ApiOperation({ summary: 'Listar todos los super admins (solo super admin)' })
  @ApiResponse({ status: 200, description: 'Lista de super admins.' })
  getSuperAdmins(@Request() req) {
    this.checkSuperAdmin(req);
    return this.adminService.getSuperAdmins();
  }

  @Post('super-admins')
  @ApiOperation({ summary: 'Crear un nuevo super admin (solo super admin)' })
  @ApiResponse({ status: 201, description: 'Super admin creado correctamente.' })
  createSuperAdmin(@Request() req, @Body() dto: CreateSuperAdminDto) {
    this.checkSuperAdmin(req);
    return this.adminService.createSuperAdmin(dto);
  }

  @Delete('super-admins/:id')
  @ApiOperation({ summary: 'Desactivar un super admin (solo super admin)' })
  @ApiParam({ name: 'id', example: '2' })
  @ApiResponse({ status: 200, description: 'Super admin desactivado.' })
  deactivateSuperAdmin(@Request() req, @Param('id') id: string) {
    this.checkSuperAdmin(req);
    return this.adminService.deactivateSuperAdmin(id);
  }
}
