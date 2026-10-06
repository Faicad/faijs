import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // M7：包名解析到活源码（不经 dist）。与 tsconfig paths 一致。
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../core/src') },
      // `@faicad/faijs-cadquery` was split into its own repo — resolve it from
      // node_modules (declared in package.json devDependencies) instead of the
      // now-removed `../faijs-cadquery/src` path.
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
