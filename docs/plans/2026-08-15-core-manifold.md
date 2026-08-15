# 方案：剔除 manifoldCAD，直接使用核心 manifold.js

> 日期：2026-08-15
> 背景：demo 的 build 产物（vite preview）暴露 importmap 闭包问题——faijs 只用 manifold-3d 的几何核心，却被迫整体加载 manifoldCAD，背下整个 GLTF/3MF/材质/动画模块图（~20 个传递依赖包），每条都要手写进 importmap 且版本必须与 node_modules 同步。

## 1. 动机：现状的四重代价

| # | 代价 | 说明 |
|---|---|---|
| 1 | importmap 20+ 条手写映射 | @gltf-transform×3、ktx-parse、ndarray 全家、@jridgewell×3、convert-source-map、fast-xml-parser、fflate、@jscadui/3mf-export、property-graph；缺一条就静默崩 UI，版本漂移无保护 |
| 2 | 加载性能 | 每页额外拉 ~20 个 CDN 模块 + 2 个 jsdelivr `+esm` 转换产物（ndarray/ndarray-ops 是 2014 年 CJS 包，靠 +esm 运行时转换） |
| 3 | wasm 模块身份共享 | `setWasmUrl` 必须作用于与 manifoldCAD **同一份** `wasm.js` 模块实例，否则 wasm 定位失效——vite `dedupe` 注释与 importmap 前缀都是为了迁就这一点 |
| 4 | dev/build 行为不对称 | dev 走 node_modules 全量解析，build 走 CDN 闭包；预览环境是唯一暴露点，测试必须单开一套 preview e2e 才兜得住 |

## 2. 可行性核验（已完成）

- **API 覆盖**：核心 `manifold.js` 暴露 `Module.Mesh / Module.Manifold / Module.CrossSection / Module.triangulate`，且 `Module.Manifold.levelSet` 静态方法存在（manifold.d.ts:645，faijs 的 SDF 链路依赖它）。注意：`Module.ManifoldError` **仅运行时存在**（manifold.js 内部 warp/warpBatch 使用），manifold.d.ts 的 `ManifoldToplevel`（1250 行）不含它、也无任何导出声明——faijs 从未使用，可忽略。
- **faijs 实际用量**（全量清点）：运行时动态 import 收敛为 **1 处**——`manifold-loader.ts:35`（§3.1 新建；`inline-csg-backend.ts`/`inline-sdf-backend.ts` 与 Worker 后端全部经 `getManifoldModule()` 间接取用）；类型引用 4 处——`inline-csg-backend.ts:23`、`inline-sdf-backend.ts:15`（两处 `ManifoldMod` 别名）、`sdf-core.ts:83`、`csg-core.ts:24-25`；测试 1 文件 3 处——`csg-dovetail-curved.test.ts:52`（运行时 import）、`136-137`（类型）。全部落在核心 API 上（union/subtract/intersect/levelSet/Mesh/triangulate），**未使用** scene builder、材质、GLTF/3MF 导入导出、动画。
- **wasm 加载机制等价**：manifoldCAD 内部就是 `Module({ locateFile: () => wasmUrl })` + `module.setup()`（lib/wasm.js `instantiateManifold`），faijs 可原样复刻这 3 行。
- **类型声明完备**：包根 `manifold.d.ts`（1636 行，"core WASM bindings with no frills"）`export default Module` + 具名类声明；faijs 已用 `import type { Manifold } from 'manifold-3d/manifold'`（sdf-core.ts:11）。
- **自包含**：`manifold.js` 单文件（2 行），零静态导入 → importmap 只需一条 `manifold-3d` 精确映射，`manifold-3d/` 前缀与全部闭包条目都可删除。

## 3. 目标架构

### 3.1 faijs 侧：新增 `src/mesh/manifold-loader.ts`

```ts
// 伪代码——接口与现在 demo 的调用方式保持兼容
let wasmUrl: string | undefined
let manifoldPromise: Promise<ManifoldModule> | null

export function setManifoldWasmUrl(url: string): void { wasmUrl = url }
export function getManifoldWasmUrl(): string | undefined { return wasmUrl }

export async function getManifoldModule(): Promise<ManifoldModule> {
  if (!manifoldPromise) {
    manifoldPromise = import('manifold-3d').then(async (m) => {
      const mod = await m.default(wasmUrl ? { locateFile: () => wasmUrl } : undefined)
      mod.setup() // 与 manifold-3d lib/wasm.js 的 instantiateManifold 一致，必须调用
      return mod
    })
  }
  return manifoldPromise
}
```

> **必须用根裸导入 `import('manifold-3d')`，不能写成 `manifold-3d/manifold`。** 三个解析出口恰好都指向同一个 `manifold.js`：Node 的 `package.json main`、exports 的 `"."` 子路径（types 同指向 `manifold.d.ts`）、importmap 的精确键 `manifold-3d`。反之子路径导入在 build 产物里需要 importmap 提供 `manifold-3d/manifold` 精确键（见 §3.3 警示），否则以 "Failed to resolve module specifier" 复现本方案要消灭的 bug。

> 附加说明：`getManifoldWasmUrl()` 是 Worker 后端（§3.5）的握手数据源——worker 与主线程是不同的 JS realm，主线程模块级的 wasmUrl 状态必须经 postMessage 传给 worker。

- 类型：`ManifoldModule` = `ManifoldToplevel`——manifold.d.ts:1250 已为 `default Module()` 声明返回类型（含 `Manifold`/`Mesh`/`CrossSection`/`triangulate`/`setup`），**无需运行时断言**；若想要更可读的 wasm 加载失败报错可另加断言（demo 对 OcctKernel 有同款先例）。`setManifoldWasmUrl` 须在首次 `getManifoldModule()` 之前调用（与官方 `getManifoldModule` 缓存语义一致）。
- 该 loader 同时服务浏览器与 Node（node-host 链路同样受益）。

### 3.2 替换点

| 文件 | 现在 | 改后 |
|---|---|---|
| `src/browser-host/inline-csg-backend.ts:23,29` | `type ManifoldMod = typeof import('manifold-3d/manifoldCAD')`；`import('manifold-3d/manifoldCAD')` | 运行时改经 `getManifoldModule()`；`ManifoldMod` 类型改 `ManifoldToplevel` |
| `src/browser-host/inline-sdf-backend.ts:15,21` | 同上 | 同上 |
| `src/boolean/csg-core.ts:24-25` | `typeof import('...manifoldCAD').Manifold/Mesh` | `typeof import('manifold-3d/manifold').Manifold/Mesh`（类型，`manifold-3d` 根导入的 types 同源） |
| `src/sdf/sdf-core.ts:83` | `typeof import('...manifoldCAD').Manifold` | `typeof import('manifold-3d/manifold').Manifold`（类型） |
| `src/boolean/csg-dovetail-curved.test.ts:52,136-137` | `import('manifold-3d/manifoldCAD')` ×1 + 类型 ×2 | 类型改 `manifold-3d/manifold`；运行时改经 loader（与生产一致） |
| `src/browser.ts` / `src/index.ts`（`src/node.ts` 可选） | 无导出 | **导出 `setManifoldWasmUrl` / `getManifoldWasmUrl` / `getManifoldModule`**——demo 从 `@faicad/faijs/browser` 导入的前提，缺此步 main.ts 换导入无法编译 |
| 注释（`csg-core.ts:8`、`sdf-core.ts:8`、`inline-csg-backend.ts:8`、`demo/main.ts:424-426`） | 提及 manifoldCAD | 顺带清理 |

### 3.5 Worker 后端（随本方案一并实施）

浏览器端 manifold 计算**默认移出主线程**（`createBrowserPorts` 无 Web Worker 环境时自动回退 Inline）：

| 文件 | 职责 |
|---|---|
| `src/browser-host/csg-worker.ts` | CSG Worker 入口：init 握手（wasmUrl）→ boolean/splitPlane/splitDovetail/splitDowel/splitStraightTenon |
| `src/browser-host/sdf-worker.ts` | SDF Worker 入口：init 握手 → runSdf |
| `src/browser-host/csg-worker-protocol.ts` / `sdf-worker-protocol.ts` | postMessage 消息类型（id 关联请求/响应） |
| `src/browser-host/worker-csg-backend.ts` / `worker-sdf-backend.ts` | 主线程侧 `new Worker(new URL(...), { type: 'module' })` + 请求配对；提供 `terminate()` |
| `src/browser-host/index.ts` | `CreateBrowserPortsOptions.useWorker`（默认：有 Worker 用 Worker，否则 Inline；显式 true 但无 Worker 抛错） |
| `src/boolean/csg-core.ts` | 新增 `meshToManifold` / `chainBoolean` 共享纯函数——Inline 与 Worker 调用**同一实现**，双后端一致性由构造保证 |

关键点：
- **wasmUrl 握手**：Worker 是独立 JS realm，主线程 loader 的 wasmUrl 状态不可见；后端构造时经 init 消息传递（`getManifoldWasmUrl()`），worker 内再 `setManifoldWasmUrl`。
- **构建行为（已实测）**：vite 把 worker 入口打成独立 chunk（`worker.format: 'es'`），并将 manifold.js **内联进 worker 图**（zero 静态导入，内联安全）——worker chunk 内无裸 `manifold-3d` 导入，天然规避了"module worker 是否继承 importmap"的不确定性；主 bundle 的 inline 回退路径保留裸 `import("manifold-3d")`，仍走 importmap → CDN。
- **Node 侧不动**：node-host 保持 Inline 后端；vitest（Node 无 Worker）自动走 Inline，`index.test.ts` 断言回退行为。
- 消息中的 MeshData（Float32Array/Uint32Array）经结构化克隆传输，暂不启用 transferable（避免转移调用方缓冲的所有权）。

### 3.3 demo 侧

- **main.ts**：删除 `import { setWasmUrl as setManifoldWasmUrl } from 'manifold-3d/lib/wasm.js'`（最初 "Failed to resolve module specifier" 的报错源头；该 import 依赖 `manifold-3d/` 前缀键），改从 `@faicad/faijs/browser` 导入 `setManifoldWasmUrl`；424-426 行注释里 "manifoldCAD" 字样一并清理。
- **index.html importmap**：26 条 → 5 条（删除 21 条：`manifold-3d/manifold`、`manifold-3d/manifold.js`、`manifold-3d/manifoldCAD`、`manifold-3d/manifoldCAD.js`、`manifold-3d/` 前缀 + 16 条传递闭包）：

```json
{
  "three": ".../three@0.184.0/build/three.module.js",
  "three/": ".../three@0.184.0/",
  "manifold-3d": ".../manifold-3d@3.5.1/manifold.js",
  "occt-wasm": ".../occt-wasm@3.7.0/dist/index.js",
  "occt-wasm/": ".../occt-wasm@3.7.0/"
}
```

- **vite.config.ts**：`PREFIX_CDN` 删除 `manifold-3d/`（loader 只用根裸导入，不再有子路径导入）；`EXACT_CDN` 保留 `manifold-3d` 一条（`manifold-3d/manifold`、`manifold-3d/manifoldCAD` 及 `.js` 变体全部删除）。`resolve.dedupe` 中 `manifold-3d` 条目可删（demo 不再直接 import manifold-3d，`occt-wasm` 保留——demo 仍直接 `import { OcctKernel } from 'occt-wasm'`）。rollup `external` 正则 `/^manifold-3d(\/|$)/` 保留（仍拦截误入的子路径）；`optimizeDeps.esbuildOptions.target: 'esnext'` 保留无害（TLA 需求源自 manifoldCAD.js，core manifold.js 无 TLA，但 esnext 对其它依赖不造成问题）。

> ⚠️ **§3.1 的根裸导入是本 importmap 缩到 5 条的前提。** 若有人把 loader 改回子路径 `import('manifold-3d/manifold')`，importmap 必须补精确键 `"manifold-3d/manifold": ".../manifold.js"`（且 EXACT_CDN 同步补回），否则 build 产物在浏览器报 "Failed to resolve module specifier"——正是本方案要消灭的 bug。

### 3.4 测试

- `demo/e2e/preview-cdn.spec.ts`：`REQUIRED_IMPORTMAP_KEYS` 从 22 项缩为 5 项（three、three/、manifold-3d、occt-wasm、occt-wasm/——与 §3.3 完全一致）；wasm 从 CDN 加载 + 无模块解析错误的运行时断言保留（这两条正是 §3.3 importmap 精确性的回归防线，不可删）。preview 模式默认走 Worker 后端，该 e2e 同时是 worker chunk + 内联 manifold + CDN wasm 的集成验证。
- dev e2e 全量回归（默认 Worker 后端）——新增显式本地 wasm 断言（demo.spec.ts：两条链路 wasm 必须从 localhost `/node_modules/...` 加载、不得出现 CDN 请求，与 preview 的 CDN 断言互为正反）；Node 侧 vitest 全量回归（Node 无 Worker → Inline 回退，等价于对 loader 与共享 csg-core 函数的验证）。

## 4. 实施步骤

1. 新增 `src/mesh/manifold-loader.ts`（根裸导入 `manifold-3d`）；替换 2 处运行时 import + 4 处类型 + `csg-dovetail-curved.test.ts` 3 处；从 `src/browser.ts`/`src/index.ts`/`src/node.ts` 导出 loader；`npm run typecheck` + vitest 全量（Node 链路即首次验证 loader）。
2. 新增 Worker 后端（§3.5）：csg-worker/sdf-worker + 协议 + WorkerCsgBackend/WorkerSdfBackend + `useWorker` 选项；csg-core 提取 `meshToManifold`/`chainBoolean` 共享实现；`index.test.ts` 补回退/抛错断言。
3. demo：main.ts 换导入、importmap 瘦身（26→5）、vite.config 删前缀 + `worker: { format: 'es' }`；跑 dev e2e。
4. 跑 preview e2e（importmap 断言同步缩减；worker chunk + CDN wasm 集成验证）；对比 Network 面板请求数/体积（预期 ~25 个模块 → 3 个）。
5. lint + CI 脚本回归。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 核心模块与 manifoldCAD 存在 API 差异 | 已核对 faijs 全部用量落在核心 API（§2 清单为全量）；实施以 vitest 全量回归兜底 |
| 忘记 `module.setup()` 导致类不可用 | loader 内强制调用（与 lib/wasm.js 行为一致） |
| 类型与运行时形态差异 | 类型以 `manifold.d.ts` 的 `ManifoldToplevel` 为准——`default Module()` 返回值已声明该类型，无需断言 |
| loader 被改回子路径导入导致 importmap 缺键 | §3.3 已加警示条目；e2e 的 `REQUIRED_IMPORTMAP_KEYS` 断言兜底 |
| peerDependencies 仍留在 node_modules（@gltf-transform×3、esbuild-wasm 由 npm 自动安装） | 运行时不再加载；本方案剔除的是**运行时模块图**，不是依赖树；物理移除需处理 manifold-3d 的 peer 声明，不在范围内 |
| worker/bundler 路径（esbuild-wasm 等）不再可用 | faijs 从未使用（已核实 src 无任何引用）；明确不在范围内 |
| 未来需要 GLTF/3MF 导入导出 | 按需独立引入（如 @gltf-transform 单独依赖），不再隐式背包 |

## 6. 明确不做

- 不使用 manifoldCAD 的 scene builder / 材质 / 动画 / GLTF/3MF 导入导出
- 不引入 **manifold 官方 worker 管线**（`lib/worker.js` + `dist/worker.bundled.js` + esbuild-wasm bundler，会重新膨胀 importmap）——worker 能力由 faijs 自建后端（§3.5，复用 csg-core 纯函数）承担，与官方管线无关
- 不改变 wasm 二进制来源策略（dev 本地 / build CDN，由 `setManifoldWasmUrl` 单一挂点控制，Worker 经 init 握手继承同一挂点）
