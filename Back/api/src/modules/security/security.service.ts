import { Injectable, Inject, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PG_MASTER_POOL } from '../../database/database.module';

@Injectable()
export class SecurityService {
    constructor(@Inject(PG_MASTER_POOL) private readonly pool: Pool) { }

    async revokeSession(schema: string, userId: string, tokenId: string) {
        const result = await this.pool.query(
            `UPDATE ${schema}.refresh_tokens
       SET revoked_at = NOW(), revoke_reason = 'manual'
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
            [tokenId, userId],
        );
        if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Sesión no encontrada');
        return { message: 'Sesión revocada' };
    }

    async revokeAllSessions(schema: string, userId: string, currentToken: string) {
        const tokenHash = crypto.createHash('sha256').update(currentToken).digest('hex');
        await this.pool.query(
            `UPDATE ${schema}.refresh_tokens
       SET revoked_at = NOW(), revoke_reason = 'logout_all'
       WHERE user_id = $1 AND revoked_at IS NULL AND token_hash != $2`,
            [userId, tokenHash],
        );
        return { message: 'Todas las sesiones cerradas' };
    }

    async changePassword(schema: string, userId: string, dto: {
        currentPassword: string;
        newPassword: string;
    }) {
        const result = await this.pool.query(
            `SELECT password_hash FROM ${schema}.users WHERE id = $1 AND deleted_at IS NULL`,
            [userId],
        );
        if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Usuario no encontrado');

        const valid = await bcrypt.compare(dto.currentPassword, result.rows[0].password_hash);
        if (!valid) throw new UnauthorizedException('Contraseña actual incorrecta');

        const newHash = await bcrypt.hash(dto.newPassword, 10);
        await this.pool.query(
            `UPDATE ${schema}.users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
            [newHash, userId],
        );

        return { message: 'Contraseña actualizada' };
    }

    async changePasswordAdmin(adminId: string, dto: {
        currentPassword: string;
        newPassword: string;
    }) {
        const result = await this.pool.query(
            `SELECT password_hash FROM public.super_admins WHERE id = $1 AND is_active = TRUE`,
            [adminId],
        );
        if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Super admin no encontrado');

        const valid = await bcrypt.compare(dto.currentPassword, result.rows[0].password_hash);
        if (!valid) throw new UnauthorizedException('Contraseña actual incorrecta');

        const newHash = await bcrypt.hash(dto.newPassword, 10);
        await this.pool.query(
            `UPDATE public.super_admins SET password_hash = $1 WHERE id = $2`,
            [newHash, adminId],
        );

        return { message: 'Contraseña actualizada' };
    }

    private async cleanExpiredSessions(schema: string, userId: string) {
        await this.pool.query(
            `UPDATE ${schema}.refresh_tokens
     SET revoked_at = NOW(), revoke_reason = 'expired'
     WHERE user_id = $1 AND expires_at < NOW() AND revoked_at IS NULL`,
            [userId],
        );
    }

    async getSessions(schema: string, userId: string) {
        await this.cleanExpiredSessions(schema, userId);
        const result = await this.pool.query(
            `SELECT id, ip_address, user_agent, created_at, expires_at
     FROM ${schema}.refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
            [userId],
        );
        return result.rows;
    }

    async getAdminSessions(adminId: string) {
        await this.pool.query(
            `UPDATE public.super_admin_refresh_tokens
     SET revoked_at = NOW(), revoke_reason = 'expired'
     WHERE admin_id = $1 AND expires_at < NOW() AND revoked_at IS NULL`,
            [adminId],
        );

        const result = await this.pool.query(
            `SELECT id, ip_address, user_agent, created_at, expires_at
     FROM public.super_admin_refresh_tokens
     WHERE admin_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
            [adminId],
        );
        return result.rows;
    }
}