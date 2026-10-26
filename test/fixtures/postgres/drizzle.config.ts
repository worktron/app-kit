// Regenerates the fixture's migration after a change to schema.ts: bunx drizzle-kit generate --config test/fixtures/postgres/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './test/fixtures/postgres/schema.ts',
  out: './test/fixtures/postgres/drizzle',
});
