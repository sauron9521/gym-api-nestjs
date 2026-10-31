export function useTestDatabase(): void {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error('TEST_DATABASE_URL is required');
  }

  const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));

  if (!databaseName.toLowerCase().includes('test')) {
    throw new Error('Refusing to use a non-test database');
  }

  process.env.DATABASE_URL = url;
}
