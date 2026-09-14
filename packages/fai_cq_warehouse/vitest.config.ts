import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // 与 packages/fai_cq_gears 同款：包名解析到活源码，不经 dist
      { find: '@faicad/faijs-core', replacement: resolve(__dirname, '../core/src') },
      { find: '@faicad/cq-compat', replacement: resolve(__dirname, '../cq-compat/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../../src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 600000,
    hookTimeout: 600000,
  },
})
