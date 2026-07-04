import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Bloquea el acceso a rutas tenant-only cuando el JWT es de un super admin
 * (sin schemaName). Debe usarse siempre después de JwtAuthGuard.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user || user.isSuperAdmin || !user.schemaName) {
      throw new UnauthorizedException('Esta ruta requiere una sesión de tenant');
    }

    return true;
  }
}
