import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'demo', description: 'Slug del tenant' })
  tenantSlug: string;

  @ApiProperty({ example: 'admin@demo.com' })
  email: string;

  @ApiProperty({ example: 'Admin1234!', description: 'Contraseña del usuario' })
  password: string;
}
