import { ApiProperty } from '@nestjs/swagger';

export class CreateSuperAdminDto {
  @ApiProperty({ example: 'admin@sistema.com' })
  email: string;

  @ApiProperty({ example: 'Segura123!', description: 'Mínimo 8 caracteres' })
  password: string;

  @ApiProperty({ example: 'Juan' })
  firstName: string;

  @ApiProperty({ example: 'Pérez' })
  lastName: string;
}
