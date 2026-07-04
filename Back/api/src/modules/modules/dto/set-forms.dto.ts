import { ApiProperty } from '@nestjs/swagger';

export class SetFormsDto {
  @ApiProperty({
    example: ['orden_compra', 'recepcion_mercancia'],
    description: 'Lista de slugs de formularios asignados al módulo (reemplaza la lista actual)',
    type: [String],
  })
  formSlugs: string[];
}
