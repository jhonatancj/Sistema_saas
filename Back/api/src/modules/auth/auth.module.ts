import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { AdminAuthService } from './admin-auth/admin-auth.service';
import { AdminAuthController } from './admin-auth/admin-auth.controller';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET')!,
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_EXPIRATION') as any,
        },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, AdminAuthService],
  controllers: [AuthController, AdminAuthController],
})
export class AuthModule {}