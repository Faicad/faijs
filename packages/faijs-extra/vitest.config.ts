import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。与 tsconfig paths 一致。
      // 前缀匹配按 `find` 或 `find + '/'` 判定，因此 `@faicad/faijs-extra`
      // 不会被这条规则吞掉（它不匹配 `@faicad/faijs/`）。
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
