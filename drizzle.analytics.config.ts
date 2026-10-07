import { defineConfig } from 'drizzle-kit';

/** The analytics service's own database and migrations, apart from the order API's. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/analytics-service/database/schema.ts',
  out: './drizzle-analytics',
  dbCredentials: {
    url: process.env.ANALYTICS_DATABASE_URL ?? 'postgres://outbox:outbox@localhost:5432/analytics',
  },
});
