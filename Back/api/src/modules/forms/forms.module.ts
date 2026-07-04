import { Module } from '@nestjs/common';
import { FormGeneratorService } from './form-generator.service';
import { FormsController } from './forms.controller';
import { FormExecutorService } from './form-executor.service';
import { FormAccessModule } from '../form-access/form-access.module';

@Module({
  imports: [FormAccessModule],
  controllers: [FormsController],
  providers: [FormGeneratorService, FormExecutorService],
  exports: [FormGeneratorService, FormExecutorService],
})
export class FormsModule {}
