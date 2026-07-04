import { ApiProperty } from '@nestjs/swagger';

export class SetModuleFormsDto {
  @ApiProperty({ example: ['producto', 'categoria'] })
  form_slugs: string[];
}