import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_MASTER_POOL } from '../../database/database.module';

interface ExtractedField {
  key: string;
  type: string;
  required: boolean;
  maxLength?: number;
  isUnique?: boolean;
  relation?: {
    form: string;
    keyValue: string;
    keyLabel: string;
  };
}

// Columna de una tabla de detalle (nodo 'line-items' de @jhonatancj/dforms
// >=1.3.3 — ver docs/adr/017-tabla-detalle-line-items.md). Tipado laxo a
// propósito: viene tal cual del JSON del builder, mismo criterio que
// ExtractedField.relation.
interface LineItemColumn {
  key: string;
  type: string; // 'text' | 'number' | 'select' | 'currency' | 'calculated'
  relation?: { form: string; keyValue: string } | null;
}

@Injectable()
export class FormGeneratorService {
  constructor(@Inject(PG_MASTER_POOL) private readonly pool: Pool) { }

  // ── 1. Extrae campos de datos ignorando nodos de layout ──────────
  extractFields(nodes: any[]): ExtractedField[] {
    const fields: ExtractedField[] = [];
    for (const node of nodes) {
      if (['column'].includes(node.type)) {
        if (node.children?.length) {
          fields.push(...this.extractFields(node.children));
        }
        continue;
      }
      if (node.children?.length) {
        fields.push(...this.extractFields(node.children));
      }
      // input-lupa con persistDisplay:false es solo UI (busca y autocompleta
      // otros campos vía assignments) — no genera columna propia, evita
      // duplicar el nombre cuando ya se persiste el id real en un campo
      // hermano con `relation` (ver docs/adr/019, sección "sin denormalizar").
      if (node.type === 'input-lupa' && node.persistDisplay === false) continue;
      if (['text', 'number', 'select', 'textarea', 'checkbox', 'image', 'currency', 'date', 'input-lupa'].includes(node.type)) {
        fields.push({
          key: node.key,
          type: node.type,
          required: node.required ?? false,
          maxLength: node.validators?.find((v: any) => v.type === 'maxLength')?.value,
          isUnique: node.unique ?? false,
          relation: node.relation ?? null,
        });
      }
    }
    return fields;
  }

  // ── 2. Mapea tipo de campo a tipo SQL ────────────────────────────
  private toDbType(field: ExtractedField): string {
    if (field.relation) return 'BIGINT';
    switch (field.type) {
      case 'text': return `VARCHAR(${field.maxLength ?? 255})`;
      case 'textarea': return 'TEXT';
      case 'number': return 'NUMERIC(12,2)';
      case 'currency': return 'NUMERIC(12,2)';
      case 'date': return 'DATE';
      case 'select': return 'VARCHAR(100)';
      case 'checkbox': return 'BOOLEAN';
      case 'image': return 'TEXT';
      case 'input-lupa': return 'VARCHAR(255)';
      default: return 'TEXT';
    }
  }

  // ── 3. Genera DDL de la tabla ────────────────────────────────────
buildTableDDL(schema: string, slug: string, fields: ExtractedField[]): string {
  const tableName = `${schema}.tbl_${slug}`;
  const columns = fields.map((f) => {
    const dbType = this.toDbType(f);
    const nullable = f.required ? 'NOT NULL' : 'NULL';
    const defaults = f.type === 'checkbox' ? 'DEFAULT FALSE' : '';
    return `  ${f.key.padEnd(20)} ${dbType.padEnd(16)} ${nullable} ${defaults}`.trimEnd();
  });

  const columnSection = columns.length > 0 ? `\n${columns.join(',\n')},` : '';

  const uniqueConstraints = fields.filter(f => f.isUnique)
    .map(f => `  CONSTRAINT uq_tbl_${slug}_${f.key} UNIQUE (${f.key})`);
  const fkConstraints = fields.filter(f => f.relation)
    .map(f => `  CONSTRAINT fk_tbl_${slug}_${f.key} FOREIGN KEY (${f.key}) REFERENCES ${schema}.tbl_${f.relation!.form}(${f.relation!.keyValue})`);
  const extraConstraints = [...uniqueConstraints, ...fkConstraints];

  return `
CREATE TABLE IF NOT EXISTS ${tableName} (
  id          BIGINT       NOT NULL GENERATED ALWAYS AS IDENTITY,${columnSection}
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  CONSTRAINT pk_tbl_${slug} PRIMARY KEY (id)${extraConstraints.length > 0 ? ',\n' + extraConstraints.join(',\n') : ''}
);`.trim();
}

  // ── 3b. Genera DDL para agregar a una tabla existente las columnas
  //        que el formulario tenga y la tabla no — nunca borra ni altera
  //        columnas existentes. Siempre NULL: las filas ya guardadas no
  //        tienen valor para el campo nuevo y no hay backfill. Si el campo
  //        nuevo tiene `relation`, agrega también la FK real (idempotente
  //        contra pg_constraint/pg_namespace — mismo criterio que
  //        buildDetailAlterTableDDL, ver docs/adr/017 y docs/adr/018).
  //        Antes de este fix, agregar `relation` a un campo en una tabla ya
  //        existente dejaba la columna sin FK — gap real, cerrado acá.
  buildAlterTableDDL(schema: string, slug: string, fields: ExtractedField[]): string {
    const tableName = `${schema}.tbl_${slug}`;
    const statements: string[] = [];
    for (const f of fields) {
      const dbType = this.toDbType(f);
      const defaults = f.type === 'checkbox' ? ' DEFAULT FALSE' : '';
      statements.push(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${f.key} ${dbType}${defaults};`);
      if (f.relation) {
        const constraintName = `fk_tbl_${slug}_${f.key}`;
        statements.push(`
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_namespace ns ON ns.oid = con.connamespace
    WHERE con.conname = '${constraintName}' AND ns.nspname = '${schema}'
  ) THEN
    ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName}
      FOREIGN KEY (${f.key}) REFERENCES ${schema}.tbl_${f.relation.form}(${f.relation.keyValue});
  END IF;
END $$;`.trim());
      }
    }
    return statements.join('\n');
  }

  // ── 3c. Detecta un nodo 'line-items' en el árbol del formulario (a lo
  // sumo uno soportado por formulario) — igual que node.relation, sus
  // columnas (node.lineItemColumns) vienen flat sobre el nodo, no anidadas
  // bajo node.schema (así emite el builder real, verificado toda la
  // sesión con node.relation/extractFields). Ver docs/adr/017.
  findLineItemsNode(nodes: any[]): any | null {
    for (const node of nodes) {
      if (node.type === 'line-items') return node;
      if (node.children?.length) {
        const found = this.findLineItemsNode(node.children);
        if (found) return found;
      }
    }
    return null;
  }

  private toDetailColumnDbType(col: LineItemColumn): string {
    if (col.relation) return 'BIGINT';
    switch (col.type) {
      case 'text': return 'VARCHAR(255)';
      case 'number': return 'NUMERIC(12,2)';
      case 'currency': return 'NUMERIC(12,2)';
      case 'calculated': return 'NUMERIC(12,2)';
      case 'select': return 'VARCHAR(100)';
      default: return 'TEXT';
    }
  }

  // ── 3d. DDL de la tabla de detalle — solo la estructura fija (id, FK al
  // encabezado, created_at). Las columnas de line-items siempre se agregan
  // vía buildDetailAlterTableDDL (ADD COLUMN IF NOT EXISTS), sea la
  // primera vez (tabla recién creada, sin esas columnas todavía) o en un
  // reprocesamiento (tabla ya existente) — un solo camino idempotente en
  // vez de las 2 ramas que sí hacen falta para el encabezado (que además
  // soporta bind-to-existing).
  buildDetailTableDDL(schema: string, slug: string): string {
    const tableName = `${schema}.tbl_${slug}_detalle`;
    const fkColumn = `${slug}_id`;
    return `
CREATE TABLE IF NOT EXISTS ${tableName} (
  id          BIGINT       NOT NULL GENERATED ALWAYS AS IDENTITY,
  ${fkColumn.padEnd(20)} BIGINT NOT NULL REFERENCES ${schema}.tbl_${slug}(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_tbl_${slug}_detalle PRIMARY KEY (id)
);`.trim();
  }

  // FK real por columna con `relation` (ej. "producto" de una línea de
  // venta) — Postgres no soporta `ADD CONSTRAINT IF NOT EXISTS`, así que la
  // idempotencia se resuelve a mano contra pg_constraint (con namespace,
  // no alcanza con el nombre solo: dos schemas distintos pueden tener una
  // constraint con el mismo nombre, ej. tenant_a y tenant_b con el mismo
  // form). Mismo criterio de evolución que el resto del motor: nunca se
  // quita/reemplaza una constraint existente, solo se agrega si falta.
  buildDetailAlterTableDDL(schema: string, slug: string, columns: LineItemColumn[]): string {
    const tableName = `${schema}.tbl_${slug}_detalle`;
    const statements: string[] = [];
    for (const c of columns) {
      if (!c.key) continue;
      statements.push(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${c.key} ${this.toDetailColumnDbType(c)};`);
      if (c.relation) {
        const constraintName = `fk_tbl_${slug}_detalle_${c.key}`;
        statements.push(`
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_namespace ns ON ns.oid = con.connamespace
    WHERE con.conname = '${constraintName}' AND ns.nspname = '${schema}'
  ) THEN
    ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName}
      FOREIGN KEY (${c.key}) REFERENCES ${schema}.tbl_${c.relation.form}(${c.relation.keyValue});
  END IF;
END $$;`.trim());
      }
    }
    return statements.join('\n');
  }

  // ── 4. Genera el SP único con p_action ───────────────────────────
  buildSpDDL(
    schema: string,
    slug: string,
    fields: ExtractedField[],
    tableNameOverride?: string | null,
    spNameOverride?: string | null,
  ): string {
    const tableName = `${schema}.${tableNameOverride || `tbl_${slug}`}`;
    const fnName = `${schema}.${spNameOverride || `sp_${slug}`}`;

    const insertColumns = fields.map((f) => f.key).join(',\n        ');
    const insertValues = fields.map((f) => this.castField(f)).join(',\n        ');
    const updateSet = fields.map((f) =>
      `${f.key.padEnd(20)} = COALESCE(${this.castField(f)}, ${f.key})`
    ).join(',\n        ');

    return `
-- Limpia la firma vieja (3 params, sin paginación) si existía: CREATE OR
-- REPLACE no la toca porque el número de parámetros cambió, y dejarla
-- convive como overload ambiguo con la nueva (sus 2 params nuevos tienen
-- DEFAULT, así que una llamada de 3 args matchea ambas — Postgres tira
-- "function ... is not unique"). DROP IF EXISTS es idempotente.
DROP FUNCTION IF EXISTS ${fnName}(VARCHAR, BIGINT, JSONB);

CREATE OR REPLACE FUNCTION ${fnName}(
  p_action  VARCHAR,
  p_id      BIGINT    DEFAULT NULL,
  p_data    JSONB   DEFAULT NULL,
  p_limit   BIGINT    DEFAULT NULL,
  p_offset  BIGINT    DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  CASE p_action

    WHEN 'INSERT' THEN
      INSERT INTO ${tableName} (
        ${insertColumns}
      ) VALUES (
        ${insertValues}
      )
      RETURNING to_jsonb(${tableName}.*) INTO v_result;

    WHEN 'UPDATE' THEN
      UPDATE ${tableName} SET
        ${updateSet},
        updated_at = NOW()
      WHERE id = p_id AND deleted_at IS NULL
      RETURNING to_jsonb(${tableName}.*) INTO v_result;

    WHEN 'DELETE' THEN
      UPDATE ${tableName}
      SET deleted_at = NOW()
      WHERE id = p_id AND deleted_at IS NULL
      RETURNING to_jsonb(${tableName}.*) INTO v_result;

    WHEN 'SELECT' THEN
      -- Sin p_limit/p_offset: mismo comportamiento de siempre (array plano
      -- con todos los registros) para no romper a los consumidores actuales.
      -- Con p_limit y/o p_offset: pagina y devuelve { rows, total } para que
      -- el caller sepa cuántas páginas hay.
      IF p_limit IS NOT NULL OR p_offset IS NOT NULL THEN
        SELECT jsonb_build_object(
          'rows', COALESCE(jsonb_agg(to_jsonb(paged.*) ORDER BY paged.id), '[]'::jsonb),
          'total', (SELECT COUNT(*) FROM ${tableName} WHERE deleted_at IS NULL)
        )
        INTO v_result
        FROM (
          SELECT * FROM ${tableName}
          WHERE deleted_at IS NULL
          ORDER BY id
          LIMIT p_limit OFFSET p_offset
        ) paged;
      ELSE
        SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.id)
        INTO v_result
        FROM ${tableName} t
        WHERE t.deleted_at IS NULL;
      END IF;

    WHEN 'SELECT_BY_ID' THEN
      SELECT to_jsonb(t.*)
      INTO v_result
      FROM ${tableName} t
      WHERE t.id = p_id AND t.deleted_at IS NULL;

    ELSE
      RAISE EXCEPTION 'Acción no soportada: %', p_action;
  END CASE;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql;`.trim();
  }

  // ── 5. Cast de campo JSONB al tipo SQL correspondiente ───────────
  private castField(field: ExtractedField): string {
    const raw = `p_data->>'${field.key}'`;
    if (field.relation) return `(${raw})::BIGINT`;
    switch (field.type) {
      case 'number': return `(${raw})::NUMERIC`;
      case 'currency': return `(${raw})::NUMERIC`;
      case 'date': return `(${raw})::DATE`;
      case 'checkbox': return `(${raw})::BOOLEAN`;
      default: return raw;
    }
  }

  // ── 5b. Valida identificadores SQL que vienen del admin (table_name/sp_name)
  // Defensa en profundidad: solo super admin puede setearlos, pero un valor
  // mal formado quedaría persistido y se reusaría en cada /execute.
  private validateIdentifier(name: string, label: string): void {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
      throw new BadRequestException(
        `${label} inválido: debe ser snake_case, empezar con letra/guión bajo (máx 63 caracteres)`,
      );
    }
  }

  // ── 5c. Valida el SQL custom de la grid — no es un parser SQL completo,
  // es una validación de superficie (single-statement, solo SELECT, sin
  // palabras clave de escritura). Consistente con el modelo de confianza ya
  // existente en la app: solo super admin llega hasta acá.
  private validateGridQuery(sql: string | null | undefined): void {
    if (!sql) return;
    const trimmed = sql.trim().replace(/;\s*$/, '');
    if (!trimmed) return;
    if (trimmed.includes(';')) {
      throw new BadRequestException('El query de grid debe ser un único SELECT (sin múltiples sentencias)');
    }
    if (!/^select\b/i.test(trimmed)) {
      throw new BadRequestException('El query de grid debe empezar con SELECT');
    }
    const denylist = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|call|copy|vacuum|execute|do|merge)\b/i;
    if (denylist.test(trimmed)) {
      throw new BadRequestException('El query de grid contiene una palabra clave no permitida');
    }
  }

  // ── 6. Proceso principal ─────────────────────────────────────────
  async processForm(schema: string, dto: {
    slug: string;
    name: string;
    parentId?: string;
    action?: string;
    jsonForm: any;
    tableName?: string | null;
    spName?: string | null;
    recreateSp?: boolean;
    gridQuery?: string | null;
    icon?: string | null;
    displayMode?: 'modal' | 'inline' | null;
    modalWidth?: number | null;
  }) {
    if (dto.tableName) this.validateIdentifier(dto.tableName, 'Nombre de tabla');
    if (dto.spName) this.validateIdentifier(dto.spName, 'Nombre de SP');
    this.validateGridQuery(dto.gridQuery);
    if (dto.displayMode && dto.displayMode !== 'modal' && dto.displayMode !== 'inline') {
      throw new BadRequestException("displayMode debe ser 'modal' o 'inline'");
    }

    const existing = await this.pool.query(
      `SELECT id, has_table, has_sp, table_name, sp_name FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`,
      [dto.slug],
    );

    const exists = (existing.rowCount ?? 0) > 0;
    const prev = exists ? existing.rows[0] : null;
    const boundToExisting = !!dto.tableName;
    const effectiveTable = dto.tableName || `tbl_${dto.slug}`;
    const fields = this.extractFields(dto.jsonForm.root);

    let hasTable = exists ? prev.has_table : false;
    if (!boundToExisting) {
      if (!hasTable) {
        await this.pool.query(this.buildTableDDL(schema, dto.slug, fields));
      } else {
        const alterDDL = this.buildAlterTableDDL(schema, dto.slug, fields);
        if (alterDDL) {
          await this.pool.query(alterDDL);
        }
      }
      hasTable = true;
    } else {
      // Tabla existente: no se ejecuta CREATE ni ALTER. Se valida que los
      // campos del schema realmente existan como columnas — evita un error
      // críptico de Postgres al crear el SP contra columnas inexistentes.
      const cols = await this.pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [schema, effectiveTable],
      );
      const validCols = new Set(cols.rows.map((r) => r.column_name));
      const missing = fields.filter((f) => !validCols.has(f.key)).map((f) => f.key);
      if (missing.length > 0) {
        throw new BadRequestException(`Los campos [${missing.join(', ')}] no existen en la tabla '${effectiveTable}'`);
      }
      hasTable = true;
    }

    // Tabla de detalle (nodo 'line-items') — solo si el encabezado se
    // generó por este motor (no bindeado a una tabla existente, ver
    // docs/adr/017-tabla-detalle-line-items.md).
    const lineItemsNode = this.findLineItemsNode(dto.jsonForm.root);
    if (lineItemsNode && !boundToExisting) {
      await this.pool.query(this.buildDetailTableDDL(schema, dto.slug));
      const detailAlterDDL = this.buildDetailAlterTableDDL(
        schema, dto.slug, lineItemsNode.lineItemColumns ?? [],
      );
      if (detailAlterDDL) {
        await this.pool.query(detailAlterDDL);
      }
    }

    const recreateSp = dto.recreateSp ?? true;
    const effectiveSpName = dto.spName || `sp_${dto.slug}`;
    let hasSp = exists ? prev.has_sp : false;
    if (recreateSp) {
      // Evita dejar huérfana la función anterior si el admin renombró el SP.
      if (exists && prev.sp_name && prev.sp_name !== effectiveSpName) {
        await this.pool.query(
          `DROP FUNCTION IF EXISTS ${schema}.${prev.sp_name}(VARCHAR, BIGINT, JSONB, BIGINT, BIGINT)`,
        );
      }
      await this.pool.query(this.buildSpDDL(schema, dto.slug, fields, effectiveTable, effectiveSpName));
      hasSp = true;
    } else if (dto.spName) {
      hasSp = true; // SP hecho a mano por el admin — se confía en que existe
    }

    const tableNameToStore = boundToExisting ? dto.tableName : null;
    const spNameToStore = dto.spName || null;

    const displayModeToStore = dto.displayMode || 'modal';
    const modalWidthToStore = displayModeToStore === 'modal' ? (dto.modalWidth ?? null) : null;

    let result: { rows: any[] };
    if (exists) {
      result = await this.pool.query(
        `UPDATE ${schema}.forms SET
          name         = $1,
          json_form    = $2,
          has_table    = $3,
          has_sp       = $4,
          table_name   = $5,
          sp_name      = $6,
          grid_query   = $7,
          icon         = $8,
          display_mode = $9,
          modal_width  = $10,
          updated_at   = NOW()
         WHERE slug = $11
         RETURNING *`,
        [
          dto.name, dto.jsonForm, hasTable, hasSp, tableNameToStore, spNameToStore,
          dto.gridQuery ?? null, dto.icon ?? null, displayModeToStore, modalWidthToStore, dto.slug,
        ],
      );
    } else {
      result = await this.pool.query(
        `INSERT INTO ${schema}.forms
          (slug, name, parent_id, action, json_form, has_table, has_sp, table_name, sp_name, grid_query, icon, display_mode, modal_width)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          dto.slug, dto.name, dto.parentId ?? null, dto.action ?? null, dto.jsonForm,
          hasTable, hasSp, tableNameToStore, spNameToStore, dto.gridQuery ?? null, dto.icon ?? null,
          displayModeToStore, modalWidthToStore,
        ],
      );
    }

    return result.rows[0];
  }

  // ── 7. Elimina un formulario: dropea el SP y (si la tabla fue generada
  // por este motor, no bindeada a una ya existente) la tabla real, limpia
  // las asignaciones a módulos (`module_forms`, sin FK — ver
  // docs/known-bugs.md) y borra la fila de metadata. Todo en una única
  // transacción — ver CLAUDE.md "operaciones multi-paso con efectos
  // estructurales". Si algo más en la DB depende de la tabla (ej. un FK de
  // relación desde otro formulario), el DROP TABLE falla y todo se revierte
  // en vez de cascadear un borrado no pedido.
  async deleteForm(schema: string, slug: string): Promise<void> {
    const existing = await this.pool.query(
      `SELECT has_table, has_sp, table_name, sp_name FROM ${schema}.forms WHERE slug = $1 AND deleted_at IS NULL`,
      [slug],
    );
    if ((existing.rowCount ?? 0) === 0) {
      throw new NotFoundException(`Formulario '${slug}' no encontrado`);
    }
    const row = existing.rows[0];
    const boundToExisting = !!row.table_name;
    const tableName = row.table_name || `tbl_${slug}`;
    const spName = row.sp_name || `sp_${slug}`;
    this.validateIdentifier(tableName, 'Nombre de tabla');
    this.validateIdentifier(spName, 'Nombre de SP');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (row.has_sp) {
        await client.query(`DROP FUNCTION IF EXISTS ${schema}.${spName}(VARCHAR, BIGINT, JSONB, BIGINT, BIGINT)`);
        await client.query(`DROP FUNCTION IF EXISTS ${schema}.${spName}(VARCHAR, BIGINT, JSONB)`);
      }
      if (row.has_table && !boundToExisting) {
        // La tabla de detalle (si existe, ver docs/adr/017) tiene FK hacia
        // el encabezado — hay que dropearla primero o el DROP de abajo falla.
        await client.query(`DROP TABLE IF EXISTS ${schema}.tbl_${slug}_detalle`);
        await client.query(`DROP TABLE IF EXISTS ${schema}.${tableName}`);
      }

      await client.query(`DELETE FROM ${schema}.module_forms WHERE form_slug = $1`, [slug]);
      await client.query(`DELETE FROM ${schema}.forms WHERE slug = $1`, [slug]);

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err?.code === '23503') {
        throw new BadRequestException(
          `No se puede eliminar '${slug}': otro objeto de la base de datos depende de su tabla o de su fila de formulario.`,
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }
}