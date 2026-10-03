import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  // Same M7 rule as vite.config.ts: @faicad/* resolves to live source, never
  // dist. Required here too — Vitest `projects` do NOT inherit the root
  // config's resolve.alias, so without this the unit tests resolve
  // '@faicad/faijs/io/zip' through node_modules -> core's exports map ->
  // dist/io/zip.js, which does not exist in CI (no build step before
  // `npx vitest run`) and fails with ERR_MODULE_NOT_FOUND.
  resolve: {
    alias: [
      // Prefix match: '@faicad/faijs-extra' must be listed before '@faicad/faijs'
      // (Vite matches `find` or `find + '/'`, so the two do not shadow).
      { find: '@faicad/faijs-extra', replacement: resolve(__dirname, '../faijs-extra/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../core/src') },
    ],
  },
  test: {
    // 只跑 demo 自己的单测；e2e/demo.spec.ts 是 Playwright 用例，不归 vitest 管
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})