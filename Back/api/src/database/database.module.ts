import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, types } from 'pg';

// `pg` devuelve BIGINT (OID 20 — id de toda tabla generada por el motor,
// GENERATED ALWAYS AS IDENTITY) como string por default, para no perder
// precisión en valores que superen Number.MAX_SAFE_INTEGER. En este
// proyecto ningún id real se acerca a ese rango, y el driver no-uniforme
// (string en queries crudas vs. number en los valores que salen de
// to_jsonb()/JSONB de un SP) rompe cualquier comparación entre un id leído
// por SQL plano y uno leído por el motor de formularios — ej.
// `tenants.rubro_id` (string, query cruda) vs. `tbl_rubro.id` (number, vía
// to_jsonb en el SP) nunca comparaban igual con `===`. Parsear BIGINT como
// number acá, una sola vez, lo resuelve de raíz para toda la app.
types.setTypeParser(20, (val: string) => parseInt(val, 10));

export const PG_MASTER_POOL = 'PG_MASTER_POOL';

@Global()
@Module({
    providers: [
        {
            provide: PG_MASTER_POOL,
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                return new Pool({
                    host: config.get('DB_HOST'),
                    port: config.get<number>('DB_PORT'),
                    database: config.get('DB_NAME'),
                    user: config.get('DB_USER'),
                    password: config.get('DB_PASSWORD'),
                    max: 10,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 2000,
                });
            },
        },
    ],
    exports: [PG_MASTER_POOL],
})
export class DatabaseModule { }
