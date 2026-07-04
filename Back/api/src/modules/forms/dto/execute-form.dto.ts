import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExecuteFormDto {
  @ApiProperty({
    example: 'INSERT',
    enum: ['INSERT', 'UPDATE', 'DELETE', 'SELECT', 'SELECT_BY_ID'],
    description: 'Acción a ejecutar en el stored procedure del formulario',
  })
  action: string;

  @ApiPropertyOptional({ example: 1, description: 'ID del registro (requerido en UPDATE, DELETE, SELECT_BY_ID)' })
  id?: number;

  @ApiPropertyOptional({
    description: 'Datos del formulario (requerido en INSERT y UPDATE)',
    example: { nombre: 'Producto A', precio: 15000 },
  })
  data?: Record<string, any>;

  @ApiPropertyOptional({
    example: 25,
    description: 'Máximo de registros a devolver (solo aplica a SELECT). Si no se manda, devuelve todos los registros como antes.',
  })
  limit?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Registros a saltar antes de empezar a devolver (solo aplica a SELECT, junto con limit).',
  })
  offset?: number;

  @ApiPropertyOptional({
    description: 'Filtro + orden de columna + búsqueda general para la grid (solo aplica a SELECT). Si viene algo, se ignora el SP y se arma SQL dinámico validado contra las columnas reales de la tabla.',
    example: {
      filters: [{ field: 'nombre', operator: 'contains', value: 'abc' }],
      sorts: [{ field: 'precio', sort: 'desc' }],
      search: 'camisa',
    },
  })
  filter?: {
    filters?: { field: string; operator: string; value?: string | number; valueTo?: number }[];
    sorts?: { field: string; sort: 'asc' | 'desc' }[];
    // Búsqueda general (un input, sin elegir columna) — OR de ILIKE contra
    // todas las columnas de texto de la tabla, AND con `filters` si también vienen.
    search?: string;
  };
}
