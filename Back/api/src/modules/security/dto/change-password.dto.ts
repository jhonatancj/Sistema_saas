import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'ContraseñaActual1!', description: 'Contraseña actual del usuario' })
  currentPassword: string;

  @ApiProperty({ example: 'NuevaContraseña1!', description: 'Nueva contraseña (mínimo 8 caracteres)' })
  newPassword: string;
}
