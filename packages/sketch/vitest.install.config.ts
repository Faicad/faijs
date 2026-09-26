import { defineConfig } from 'vitest/config'

/**
 * Publish-state smoke only (`npm run test:install`): packs `@faicad/faijs-sketch`
 * and `@faicad/faijs`, installs them into an isolated temp consumer and runs a
 * sketch end-to-end from the installed tarballs. Excluded from the default suite
 * so day-to-day runs stay fast; mirrors `scripts/ci.ps1`'s publish gate.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/install-smoke.test.ts'],
    testTimeout: 600000,
    hookTimeout: 600000,
  },
})