import { Controller, Post, Get, Body, UseGuards, Request, Ip, Headers } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Iniciar sesión y obtener tokens JWT' })
  @ApiResponse({ status: 201, description: 'Login exitoso. Retorna accessToken y refreshToken.' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas o tenant inexistente.' })
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent: string) {
    return this.authService.login(dto.tenantSlug, dto.email, dto.password, ip, userAgent);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Renovar accessToken usando el refreshToken' })
  @ApiResponse({ status: 201, description: 'Token renovado exitosamente.' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido o expirado.' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.tenantSlug, dto.refreshToken);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Cerrar sesión revocando el refreshToken' })
  @ApiResponse({ status: 201, description: 'Sesión cerrada correctamente.' })
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.tenantSlug, dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Obtener datos del usuario autenticado' })
  @ApiResponse({ status: 200, description: 'Payload JWT del usuario actual.' })
  @ApiResponse({ status: 401, description: 'Token inválido o expirado.' })
  me(@Request() req) {
    return req.user;
  }
}
