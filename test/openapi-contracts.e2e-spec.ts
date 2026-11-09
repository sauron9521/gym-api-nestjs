import { randomUUID } from 'node:crypto';

import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/index.js';
import { createOpenApiDocument } from '../src/openapi/openapi.js';
import { useTestDatabase } from './utility/test-db-helper.js';

/**
 * Validate the response as an API consumer receives it, against the schema
 * actually exported to OpenAPI (not a second hand-written response fixture).
 */
type Schema = {
  $ref?: string;
  type?: string;
  format?: string;
  nullable?: boolean;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  oneOf?: Schema[];
  allOf?: Schema[];
};
type OpenApiDocument = {
  paths?: Record<string, Record<string, {
    responses?: Record<string, {
      content?: Record<string, { schema?: Schema }>;
    }>;
  }>>;
  components?: { schemas?: Record<string, Schema> };
};

function assertValidResponse(
  value: unknown,
  schema: Schema,
  document: OpenApiDocument,
  path = '$',
): void {
  if (schema.$ref) {
    const prefix = '#/components/schemas/';
    expect(schema.$ref.startsWith(prefix), `Unsupported reference at ${path}`).toBe(true);
    const name = schema.$ref.slice(prefix.length).replaceAll('~1', '/').replaceAll('~0', '~');
    const target = document.components?.schemas?.[name];
    expect(target, `Missing OpenAPI component ${name}`).toBeDefined();
    assertValidResponse(value, target!, document, path);
    return;
  }

  if (value === null) {
    expect(schema.nullable, `Unexpected null at ${path}`).toBe(true);
    return;
  }

  if (schema.allOf) {
    for (const variant of schema.allOf) {
      assertValidResponse(value, variant, document, path);
    }
    return;
  }

  if (schema.oneOf) {
    let matches = 0;
    for (const variant of schema.oneOf) {
      try {
        assertValidResponse(value, variant, document, path);
        matches++;
      } catch {
        // A union alternative may intentionally exclude redacted properties.
      }
    }
    expect(matches, `Expected exactly one matching union variant at ${path}`).toBe(1);
    return;
  }

  if (schema.enum) {
    expect(schema.enum, `Invalid enum at ${path}`).toContain(value);
  }

  if (schema.type === 'object') {
    expect(value !== null && typeof value === 'object' && !Array.isArray(value),
      `Expected object at ${path}`).toBe(true);
    const record = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      expect(Object.hasOwn(record, key), `Missing required property ${path}.${key}`).toBe(true);
    }
    if (schema.additionalProperties === false) {
      expect(Object.keys(record).sort(), `Unexpected response fields at ${path}`)
        .toEqual(Object.keys(properties).sort());
    }
    for (const [key, fieldSchema] of Object.entries(properties)) {
      if (Object.hasOwn(record, key)) {
        assertValidResponse(record[key], fieldSchema, document, `${path}.${key}`);
      }
    }
    return;
  }

  if (schema.type === 'array') {
    expect(Array.isArray(value), `Expected array at ${path}`).toBe(true);
    expect(schema.items, `No array item schema at ${path}`).toBeDefined();
    for (const [index, item] of (value as unknown[]).entries()) {
      assertValidResponse(item, schema.items!, document, `${path}[${index}]`);
    }
    return;
  }

  if (schema.type === 'string') {
    expect(typeof value, `Expected string at ${path}`).toBe('string');
    if (schema.format === 'uuid') {
      expect(value as string, `Invalid UUID at ${path}`)
        .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
    if (schema.format === 'date-time') {
      expect(Number.isNaN(Date.parse(value as string)), `Invalid date-time at ${path}`).toBe(false);
    }
    return;
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    expect(typeof value, `Expected number at ${path}`).toBe('number');
    if (schema.type === 'integer') {
      expect(Number.isInteger(value), `Expected integer at ${path}`).toBe(true);
    }
    return;
  }

  if (schema.type === 'boolean') {
    expect(typeof value, `Expected boolean at ${path}`).toBe('boolean');
  }
}

function responseSchema(document: OpenApiDocument, path: string, method: string, status: number): Schema {
  const schema = document.paths?.[path]?.[method]?.responses?.[String(status)]?.content?.['application/json']?.schema;
  expect(schema, `OpenAPI response missing: ${method.toUpperCase()} ${path} (${status})`)
    .toBeDefined();
  return schema!;
}

describe('OpenAPI / HTTP contract regression (PostgreSQL)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let exerciseId: string;
  let document: OpenApiDocument;
  const name = `OpenAPI E2E ${randomUUID()}`;

  beforeAll(async () => {
    useTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [await ConfigModule.forRoot({ isGlobal: true }), AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
      new StandardSchemaValidationPipe(),
    );
    await app.init();

    document = createOpenApiDocument(app) as OpenApiDocument;
    prisma = app.get(PrismaService);
    const muscleGroup = await prisma.muscleGroup.upsert({
      where: { slug: 'chest' },
      update: {},
      create: { name: 'Chest', slug: 'chest' },
    });
    const exercise = await prisma.exercise.create({
      data: {
        name,
        slug: `openapi-e2e-${randomUUID()}`,
        source: 'GLOBAL',
        exerciseType: 'STRENGTH',
        muscleGroups: {
          create: [{ role: 'PRIMARY', muscleGroupId: muscleGroup.id }],
        },
      },
      select: { id: true },
    });
    exerciseId = exercise.id;
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma && exerciseId) {
        await prisma.exercise.delete({ where: { id: exerciseId } });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('validates actual GET /exercises/:id JSON against the exported OpenAPI schema', async () => {
    const response = await request(app!.getHttpServer()).get(`/exercises/${exerciseId}`);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(exerciseId);
    expect(response.body.muscleGroups).toHaveLength(1);
    assertValidResponse(response.body, responseSchema(document, '/exercises/{id}', 'get', 200), document);
  });

  it('validates paginated GET /exercises JSON and its nested records', async () => {
    const response = await request(app!.getHttpServer())
      .get('/exercises')
      .query({ search: name });
    expect(response.status).toBe(200);
    expect(response.body.data.some((exercise: { id: string }) => exercise.id === exerciseId)).toBe(true);
    assertValidResponse(response.body, responseSchema(document, '/exercises', 'get', 200), document);
  });

  it('does not publish the removed legacy root route in OpenAPI', () => {
    expect(document.paths).not.toHaveProperty('/');
  });

  it('publishes training response definitions for all four modules', () => {
    const required = [
      ['/exercises/{id}', 'get', 200],
      ['/workouts/{id}', 'get', 200],
      ['/trainer-athletes/{id}', 'get', 200],
      ['/training-programs/{programId}', 'get', 200],
    ] as const;
    for (const [path, method, status] of required) {
      responseSchema(document, path, method, status);
    }
  });
});
