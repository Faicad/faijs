import { defineConfig } from 'vitest/config'

/**
 * Publish-state smoke only (`npm run test:install`): packs `@faicad/faijs`,
 * installs it into an isolated temp consumer and runs a sketch end-to-end from
 * the installed tarball. Excluded from the default suite
 * (`vitest.config.ts` → `exclude`) so day-to-day runs stay fast; mirrors
 * `scripts/ci.ps1` / `.github/workflows/ci.yml`'s 4/9 publish gate.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/install-smoke.test.ts'],
    testTimeout: 600000,
    hookTimeout: 600000,
  },
})
