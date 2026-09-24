import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。
      // `@faicad/faijs-extra` 前缀不与 `@faicad/faijs` 冲突（Vite 只匹配
      // `find` 本身或 `find + '/'`），故两条互不吞并。
      { find: '@faicad/faijs-extra', replacement: resolve(__dirname, '../faijs-extra/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../core/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../../src') },
      { find: '@faicad/sheetmetal', replacement: resolve(__dirname, '../sheetmetal/src/index.ts') },
      { find: '@faicad/fai-cq-gears', replacement: resolve(__dirname, '../fai_cq_gears/src/index.ts') },
      { find: '@faicad/cq-compat', replacement: resolve(__dirname, '../cq-compat/src/index.ts') },
      { find: '@faicad/faijs-fixtures', replacement: resolve(__dirname, '../fixtures/data') },
    ],
  },
  test: {
    environment: 'node',
    include: ['faijs/**/*.test.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
    // Yields the worker after every busy test: vitest's between-test bookkeeping
    // never returns to the event loop, so consecutive geometry-heavy tests
    // accumulate into one stretch that can exceed birpc's hard-coded 60s
    // `onTaskUpdate` RPC timeout (= unhandled error + exit 1 on a green run).
    // Mechanism and measurements: faijs/_support/worker-yield.ts
    setupFiles: ['./faijs/_support/setup-worker-yield.ts'],
  },
})
