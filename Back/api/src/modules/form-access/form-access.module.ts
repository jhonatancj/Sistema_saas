import { Module } from '@nestjs/common';
import { FormAccessService } from './form-access.service';

@Module({
  providers: [FormAccessService],
  exports: [FormAccessService],
})
export class FormAccessModule {}
