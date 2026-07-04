import { Controller, Get, Delete, Patch, Param, Body, UseGuards, Request, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { SecurityService } from './security.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RevokeAllDto } from './dto/revoke-all.dto';

@ApiTags('Security')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('security')
export class SecurityController {
    constructor(private readonly securityService: SecurityService) { }

    @Get('sessions')
    @UseGuards(TenantGuard)
    @ApiOperation({ summary: 'Listar sesiones activas del usuario autenticado' })
    @ApiResponse({ status: 200, description: 'Lista de sesiones activas.' })
    getSessions(@Request() req) {
        return this.securityService.getSessions(req.user.schemaName, req.user.sub);
    }

    @Get('admin/sessions')
    @ApiOperation({ summary: 'Listar sesiones del super admin (solo super admin)' })
    @ApiResponse({ status: 200, description: 'Lista de sesiones del super admin.' })
    getAdminSessions(@Request() req) {
        if (!req.user.isSuperAdmin) throw new UnauthorizedException();
        return this.securityService.getAdminSessions(req.user.sub);
    }

    @Delete('sessions/:id')
    @UseGuards(TenantGuard)
    @ApiOperation({ summary: 'Revocar una sesión específica por ID' })
    @ApiParam({ name: 'id', example: '42' })
    @ApiResponse({ status: 200, description: 'Sesión revocada.' })
    revokeSession(@Request() req, @Param('id') id: string) {
        return this.securityService.revokeSession(req.user.schemaName, req.user.sub, id);
    }

    @Delete('sessions')
    @UseGuards(TenantGuard)
    @ApiOperation({ summary: 'Revocar todas las sesiones excepto la actual' })
    @ApiResponse({ status: 200, description: 'Todas las demás sesiones revocadas.' })
    revokeAllSessions(@Request() req, @Body() dto: RevokeAllDto) {
        return this.securityService.revokeAllSessions(req.user.schemaName, req.user.sub, dto.currentToken);
    }

    @Patch('password')
    @UseGuards(TenantGuard)
    @ApiOperation({ summary: 'Cambiar contraseña del usuario autenticado' })
    @ApiResponse({ status: 200, description: 'Contraseña actualizada correctamente.' })
    @ApiResponse({ status: 401, description: 'Contraseña actual incorrecta.' })
    changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
        return this.securityService.changePassword(req.user.schemaName, req.user.sub, dto);
    }

    @Patch('admin/password')
    @ApiOperation({ summary: 'Cambiar contraseña del super admin autenticado' })
    @ApiResponse({ status: 200, description: 'Contraseña actualizada correctamente.' })
    @ApiResponse({ status: 401, description: 'Contraseña actual incorrecta.' })
    changePasswordAdmin(@Request() req, @Body() dto: ChangePasswordDto) {
        if (!req.user.isSuperAdmin) throw new UnauthorizedException();
        return this.securityService.changePasswordAdmin(req.user.sub, dto);
    }
}
