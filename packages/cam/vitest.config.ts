import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // Package name resolves to live source (not dist).
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../core/src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
