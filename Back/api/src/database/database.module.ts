import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

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
