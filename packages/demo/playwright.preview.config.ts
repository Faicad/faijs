import { defineConfig } from '@playwright/test'

/**
 * Preview-mode e2e config.
 *
 * Builds the demo, serves `dist/` via `vite preview`, and verifies the CDN
 * loading path: three / manifold-3d / occt-wasm and their transitive closure
 * are resolved from jsdelivr at runtime through the importmap in index.html.
 *
 * Browser settings mirror playwright.config.ts (headless SwiftShader WebGL).
 * Never reuses an existing server — this config must always run against the
 * freshly built preview output, not the dev server.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/preview-cdn.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  // Headless Chromium occasionally crashes under WebGL + OCCT wasm memory
  // pressure ("session closed"). Retry once to keep CI robust.
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8899',
    headless: true,
    viewport: { width: 1400, height: 900 },
    launchOptions: {
      args: [
        '--disable-dev-shm-usage',
        // CI has no GPU: enable software WebGL (SwiftShader). Newer Chromium
        // builds block SwiftShader unless --enable-unsafe-swiftshader is set,
        // and the demo creates two WebGL contexts on page load — without this
        // the renderer process crashes with "session closed".
        '--enable-unsafe-swiftshader',
        '--use-angle=swiftshader',
      ],
    },
  },
  webServer: {
    command: 'npm run build && vite preview --port 8899 --strictPort --no-open',
    url: 'http://localhost:8899',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium-preview', use: { browserName: 'chromium' } }],
})