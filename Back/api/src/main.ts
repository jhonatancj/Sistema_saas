import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';



async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // El campo `image` del builder manda la imagen como base64 dentro del JSON
  // (no multipart) — el límite default de express.json() (100kb) revienta con
  // cualquier imagen real. El builder limita a 2MB por archivo (+~33% de overhead
  // de base64), de ahí el margen a 10mb.
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  const config = new DocumentBuilder()
    .setTitle('SaaS Inventario API')
    .setDescription('API multi-tenant schema-per-tenant')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  app.enableCors({
    origin: (origin, callback) => {
      const isDev = process.env.APP_ENV === 'development';
      const devPattern = /\.localhost(:\d+)?$/;
      const prodPattern = new RegExp(
        `\\.${process.env.CORS_DOMAIN}$`
      );

      if (!origin || (isDev && devPattern.test(origin)) || prodPattern.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });


  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  const port = process.env.APP_PORT ?? 3000
  await app.listen(port);
  console.log(`Application running on http://localhost:${port}`);
}
bootstrap();
