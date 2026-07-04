import { Injectable, UnauthorizedException, ForbiddenException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PG_MASTER_POOL } from '../../database/database.module';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_MASTER_POOL) private readonly pool: Pool,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) { }

  // Estado de suscripción del tenant — antes no se validaba en ningún lado
  // (ver CLAUDE.md §17/§18): un tenant suspendido/cancelado o con trial
  // vencido podía seguir logueándose sin ninguna restricción.
  private assertTenantActive(tenant: { status: string; trial_ends_at: Date | string | null }): void {
    if (tenant.status === 'suspended') {
      throw new ForbiddenException('Esta cuenta está suspendida. Contacta a soporte.');
    }
    if (tenant.status === 'cancelled') {
      throw new ForbiddenException('Esta cuenta fue cancelada.');
    }
    if (tenant.status === 'trial' && tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date()) {
      throw new ForbiddenException('El período de prueba ha finalizado. Contacta a soporte para continuar.');
    }
  }

  async login(tenantSlug: string, email: string, password: string, ip?: string, userAgent?: string) {
    // 1. Obtener schema del tenant
    const tenantResult = await this.pool.query(
      `SELECT schema_name, status, trial_ends_at FROM public.tenants WHERE slug = $1 AND deleted_at IS NULL`,
      [tenantSlug],
    );

    if (tenantResult.rowCount === 0) {
      throw new UnauthorizedException('Tenant no encontrado');
    }

    this.assertTenantActive(tenantResult.rows[0]);
    const schema = tenantResult.rows[0].schema_name;

    // 2. Buscar usuario en el schema del tenant
    const userResult = await this.pool.query(
      `SELECT id, email, password_hash, first_name, last_name, is_active, login_attempts, locked_until
       FROM ${schema}.users
       WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );

    if (userResult.rowCount === 0) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const user = userResult.rows[0];

    // 3. Verificar si está bloqueado
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new UnauthorizedException('Cuenta bloqueada temporalmente');
    }

    // 4. Verificar contraseña
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await this.pool.query(
        `UPDATE ${schema}.users SET login_attempts = login_attempts + 1,
         locked_until = CASE WHEN login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
         WHERE id = $1`,
        [user.id],
      );
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 5. Reset intentos fallidos + actualizar last_login_at
    await this.pool.query(
      `UPDATE ${schema}.users SET login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1`,
      [user.id],
    );

    // 6. Obtener roles del usuario
    const rolesResult = await this.pool.query(
      `SELECT r.code FROM ${schema}.roles r
       INNER JOIN ${schema}.user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [user.id],
    );
    const roles = rolesResult.rows.map((r) => r.code);

    // 7. Generar JWT
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: tenantSlug,
      schemaName: schema,
      roles,
    };

    const accessToken = this.jwtService.sign(payload);


    // 8. Generar refresh token
    const rawRefreshToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.pool.query(
      `INSERT INTO ${schema}.refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
   VALUES ($1, $2, $3, $4, $5)`,
      [user.id, tokenHash, expiresAt, ip ?? null, userAgent ?? null],
    );


    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        roles,
      },
    };
  }

  async refresh(tenantSlug: string, rawToken: string) {
    const tenantResult = await this.pool.query(
      `SELECT schema_name, status, trial_ends_at FROM public.tenants WHERE slug = $1 AND deleted_at IS NULL`,
      [tenantSlug],
    );

    if (tenantResult.rowCount === 0) {
      throw new UnauthorizedException('Tenant no encontrado');
    }

    // Revalidar acá también: si el tenant se suspendió o el trial venció
    // *después* de que el usuario ya tenía sesión, el access token corto
    // sigue funcionando hasta que expira — pero el próximo refresh (que el
    // interceptor del frontend dispara automáticamente) corta el acceso acá.
    this.assertTenantActive(tenantResult.rows[0]);
    const schema = tenantResult.rows[0].schema_name;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Buscar token válido
    const tokenResult = await this.pool.query(
      `SELECT id, user_id, expires_at, family FROM ${schema}.refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );

    if (tokenResult.rowCount === 0) {
      throw new UnauthorizedException('Token inválido');
    }

    const tokenRow = tokenResult.rows[0];

    // Verificar expiración
    if (new Date(tokenRow.expires_at) < new Date()) {
      throw new UnauthorizedException('Token expirado');
    }

    // Revocar token actual (rotación)
    await this.pool.query(
      `UPDATE ${schema}.refresh_tokens SET revoked_at = NOW(), revoke_reason = 'rotated'
     WHERE id = $1`,
      [tokenRow.id],
    );

    // Obtener datos del usuario y roles
    const userResult = await this.pool.query(
      `SELECT id, email, first_name, last_name FROM ${schema}.users
     WHERE id = $1 AND deleted_at IS NULL`,
      [tokenRow.user_id],
    );

    if (userResult.rowCount === 0) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const user = userResult.rows[0];

    const rolesResult = await this.pool.query(
      `SELECT r.code FROM ${schema}.roles r
     INNER JOIN ${schema}.user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
      [user.id],
    );
    const roles = rolesResult.rows.map((r) => r.code);

    // Nuevo access token
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: tenantSlug,
      schemaName: schema,
      roles: roles ?? [],
    };
    const accessToken = this.jwtService.sign(payload);

    // Nuevo refresh token (misma family)
    const newRawToken = crypto.randomBytes(64).toString('hex');
    const newTokenHash = crypto.createHash('sha256').update(newRawToken).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.pool.query(
      `INSERT INTO ${schema}.refresh_tokens (user_id, token_hash, family, expires_at)
     VALUES ($1, $2, $3, $4)`,
      [user.id, newTokenHash, tokenRow.family, expiresAt],
    );

    return { accessToken, refreshToken: newRawToken };
  }

  async logout(tenantSlug: string, rawToken: string) {
    const tenantResult = await this.pool.query(
      `SELECT schema_name FROM public.tenants WHERE slug = $1 AND deleted_at IS NULL`,
      [tenantSlug],
    );

    if (tenantResult.rowCount === 0) {
      throw new UnauthorizedException('Tenant no encontrado');
    }

    const schema = tenantResult.rows[0].schema_name;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await this.pool.query(
      `UPDATE ${schema}.refresh_tokens SET revoked_at = NOW(), revoke_reason = 'logout'
     WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );

    return { message: 'Sesión cerrada' };
  }
}