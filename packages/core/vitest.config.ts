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
    // test/perf/** 是 deflection/耗时探针（方案 2026-10-21），自重几秒 + 启动
    // brepkit wasm，只在 `vitest.perf.config.ts` 下跑（`npm run test:perf` 语义），
    // 不进默认套件。
    // smlib-stl-import-perf.probe 同理（dca1013 引入漏配）：10k 三角 → 30k 线段 +
    // 万级面 SmApiStitchIntoSolidEx 实测挂起（方案 §8 风险 R1 实锤：万级面缝合
    // 不可行），是手动探针，不进默认套件；手动跑需知悉会长时间无响应。
    exclude: [
      'test/install-smoke.test.ts',
      'test/perf/**',
      'test/smlib-kernel/smlib-stl-import-perf.probe.test.ts',
      'node_modules/**',
    ],
    // 2026-09-25 core-decouple Phase 2：core 不再注入外部 registry，
    // 全局 setup 自装配（见 test/test-setup.ts）。
    setupFiles: ['test/test-setup.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
