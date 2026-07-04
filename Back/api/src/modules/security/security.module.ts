import { Module } from '@nestjs/common';
import { SecurityService } from './security.service';
import { SecurityController } from './security.controller';

@Module({
  providers: [SecurityService],
  controllers: [SecurityController],
})
export class SecurityModule {}