import { Controller, Get, Post, Patch, Body, Param, UseGuards, Request, UnauthorizedException, Query, } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { AdminFormsService } from './admin-forms.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreatePublicFormDto } from './dto/create-public-form.dto';
import { UpdateFormDto } from './dto/update-form.dto';
import { CreateTenantFormDto } from './dto/create-tenant-form.dto';
import { UpdateTenantFormDto } from './dto/update-tenant-form.dto';
import { ExecuteFormDto } from '../forms/dto/execute-form.dto';


@ApiTags('Admin — Forms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/forms')
export class AdminFormsController {
  constructor(private readonly service: AdminFormsService) { }

  private guardSuperAdmin(req: any) {
    if (!req.user.isSuperAdmin) throw new UnauthorizedException('Solo super admin');
  }

  // ── Public forms ──────────────────────────────────────────────────

  @ApiOperation({ summary: 'Listar formularios públicos' })
  @Get()
  getPublicForms(@Request() req) {
    this.guardSuperAdmin(req);
    return this.service.getPublicForms();
  }

  @ApiOperation({ summary: 'Obtener formulario público por slug' })
  @ApiParam({ name: 'slug', example: 'producto' })
  @Get(':slug')
  getPublicForm(@Request() req, @Param('slug') slug: string) {
    this.guardSuperAdmin(req);
    return this.service.getPublicForm(slug);
  }

  @ApiOperation({ summary: 'Crear formulario público' })
  @Post()
  createPublicForm(@Request() req, @Body() dto: CreatePublicFormDto) {
    this.guardSuperAdmin(req);
    return this.service.createPublicForm(dto);
  }

  @ApiOperation({ summary: 'Actualizar formulario público' })
  @ApiParam({ name: 'slug', example: 'producto' })
  @Patch(':slug')
  updatePublicForm(@Request() req, @Param('slug') slug: string, @Body() dto: UpdateFormDto) {
    this.guardSuperAdmin(req);
    return this.service.updatePublicForm(slug, dto);
  }

  // Debe registrarse ANTES de Get(':slug') — si no, Nest matchea esa ruta
  // primero y ':slug' captura literalmente "public" (mismo gotcha que
  // 'tenant/:tenantSlug/tables' vs 'tenant/:tenantSlug/:slug').
  @ApiOperation({ summary: 'Listar tablas reales del schema public (para bind de formulario público)' })
  @Get('public/tables')
  getPublicTables(@Request() req) {
    this.guardSuperAdmin(req);
    return this.service.listPublicTables();
  }

  @ApiOperation({ summary: 'Ejecutar acción CRUD sobre los datos de un formulario público (grid/pruebas)' })
  @ApiParam({ name: 'slug', example: 'producto' })
  @Post(':slug/execute')
  execute(@Request() req, @Param('slug') slug: string, @Body() dto: ExecuteFormDto) {
    this.guardSuperAdmin(req);
    return this.service.executePublicForm(
      slug, dto.action, dto.id, dto.data, dto.limit, dto.offset, dto.filter,
    );
  }

  // ── Tenant forms ──────────────────────────────────────────────────

  @ApiOperation({ summary: 'Listar formularios de un tenant' })
  @ApiParam({ name: 'tenantSlug', example: 'demo' })
  @Get('tenant/:tenantSlug')
  getTenantForms(@Request() req, @Param('tenantSlug') tenantSlug: string) {
    this.guardSuperAdmin(req);
    return this.service.getTenantForms(tenantSlug);
  }

  // Debe registrarse ANTES de 'tenant/:tenantSlug/:slug' — si no, Nest
  // matchea esa ruta primero y ':slug' captura literalmente "tables".
  @ApiOperation({ summary: 'Listar tablas reales del schema de un tenant (para bind de formulario)' })
  @ApiParam({ name: 'tenantSlug', example: 'demo' })
  @Get('tenant/:tenantSlug/tables')
  getTenantTables(@Request() req, @Param('tenantSlug') tenantSlug: string) {
    this.guardSuperAdmin(req);
    return this.service.listTenantTables(tenantSlug);
  }

  @ApiOperation({ summary: 'Crear formulario scopeado a un tenant específico (con generación de tabla/SP)' })
  @ApiParam({ name: 'tenantSlug', example: 'demo' })
  @Post('tenant/:tenantSlug')
  createTenantForm(
    @Request() req,
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: CreateTenantFormDto,
  ) {
    this.guardSuperAdmin(req);
    return this.service.createTenantForm(tenantSlug, dto);
  }

  @ApiOperation({ summary: 'Obtener formulario de un tenant' })
  @ApiParam({ name: 'tenantSlug', example: 'demo' })
  @ApiParam({ name: 'slug', example: 'producto' })
  @Get('tenant/:tenantSlug/:slug')
  getTenantForm(
    @Request() req,
    @Param('tenantSlug') tenantSlug: string,
    @Param('slug') slug: string,
  ) {
    this.guardSuperAdmin(req);
    return this.service.getTenantForm(tenantSlug, slug);
  }

  @ApiOperation({ summary: 'Actualizar formulario de un tenant (genera/altera tabla y SP según corresponda)' })
  @ApiParam({ name: 'tenantSlug', example: 'demo' })
  @ApiParam({ name: 'slug', example: 'producto' })
  @Patch('tenant/:tenantSlug/:slug')
  updateTenantForm(
    @Request() req,
    @Param('tenantSlug') tenantSlug: string,
    @Param('slug') slug: string,
    @Body() dto: UpdateTenantFormDto,
  ) {
    this.guardSuperAdmin(req);
    return this.service.updateTenantForm(tenantSlug, slug, dto);
  }

  @ApiOperation({ summary: 'Preview de formulario público' })
  @ApiParam({ name: 'slug', example: 'test' })
  @Get('preview/:slug')
  previewForm(@Request() req, @Param('slug') slug: string) {
    this.guardSuperAdmin(req);
    return this.service.getPublicForm(slug);
  }

  @ApiOperation({ summary: 'Obtener grid config (público o tenant)' })
  @Get(':slug/grid')
  getGridConfig(@Request() req, @Param('slug') slug: string, @Query('tenant') tenant?: string) {
    this.guardSuperAdmin(req);
    return this.service.getGridConfig(slug, tenant);
  }

  @ApiOperation({ summary: 'Guardar grid config (público o tenant)' })
  @Post(':slug/grid')
  saveGridConfig(
    @Request() req,
    @Param('slug') slug: string,
    @Body() body: { columns: any[] },
    @Query('tenant') tenant?: string,
  ) {
    this.guardSuperAdmin(req);
    return this.service.saveGridConfig(slug, body.columns, tenant);
  }
}