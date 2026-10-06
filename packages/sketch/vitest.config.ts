import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      // Regex (not prefix) so `@faicad/faijs-sketch` is never rewritten by the
      // core alias — same prefix trap fcstd/faijs-extra document.
      { find: /^@faicad\/faijs\/(.*)$/, replacement: new URL('../core/src/$1', import.meta.url).pathname },
      { find: /^@faicad\/faijs$/, replacement: new URL('../core/src', import.meta.url).pathname },
    ],
  },
  test: {
    environment: 'node',
    // install-smoke is a publish-state test with its own config (`test:install`).
    include: ['test/**/*.test.ts'],
    exclude: ['src/install-smoke.test.ts', 'node_modules/**'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})