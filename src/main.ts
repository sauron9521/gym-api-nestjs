import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { enableOpenApi } from './openapi/openapi.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  //CORS
  const corsOrigins = config
    .getOrThrow<string>('CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  });

  //CSRF
  app.enableCsrfProtection();

  //Global Pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
    new StandardSchemaValidationPipe(),
  );

  // Documentation is opt-in, never exposed to production by default.
  if (config.get<boolean>('ENABLE_OPENAPI') === true) {
    enableOpenApi(app);
  }

  app.enableShutdownHooks();
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
  console.log('App started on port: ' + port);
}
await bootstrap();
