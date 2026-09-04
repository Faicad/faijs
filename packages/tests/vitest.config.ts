import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。
      { find: '@faicad/faijs-core', replacement: resolve(__dirname, '../core/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../../src') },
      { find: '@faicad/mech-lib', replacement: resolve(__dirname, '../mech-lib/src/index.ts') },
      { find: '@faicad/sheetmetal', replacement: resolve(__dirname, '../sheetmetal/src/index.ts') },
      { find: '@faicad/faijs-fixtures', replacement: resolve(__dirname, '../fixtures/data') },
    ],
  },
  test: {
    environment: 'node',
    include: ['faijs/**/*.test.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
