import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。compat.ts 是唯一桥接点，经此引用
      // vendored L1/L2（D12 / §9 白名单）与 faijs 内核装配。
      { find: '@faicad/faijs-core', replacement: resolve(__dirname, '../core/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../../src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
