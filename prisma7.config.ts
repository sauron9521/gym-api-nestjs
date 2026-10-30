import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schemas/',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['TEST_DATABASE_URL'],
    // url: process.env['DATABASE_URL'],
  },
});
