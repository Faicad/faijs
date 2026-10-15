import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。与 tsconfig paths 一致。
      // 2026-10-13 merge：`@faicad/faijs-extra`（及 `@faicad/faijs-sketch`）已并入
      // core，别名删除——旧别名指向 ../faijs-extra/src，路径已不存在。
      { find: '@faicad/faijs', replacement: resolve(__dirname, 'src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../../src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // install-smoke is a publish-state test with its own config (`test:install`):
    // it packs the tarball and npm-installs it into a temp dir (slow, needs
    // dist/). Excluded from the default suite; run it via `npm run test:install`.
    exclude: ['test/install-smoke.test.ts', 'node_modules/**'],
    // 2026-09-25 core-decouple Phase 2：core 不再注入外部 registry，
    // 全局 setup 自装配（见 test/test-setup.ts）。
    setupFiles: ['test/test-setup.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
