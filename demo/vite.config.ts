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
  ['occt-wasm', `${CDN_BASE}/occt-wasm@${OCCT_VERSION}/dist/index.js`],
])

const PREFIX_CDN = new Map<string, string>([
  ['three/', `${CDN_BASE}/three@${THREE_VERSION}/`],
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
    // faijs 以 npm pack tarball 安装（demo/node_modules/@faicad/faijs），
    // 其 dist 与 demo 各声明了一份 occt-wasm，强制解析到同一实例：
    // 避免产物中出现两份 wasm。
    // （manifold-3d 不再需要 dedupe：demo 不再直接 import 它，
    //  仅 faijs 经 loader 根裸导入，Workder/Inline 后端共用。）
    dedupe: ['occt-wasm'],
  },
  plugins: [cdnExternalPlugin()],
  // Worker 后端（csg-worker/sdf-worker）打包为 ES module worker。
  // 实测：vite 将 manifold-3d（loader 的根裸导入）内联进 worker 图
  // （zero 静态导入，内联安全），worker chunk 内无裸 specifier，
  // 不依赖 module worker 是否继承文档 importmap；主 bundle 的
  // inline 回退路径保留裸 import("manifold-3d")，仍走 importmap → CDN。
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // dev 预打包 target 沿用 esnext：此前的 manifoldCAD.js 有顶层 await，
    // esbuild 默认 target 会报错；如今已不加载 manifoldCAD，保留无害
    //（build target 同为 esnext，不构成差异）。
    esbuildOptions: {
      target: 'esnext',
    },
    // faijs 的 worker 后端以相对 URL 建 Worker（new URL('./sdf-worker.js', import.meta.url)），
    // esbuild 预打包不会把包内相对 worker 文件发射到 .vite/deps/，dev 下会报
    // "The file does not exist at .../sdf-worker.js?worker_file&type=module"。
    // exclude 后 faijs 按源码模块直接 serve，worker URL 解析到真实文件；
    // build（Rollup）不读 optimizeDeps，产物不受影响。
    exclude: ['@faicad/faijs/browser'],
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
  },
})