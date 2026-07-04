import { Module } from '@nestjs/common';
import { AdminFormsService } from './admin-forms.service';
import { AdminFormsController } from './admin-forms.controller';
import { FormsModule } from '../forms/forms.module';

@Module({
  imports: [FormsModule],
  controllers: [AdminFormsController],
  providers: [AdminFormsService],
})
export class AdminFormsModule {}
