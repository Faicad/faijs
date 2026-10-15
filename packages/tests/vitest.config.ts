import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。
      // 2026-10-13: sketch and extra merged into core — their imports now
      // resolve to core/src subdirectories.
      // 子路径必须用锚定正则：字符串 find 按「前缀」匹配（importee === find ||
      // importee.startsWith(find + '/')），若用字符串 '@faicad/faijs/extra' 会把
      // '@faicad/faijs/extra/browser' 也吃掉、拼成非法路径 index.ts/browser。
      // 锚定后仅精确匹配该子路径，其余子路径落给下面的 @faicad/faijs → core/src。
      { find: /^@faicad\/faijs\/sketch\/node$/, replacement: resolve(__dirname, '../core/src/sketch/node.ts') },
      { find: /^@faicad\/faijs\/sketch$/, replacement: resolve(__dirname, '../core/src/sketch/index.ts') },
      { find: /^@faicad\/faijs\/extra$/, replacement: resolve(__dirname, '../core/src/extra/index.ts') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../core/src') },
      { find: '@faicad/sheetmetal', replacement: resolve(__dirname, '../sheetmetal/src/index.ts') },
      { find: '@faicad/faijs-gears', replacement: resolve(__dirname, '../faijs-gears/src/index.ts') },
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
