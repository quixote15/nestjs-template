import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Each suite migrates its own PGlite in beforeAll; run side by side, that outlasts the 10s default.
    hookTimeout: 30_000,
    // AuthModule refuses to start without a signing secret.
    env: { JWT_SECRET: 'e2e-test-secret' },
  },
});
