import { Module } from '@nestjs/common';
import { AdminModulesService } from './admin-modules.service';
import { AdminModulesController } from './admin-modules.controller';
import { ModulesModule } from '../modules/modules.module';

@Module({
  imports: [ModulesModule],
  controllers: [AdminModulesController],
  providers: [AdminModulesService],
})
export class AdminModulesModule {}
