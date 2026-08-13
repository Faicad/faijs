import { defineConfig, type Plugin } from 'vite'

// ── CDN externalization ──
//
// three.js 与 manifold-3d 由浏览器直接从 CDN 加载（不打包进产物）：
// - dev：插件将裸导入解析为 CDN URL（external），浏览器直接请求 CDN
// - build：rollup 将 `three` / `manifold-3d` 及其子路径保持为裸导入，
//   运行时由 index.html 中的 <script type="importmap"> 解析到 CDN
//
// 版本必须与 package.json / node_modules 中的实际依赖版本一致。
const CDN_BASE = 'https://cdn.jsdelivr.net/npm'

const THREE_VERSION = '0.184.0'
const MANIFOLD_VERSION = '3.5.1'

const EXACT_CDN = new Map<string, string>([
  ['three', `${CDN_BASE}/three@${THREE_VERSION}/build/three.module.js`],
  ['manifold-3d', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/manifold.js`],
  ['manifold-3d/manifold', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/manifold.js`],
  ['manifold-3d/manifold.js', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/manifold.js`],
  ['manifold-3d/manifoldCAD', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/lib/manifoldCAD.js`],
  ['manifold-3d/manifoldCAD.js', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/lib/manifoldCAD.js`],
])

const PREFIX_CDN = new Map<string, string>([
  ['three/', `${CDN_BASE}/three@${THREE_VERSION}/`],
])

function cdnExternalPlugin(): Plugin {
  return {
    name: 'cdn-external',
    resolveId(source) {
      const exact = EXACT_CDN.get(source)
      if (exact) return { id: exact, external: true }
      for (const [prefix, base] of PREFIX_CDN) {
        if (source.startsWith(prefix)) {
          return { id: base + source.slice(prefix.length), external: true }
        }
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [cdnExternalPlugin()],
  build: {
    target: 'esnext',
    rollupOptions: {
      external: [/^three(\/|$)/, /^manifold-3d(\/|$)/],
    },
  },
  optimizeDeps: {
    exclude: ['three', 'manifold-3d'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  server: {
    port: 3000,
    open: true,
  },
})