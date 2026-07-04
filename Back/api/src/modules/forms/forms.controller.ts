import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { FormGeneratorService } from './form-generator.service';
import { FormExecutorService } from './form-executor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CreateFormDto } from './dto/create-form.dto';
import { ExecuteFormDto } from './dto/execute-form.dto';

@ApiTags('Forms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('forms')
export class FormsController {
  constructor(
    private readonly formGenerator: FormGeneratorService,
    private readonly formExecutor: FormExecutorService,
  ) { }

  @Post()
  @ApiOperation({ summary: 'Crear o actualizar un formulario (genera tabla y SP automáticamente)' })
  @ApiResponse({ status: 201, description: 'Formulario creado/actualizado correctamente.' })
  create(@Request() req, @Body() dto: CreateFormDto) {
    return this.formGenerator.processForm(req.user.schemaName, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos los formularios del tenant' })
  @ApiResponse({ status: 200, description: 'Lista de formularios (id, slug, name, has_table, has_sp, created_at).' })
  getForms(@Request() req) {
    return this.formExecutor.getForms(req.user.schemaName);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Obtener un formulario por slug (incluye json_form)' })
  @ApiParam({ name: 'slug', example: 'orden_compra' })
  @ApiResponse({ status: 200, description: 'Datos completos del formulario.' })
  @ApiResponse({ status: 404, description: 'Formulario no encontrado.' })
  getForm(@Request() req, @Param('slug') slug: string) {
    return this.formExecutor.getForm(req.user.schemaName, slug);
  }

  @Post(':slug/execute')
  @ApiOperation({ summary: 'Ejecutar acción sobre los datos de un formulario (CRUD vía SP)' })
  @ApiParam({ name: 'slug', example: 'orden_compra' })
  @ApiResponse({ status: 201, description: 'Acción ejecutada correctamente.' })
  @ApiResponse({ status: 404, description: 'Formulario no encontrado.' })
  execute(@Request() req, @Param('slug') slug: string, @Body() dto: ExecuteFormDto) {
    return this.formExecutor.execute(
      req.user.schemaName, slug, dto.action, dto.id, dto.data,
      dto.limit, dto.offset, dto.filter,
    );
  }


  @ApiOperation({ summary: 'Obtener configuración de grid' })
  @ApiParam({ name: 'slug' })
  @Get(':slug/grid')
  getGridConfig(@Request() req, @Param('slug') slug: string) {
    return this.formExecutor.getGridConfig(req.user.schemaName, slug);
  }

  @ApiOperation({ summary: 'Guardar configuración de grid' })
  @ApiParam({ name: 'slug' })
  @Post(':slug/grid')
  saveGridConfig(@Request() req, @Param('slug') slug: string, @Body() body: { columns: any[] }) {
    return this.formExecutor.saveGridConfig(req.user.schemaName, slug, body.columns);
  }
}
