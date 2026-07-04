import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { PG_MASTER_POOL } from '../../database/database.module';

@Injectable()
export class UsersService {
    constructor(@Inject(PG_MASTER_POOL) private readonly pool: Pool) { }

    async findAll(schema: string) {
        const result = await this.pool.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.last_login_at, u.created_at,
              array_agg(r.code) FILTER (WHERE r.code IS NOT NULL) as roles
       FROM ${schema}.users u
       LEFT JOIN ${schema}.user_roles ur ON ur.user_id = u.id
       LEFT JOIN ${schema}.roles r ON r.id = ur.role_id
       WHERE u.deleted_at IS NULL
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
        );
        return result.rows.map((u) => ({
            ...u,
            roles: Array.isArray(u.roles) ? u.roles : [],
        }));
    }

    async findOne(schema: string, userId: string) {
        const result = await this.pool.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.last_login_at, u.created_at,
              array_agg(r.code) FILTER (WHERE r.code IS NOT NULL) as roles
       FROM ${schema}.users u
       LEFT JOIN ${schema}.user_roles ur ON ur.user_id = u.id
       LEFT JOIN ${schema}.roles r ON r.id = ur.role_id
       WHERE u.id = $1 AND u.deleted_at IS NULL
       GROUP BY u.id`,
            [userId],
        );
        if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Usuario no encontrado');
        const u = result.rows[0];
        return { ...u, roles: Array.isArray(u.roles) ? u.roles : [] };
    }

    async create(schema: string, dto: { email: string; password: string; firstName: string; lastName: string; roles: string[]; }) {
        const existing = await this.pool.query(
            `SELECT id FROM ${schema}.users WHERE email = $1 AND deleted_at IS NULL`,
            [dto.email],
        );
        if ((existing.rowCount ?? 0) > 0) throw new ConflictException('El email ya está en uso');

        const passwordHash = await bcrypt.hash(dto.password, 10);
        const userResult = await this.pool.query(
            `INSERT INTO ${schema}.users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
            [dto.email, passwordHash, dto.firstName, dto.lastName],
        );
        const userId = userResult.rows[0].id;

        if (dto.roles?.length > 0) {
            await this.pool.query(
                `INSERT INTO ${schema}.user_roles (user_id, role_id)
         SELECT $1, id FROM ${schema}.roles WHERE code = ANY($2)`,
                [userId, dto.roles],
            );
        }

        return this.findOne(schema, userId);
    }

    async update(schema: string, userId: string, dto: { firstName?: string; lastName?: string; isActive?: boolean; roles?: string[]; }) {
        await this.findOne(schema, userId);

        if (dto.firstName || dto.lastName || dto.isActive !== undefined) {
            await this.pool.query(
                `UPDATE ${schema}.users SET
          first_name = COALESCE($1, first_name),
          last_name  = COALESCE($2, last_name),
          is_active  = COALESCE($3, is_active),
          updated_at = NOW()
         WHERE id = $4`,
                [dto.firstName ?? null, dto.lastName ?? null, dto.isActive ?? null, userId],
            );
        }

        if (dto.roles !== undefined) {
            await this.pool.query(
                `DELETE FROM ${schema}.user_roles WHERE user_id = $1`,
                [userId],
            );
            if (dto.roles.length > 0) {
                await this.pool.query(
                    `INSERT INTO ${schema}.user_roles (user_id, role_id)
           SELECT $1, id FROM ${schema}.roles WHERE code = ANY($2)`,
                    [userId, dto.roles],
                );
            }
        }

        return this.findOne(schema, userId);
    }

    async remove(schema: string, userId: string) {
        await this.findOne(schema, userId);
        await this.pool.query(
            `UPDATE ${schema}.users SET deleted_at = NOW() WHERE id = $1`,
            [userId],
        );
        return { message: 'Usuario eliminado' };
    }
}