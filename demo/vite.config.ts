import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      // Order matters: more specific aliases must come first
      { find: '@faicad/faijs/browser', replacement: resolve(__dirname, '../src/browser.ts') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../src/index.ts') },
    ],
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
  server: {
    port: 3000,
    open: true,
  },
})
