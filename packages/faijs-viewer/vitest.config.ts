import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const dir = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: [
      // M7: package name resolves to live `src` (no dist). Consistent with
      // tsconfig paths. Prefix matching on `find` / `find + '/'`, so the
      // `@faicad/faijs/io/fai-zip` subpath lands on `../core/src/io/fai-zip`.
      { find: '@faicad/faijs', replacement: resolve(dir, '../core/src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // parsing + occt/manifold wasm init on first execution is slow.
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})