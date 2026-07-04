import { ApiProperty } from '@nestjs/swagger';

export class RevokeAllDto {
  @ApiProperty({ example: 'abc123...', description: 'Refresh token de la sesión actual (se mantiene activa, las demás se revocan)' })
  currentToken: string;
}
