import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { FormGeneratorService } from '../modules/forms/form-generator.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(FormGeneratorService);

  // 1. 404 on missing slug
  try {
    await svc.deleteForm('public', 'does_not_exist_slug_xyz');
    console.log('FAIL: expected NotFoundException');
  } catch (e: any) {
    console.log('404 case OK:', e?.constructor?.name, e?.message);
  }

  await app.close();
  process.exit(0);
}
main();
