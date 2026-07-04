import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFormDto {
  @ApiProperty({ example: 'orden_compra', description: 'Identificador único del formulario (snake_case)' })
  slug: string;

  @ApiProperty({ example: 'Orden de Compra' })
  name: string;

  @ApiPropertyOptional({ example: '1', description: 'ID del formulario padre' })
  parentId?: string;

  @ApiPropertyOptional({ example: 'INSERT', description: 'Acción por defecto del formulario' })
  action?: string;

  @ApiProperty({ description: 'Schema JSON generado por el builder (@jhonatancj/dforms BuilderSchema)', example: { version: 1, root: [] } })
  jsonForm: any;
}
