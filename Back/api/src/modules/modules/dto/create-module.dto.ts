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

  @ApiPropertyOptional({ example: 'inventario', description: 'Solo aplica a módulos públicos: código (usado en la URL del tenant) que recibe el tenant al sincronizar. Si se omite, usa `code` tal cual.' })
  tenantCode?: string;

  @ApiPropertyOptional({ example: 1, description: 'Id de public.tbl_rubro — a qué rubro aplica este módulo. Vacío = universal/core (se ofrece para cualquier tenant).' })
  rubroId?: number;
}
