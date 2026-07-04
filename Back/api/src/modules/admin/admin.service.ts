import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { PG_MASTER_POOL } from '../../database/database.module';
import { FormAccessService } from '../form-access/form-access.service';

@Injectable()
export class AdminService {
    constructor(
        @Inject(PG_MASTER_POOL) private readonly pool: Pool,
        private readonly formAccess: FormAccessService,
    ) { }

    // ── Tenants ──────────────────────────────────────────────────────
    async getTenants() {
        const result = await this.pool.query(
            `SELECT id, slug, name, trade_name, country_code, status,
              max_users, trial_ends_at, contact_email, created_at
       FROM public.tenants
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`,
        );
        return result.rows;
    }

    async createTenant(dto: {
        slug: string; name: string; contactEmail?: string; maxUsers?: number;
        adminEmail: string; adminPassword: string; adminFirstName: string; adminLastName: string;
    }) {
        if (!/^[a-z0-9][a-z0-9-]{2,98}[a-z0-9]$/i.test(dto.slug)) {
            throw new BadRequestException(
                'El slug debe tener al menos 4 caracteres, solo minúsculas/números/guiones, sin empezar o terminar en guion',
            );
        }

        const existing = await this.pool.query(
            `SELECT id FROM public.tenants WHERE slug = $1 AND deleted_at IS NULL`, [dto.slug],
        );
        if ((existing.rowCount ?? 0) > 0) throw new ConflictException(`El slug '${dto.slug}' ya existe`);

        const schema = `tenant_${dto.slug.replace(/-/g, '_')}`;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const tenantResult = await client.query(
                `INSERT INTO public.tenants (slug, name, contact_email, max_users, schema_name)
         VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
                [dto.slug, dto.name, dto.contactEmail ?? null, dto.maxUsers ?? 5],
            );
            const tenantId = tenantResult.rows[0].id;

            await client.query(`SELECT public.create_tenant_schema($1, $2)`, [tenantId, dto.slug]);

            const passwordHash = await bcrypt.hash(dto.adminPassword, 10);
            await client.query(
                `INSERT INTO ${schema}.users (email, password_hash, first_name, last_name)
         VALUES ($1, $2, $3, $4)`,
                [dto.adminEmail, passwordHash, dto.adminFirstName, dto.adminLastName],
            );
            await client.query(
                `INSERT INTO ${schema}.user_roles (user_id, role_id)
         SELECT u.id, r.id FROM ${schema}.users u, ${schema}.roles r
         WHERE u.email = $1 AND r.code = 'ADMIN'`,
                [dto.adminEmail],
            );

            await client.query('COMMIT');
            return this.getTenant(tenantId);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async getTenant(id: string) {
        const result = await this.pool.query(
            `SELECT id, slug, name, trade_name, tax_id, country_code, timezone,
              locale, status, schema_name, contact_email, contact_phone,
              logo_url, max_users, trial_ends_at, created_at
       FROM public.tenants WHERE id = $1 AND deleted_at IS NULL`,
            [id],
        );
        if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Tenant no encontrado');
        return result.rows[0];
    }

    async updateTenant(id: string, dto: {
        status?: string;
        maxUsers?: number;
        trialEndsAt?: string;
    }) {
        const result = await this.pool.query(
            `UPDATE public.tenants SET
        status        = COALESCE($1, status),
        max_users     = COALESCE($2, max_users),
        trial_ends_at = COALESCE($3::TIMESTAMPTZ, trial_ends_at),
        updated_at    = NOW()
       WHERE id = $4 AND deleted_at IS NULL
       RETURNING id, slug, name, status, max_users, trial_ends_at`,
            [dto.status ?? null, dto.maxUsers ?? null, dto.trialEndsAt ?? null, id],
        );
        if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Tenant no encontrado');
        return result.rows[0];
    }

    async getTenantUsers(tenantId: string) {
        const tenantResult = await this.pool.query(
            `SELECT schema_name FROM public.tenants WHERE id = $1 AND deleted_at IS NULL`,
            [tenantId],
        );
        if ((tenantResult.rowCount ?? 0) === 0) throw new NotFoundException('Tenant no encontrado');
        const schema = tenantResult.rows[0].schema_name;

        const result = await this.pool.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active,
              u.last_login_at, u.created_at,
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

    // ── Super Admins ─────────────────────────────────────────────────
    async getSuperAdmins() {
        const result = await this.pool.query(
            `SELECT id, email, first_name, last_name, is_active, last_login_at, created_at
       FROM public.super_admins WHERE deleted_at IS NULL ORDER BY created_at DESC`,
        );
        return result.rows;
    }

    async createSuperAdmin(dto: {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
    }) {
        const existing = await this.pool.query(
            `SELECT id FROM public.super_admins WHERE email = $1 AND deleted_at IS NULL`,
            [dto.email],
        );
        if ((existing.rowCount ?? 0) > 0) throw new ConflictException('El email ya está en uso');

        const passwordHash = await bcrypt.hash(dto.password, 10);
        const result = await this.pool.query(
            `INSERT INTO public.super_admins (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, first_name, last_name, is_active, created_at`,
            [dto.email, passwordHash, dto.firstName, dto.lastName],
        );
        return result.rows[0];
    }

    async deactivateSuperAdmin(id: string) {
        const result = await this.pool.query(
            `UPDATE public.super_admins SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, email, is_active`,
            [id],
        );
        if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Super admin no encontrado');
        return result.rows[0];
    }

    // ── Acceso a formularios del catálogo público ──────────────────────
    async getTenantFormAccess(tenantId: string) {
        return this.formAccess.getTenantFormAccess(tenantId);
    }

    async setTenantFormAccess(tenantId: string, mode: 'all' | 'restricted', allowedSlugs: string[]) {
        return this.formAccess.setTenantFormAccess(tenantId, mode, allowedSlugs);
    }
}