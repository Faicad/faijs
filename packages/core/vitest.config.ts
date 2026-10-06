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
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // 2026-09-25 core-decouple Phase 2：core 不再注入 vendored registry，
    // 全局 setup 自装配（见 test/vendored-setup.ts）。
    setupFiles: ['test/vendored-setup.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
