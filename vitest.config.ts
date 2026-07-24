import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'packages/*/src/**/*.ts',
        'apps/*/lib/**/*.ts',
        'apps/*/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/node_modules/**',
      ],
    },
    // Mock external dependencies that aren't available in test environment
    server: {
      deps: {
        inline: ['@filmsnaps/shared'],
      },
    },
  },
  resolve: {
    alias: {
      '@filmsnaps/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@filmsnaps/shared/providers': path.resolve(__dirname, 'packages/shared/src/providers'),
      '@filmsnaps/shared/security': path.resolve(__dirname, 'packages/shared/src/security'),
      '@filmsnaps/shared/types': path.resolve(__dirname, 'packages/shared/src/types'),
    },
  },
});
