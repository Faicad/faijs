import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // vendored tree ships no test files of its own; parity/surface tests live in core.
    passWithNoTests: true,
    testTimeout: 300000,
  },
})
