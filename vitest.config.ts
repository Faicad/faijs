import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/index.ts', 'src/browser.ts', 'src/node.ts', 'src/csg.ts', 'src/sdf.ts'],
      reporter: ['text', 'html'],
    },
  },
})
