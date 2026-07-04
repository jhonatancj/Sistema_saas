import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateModuleDto {
  @ApiProperty({ example: 'Inventario' })
  name: string;

  @ApiProperty({ example: 'INVENTORY', description: 'Código único en mayúsculas' })
  code: string;

  @ApiPropertyOptional({ example: 'box', description: 'Nombre del ícono del sidebar' })
  icon?: string;

  @ApiPropertyOptional({ example: 'Gestión de inventario y productos' })
  description?: string;

  @ApiPropertyOptional({ example: 1, description: 'Orden en el sidebar (menor = primero)' })
  sort_order?: number;

  @ApiPropertyOptional({ example: 'Inventario', description: 'Solo aplica a módulos públicos: nombre que ve el tenant al recibir el módulo. Si se omite, usa `name` tal cual.' })
  tenantName?: string;
}
