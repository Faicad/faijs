import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../core/src') },
      { find: '@faicad/cq-compat', replacement: resolve(__dirname, '../cq-compat/src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
