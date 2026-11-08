import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { createOpenApiDocument } from '../src/openapi/openapi.js';

const output = resolve(process.cwd(), 'openapi/openapi.json');
const app = await NestFactory.create(AppModule, { logger: false });

try {
  const document = createOpenApiDocument(app);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(document, null, 2) + '\n', 'utf8');
  console.log(`OpenAPI written to ${output}`);
} finally {
  await app.close();
}
