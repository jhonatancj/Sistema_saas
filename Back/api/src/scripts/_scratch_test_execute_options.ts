import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { FormExecutorService } from '../modules/forms/form-executor.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const formExecutor = app.get(FormExecutorService);

  const result = await formExecutor.execute('tenant_test_rubro_moda', 'categorias', 'SELECT', undefined, undefined, 1000, 0);
  console.log('execute(SELECT, limit=1000) result:', JSON.stringify(result, null, 2));

  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
