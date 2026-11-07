import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: [
      'test/app.e2e-spec.ts',
      'test/auth-lifecycle.e2e-spec.ts',
      'test/event-registrations.e2e-spec.ts',
      'test/registrations.e2e-spec.ts',
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
