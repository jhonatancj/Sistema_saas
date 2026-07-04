import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PG_MASTER_POOL } from '../../../database/database.module';

@Injectable()
export class AdminAuthService {
    constructor(
        @Inject(PG_MASTER_POOL) private readonly pool: Pool,
        private readonly jwtService: JwtService,
    ) { }

    async login(email: string, password: string, ip?: string, userAgent?: string) {
        const result = await this.pool.query(
            `SELECT id, email, password_hash, first_name, last_name, is_active, login_attempts, locked_until
       FROM public.super_admins
       WHERE email = $1 AND deleted_at IS NULL`,
            [email],
        );

        if ((result.rowCount ?? 0) === 0) {
            throw new UnauthorizedException('Credenciales inválidas');
        }

        const sa = result.rows[0];

        if (!sa.is_active) throw new UnauthorizedException('Cuenta desactivada');

        if (sa.locked_until && new Date(sa.locked_until) > new Date()) {
            throw new UnauthorizedException('Cuenta bloqueada temporalmente');
        }

        const valid = await bcrypt.compare(password, sa.password_hash);
        if (!valid) {
            await this.pool.query(
                `UPDATE public.super_admins SET login_attempts = login_attempts + 1,
         locked_until = CASE WHEN login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
         WHERE id = $1`,
                [sa.id],
            );
            throw new UnauthorizedException('Credenciales inválidas');
        }

        await this.pool.query(
            `UPDATE public.super_admins SET login_attempts = 0, locked_until = NULL, last_login_at = NOW()
       WHERE id = $1`,
            [sa.id],
        );

        const payload = {
            sub: sa.id,
            email: sa.email,
            isSuperAdmin: true,
            roles: ['SUPER_ADMIN'],
        };

        const accessToken = this.jwtService.sign(payload);
        const rawRefreshToken = crypto.randomBytes(64).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await this.pool.query(
            `INSERT INTO public.super_admin_refresh_tokens (admin_id, token_hash, expires_at, ip_address, user_agent)
   VALUES ($1, $2, $3, $4, $5)`,
            [sa.id, tokenHash, expiresAt, ip ?? null, userAgent ?? null],
        );

        return {
            accessToken,
            refreshToken: rawRefreshToken,
            isSuperAdmin: true,
            user: {
                id: sa.id,
                email: sa.email,
                firstName: sa.first_name,
                lastName: sa.last_name,
                isSuperAdmin: true,
            },
        };
    }

    async refresh(rawToken: string) {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        const tokenResult = await this.pool.query(
            `SELECT id, admin_id, expires_at, family FROM public.super_admin_refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL`,
            [tokenHash],
        );

        if ((tokenResult.rowCount ?? 0) === 0) {
            throw new UnauthorizedException('Token inválido');
        }

        const tokenRow = tokenResult.rows[0];

        if (new Date(tokenRow.expires_at) < new Date()) {
            throw new UnauthorizedException('Token expirado');
        }

        await this.pool.query(
            `UPDATE public.super_admin_refresh_tokens SET revoked_at = NOW(), revoke_reason = 'rotated'
       WHERE id = $1`,
            [tokenRow.id],
        );

        const userResult = await this.pool.query(
            `SELECT id, email, first_name, last_name, is_active FROM public.super_admins
       WHERE id = $1 AND deleted_at IS NULL`,
            [tokenRow.admin_id],
        );

        if ((userResult.rowCount ?? 0) === 0 || !userResult.rows[0].is_active) {
            throw new UnauthorizedException('Super admin no encontrado');
        }

        const sa = userResult.rows[0];

        const payload = {
            sub: sa.id,
            email: sa.email,
            isSuperAdmin: true,
            roles: ['SUPER_ADMIN'],
        };
        const accessToken = this.jwtService.sign(payload);

        const newRawToken = crypto.randomBytes(64).toString('hex');
        const newTokenHash = crypto.createHash('sha256').update(newRawToken).digest('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await this.pool.query(
            `INSERT INTO public.super_admin_refresh_tokens (admin_id, token_hash, family, expires_at)
       VALUES ($1, $2, $3, $4)`,
            [sa.id, newTokenHash, tokenRow.family, expiresAt],
        );

        return {
            accessToken,
            refreshToken: newRawToken,
            isSuperAdmin: true,
            user: {
                id: sa.id,
                email: sa.email,
                firstName: sa.first_name,
                lastName: sa.last_name,
                isSuperAdmin: true,
            },
        };
    }

    async logout(rawToken: string) {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        await this.pool.query(
            `UPDATE public.super_admin_refresh_tokens SET revoked_at = NOW(), revoke_reason = 'logout'
       WHERE token_hash = $1 AND revoked_at IS NULL`,
            [tokenHash],
        );

        return { message: 'Sesión cerrada' };
    }
}