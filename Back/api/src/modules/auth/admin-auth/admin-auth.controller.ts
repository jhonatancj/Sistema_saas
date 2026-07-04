import { Controller, Post, Body, Ip, Headers } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

class AdminLoginDto {
  email!: string;
  password: string;
}

class AdminRefreshDto {
  refreshToken!: string;
}

class AdminLogoutDto {
  refreshToken!: string;
}

@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  login(@Body() dto: AdminLoginDto, @Ip() ip: string, @Headers('user-agent') userAgent: string) {
    return this.adminAuthService.login(dto.email, dto.password, ip, userAgent);
  }

  @Post('refresh')
  refresh(@Body() dto: AdminRefreshDto) {
    return this.adminAuthService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: AdminLogoutDto) {
    return this.adminAuthService.logout(dto.refreshToken);
  }
}