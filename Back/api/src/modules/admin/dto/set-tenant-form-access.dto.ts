import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetTenantFormAccessDto {
  @ApiProperty({ example: 'restricted', enum: ['all', 'restricted'] })
  mode: 'all' | 'restricted';

  @ApiPropertyOptional({
    example: ['producto', 'categoria'],
    description: 'Slugs del catálogo public.forms permitidos cuando mode = restricted. Ignorado si mode = all.',
    type: [String],
  })
  allowedSlugs?: string[];
}
