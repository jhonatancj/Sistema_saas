import { Injectable, Inject, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PG_MASTER_POOL } from '../../database/database.module';

@Injectable()
export class TenantsService {
    constructor(@Inject(PG_MASTER_POOL) private readonly pool: Pool) { }

    async register(dto: { name: string; slug: string; contactEmail: string; countryCode: string; adminPassword: string; }) {
        // 1. Verificar que el slug no exista
        const existing = await this.pool.query(
            `SELECT id FROM public.tenants WHERE slug = $1`,
            [dto.slug],
        );

        if ((existing.rowCount ?? 0) > 0) {
            throw new ConflictException(`El slug '${dto.slug}' ya está en uso`);
        }

        // 2. Insertar tenant
        const tenantResult = await this.pool.query(
            `INSERT INTO public.tenants (slug, name, country_code, contact_email, status, schema_name)
       VALUES ($1, $2, $3, $4, 'trial', 'pending')
       RETURNING id`,
            [dto.slug, dto.name, dto.countryCode, dto.contactEmail],
        );

        const tenantId = tenantResult.rows[0].id;

        // 3. Crear schema del tenant
        await this.pool.query(
            `SELECT public.create_tenant_schema($1, $2)`,
            [tenantId, dto.slug],
        );

        // 4. Obtener schema_name actualizado
        const schemaResult = await this.pool.query(
            `SELECT schema_name FROM public.tenants WHERE id = $1`,
            [tenantId],
        );
        const schema = schemaResult.rows[0].schema_name;

        // 5. Crear usuario admin
        const passwordHash = await bcrypt.hash(dto.adminPassword, 10);
        const userResult = await this.pool.query(
            `INSERT INTO ${schema}.users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, 'Admin', $3)
       RETURNING id`,
            [dto.contactEmail, passwordHash, dto.name],
        );

        const userId = userResult.rows[0].id;

        // 6. Asignar rol ADMIN
        await this.pool.query(
            `INSERT INTO ${schema}.user_roles (user_id, role_id)
       SELECT $1, id FROM ${schema}.roles WHERE code = 'ADMIN'`,
            [userId],
        );

        return {
            tenantId,
            slug: dto.slug,
            name: dto.name,
            adminEmail: dto.contactEmail,
            message: 'Tenant registrado correctamente',
        };
    }

    async updateSettings(tenantSlug: string, dto: {
        name?: string;
        tradeName?: string;
        taxId?: string;
        countryCode?: string;
        timezone?: string;
        locale?: string;
        contactEmail?: string;
        contactPhone?: string;
        logoUrl?: string;
    }) {
        const result = await this.pool.query(
            `UPDATE public.tenants SET
      name          = COALESCE($1, name),
      trade_name    = COALESCE($2, trade_name),
      tax_id        = COALESCE($3, tax_id),
      country_code  = COALESCE($4, country_code),
      timezone      = COALESCE($5, timezone),
      locale        = COALESCE($6, locale),
      contact_email = COALESCE($7, contact_email),
      contact_phone = COALESCE($8, contact_phone),
      logo_url      = COALESCE($9, logo_url),
      updated_at    = NOW()
    WHERE slug = $10 AND deleted_at IS NULL
    RETURNING id, slug, name, trade_name, tax_id, country_code,
              timezone, locale, contact_email, contact_phone, logo_url`,
            [
                dto.name ?? null,
                dto.tradeName ?? null,
                dto.taxId ?? null,
                dto.countryCode ?? null,
                dto.timezone ?? null,
                dto.locale ?? null,
                dto.contactEmail ?? null,
                dto.contactPhone ?? null,
                dto.logoUrl ?? null,
                tenantSlug,
            ],
        );

        if ((result.rowCount ?? 0) === 0) {
            throw new NotFoundException('Tenant no encontrado');
        }

        return result.rows[0];
    }

    async getSettings(tenantSlug: string) {
        const result = await this.pool.query(
            `SELECT id, slug, name, trade_name, tax_id, country_code,
            timezone, locale, contact_email, contact_phone, logo_url,
            status, max_users, trial_ends_at, created_at
     FROM public.tenants
     WHERE slug = $1 AND deleted_at IS NULL`,
            [tenantSlug],
        );

        if ((result.rowCount ?? 0) === 0) {
            throw new NotFoundException('Tenant no encontrado');
        }

        return result.rows[0];
    }
}