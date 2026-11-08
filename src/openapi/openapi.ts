import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Nest 12's Swagger scanner reads the existing Standard Schema/Zod
 * metadata from @Body({schema}) and @Query({schema}) directly.
 */
export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Gym API')
    .setDescription(
      'Gym training, trainer–athlete relationships, workout logging and progress measurements.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'accessToken',
    )
    .addCookieAuth('__Host-sid', {
      type: 'apiKey',
      in: 'cookie',
      name: '__Host-sid',
    }, 'sessionCookie')
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) => `${controller}_${method}`,
  });
}

export function enableOpenApi(app: INestApplication): void {
  const doc = () => createOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, doc, {
    jsonDocumentUrl: '/api/openapi.json',
    raw: ['json'],
    ui: true,
    customSiteTitle: 'Gym API | OpenAPI',
  });
}
