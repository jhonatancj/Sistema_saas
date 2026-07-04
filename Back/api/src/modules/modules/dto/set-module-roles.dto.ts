import { ApiProperty } from '@nestjs/swagger';

export class ModuleRoleItemDto {
  @ApiProperty({ example: 'ADMIN' })
  role_code: string;

  @ApiProperty({ default: true })  can_view: boolean;
  @ApiProperty({ default: false }) can_create: boolean;
  @ApiProperty({ default: false }) can_edit: boolean;
  @ApiProperty({ default: false }) can_delete: boolean;
  @ApiProperty({ default: false }) can_export: boolean;
  @ApiProperty({ default: false }) can_import: boolean;
}

export class SetModuleRolesDto {
  @ApiProperty({ type: [ModuleRoleItemDto] })
  roles: ModuleRoleItemDto[];
}