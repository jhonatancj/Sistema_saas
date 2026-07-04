import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateModuleDto {
  @ApiPropertyOptional({ example: 'Inventario v2' })
  name?: string;

  @ApiPropertyOptional({ example: 'warehouse' })
  icon?: string;

  @ApiPropertyOptional({ example: 'Módulo actualizado de inventario' })
  description?: string;

  @ApiPropertyOptional({ example: 2 })
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'Inventario', description: 'Solo aplica a módulos públicos: nombre que ve el tenant al recibir el módulo. Si se omite, usa `name` tal cual.' })
  tenantName?: string;
}
