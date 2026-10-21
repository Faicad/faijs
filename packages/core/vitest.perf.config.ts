import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * 性能探针专用配置（不进入默认套件，CI 不跑）：
 *   npx vitest run --config vitest.perf.config.ts
 * 与 vitest.config.ts 同款别名（@faicad/faijs → 活源码），
 * 只 include test/perf/**；testTimeout 放宽到 10 分钟（face.fai.js 全量
 * 执行单次 30-70s，多档位/多轮次循环需要长超时）。
 *
 * setup 用 test/perf/setup-perf.ts（只注册 brepkit → 默认引擎 = 端侧引擎）；
 * **不用** test-setup.ts——它会先注册 OCCT 抢占 defaultBrepId，探针会静默跑在
 * OCCT 上（2026-10-21 探针作废实录）。
 */
export default defineConfig({
  resolve: {
    alias: [{ find: '@faicad/faijs', replacement: resolve(__dirname, 'src') }],
  },
  test: {
    environment: 'node',
    include: ['test/perf/**/*.test.ts'],
    setupFiles: ['test/perf/setup-perf.ts'],
    testTimeout: 600000,
    hookTimeout: 600000,
  },
})
