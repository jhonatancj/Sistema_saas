import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTenantDto {
  @ApiPropertyOptional({ example: 'active', enum: ['trial', 'active', 'suspended'] })
  status?: string;

  @ApiPropertyOptional({ example: 10, description: 'Número máximo de usuarios permitidos' })
  maxUsers?: number;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00Z', description: 'Fecha de expiración del período de prueba (ISO 8601)' })
  trialEndsAt?: string;

  @ApiPropertyOptional({ example: 1, description: 'Id de public.tbl_rubro — a qué rubro/vertical pertenece el tenant' })
  rubroId?: number;

  @ApiPropertyOptional({ example: false, description: 'Si true, permite editar/eliminar ventas ya creadas (restituyendo stock). Default: false (inmutables, como una factura real).' })
  ventasEditable?: boolean;
}
