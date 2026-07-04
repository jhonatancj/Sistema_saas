import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { FormAccessModule } from '../form-access/form-access.module';

@Module({
  imports: [FormAccessModule],
  providers: [AdminService],
  controllers: [AdminController]
})
export class AdminModule {}
