import { ConsoleLogger, Logger, StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '#src/app.module';
import type { AppConfigService } from '#src/common/config/app-config.types';
import { getCorsOrigins } from '#src/common/config/http.config';
import { getLogLevels } from '#src/common/config/logger.config';
import { enableOpenApi } from '#src/infra/openapi/openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production' }),
  });
  const config = app.get<AppConfigService>(ConfigService);

  // The Zod parser validates the level and provides its default before use.
  app.useLogger(new ConsoleLogger({
    json: config.getOrThrow('NODE_ENV') === 'production',
    logLevels: getLogLevels(config.getOrThrow('LOG_LEVEL')),
  }));

  //CORS
  const corsOrigins = getCorsOrigins(config.getOrThrow('CORS_ORIGINS'));

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
  if (config.get('ENABLE_OPENAPI') === true) {
    enableOpenApi(app);
  }

  app.enableShutdownHooks();
  const port = config.getOrThrow('PORT');
  await app.listen(port);
  Logger.log('App started on port: ' + port, 'Bootstrap');
}
await bootstrap();
