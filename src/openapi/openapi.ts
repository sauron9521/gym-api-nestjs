import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';

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
    standardSchemaConverter: (schema, { schemaType }) => {
      if (!schema || typeof schema !== 'object' || !('_zod' in schema)) {
        return undefined;
      }

      const jsonSchema = z.toJSONSchema(schema as z.ZodType, {
        target: 'openapi-3.0',
        io: schemaType,
        // Some existing Zod inputs contain Date values that serialize as
        // ISO strings over HTTP. Reject other unrepresentable types instead
        // of silently documenting an unvalidated object.
        unrepresentable: ({ zodSchema }) =>
          zodSchema._zod.def.type === 'date'
            ? { type: 'string', format: 'date-time' }
            : 'throw',
      });
      return { schema: jsonSchema };
    },
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
