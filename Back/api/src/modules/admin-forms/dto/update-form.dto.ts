import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFormDto {
  @ApiPropertyOptional({ example: 'Orden de Compra' })
  name?: string;

  @ApiPropertyOptional({ description: 'JSON generado por el builder' })
  jsonForm?: any;

  @ApiPropertyOptional({ example: 'fa-solid fa-box', description: 'Clase FontAwesome' })
  icon?: string;

  @ApiPropertyOptional({ description: 'Nombre de tabla existente a la que enlazar (bind). Si se omite, mantiene la actual o genera tbl_{slug}.' })
  tableName?: string;

  @ApiPropertyOptional({ description: 'Nombre custom del SP. Si se omite, mantiene el actual o usa sp_{slug}.' })
  spName?: string;

  @ApiPropertyOptional({ description: 'Si es false, no se (re)genera el SP — para SPs escritos a mano. Default true.' })
  recreateSp?: boolean;

  @ApiPropertyOptional({ description: 'SQL SELECT custom como fuente de datos de la grid.' })
  gridQuery?: string;

  @ApiPropertyOptional({ example: 'modal', enum: ['modal', 'inline'], description: 'Cómo se muestra el registro al crear/editar. Default modal.' })
  displayMode?: 'modal' | 'inline';

  @ApiPropertyOptional({ example: 620, description: 'Ancho del modal en px (solo aplica si displayMode=modal). Si se omite, usa el ancho por default del componente.' })
  modalWidth?: number;
}
