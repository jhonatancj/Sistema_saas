import { ApiProperty } from '@nestjs/swagger';

export class LogoutDto {
  @ApiProperty({ example: 'demo', description: 'Slug del tenant' })
  tenantSlug: string;

  @ApiProperty({ example: 'abc123...', description: 'Refresh token a revocar' })
  refreshToken: string;
}
