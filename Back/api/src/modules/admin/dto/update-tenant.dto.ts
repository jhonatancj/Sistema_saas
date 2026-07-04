import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTenantDto {
  @ApiPropertyOptional({ example: 'active', enum: ['trial', 'active', 'suspended'] })
  status?: string;

  @ApiPropertyOptional({ example: 10, description: 'Número máximo de usuarios permitidos' })
  maxUsers?: number;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00Z', description: 'Fecha de expiración del período de prueba (ISO 8601)' })
  trialEndsAt?: string;
}
