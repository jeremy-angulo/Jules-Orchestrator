import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.js'],
    exclude: ['tests/**/*.test.js', 'node_modules/**/*'],
    environment: 'node',
  },
});
