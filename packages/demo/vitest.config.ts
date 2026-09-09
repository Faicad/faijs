import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只跑 demo 自己的单测；e2e/demo.spec.ts 是 Playwright 用例，不归 vitest 管
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})