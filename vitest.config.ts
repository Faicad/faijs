import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。前缀匹配：'@faicad/faijs/sdk' → src/sdk.ts。
      { find: '@faicad/faijs-core', replacement: resolve(__dirname, 'packages/core/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, 'src') },
      { find: '@', replacement: resolve(__dirname, 'src') },
    ],
  },
  test: {
    // Monorepo：测试分布在各 workspace 包内（根 src/ 无测试），各包 alias 不同
    // （sheetmetal/cq-compat/fai_cq_gears/tests 均有自定义解析），根配置只做
    // projects 分发，让每个包按自己的配置（含 alias）跑。
    projects: [
      'packages/core',
      'packages/gear-lib-demo',
      'packages/sheetmetal',
      'packages/demo',
      'packages/tests',
      // 注意：不包含 packages/cq-compat 与 packages/fai_cq_gears —— 两者较重，
      // 用户明确要求根目录测试忽略它们（各包仍可单独 `npm test -w <pkg>` 运行）。
    ],
    testTimeout: 300000,
    hookTimeout: 300000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'packages/*/src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/index.ts', 'src/browser.ts', 'src/node.ts', 'src/csg.ts', 'src/sdf.ts'],
      reporter: ['text', 'html'],
    },
  },
})
