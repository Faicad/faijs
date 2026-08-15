import { defineConfig, type Plugin } from 'vite'

// ── CDN externalization (build only) ──
//
// 开发（dev）走本地 node_modules：three.js、manifold-3d 与 occt-wasm
// 由 vite 正常解析/预打包，不经过本插件。
// 发布（build）走 CDN：rollup 将上述包及其子路径保持为裸导入，
// 运行时由 index.html 中的 <script type="importmap"> 解析到 jsdelivr。
//
// 版本必须与 package.json 中的实际依赖版本一致。
const CDN_BASE = 'https://cdn.jsdelivr.net/npm'

const THREE_VERSION = '0.184.0'
const MANIFOLD_VERSION = '3.5.1'
const OCCT_VERSION = '3.7.0'

const EXACT_CDN = new Map<string, string>([
  ['three', `${CDN_BASE}/three@${THREE_VERSION}/build/three.module.js`],
  ['manifold-3d', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/manifold.js`],
  ['manifold-3d/manifold', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/manifold.js`],
  ['manifold-3d/manifold.js', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/manifold.js`],
  ['manifold-3d/manifoldCAD', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/lib/manifoldCAD.js`],
  ['manifold-3d/manifoldCAD.js', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/lib/manifoldCAD.js`],
  ['occt-wasm', `${CDN_BASE}/occt-wasm@${OCCT_VERSION}/dist/index.js`],
])

const PREFIX_CDN = new Map<string, string>([
  ['three/', `${CDN_BASE}/three@${THREE_VERSION}/`],
  ['manifold-3d/', `${CDN_BASE}/manifold-3d@${MANIFOLD_VERSION}/`],
  ['occt-wasm/', `${CDN_BASE}/occt-wasm@${OCCT_VERSION}/`],
])

function cdnExternalPlugin(): Plugin {
  return {
    name: 'cdn-external',
    // 仅 build 生效；dev 走本地依赖（vite 预打包）
    apply: 'build',
    // vite 6 内置 vite:resolve 在用户插件之前执行，
    // 必须 enforce: 'pre' 才能先于它拦截裸导入
    enforce: 'pre',
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
  resolve: {
    // faijs（junction 链接到仓库根）与 demo 各声明了一份 occt-wasm / manifold-3d，
    // 强制解析到同一实例：
    // - occt-wasm：避免产物中出现两份 wasm
    // - manifold-3d：demo 调用 setWasmUrl 必须作用于 faijs 加载的同一模块实例，
    //   否则 manifoldCAD 仍用 import.meta.url 定位 wasm（.vite/deps → 404 HTML）
    dedupe: ['occt-wasm', 'manifold-3d'],
  },
  plugins: [cdnExternalPlugin()],
  optimizeDeps: {
    // manifold-3d 的 manifoldCAD.js 使用 Top-level await，
    // esbuild 预打包需 esnext target
    esbuildOptions: {
      target: 'esnext',
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      external: [/^three(\/|$)/, /^manifold-3d(\/|$)/, /^occt-wasm(\/|$)/],
    },
  },
  server: {
    // 避免占用常见端口（3000/5173 等）
    port: 8899,
    open: true,
    // manifold-3d 由 @faicad/faijs（junction → faijs 根）解析，
    // 源文件位于 faijs/node_modules，需允许访问上一级
    fs: { allow: ['..'] },
  },
})