import { Module } from '@nestjs/common';
import { ModulesService } from './modules.service';
import { ModulesController } from './modules.controller';
import { FormAccessModule } from '../form-access/form-access.module';
import { FormsModule } from '../forms/forms.module';

@Module({
  imports: [FormAccessModule, FormsModule],
  controllers: [ModulesController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class ModulesModule {}
