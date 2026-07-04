import { ApiProperty } from '@nestjs/swagger';

export class RolePermissionDto {
  @ApiProperty({ example: 'ADMIN', description: 'Código del rol (ADMIN, SALES, WAREHOUSE)' })
  roleCode: string;

  @ApiProperty({ example: true })
  canView: boolean;

  @ApiProperty({ example: true })
  canCreate: boolean;

  @ApiProperty({ example: false })
  canEdit: boolean;

  @ApiProperty({ example: false })
  canDelete: boolean;
}

export class SetRolesDto {
  @ApiProperty({
    type: [RolePermissionDto],
    description: 'Permisos por rol para el módulo (reemplaza los actuales)',
  })
  roles: RolePermissionDto[];
}
