import { defineConfig, type Plugin } from 'vite'
import { createRequire } from 'node:module'
import { createReadStream, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

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
const OCCT_VERSION = '3.8.4'

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

// ── WASM assets（dev 中间件 + build 拷贝） ──
//
// dev：在 `${base}wasm/<file>` 下 serve occt-wasm.wasm / manifold.wasm
//（路径经 createRequire 解析，与 node_modules 物理位置/cwd/linker 无关）。
// build：writeBundle 时把 wasm 拷进 dist/wasm/。
// main.ts 的 dev 分支已改为 '/wasm/occt-wasm.wasm' / '/wasm/manifold.wasm'（P-0）。
const require_ = createRequire(import.meta.url)

function wasmFileMap(): Record<string, string> {
  const occtDir = dirname(require_.resolve('occt-wasm/dist/occt-wasm.js'))
  const manifoldDir = dirname(require_.resolve('manifold-3d/manifold.js'))
  return {
    'occt-wasm.wasm': resolve(occtDir, 'occt-wasm.wasm'),
    'manifold.wasm': resolve(manifoldDir, 'manifold.wasm'),
  }
}

function wasmAssets(): Plugin {
  const files = wasmFileMap()
  return {
    name: 'wasm-assets',
    configureServer(server) {
      server.middlewares.use('/wasm', (req, res, next) => {
        const filePath = files[(req.url?.slice(1) ?? '')]
        if (!filePath || !existsSync(filePath)) return next()
        res.setHeader('Content-Type', 'application/wasm')
        createReadStream(filePath).pipe(res)
      })
    },
    writeBundle({ dir }) {
      if (!dir) return
      const out = resolve(dir, 'wasm')
      mkdirSync(out, { recursive: true })
      for (const [file, src] of Object.entries(files)) {
        if (existsSync(src)) copyFileSync(src, resolve(out, file))
      }
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
    // M7：免打包联动——@faicad/faijs（及 core）解析到活源码，不经 dist。
    // 前缀匹配（@rollup/plugin-alias）：'@faicad/faijs/browser' → ../../src/browser.ts，
    // '@faicad/faijs-core/browser' → ../core/src/browser.ts。
    alias: [
      { find: '@faicad/faijs-core', replacement: resolve(__dirname, '../core/src') },
      { find: '@faicad/faijs', replacement: resolve(__dirname, '../../src') },
      // P 三/四：gear-lib 经 alias 落位活源码，浏览器的静态 LIB_MODULES import 才能打包；
      // dev 与 build（rollup）一致生效。
      { find: '@faicad/gear-lib-demo', replacement: resolve(__dirname, '../gear-lib-demo/src/index.ts') },
      // sheetmetal：与 gear-lib-demo 同理，经 alias 落位活源码。
      { find: '@faicad/sheetmetal', replacement: resolve(__dirname, '../sheetmetal/src/index.ts') },
    ],
  },
  plugins: [cdnExternalPlugin(), wasmAssets()],
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
    // 源码包不预打包（预打包会编译成冻结快照，改动不再生效 → M7 失效）；
    // Emscripten glue 经 esbuild 预打包会损坏 wasm import 对象（brepjs 同款）。
    exclude: ['@faicad/faijs/browser', 'occt-wasm', 'manifold-3d'],
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
    // workspace 包是 node_modules 下的 symlink，Vite 默认忽略 node_modules；
    // 必须显式反选才能对引擎源码改动触发 HMR（M7）。
    watch: {
      ignored: ['!**/node_modules/@faicad/**'],
    },
  },
})