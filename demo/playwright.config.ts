import { defineConfig } from '@playwright/test'

/**
 * E2E tests for the faijs demo app.
 *
 * Starts the vite dev server (port 8899, matching vite.config.ts) and runs
 * the browser tests in e2e/*.spec.ts.
 *
 * Notes:
 * - OCCT wasm (~22MB) downloads on first run, geometry ops are slow →
 *   generous timeouts, serial execution (workers: 1).
 * - `--no-open` overrides the `open: true` in vite.config.ts so the CI
 *   run does not pop a browser window.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8899',
    headless: true,
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: 'npx vite --port 8899 --strictPort --no-open',
    url: 'http://localhost:8899',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
