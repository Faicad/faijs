import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。与 tsconfig paths 一致。
      // `@faicad/faijs-extra` 前缀不与 `@faicad/faijs` 冲突（Vite 只匹配
      // `find` 本身或 `find + '/'`），故两条互不吞并。
      { find: '@faicad/faijs-extra', replacement: resolve(__dirname, '../faijs-extra/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, 'src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../../src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
