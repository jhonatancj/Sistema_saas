import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty({ example: 'acme-corp', description: 'URL-safe, se usa como subdominio' })
  slug: string;

  @ApiProperty({ example: 'Acme Corp' })
  name: string;

  @ApiPropertyOptional({ example: 'contacto@acme.com' })
  contactEmail?: string;

  @ApiPropertyOptional({ example: 5, description: 'Default 5' })
  maxUsers?: number;

  @ApiPropertyOptional({ example: 1, description: 'Id de public.tbl_rubro — a qué rubro/vertical pertenece el tenant' })
  rubroId?: number;

  @ApiProperty({ example: 'admin@acme.com', description: 'Usuario administrador inicial del tenant' })
  adminEmail: string;

  @ApiProperty({ example: 'Segura123!', description: 'Mínimo 8 caracteres' })
  adminPassword: string;

  @ApiProperty({ example: 'Juan' })
  adminFirstName: string;

  @ApiProperty({ example: 'Pérez' })
  adminLastName: string;
}
