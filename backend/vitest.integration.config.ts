import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/lib/database.test.ts'],
    testTimeout: 30000,
  },
});
