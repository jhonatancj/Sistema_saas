import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { FormsModule } from './modules/forms/forms.module';
import { SecurityModule } from './modules/security/security.module';
import { AdminModule } from './modules/admin/admin.module';
import { ModulesModule } from './modules/modules/modules.module';
import { AdminFormsModule } from './modules/admin-forms/admin-forms.module';
import { AdminModulesModule } from './modules/admin-modules/admin-modules.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    FormsModule,
    SecurityModule,
    AdminModule,
    ModulesModule,
    AdminFormsModule,
    AdminModulesModule,
  ],
})
export class AppModule {}
