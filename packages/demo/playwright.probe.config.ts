import { defineConfig } from '@playwright/test'

/**
 * probe config — 仅跑 e2e/probe-cdn-kernel.spec.ts 诊断探针（非 CI 门禁）。
 * 复用主 config 的 webServer/launchOptions；testMatch 放开到探针文件。
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/probe-cdn-*.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8899',
    headless: true,
    viewport: { width: 1400, height: 900 },
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    },
  },
  webServer: {
    command: 'npx vite --port 8899 --strictPort --no-open',
    url: 'http://localhost:8899',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
