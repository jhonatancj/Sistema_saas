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

  @ApiPropertyOptional({ example: 'inventario', description: 'Solo aplica a módulos públicos: código (usado en la URL del tenant) que recibe el tenant al sincronizar. Si se omite, usa `code` tal cual.' })
  tenantCode?: string;

  @ApiPropertyOptional({ example: 1, description: 'Id de public.tbl_rubro — a qué rubro aplica este módulo. Vacío = universal/core (se ofrece para cualquier tenant).' })
  rubroId?: number;
}
