# 把 sketch、faijs-extra 收入 core，并删除 draw — 变更实施方案

- 日期：2026-10-13
- 状态：已落地
- 影响范围：`packages/core`（@faicad/faijs）、`packages/sketch`（@faicad/faijs-sketch，删除）、`packages/faijs-extra`（@faicad/faijs-extra，删除）、`packages/draw`（@faicad/faijs-draw，删除）；根构建/发布/CI 脚本；monorepo 内测试；9 个下游仓库（3d_editor、3d_viewer_web、3d_viewer_electron、faijs-cadquery、faijs-freecad、faijs-openscad、fcstd-port、__convtest，以及 3d_viewer_tauri/cadquery-port 复核）
- 前置决策（用户已定）：**零兼容，一次性改完**——不保留转发壳、不保留旧包名、不保留旧子路径；**draw 包一并删除**

---

## 0. 需求原文（逐字）

> 请写一份完整的计划方案，我需要把sketch和faijs-extra两个子包收入core中。因为它们也是注入cad空间，如果不纳入core，则宿主端忘记装配了就导致faijs执行失败。而faijs全平台一致性是第一位的，首要满足的。请完整分析本项目的代码、部署脚本、测试，其它依赖这两个包的项目如../3d_editor，../faijs-*的几个项目，完整写出变更实施方案

> 首先，不考虑任何兼容性。这次的任务要一次性改完。其次，你的方案里要分析为何有这样的问题，未来包的重构，要如何避免更改依赖的第三方。

> 引擎自己组装 cad 面，这个可以。但是宿主应该仍然可以组装第三方包。cad门面必须内置且不允许宿主修改。
> packages/faijs-extra→core/src/extra，路径也对应修改。
> 请更新方案。

> 1. 不清楚你的意思，请说明清楚，我再选择
> 2. 公开发布
> 3. 只有一个cad保留名字
> 4. 你自己决定最合适的方案
> 5. `packages/draw`删除，一起删除。

---

## 1. 结论摘要

把 `packages/sketch`、`packages/faijs-extra` 的源码并入 `packages/core`（落点 `core/src/sketch`、`core/src/extra`），**删除 draw 包**，删除这三个包的全部旧子路径；把 sketch/extra 的 op 并入 `core` 的 `createApiNamespace()`。`createRuntime(ports)` 成为**唯一 cad 装配点**：**内置 cad 面、完整、且宿主不得修改**（`cad` 是**唯一**的保留绑定名，注册/覆盖均被拒绝）；宿主**仍可注册任意第三方库**，并只提供环境能力（ports / wasm 源）。"cad 面完整性"与"cad 不可被宿主修改"由 CI 守卫钉死，未来任何内部目录/包重排都不得改变下游可见的子路径契约。

| 项 | 现状 | 目标 |
|---|---|---|
| cad 面装配 | 三处：`createRuntime` 只装平台面；sketch、extra 各自 merge + register + install，宿主可覆盖 cad | 单处：`createRuntime` 内置全量 cad 面 |
| cad 面的可变性 | 宿主可 `registerLib('cad', …)` 覆盖；`libs.cad` 可替换引擎内置 | `cad` 为**唯一**保留绑定名，二次注册/覆盖一律拒绝 |
| 第三方库 | 宿主可注册（`registerLib` / `libs`） | **不变**：宿主仍可注册任意第三方库 |
| 可发布包数量 | core + sketch + extra + draw(private) + viewer + cq-compat-compare + gears + fasteners + sheetmetal | 去掉 sketch、extra、draw |
| 旧子路径 | `@faicad/faijs-extra`、`/browser`、`/editor-ops`、`@faicad/faijs-sketch`、`/node`、`@faicad/faijs-draw` | 删除，改为 `@faicad/faijs/{sketch,sketch/node,extra,extra/browser,extra/editor-ops}`；draw 无替代（能力废弃） |
| 编辑器 op 发包 | 独立包 `@faicad/faijs-extra` | core 子路径 `@faicad/faijs/extra`（**公开发布**） |
| 宿主装配代码 | 每宿主各写一遍（web/electron/weapp + viewer + freecad + fcstd-port） | 宿主零 cad 装配（只传 ports 与 wasm 源） |
| 全平台一致性 | 依赖每个宿主的装配都写对 | 由引擎单点保证，守卫钉死 |

---

## 2. 现状（本仓磁盘实测，2026-10-13）

### 2.1 三个装配点

**核心事实：cad 命名空间是宿主在运行时注册的一个库**（`registerLib('cad', ns, { default: true })`），`core` 只在 `createRuntime` 里自动注册平台面（`packages/core/src/cad-runtime/runtime.ts:1841`）：

```ts
export function createRuntime(ports, mode?, libs?, options?): CadRuntime {
  const rt = new CadRuntime(ports, mode, libs, options)
  if (!libs?.cad) {
    rt.registerLib('cad', createApiNamespace(), { default: true, packageName: '@faicad/faijs' })
  }
  return rt
}
```

注意两处"可被宿主改写"的设计：`if (!libs?.cad)` 允许宿主用 `libs.cad` 替换内置 cad；`registerLib` 允许宿主再次以 `'cad'` 为名注册来覆盖（3d_editor 的 web/electron 宿主就是这么做的）。

平台面由 `packages/core/src/api/api-namespace.ts:138` 的 `createApiNamespace()` 手写字面量给出（box / union / extrude / … 以及 `...scriptFaceOps`）。

**sketch**（`packages/sketch/src/namespace.ts`）导出 `createSketchNamespace()` / `mergeSketchNamespace(platform)` / `createSketchCadNamespace()` / `registerSketchSymbols()` / `installSketchSolver(factory)`，宿主须自己：

```ts
const rt = createRuntime(ports, mode)
rt.registerLib('cad', createSketchCadNamespace(), { default: true })    // ① 覆盖注册
registerSketchSymbols()                                                 // ② 静态符号
installSketchSolver(createNodePlanegcsSolver)                           // ③ 注入求解器
```

**faijs-extra**（`packages/faijs-extra/src/namespace.ts`）同形态，导出 `createEditorNamespace()` / `mergeEditorNamespace` / `createEditorCadNamespace()` / `registerEditorSymbols()` / `installEditorMeshProviders()`，宿主须：

```ts
rt.registerLib('cad', createEditorCadNamespace(), { default: true })
registerEditorSymbols()
installEditorMeshProviders()   // cad.engrave 的 mesh 装饰 provider
```

`installSketchSolver` 与 `installEditorMeshProviders` 都是**模块级全局副作用**（`packages/sketch/src/op.ts:73` 的 `let solverFactory`；`packages/core/src/mesh/decoration-provider.ts:43` 的 `let provider`）。

### 2.1b core 既有 wasm 装载模式（planegcs 应对齐的参照系）

core 已有三个 wasm 装载点，同构地遵循"`setXxxWasmInitFn` 宿主注入 + `initXxx()` 内部三段式 + globalThis 共享"模式：

| wasm | 注入 API | 初始化 API | 三段式（注入优先 → Node 自动 → 否则报错） | 共享状态 |
|---|---|---|---|---|
| occt-wasm | `setOcctWasmInitFn(fn)` (`occtKernel.ts:99`) | `initOcctWasm()` (`:142-178`) | ① `customInitFn` ② Node 经 `resolveOcctWasmPath()` (`:121`) 从 node_modules 读 ③ 报错 "no init function set and not in Node environment. Call setOcctWasmInitFn() first." | `getOcctKernelSharedState()` (globalThis) |
| brepkit2-wasm | `setBrepkitWasmInitFn(fn)` (`brepkitWasm.ts:67`) | `initBrepkitWasm()` (`:78-102`) | ① `customInitFn` ② Node `import('@faicad/brepkit2-wasm')` ③ 同款报错 | `getBrepkitKernelSharedState()` (globalThis, `:58`) |
| manifold-3d | `setManifoldWasmUrl(url)` (`manifold-loader.ts:31`) | `getManifoldModule()` (`:51-59`) | `import('manifold-3d')` + `locateFile: () => url`（manifold 自带 ESM loader，Node 端无需注入） | 模块级 `manifoldPromise`（manifold 差异：纯 ESM 自带 loader，仅 browser 需 setUrl） |

**对照结论**：sketch 的 `installSketchSolver(factory)`（`packages/sketch/src/op.ts:73` 的模块级 `let solverFactory`）是这个模式的**半成品**——有注入、缺 Node 兜底、模块级而非 globalThis（CDN 外部化多实例会断）。这正是"宿主忘装配就失败"的根源之一，也是 §6.3(a) 改造的参照系。planegcs 的 wasm 位置问题与 occt-wasm / brepkit2-wasm 是**同一个问题**（宿主知道 browser 端 wasm 在哪、Node 端可自动），应沿用同一答案，不另发明 `HostPorts.assets` 资源键或新 `createRuntime` 选项。

### 2.2 包的公开导入契约（下游硬编码的字符串）

- `packages/sketch/package.json:22-39`：`"."`、`"./node"`、`"./canonical"`、`"./*"`
- `packages/faijs-extra/package.json:22-35`：`"."`、`"./browser"`、`"./editor-ops"`
- `packages/draw/package.json:22-27`：`"."`（`private: true`，description 自述 **DEPRECATED — superseded by `cad.sketchOnPlane` / `cad.profile`**）

`./editor-ops` 的存在理由是"不把 `three/examples` 的 `SVGLoader` 与 `Shape`/`ExtrudeGeometry` 链打进小程序 worker"（`packages/faijs-extra/src/editor-ops.ts:1-14`、`packages/faijs-extra/test/entry-boundary.test.ts:69-91`）。注意：2026-10-11 的 core/extra 去 three 后，extra 的 package.json 已无 `three` 依赖、src 中也无 `from 'three'` 导入，该"依赖闭包差异"只剩 `opentype.js` + 文字/SVG 几何生成链这一层，且 `entry-boundary.test.ts:82-85` 仍断言全入口命中 `SVGLoader`——**该测试与现状矛盾，属过时项，本次一并处理**。

### 2.3 装配"三件套"与宿主实现

一致性与正确性要求宿主完成三件事（`packages/faijs-extra/src/namespace.ts:1-31`、`packages/sketch/src/namespace.ts:1-19`、`packages/core/test/support/editor-ops.ts`、`packages/tests/faijs/_support/editor-runtime.ts` 都把这三件事复述了一遍）：

1. `registerLib('cad', <platform ∪ sketch ∪ extra>)` —— 让 `cad.sketch` / `cad.fai_drill` 等可被解析；
2. `register*Symbols()` —— 让静态分析（`SYMBOL_TABLE`）认识这些 op 名；
3. `installSketchSolver()` / `installEditorMeshProviders()` —— 让求值与 mesh 装饰可用。

遗漏任一项的后果：第 1 项缺失 → `.fai.js` 里 `cad.sketch(...)` 在 `check()` 报"函数不存在"或运行时报未定义；第 2 项缺失 → fcstd 边界守卫等静态分析误判；第 3 项缺失 → `cad.sketch` 抛 `E_SKETCHC_NO_SOLVER`、`cad.engrave` mesh 路径抛"no mesh decoration provider installed"（`packages/core/src/mesh/engrave.ts:40-48`）。

### 2.4 符号表与守卫链

- 生成文件 `packages/core/src/lang/symbol-table.generated.ts` 由 `packages/core/scripts/gen-symbol-table.ts` 从 **`createApiNamespace()` 返回对象字面量**（AST 识别简写/属性赋值）**∪ `SCRIPT_FACE_OPS`** 生成。**关键限制：`discoverCadNamespaceFunctions()`（同文件 41-83 行）只收集 `ShorthandPropertyAssignment` 与 `PropertyAssignment`，不收集 `SpreadAssignment`（`...x`）**。
- `packages/core/test/lang/op-set-consistency.test.ts:39-47` 双向断言：符号表键集 **恰好等于** `Object.keys(createApiNamespace())`（运行时对象，天然含展开键）。
- `packages/core/test/three-surface.test.ts:125-130` 断言 core **不得** import `@faicad/faijs-extra`（防环）。
- `packages/faijs-extra/test/core-surface.test.ts` 反向断言 core 入口**不得**导出 editor op / creator op / 迁移的预览辅助。
- `scripts/check-op-dims.mjs:30-38` 扫描 `core/src/api`、`faijs-extra/src/ops`、`sketch/src`、sheetmetal/**draw**/gears/fasteners 的每个 `defineOp`/`compatOp`，要求 `paramDims`（或 `spec`）——本次要改扫描目录并移除 draw。
- `scripts/check-facade.mjs`：core 门面（index/browser/weapp）只允许 re-export；`package.json` exports 只允许 `./api/*` 一个通配键，其余必须显式枚举；`export function createRuntime` 全仓只能有一处。
- `scripts/api-surface-snapshot.mjs` 对 16 个可整体 import 的子路径做导出面快照，比对入库的 `scripts/api-surface-snapshot.json`。
- `scripts/check-dist-sync.mjs` 构建后比对 `src/lang/symbol-table.generated.ts` 与 `dist` 的键集。

### 2.5 构建 / 发布 / CI 链（需要同步改动的每一点）

- 根 `package.json:26` `build` 显式列包：`core → draw → sketch → extra → viewer → sheetmetal → gears`；`:32` `lint` 列 `core/src`、`faijs-extra/src`、`draw/src`；`:61-74` `workspaces` 含 `packages/sketch`、`packages/faijs-extra`、`packages/draw`。
- `scripts/ci.ps1`：`:72-83` build；`:104` `$testPackages` 含 sketch、extra、**draw**；`:158-166` 单独跑 `npm run test:install -w @faicad/faijs-sketch`（发布态冒烟）；`:177` `madge` 含 `packages/faijs-extra/src`；`:206` API 覆盖门禁逐包跑，含 `faijs-extra`、`sketch`、**draw**。
- `scripts/check-workspaces-order.mjs`：断言 workspaces 顺序 == 依赖拓扑。
- `scripts/check-lockstep.mjs` + `scripts/lockstep-lib.mjs`：家族成员 = `packages/*` 下非 private 的 `@faicad/*`；`FAMILY_EXCLUDE`（`lockstep-lib.mjs:31-37`）已含 `@faicad/faijs-draw`（注释"slated for deletion"）；`cdn/versions.json` 由 `scripts/gen-importmap.mjs` 生成，当前 8 条 pin（含 sketch、extra，不含 private 的 draw）。
- `scripts/publish-all.ps1:81-91` `$Packages` 显式含 sketch、extra、draw；`:11-12` 注释描述 publish scope。
- `packages/sketch/test/install-smoke.test.ts`：打包 core + sketch 到临时目录、安装并跑端到端（发布态陷阱守卫），入口 `packages/sketch/vitest.install.config.ts`。

### 2.6 下游使用方（精确）

| 仓库 | 依赖声明 | 源码 import | 说明 |
|---|---|---|---|
| 3d_editor | `file:` tgz，根 + app + platform + weapp 四份 | 83 处（下文清单） | 主消费者，三个宿主 |
| 3d_viewer_web | `file:` tgz 0.32.3 | 83 处（与 3d_editor 同源副本） | 旧副本，同改 |
| 3d_viewer_electron | `^0.29.3`（registry） | 源码 0（经 `@faicad/faijs-viewer` 间接） | 只需改 package.json + lock |
| faijs-cadquery | `^0.33.0` peer | `src/assembly/assembly.ts:31`（extra/editor-ops）、`src/sketch.ts:26,29`（sketch） | 独立仓库 |
| faijs-freecad | `^0.32.0` | 67 处 sketch（scripts/* + src/*），并对部分符号对外 re-export | 独立仓库 |
| faijs-openscad | optional peer `^0.32.0` | 1 处注释；运行时经客户端字符串判断 extra 可用性 | 独立仓库 |
| fcstd-port | `file:` tgz 0.27.0（sketch + **draw**） | `tools/lib/cad-namespace.ts:36,37`（sketch、sketch/node）、`:38`（`mergeDrawNamespace`/`registerDrawSymbols`） | 独立仓库；**有 draw 消费者** |
| __convtest | `file:` tgz 0.29.1（sketch + **draw**） | 0 处源码 | 仅 package.json |
| 3d_viewer_tauri / cadquery-port / 3d_viewer | 无 | 0 | 无需改 |

3d_editor 关键装配与 import（本次要改的核心）：

- `packages/platform/src/web/faijs.worker.ts:16-30`：`createRuntime` + `@faicad/faijs-sketch` + `@faicad/faijs-extra/browser` 的三件套装配。
- `packages/platform/src/electron/execution-process.ts:36,41`：同形态（Node 侧）。
- `packages/platform/src/weapp/faijs.worker.ts:21-40`：`@faicad/faijs/weapp` + `@faicad/faijs-extra/editor-ops`（A 组）+ `@faicad/faijs-extra` 的 `text`（B 组单个 op）+ `@faicad/faijs-sketch`（仅类型）。
- `packages/platform/src/execution/sketch-host.ts:21-29`：共用草图装配模块（刻意不 import 编辑器库，底座命名空间由参数传入）。
- `packages/platform/src/memory.ts:22`、`packages/platform/src/sketch-events.ts:10`、`packages/platform/src/web/asset-urls.ts`（含 `planegcsWasmUrl`）。
- app 侧草图 UI：`stores/tools/sketch-{constraints,draft,draw-machine,shape-fixtures,snap,statement,store}.ts`、`engine/sketch/{sketch-solve,solve-status}.ts`、`components/panels/SketchAnnotationsOverlay.tsx`、`components/renderers/SketchProfileLayer.tsx`、`features/reproject-to-units.ts`。
- app 侧 extra（文字/SVG 预览辅助）：`engine/components/engraving/EngravingCore.ts:21,24`、`EngravingPreviewLayer.tsx:23`、`engine/primitives/svg-extrude/index.ts:13,14`、`engine/primitives/text/TextDialog.tsx:13`、`engine/script-engine/faijs-test-harness.ts:24`、`ai/__integration__/box-drill.live.e2e.ts:31`。
- weapp 构建/审计：`packages/weapp/scripts/build.mjs`、`packages/weapp/scripts/audit.mjs`、`packages/weapp/src/core/sketch.ts`、`packages/weapp/src/worker/planegcs.ts:23`。
- `packages/web/vite.config.ts`。

### 2.7 draw 包现状（本次一并删除）

- `packages/draw/package.json`：`private: true`、`version 0.33.2`（落后家族线 0.33.4，因 private 不参与 lockstep）、description 自述 **DEPRECATED**，能力已被 `cad.sketchOnPlane` / `cad.profile` 取代。
- 源码 `packages/draw/src/**`：`draw.ts`、`drawing-factories.ts`、`namespace.ts`、`projection.ts`、`ops/{polygon2d,offset,boolean,boolean-union,custom-corners,svg}.ts`；测试 `test/{draw,namespace,projection}.test.ts` + `test/ops/`。
- 仓内引用：根 `package.json`（build/lint/workspaces）、`scripts/ci.ps1:104,206`、`scripts/check-op-dims.mjs` 的 `SCAN_DIRS`、`scripts/lockstep-lib.mjs:36`（`FAMILY_EXCLUDE`）、`scripts/publish-all.ps1:85`、`scripts/check-lockstep.mjs:60,115`（`--self-test` 合成包集用该名）、`packages/faijs-viewer/src/open-fai-zip.ts:223`（注释）。
- 外部引用：**fcstd-port**（`package.json:33`、`tools/lib/cad-namespace.ts:10,38`、`test/unit/cad-namespace.test.ts:7`）、**__convtest**（`package.json:8`）。
- `core/src` 不依赖 draw（唯一命中是 viewer 的注释）。

---

## 3. 问题根因分析（为何会出这种问题）

### 3.1 直接原因：把"能力归属"实现成了"物理拆包 + 宿主装配"

cad 命名空间是 faijs 的**脚本契约**（`.fai.js` 里写 `cad.<op>`）。D1（2026-09-23）按"依赖闭包差异 + 编辑器专属"把一批 op 从 core 拆到独立包，但**没有把"装配"一起收进引擎**，而是把装配责任转移给宿主。于是同一个 op 同时有了两个身份：脚本面名字（必须在 cad 面）与物理位置（在哪个包），并且"是否在 cad 面"取决于宿主的代码。更糟的是，cad 面本身是**可被宿主覆盖**的——`registerLib('cad', …)` 与 `libs.cad` 两条路径都允许宿主改写引擎内置的 cad，于是"cad 面"根本没有单一权威。

### 3.2 结构性原因：装配是宿主责任，且是一个"三件套"协议

装配不是一次调用，而是 `registerLib` + `register*Symbols` + `install*` 三件必须同时做对的事，分散在不同函数、不同包。系统性后果：

1. **漏做即失败，且失败时机不一致**：少 `registerLib` 是运行期未定义/静态"函数不存在"；少 `register*Symbols` 只在静态分析显现；少 `install*` 在求值时才抛。
2. **每个宿主各写一遍**：3d_editor 的 web/electron/weapp 三个宿主、faijs-viewer、faijs-freecad、fcstd-port、faijs-cadquery 各有一套装配代码（`sketch-host.ts` 就是为了收敛这三处而存在的补丁）。这是 N×3 个可能写错的地方。
3. **一致性只能靠人**：全平台一致（同一份工程脚本在 web/electron/weapp/node 跑出同样结果）本应是引擎保证的，却退化成"每个宿主都记得装配"的纪律问题。

### 3.3 加剧原因：把"体积/依赖差异"也用"包拆分"表达

weapp 不能带某些重链，于是拆出 `./editor-ops` 子入口，并允许宿主"少注册一些 op"。这不仅增加了装配面，更直接**违背全平台一致**：同一个 `.fai.js` 在 weapp 与 web 上 cad 面不同，行为可能不同（`cad.svgExtrude` 在 weapp 是否"存在"取决于宿主注册了什么）。正确做法应是"cad 面契约全平台相同，实现按端能力裁剪/惰性加载"。

### 3.4 为何"包重构会牵动第三方"

因为下游硬编码了**内部物理组织**（包名 + 子路径），而这本应是实现细节：

- 下游 import 的是 `@faicad/faijs-extra/browser`、`@faicad/faijs-sketch/node`、`@faicad/faijs-draw`——这些字符串把"core 内部目录叫什么、op 住在哪个包"泄露成了公开契约；
- 一旦内部把 op 从 A 包搬到 B 包，所有下游跟着改，即使**脚本面语义完全没变**；
- 更糟的是下游还被迫复刻装配逻辑，于是内部结构调整会连带引起下游**行为**改变的风险。

一句话根因：**faijs 把"逻辑分层（脚本面 / 库面 / 能力域）"用了"物理拆包"来实现，又把装配责任下放给宿主、且把 cad 做成可被覆盖，导致内部物理组织成为下游的强制契约、cad 面失去单一权威。**

---

## 4. 设计目标与原则（未来重构如何不再改第三方）

### 4.1 目标

1. **cad 面内置且不可改**：`createRuntime(ports)` 内置完整 cad 面；`cad` 是**唯一**的保留绑定名，宿主既不能替换它，也不能覆盖它。
2. **宿主仍可注册第三方库**：`cad` 之外，宿主可继续用 `registerLib(name, ns)` 或 `createRuntime(…, libs)` 注册任意第三方命名空间——收编的是"cad 面"，不是"宿主注册能力"。
3. **装配单点**：cad 面的装配只有一处（引擎内部），宿主不再组装 cad 的 op 集，只提供环境能力与 wasm 源。
4. **契约稳定**：下游只依赖两类契约——脚本面 `cad.*`，以及**语义化子路径** `@faicad/faijs/<domain>`；目录搬迁/包合并不得改变它们。
5. **全平台一致**：同一 `.fai.js` 在任意宿主的 cad 面与语义一致；端侧差异用构建裁剪/端口表达，不用"少注册 op"表达。

### 4.2 原则（防复发）

1. **cad 面是引擎的保留资产**：`createApiNamespace()` 是 op 归属的唯一权威；`cad` 绑定名由引擎独占持有，任何二次注册/覆盖被拒绝并报错。
2. **一个事实一个家**：op 的归属唯一地是 `createApiNamespace()`；包/子路径只是实现，不是"是否装配"的开关。
3. **装配与能力分离**：引擎负责**组装 cad 面**；宿主负责**提供环境能力**（fs/网络/wasm/font）与**注册第三方库**。两者不交叉。
4. **能力可选性用端口或惰性/构建裁剪表达**：需要"端侧不带某重链"时，让该链的实现经动态 `import()` 或端口进入，使打包器可裁剪；**op 名与语义在任何端都一致**。
5. **对外只发一个包**：monorepo 内可有多个内部目录，但对外只发布 `@faicad/faijs`（外加既有独立家族包 viewer/sheetmetal/gears/fasteners/cq-compat-compare），所有域经子路径暴露。内部拆分/合并对下游零感知。
6. **子路径即稳定契约**：`@faicad/faijs/<domain>` 一旦发布，视为与 `cad.*` 同级的稳定契约；重命名必须走版本迁移，不得默默改。
7. **守卫化**：把"cad 面完整性""cad 不可被宿主修改""装配单点""子路径稳定"都写成 CI 守卫，而不是靠文档纪律（见 6.2、6.6、7.4）。

### 4.3 从"装配三件套"到"单点 + 保留绑定"的机制

| 现状动作 | 合并后 | 说明 |
|---|---|---|
| 宿主 `registerLib('cad', merge(platform, sketch, extra))` | 引擎内部一次性注册 `createApiNamespace()`（已含全部 op）；宿主对 `cad` 的注册被拒绝 | cad 内置、完整、不可改 |
| `libs.cad` 替换内置 cad | 拒绝（报错），而非静默保留 | 见 6.2 保留绑定校验 |
| `register*Symbols()` | 不需要——新 op 直接进生成符号表 | 见 6.6 |
| `installSketchSolver(factory)` | 由 core 按**入口静态确定** wasm 源自动安装；仍可由宿主覆盖（环境能力，非 cad 面） | 见 6.3 / §11 |
| `installEditorMeshProviders()` | 内部化（`cad.engrave` 直接调 core 内实现），删除注入端口 | 见 6.3 |
| 宿主 `registerLib('mylib', ns)` / `libs.mylib` | **不变，继续允许** | 第三方库注册能力保留 |

---

## 5. 目标形态（命名与路径对照）

| 现状 | 目标 | 理由 |
|---|---|---|
| `packages/sketch/src/**` | `packages/core/src/sketch/**` | 收入 core；保留 `sketch` 域命名（语义准确） |
| `packages/faijs-extra/src/**` | `packages/core/src/extra/**` | 收入 core；目录名与包名段一致（`-extra` → `/extra`） |
| `packages/draw/**` | **删除** | DEPRECATED，能力已由 `cad.sketchOnPlane` / `cad.profile` 取代 |
| `@faicad/faijs-sketch` | `@faicad/faijs/sketch` | 子路径契约（公开发布） |
| `@faicad/faijs-sketch/node` | `@faicad/faijs/sketch/node` | 同上（公开发布） |
| `@faicad/faijs-extra` | `@faicad/faijs/extra` | 同上（公开发布） |
| `@faicad/faijs-extra/browser` | `@faicad/faijs/extra/browser` | 同上（公开发布） |
| `@faicad/faijs-extra/editor-ops` | `@faicad/faijs/extra/editor-ops` | 同上（**公开发布**；轻实现闭包入口，语义从"少 op"改为"轻实现闭包"，见 6.4） |
| `@faicad/faijs-draw` | 无替代 | 能力废弃，消费者迁移到 `cad.sketchOnPlane` / `cad.profile` 或放弃 |

命名说明：`extra` 域的 A 组 op 名（`fai_drill`/`fai_extrude`/`fai_split`/`group`/`assembly`/`copy`/`load`）和 B 组（`text`/`svgExtrude`）**一字不改**，`.fai.js` 零迁移。

---

## 6. 变更设计

### 6.1 core 内目录与 op 归属

- 新增 `packages/core/src/sketch/**`：原 sketch 全部源码。跨包 import（`@faicad/faijs/...`、`@faicad/faijs-sketch`）改为 core 内相对路径（`../`）。
- 新增 `packages/core/src/extra/**`：原 faijs-extra 全部源码，同样改为相对路径（原文件大量 `@faicad/faijs/...` 导入，全部降为相对路径）。
- `@salusoft89/planegcs@1.2.0` 从 sketch 的 `dependencies` 迁到 core 的 `dependencies`；`opentype.js` core 已有。
- 删除 `packages/core/src/mesh/decoration-provider.ts` 的注入端口（详见 6.3）。
- `packages/core/src/api/api-namespace.ts`：在 return 字面量中**显式列出**新增的 10 个 op 键（`sketch`、`fai_drill`、`fai_extrude`、`fai_split`、`group`、`assembly`、`copy`、`load`、`text`、`svgExtrude`）。**不要用 `...spread`**（见 6.6）。

### 6.2 装配单点化 + cad 保留绑定（本次硬约束）

**（a）cad 面全量内置。** `createApiNamespace()` 从"平台面"变成"完整 cad 面"（平台 ∪ sketch ∪ extra）。`createRuntime` 内部注册它，宿主 `createRuntime(ports)` 后 `cad.sketch` / `cad.fai_drill` / `cad.text` / `cad.svgExtrude` 开箱可用。

**（b）`cad` 是唯一的保留绑定名，宿主不得修改。** 需要三处收紧（均在 `packages/core/src/cad-runtime/runtime.ts`）：

1. **`libs.cad` 不再被接受**：现状 `if (!libs?.cad)` 允许宿主用 `libs.cad` 替换内置 cad。改为——若 `libs` 含 `cad` 键则**报错**（提示 cad 由引擎内置，第三方库用别的名字），不做静默保留。
2. **`registerLib('cad', …)` 二次注册被拒绝**：`CadRuntime` 维护保留绑定集合，**该集合只含 `'cad'` 一个名字**；引擎内部注册 cad 走一条内部通道，此后任何对 `cad` 的注册/覆盖都抛错（错误信息明确"cad 是引擎内置保留命名空间，宿主不得注册或覆盖"）。
3. **`packageName` 权威化**：内置 cad 的 `packageName` 固定为 `'@faicad/faijs'`，不接受宿主改写。

**（c）宿主仍可注册第三方库。** `registerLib('<other>', ns)` 与 `createRuntime(ports, mode, { myLib: ns })` 全部照旧；只有 `cad` 一个名字被独占（保留集合不加其它名字）。

**（d）`createBareRuntime` 保留但受同一约束**（第 4 项，本方案自行决定）。决定：**保留 `createBareRuntime`**，但**同样禁止注册名为 `cad` 的库**——`cad` 是全局保留名，只能由 `createRuntime` 注入。理由：(1) 它是"只要 parser/runtime 的纯引擎"这一合法场景（测试/工具在用），删除会造成无谓破坏；(2) 保留绑定约束已消除"绕过 cad 权威"的风险，无需再删函数。若某调用方确实需要 cad 面，应改用 `createRuntime`。

**（e）删除 sketch/extra 的宿主装配入口**：`createSketchCadNamespace`、`mergeSketchNamespace`、`createEditorCadNamespace`、`mergeEditorNamespace`、`registerSketchSymbols`、`registerEditorSymbols`、`installEditorMeshProviders` 等。若某函数仍有库作者消费者，保留为语义化内部实现，但不作为"宿主装配入口"暴露。

### 6.3 solver 与 provider 的注入处理

这是全量装配后**唯一残留的环境相关注入**，必须正面设计。要点：**solver/provider 是"环境能力"，不是 cad 面，因此不违反"cad 不可被宿主修改"**。

**(a) planegcs 求解器（`cad.sketch`）**——对齐 core 既有 wasm 装载模式（§2.1b），不另发明机制。现状 `installSketchSolver(factory)`（`packages/sketch/src/op.ts:73` 模块级 `let solverFactory`）是半成品：有注入、缺 Node 兜底、模块级而非 globalThis。改造为与 `setOcctWasmInitFn` / `setBrepkitWasmInitFn` 同构的 `setSketchSolverInitFn` + `initSketchSolver` 三段式：

1. **`setSketchSolverInitFn(fn | null)`**（宿主注入，写入 globalThis 共享挂点）：browser/weapp 宿主在启动期调一次，传入"已知 wasm 位置的 solver factory"。3d_editor 把现有 `planegcsWasmUrl` 三态（dev `/@fs/`、e2e dist、prod jsDelivr，`web/asset-urls.ts:66`）包进 factory 传入；weapp 把 `wasmLoaderPath`（`WXWebAssembly` 代码包路径）包进 factory 传入。
2. **`initSketchSolver()`**（内部三段式，幂等）：① 优先用 globalThis 共享挂点的 `customInitFn`；② Node 环境（`process.versions.node`）自动用 `createNodePlanegcsSolver()`（`require.resolve('@salusoft89/planegcs/package.json')` → `dist/planegcs_dist/planegcs.wasm`，现有 `packages/sketch/src/node.ts` 能力迁入）；③ 非 Node 且未注入 → 抛错 "no sketch solver init function set and not in Node environment. Call setSketchSolverInitFn() first."（与 occt/brepkit 报错文案同款）。
3. **globalThis 共享**：挂点经 `getSketchSolverSharedState()`（`globalThis['__faijs_sketch_solver__']`）共享，CDN 外部化多实例同款生效（与 occt/brepkit 一致）。

`cad.sketch` 的 op 实现体调 `initSketchSolver()` 取 solver（而非读模块级变量）。`installSketchSolver` 保留为 `setSketchSolverInitFn` 的**弃用别名**（一个 release 内删），避免一次性改太多下游。三态（`wasmPath` / `wasmBytes` / `wasmLoaderPath`，`packages/sketch/src/planegcs-backend.ts:57-96`）仍由 `createPlanegcsSolver` 接受，只是"谁来调"从宿主变成引擎内部。

要点：**solver 是"环境能力"，不是 cad 面，因此不违反"cad 不可被宿主修改"**——`setSketchSolverInitFn` 注入的是 wasm 源/装载方式，不是 op 语义。Node 端零装配（自动）；browser/weapp 端宿主只调一次 `setSketchSolverInitFn`（与现有 `setOcctWasmInitFn` / `setBrepkitWasmInitFn` 同形态，不是 cad 装配三件套的一部分）。

**(b) engrave 的 mesh 装饰 provider**——合并后该实现就在 core 内，不再需要宿主注入。设计：删除 `setEngraveDecorationProvider`/`getEngraveDecorationProvider` 端口，`mesh/engrave.ts` 直接调用 core 内的 `createEngraveDecorationProvider()`。删除 `packages/core/src/mesh/decoration-provider.ts`。

### 6.4 能力可选性与全平台一致（weapp 体积）

合并后 `createApiNamespace()` 全量，weapp 若直接 `import createRuntime`，会把文字/SVG 链（opentype + 解析 + 拉伸）静态引入 worker 包。解决方案不是"weapp 少注册 op"，而是**契约全量 + 实现可裁剪**：

- cad 面（op 名、参数、语义）在所有端**完全一致**——全平台一致优先。
- 重实现（`text`/`svgExtrude` 的几何生成）经**动态 `import()`** 进入 op 实现体，使不需要它的宿主在打包时可被裁掉/懒加载；若某端确实无法提供（如无字体端口），op 在**求值时**给出精确错误，而不是"不存在"。
- weapp 现有的 `build.mjs` 桩表 / `audit.mjs` 审计机制继续用于体积验证，但审计对象从"少了哪些 op"改为"哪些重实现闭包未被打进端包"。
- `@faicad/faijs/extra/editor-ops`（原 `/editor-ops`）保留为**轻实现闭包入口**（公开发布），供端侧构建明确引用；它不再意味着"cad 面少 op"。

这条是本次设计的关键：**把"端侧体积"从"装配差异"解耦为"构建裁剪差异"。**

### 6.5 子路径与 API 面

core `package.json` exports 新增（显式枚举，满足 `check-facade`；全部**公开发布**）：

- `./sketch`（原 `@faicad/faijs-sketch` 主入口）
- `./sketch/node`（原 `/node`）
- `./extra`（原 `@faicad/faijs-extra` 主入口）
- `./extra/browser`（原 `/browser`）
- `./extra/editor-ops`（原 `/editor-ops`，公开发布）

`scripts/api-surface-snapshot.mjs` 的 `SUBPATHS` 增加上述可整体 import 的子路径，并重新生成 `scripts/api-surface-snapshot.json`。

### 6.6 符号表生成（必须绕开的陷阱）

`gen-symbol-table.ts` 的 AST 解析**不识别对象字面量里的 spread**。若在 `createApiNamespace()` 里写 `...sketchOps, ...extraOps`：

- 运行时 `Object.keys(createApiNamespace())` **含**新 op → `op-set-consistency.test.ts` 的"符号表 ≡ cad 面"会因符号表**缺键**而失败；
- `gen-symbol-table` 生成的表缺这 10 个键 → `check-dist-sync` 也可能受影响。

两条路：

- **推荐**：在 `createApiNamespace()` 字面量里显式写 10 个 op 名（简写形式），生成器即可自动识别，零生成器改动。
- 备选：改造 `discoverCadNamespaceFunctions()` 支持"展开一个同文件内已知对象字面量"，但复杂且易脆。

方案选推荐路径；并在 `op-set-consistency.test.ts` 增加一条针对新 op 的显式断言（防日后被改成 spread）。

---

## 7. 变更清单

### 7.1 core 源码

| 文件/目录 | 变更 |
|---|---|
| `packages/core/src/sketch/**` | 新增（迁入 `packages/sketch/src`），跨包 import 改相对路径 |
| `packages/core/src/extra/**` | 新增（迁入 `packages/faijs-extra/src`），跨包 import 改相对路径 |
| `packages/core/src/api/api-namespace.ts` | 显式加入 10 个 op 键；更新文件头注释（不再是"平台面 only"） |
| `packages/core/src/api/index.ts` | 按库面策略决定是否 re-export（默认不整批平铺，见既有 DEC-6） |
| `packages/core/src/mesh/engrave.ts` | 直接用 core 内 decoration provider |
| `packages/core/src/mesh/decoration-provider.ts` | 删除（端口内部化） |
| `packages/core/src/sketch/solver-loader.ts`（新增，由 `packages/sketch/src/op.ts` + `node.ts` 改造） | `setSketchSolverInitFn` + `initSketchSolver` 三段式 + globalThis 共享（对齐 occt/brepkit 模式，见 §6.3(a)）；`installSketchSolver` 保留为弃用别名 |
| `packages/core/src/cad-runtime/runtime.ts` | **新增保留绑定校验**：`libs.cad` 报错、`registerLib('cad', …)` 二次注册拒绝（保留集合仅 `cad`）；注释更新为"cad 面内置且不可改，宿主可注册第三方库" |
| `packages/core/src/index.ts` / `browser.ts` / `weapp.ts` | 按需 re-export 新域符号（保持门面只 re-export） |
| `packages/core/package.json` | 新增 `dependencies["@salusoft89/planegcs"]`；新增 5 个子路径 exports |
| `packages/core/tsconfig.json` | 删除 `@faicad/faijs-extra` paths 映射 |
| `packages/core/scripts/gen-l3-surface.ts` / `gen-symbol-table.ts` | 一般不改（走显式列出）；若新增生成能力再评估 |

### 7.2 删除项

- `packages/sketch/**`（整包）
- `packages/faijs-extra/**`（整包）
- `packages/draw/**`（整包：src + test + vitest.config.ts + package.json）
- 根 `package.json`：`workspaces` 去三项、`build` 去三条、`lint` 去 `faijs-extra/src` 与 `draw/src`
- `packages/core/test/support/editor-ops.ts`（core 测试不再需要"装配扩展库"）
- `packages/tests/faijs/_support/editor-runtime.ts` 中的 extra 装配（改为直接用 core 的 `createRuntime`）

### 7.3 根 / 脚本 / CI

| 文件 | 变更 |
|---|---|
| `root package.json` | `workspaces` 去 sketch/faijs-extra/draw；`build` 去三条 `-w`；`lint` 去 `faijs-extra/src`、`draw/src` |
| `scripts/ci.ps1` | build 链去 sketch/extra/draw；`$testPackages`（`:104`）去 sketch/extra/draw；`test:install` 从 sketch 迁到 core；`madge`（`:177`）去 `faijs-extra/src`；API 覆盖门禁（`:206`）列表去 `faijs-extra`/`sketch`/`draw` |
| `scripts/check-op-dims.mjs` | `SCAN_DIRS` 把 `faijs-extra/src/ops`→`core/src/extra/ops`、`sketch/src`→`core/src/sketch`，**删除 `packages/draw/src`** |
| `scripts/api-surface-snapshot.mjs` + `.json` | 增加 `./sketch`、`./sketch/node`、`./extra`、`./extra/browser`、`./extra/editor-ops`，重新生成快照 |
| `scripts/lockstep-lib.mjs` | `FAMILY_EXCLUDE` 去掉 `'@faicad/faijs-draw'`（包已删，条目失去对象） |
| `scripts/check-lockstep.mjs` | `--self-test` 合成包集里若继续使用 `@faicad/faijs-draw` 名，改为中性合成名（避免引用已删包） |
| `scripts/publish-all.ps1` | `$Packages`（`:85`）去 draw、（`:83,84`）去 sketch、extra；顶部 publish scope 注释（`:11-12`）更新 |
| `scripts/check-workspaces-order.mjs` | 无需改（family 自动减少后顺序仍为拓扑，需实跑确认） |
| `scripts/gen-importmap.mjs` / `cdn/versions.json` | 重跑生成（去掉 sketch、extra 两条 pin） |
| `packages/tests/vitest.config.ts` | 删除 sketch/extra alias；`@faicad/faijs/sketch` 等由 core alias 覆盖 |
| 根 `package.json` scripts（`gen:surface` 等） | 复核不受影响 |

### 7.4 守卫与测试

| 文件 | 变更 |
|---|---|
| `packages/core/test/three-surface.test.ts` | 删除"core 不得 import `@faicad/faijs-extra`"断言（对象消失）；保留 three-free 断言 |
| `packages/core/test/lang/op-set-consistency.test.ts` | 增加"新 op 必在符号表"显式断言；确认仍绿 |
| `packages/core/test/cad-runtime/*` | **新增 cad 保留绑定测试**：`createRuntime(ports, mode, { cad: fakeNs })` 报错；`rt.registerLib('cad', fakeNs)` 报错；`rt.registerLib('mylib', ns)` 成功 |
| `packages/faijs-extra/test/core-surface.test.ts` | 删除（反向守卫失去对象） |
| `packages/faijs-extra/test/entry-boundary.test.ts` | 删除（其 three 断言已与现状矛盾） |
| `packages/sketch/test/**` | 全量迁入 `packages/core/test/sketch/**` |
| `packages/faijs-extra/test/**` | 全量迁入 `packages/core/test/extra/**` |
| `packages/sketch/test/install-smoke.test.ts` + `smoke/*` + `vitest.install.config.ts` | 迁入 core：改为"打包 core 单包 → 安装 → 跑 sketch + extra 端到端" |
| **新增** `packages/core/test/cad-face-completeness.test.ts` | 断言 `createApiNamespace()` 键集 == 全部已声明 op 名的并集；任何"存在但未装配"的 op 直接失败 |
| **新增** `packages/core/test/cad-binding-reserved.test.ts` | 断言 `cad` 是唯一保留绑定：宿主覆盖被拒、第三方库注册不受影响 |
| **新增** `packages/core/test/sketch/solver-loader.test.ts` | 断言 `setSketchSolverInitFn` + `initSketchSolver` 三段式：注入优先 / Node 自动 / 非 Node 未注入报错；globalThis 共享跨实例；`installSketchSolver` 弃用别名仍可用 |
| **新增** `packages/core/test/assembly-single-point.test.ts` | 断言不存在 `merge*Namespace` / `create*CadNamespace` 之类的宿主装配入口；`createRuntime` 后 `cad.sketch` 等开箱可用 |
| **新增** `packages/core/test/extra/editor-ops-closure.test.ts` | 断言 `@faicad/faijs/extra/editor-ops`（构建后）闭包不含 opentype / 重实现链（替代原 entry-boundary 的体积守卫） |
| `packages/core/test/api-coverage-baseline.json` | 重生成（新导出 API 需被 core 测试引用） |

### 7.5 文档

| 文件 | 变更 |
|---|---|
| `AGENTS.md`（仓库根） | 包结构与架构描述：不再有 sketch/faijs-extra/draw 独立包；cad 面内置且不可被宿主修改；宿主仍可注册第三方库；子路径稳定契约 |
| `docs/api-contract.md` + `.zh.md` | §10.6「编辑器扩展库」重写为 core 的 `extra` 域；装配描述改为"createRuntime 单点 + cad 保留绑定"；`cad.load` 等条目去掉 `@faicad/faijs-extra` 字样 |
| `docs/language-design.md` / `library-dev-guide.md` | 复核并更新引用（若涉及这些包）；library-dev-guide 增补"cad 保留绑定、宿主注册第三方库"的说明 |
| `docs/ops-api-inventory.md` + `.zh.md` | 该生成器已 deprecated；若仍维护，重跑或标注 |
| `.agents/notes/**` | 新增本次决策的 Agent Note（为何收编、cad 保留绑定、装配单点、draw 删除、如何防复发），并更新受影响的存量 note |
| `packages/faijs-viewer/src/open-fai-zip.ts:223` | 注释提到 `@faicad/faijs-draw`（deprecated），随删除更新 |
| 下游 `3d_viewer_web/docs/faijs-contract.md` | 外部仓库文档，随该仓库改造更新 |

### 7.6 下游仓库（逐仓精确清单）

**3d_editor**（`C:\my\Faicad\3d_editor`）

- 装配删除：`packages/platform/src/execution/sketch-host.ts` 收敛为"只注入 solver wasm 源"；`web/faijs.worker.ts`、`electron/execution-process.ts`、`weapp/faijs.worker.ts` 删掉 `registerLib('cad', …)`、`register*Symbols()`、`installEditorMeshProviders()` 三件套，只保留 `createRuntime(ports)` 与必要的 wasm 源选择。
- import 替换：
  - `@faicad/faijs-sketch` → `@faicad/faijs/sketch`
  - `@faicad/faijs-sketch/node` → `@faicad/faijs/sketch/node`
  - `@faicad/faijs-extra/browser` → `@faicad/faijs/extra/browser`
  - `@faicad/faijs-extra` → `@faicad/faijs/extra`
  - `@faicad/faijs-extra/editor-ops` → `@faicad/faijs/extra/editor-ops`
  涉及文件见 2.6 的清单（app 侧 sketch UI 12 个文件 + extra 6 个文件 + platform 侧 8 个文件 + weapp 侧 4 个文件 + `web/vite.config.ts`）。
- package.json：根 + `packages/app` + `packages/platform` + `packages/weapp` 的 `@faicad/faijs-extra`/`@faicad/faijs-sketch` 依赖项删除（能力已在 `@faicad/faijs`）。
- weapp：`scripts/build.mjs`、`scripts/audit.mjs` 的 extra 解析/审计规则改为按 `@faicad/faijs/extra/editor-ops` 与重实现闭包判断；`src/core/sketch.ts`、`src/worker/planegcs.ts` 改 import。
- 不使用 draw（无需改动）。

**3d_viewer_web**：与 3d_editor 同源副本（0.32.3），按同规则全量改。

**3d_viewer_electron**：`package.json:46,47` 删除两个依赖；重装刷 `pnpm-lock.yaml` 与 `out/` 产物；`README.md:233` 更新描述。（源码 0 处 import。）

**faijs-cadquery**：`src/assembly/assembly.ts:31` → `@faicad/faijs/extra/editor-ops`；`src/sketch.ts:26,29` → `@faicad/faijs/sketch`；`package.json:52,53,61` 依赖调整。

**faijs-freecad**：67 处 `@faicad/faijs-sketch` → `@faicad/faijs/sketch`、`@faicad/faijs-sketch/node` → `@faicad/faijs/sketch/node`；其 `src/convert.ts:631-633` 等对外 re-export 同步更新；`package.json:45` 依赖调整。

**faijs-openscad**：`packages/ext/src/index.ts:10` 注释更新；`package.json:49,52` optional peer 调整；运行时对"extra 可用性"的判断改为对 `@faicad/faijs/extra` 的判断。

**fcstd-port**（**含 draw 消费者，本次额外处理**）：

- `tools/lib/cad-namespace.ts:36,37` → `@faicad/faijs/sketch`、`@faicad/faijs/sketch/node`；
- `tools/lib/cad-namespace.ts:38` `import { mergeDrawNamespace, registerDrawSymbols } from '@faicad/faijs-draw'` → **直接删除该装配段，无迁移**（用户确认 fcstd-port 并非真的在用 draw，draw 能力已由 `cad.sketchOnPlane` / `cad.profile` 取代）；
- `package.json:33,34` 依赖调整（去 draw、改 sketch 路径）；`tools/README.md:11,108`、`test/unit/cad-namespace.test.ts:7` 注释更新。

**__convtest**：`package.json:8,10` 依赖调整（去 draw、改 sketch 路径）（源码 0 处）。

**复核无改动**：3d_viewer、3d_viewer_tauri、cadquery-port（本仓内无这些包引用）。

---

## 8. 实施步骤（分阶段，含阶段验证）

> 原则：先把 core 内部拼好并自洽，再删包与改装配，最后改外部仓库。每阶段结束都要有一个"能跑"的状态。

**阶段 1 — core 内落位（不改装配）**
1. `git mv` 式迁入 `core/src/sketch`、`core/src/extra`（保留文件结构），跨包 import 改相对路径。
2. core `package.json` 增 `@salusoft89/planegcs` 依赖；`npm install`。
3. 各自 `npm run typecheck -w @faicad/faijs`。

**阶段 2 — cad 面全量化 + 保留绑定（装配单点）**
4. `createApiNamespace()` 显式加入 10 个 op；`gen-symbol-table` 重跑（`npm run gen:surface` 若有需要）。
5. `mesh/engrave.ts` 内部化 provider，删 `decoration-provider.ts`。
6. `runtime.ts` 实施保留绑定校验（`libs.cad` 报错、二次注册拒绝，集合仅 `cad`）；solver 按入口（node/browser/weapp）自动安装（browser 方案见 §11）。
7. 迁移 sketch/extra 的测试到 `core/test/{sketch,extra}`；重写 install-smoke 为 core 单包。
8. 验证：`npm run test -w @faicad/faijs`、`npm run typecheck`、`check-op-dims`、`op-set-consistency`、新增守卫全绿。

**阶段 3 — 删包与脚本收口**
9. 删除 `packages/sketch`、`packages/faijs-extra`、`packages/draw`；根 `workspaces`/`build`/`lint` 更新。
10. `ci.ps1`、各种 `check-*.mjs`、`api-surface-snapshot`、`lockstep-lib`、`publish-all.ps1` 按 7.3 更新。
11. 更新 monorepo 内测试（tests 包 alias、support）。
12. 验证：`npm run build`、`npm run test --workspaces`、`npm run typecheck`、`node scripts/check-*`、`check-dist-sync`、`check-facade`、`check-api-test-coverage` 全绿；`node scripts/set-version.mjs <ver>` 幂等（版本不动）。

**阶段 4 — 文档与守卫固化**
13. 按 7.5 更新文档；新增 Agent Note。
14. 新增 `cad-face-completeness`、`cad-binding-reserved`、`assembly-single-point` 守卫测试。
15. 验证：`npm run doc-sync`。

**阶段 5 — 下游仓库联动（逐仓，含各自构建验证）**
16. 3d_editor → 3d_viewer_web → faijs-cadquery → faijs-freecad → fcstd-port（含 draw 迁移）→ faijs-openscad → 3d_viewer_electron → __convtest。
17. 每仓：改 import / 删装配 / 改 package.json → 安装 → 构建 → 跑该仓测试。
18. 版本线：若需发版，一律 `node scripts/set-version.mjs <ver>` + `node scripts/check-lockstep.mjs`；`npm run pack`。

**阶段 6 — 端到端验收**

见第 9 节。

---

## 9. 验证（验收标准）

1. **cad 门面内置且不可改**：`createRuntime(ports)` 后 `cad.sketch` / `cad.fai_drill` / `cad.text` / `cad.svgExtrude` 全部可用；`createRuntime(ports, mode, { cad: fake })` 与 `rt.registerLib('cad', fake)` 均**报错**；仓库内搜不到 `createEditorCadNamespace` / `mergeSketchNamespace` / `registerSketchSymbols` 等宿主装配入口。
2. **宿主可注册第三方库**：`rt.registerLib('mylib', ns)` 与 `createRuntime(ports, mode, { mylib: ns })` 正常工作，`cad` 不受影响。
3. **保留集合只有一个名字**：`cad` 被锁；其它名字（含以 `cad` 为前缀的名字如 `cadx`）不受影响。
4. **cad 面完整性守卫**：`createApiNamespace()` 键集 == 全部 op 名并集；符号表 src == dist（`check-dist-sync`）。
5. **全平台一致**：同一份 `.fai.js`（含 `cad.sketch`、`cad.group`、`cad.text`）在 node 与 browser 入口跑出同结果；weapp 端 op 名一致（重实现可裁剪，但语义不缺席）。
6. **发布态**：`npm run pack` 产出的 `@faicad/faijs` tgz 里是完整 dist（含 sketch/extra 域）；install-smoke（core 单包）通过；tarball 白名单守卫通过。
7. **draw 删除干净**：仓库内无 `packages/draw`；根 workspaces/build/lint、`ci.ps1`、`check-op-dims`、`lockstep-lib`、`publish-all.ps1`、`cdn/versions.json` 均无 draw 残留；`@faicad/faijs-viewer` 注释更新。
8. **守卫全绿**：`check-lockstep`、`check-workspaces-order`、`check-ghost-deps`、`check-facade`、`check-tsconfig-paths`、`check-op-dims`、`check-dist-sync`、`check-api-test-coverage`、`api-surface-snapshot`、`doc-sync`。
9. **CI 全绿**：`pwsh -NoProfile scripts/ci.ps1`（含 build、workspaces 测试、stderr 零容忍、demo e2e ×2、pack）。
10. **下游**：3d_editor web/electron/weapp 三个宿主全绿；faijs-freecad、faijs-cadquery、fcstd-port（含 draw 迁移）、faijs-openscad 各自测试全绿；3d_viewer_electron 依赖可解析；__convtest 依赖可解析。
11. **weapp 体积**：`npm run build:worker` + `npm run audit` 通过，产物体积与改造前对比（重实现未被打进 worker）。
12. **planegcs 装载对齐**：`setSketchSolverInitFn` + `initSketchSolver` 三段式与 occt/brepkit 同构——Node 端零装配自动、browser/weapp 端宿主调一次 `setSketchSolverInitFn`、非 Node 未注入报错文案同款；globalThis 共享跨实例生效；`cad.sketch` 在三端跑出同结果。

---

## 10. 风险与回退

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 显式列 op 时漏键 → 符号表不一致 | 高 | cad-face-completeness 守卫 + op-set-consistency 双向断言 |
| R2 | `createApiNamespace` 被改成 `...spread` → 符号表静默缺键 | 中 | 显式断言 + 测试注释说明 spread 陷阱（6.6） |
| R3 | 保留绑定校验误伤宿主第三方库注册 | 高 | cad-binding-reserved 测试覆盖"cad 拒 / 第三方放"两侧；错误信息明确；保留集合严格只有 `cad` |
| R4 | solver 装载对齐既有模式后改动求解语义或 wasm 源解析失败 | 中 | 对齐 occt/brepkit 既有模式（非新发明）+ `solver-loader.test.ts` 三段式断言 + 三态逐端 e2e；`installSketchSolver` 保留为弃用别名 |
| R5 | weapp 打包含入重实现 → 体积超预算 | 高 | 动态 import / 端口隔离 + `extra/editor-ops` 轻入口 + audit 体积门禁 |
| R6 | 下游 import 批量替换遗漏 | 中 | 逐仓 `grep -rl` 清单核对（2.6/7.6 已列全）+ 各仓 typecheck |
| R7 | 删除包后 lockstep / cdn pins / 发布列表 / FAMILY_EXCLUDE 残留 | 中 | 重跑 `gen-importmap.mjs`、`check-lockstep`、`publish-all.ps1 -DryRun`、清理 `FAMILY_EXCLUDE` |
| R8 | registry 依赖的 3d_viewer_electron 断链 | 中 | 一次性改完（用户已定）；同版本线发布后再升级依赖 |
| R9 | install-smoke 单包化后覆盖下降 | 中 | 保留 sketch + extra 双路径端到端 |
| R10 | 删 draw 后 fcstd-port 的 `cad.draw` 装配段残留 | 低 | 用户确认 fcstd-port 并非真的在用 draw，直接删除装配段与依赖，无迁移 |
| R11 | draw 虽 `private` 却被 `publish-all.ps1`/`FAMILY_EXCLUDE` 显式登记，删除时易漏清 | 中 | 7.3 逐条列出；`check-lockstep --self-test` 与 `publish-all -DryRun` 复核 |

**回退**：本方案是一次性破坏性变更，回退单位 = 阶段。阶段 1–2 仅在 core 内，可独立回退；阶段 3 起开始删包与改下游，回退依赖 git（不提供兼容层——用户已明确"零兼容"）。

---

## 11. 决策记录（无待确认项）

**planegcs wasm 装载方式（原 §11 第 1 项，已定）**：对齐 core 既有 wasm 装载模式（§2.1b）——`setSketchSolverInitFn` + `initSketchSolver` 三段式 + globalThis 共享，与 `setOcctWasmInitFn` / `setBrepkitWasmInitFn` 同构。废弃之前的候选 A（`HostPorts.assets` 资源键）/ B（新 `createRuntime` 选项）/ C（保留 `installSketchSolver` 必做）——planegcs 的 wasm 位置问题与 occt-wasm / brepkit2-wasm 是同一个问题，应沿用同一答案，不另发明机制。详见 §6.3(a)。

**其余已定项（记录，不再询问）**

- `@faicad/faijs/extra/editor-ops`：**公开发布**（随 core 一同发布）。
- 保留绑定集合：**只有 `cad` 一个名字**。
- `createBareRuntime`：**保留**，但同样禁止注册 `cad`（见 6.2(d)）。
- `packages/draw`：**本次一并删除**（见 §2.7、§7.2、§7.6、R10）。
- fcstd-port 的 draw 装配段：**直接删除，无迁移**（用户确认 fcstd-port 并非真的在用 draw）。