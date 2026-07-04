import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
  @ApiProperty({ example: 'demo', description: 'Slug del tenant' })
  tenantSlug: string;

  @ApiProperty({ example: 'abc123...', description: 'Refresh token recibido en el login' })
  refreshToken: string;
}
