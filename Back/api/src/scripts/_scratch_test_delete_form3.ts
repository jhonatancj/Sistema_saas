import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { FormGeneratorService } from '../modules/forms/form-generator.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(FormGeneratorService);
  try {
    await svc.deleteForm('public', 'scratch_bound_test');
    console.log('deleteForm OK (bound-to-existing-table case)');
  } catch (e) {
    console.error('deleteForm FAILED', e);
  }
  await app.close();
  process.exit(0);
}
main();
