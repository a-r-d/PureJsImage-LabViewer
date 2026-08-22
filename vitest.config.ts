import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'apps/*/tests/**/*.test.ts',
      'packages/*/tests/**/*.test.ts',
      'packages/*/tests/**/*.test.mjs',
      'tooling/scripts/**/*.test.ts',
    ],
    passWithNoTests: false,
  },
})
