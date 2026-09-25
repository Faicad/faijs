import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。vendored 树已剥至 @faicad/faijs-brepjs
      // 子包；@faicad/faijs/brepjs-compat（wrap 面，box/fuse 等）仍走 core。
      { find: '@faicad/faijs-brepjs', replacement: resolve(__dirname, '../brepjs/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../core/src') },
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
