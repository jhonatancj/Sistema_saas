import { ApiPropertyOptional } from '@nestjs/swagger';

export class SyncModulesDto {
  @ApiPropertyOptional({
    example: [1, 2],
    description: 'IDs de public.modules a sincronizar. Si se omite, sincroniza todo el catálogo activo (comportamiento histórico).',
  })
  moduleIds?: number[];
}
