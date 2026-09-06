# faijs 语言生态路线图 —— 让 faijs/faits 成为一门正常语言，并原生支持第三方库

日期：2026-08-28
状态：设计待裁定（**未实施，未改任何代码**）
上位文档：`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（语言定位的唯一权威）
另见：`docs\plans\2026-08-28-keep-syntax-design.md`（必需先完成的任务）
参考：brepjs `docs/dynamic-third-party-library-loading_cn.md`

---

## 0. 需求、纠错与目标场景

### 0.1 需求（用户原话）

> faijs/faits必需是一个正常的语言。faits可以理解为就是ts代码，它里面可以import其它的库。而faijs对应UI录制的代码，只有这个特殊一些，但是也要能引用第三方库呀，只是没有控制流语句。比如第三方写了一个机械模型库，这个库又引用了齿轮库，齿轮库又引用了一个标准件数据库(非cad库)。然后faijs里用机械模型库建模一个车床模型。而且让你写的而是解决方案。什么faijs 未发布，根本不是理由，那就让faijs发布即可。你需要主动规划faijs的后续开发的路线图。要实现我上面提到的这个场景。

拆解为硬需求：

| # | 需求 | 验收判据 |
|---|---|---|
| R1 | faijs/faits **必须是正常语言** | 第三方库是普通 npm 包，正常 `import`、正常传递依赖、正常 TS 工具链 |
| R2 | **faits = TS 代码**，可 import 其它库 | faits 全量 JS/TS 能力（控制流、函数、类、import） |
| R3 | **faijs = UI 录制代码**，唯一限制是**无控制流语句** | if/for/while 等被禁；**import 允许**；外观上仍是"一行一语句"的扁平序列 |
| R4 | faijs **也要能引用第三方库** | 车床场景端到端跑通 |
| R5 | 支持**任意深度传递依赖**，含**非 CAD 库**（标准件数据库） | `mech-lib → gear-lib → bearing-db` 四层依赖图 |
| R6 | "未发布"不是理由 → **faijs 发布到 npm** | 发布计划进路线图 |
| R7 | 交付物是**解决方案 + 路线图** | 本文档 |

### 0.2 上一版方案（`2026-08-28-web-host-dynamic-lib-loading-design.md`）被推翻的错误预设

先逐条认错，这些错误是**方向性**的，不是细节：

| # | 上一版的预设 | 为什么错 |
|---|---|---|
| **E1** | "faijs 用户代码不能写 import" → 因此不需要 brepjs 那套模块解析 | 混淆了**控制流**与**模块声明**。`Faijs语言的思考.md` §4 只禁止 **if/for/while 这类控制流**，import 是模块声明，与 DAG/timeline 无冲突。禁止它是**实现偷懒**（为了维持"零 import 编译产物"），不是语言要求 |
| **E2** | "第三方库不能 import faijs，改由宿主注入 facade" | 这是把第三方库降为二等公民。正常语言的生态里，库就是要 `import` 它的上游依赖。facade 注入写不出 `mech-lib → gear-lib → bearing-db` 这种多层依赖图 |
| **E3** | "faijs `private: true` 未发布 → CDN/打包器去重物理不可行" | 用户明确指出：**那是可改变的决策，不是约束**。应该做的是发布 faijs |
| **E4** | 把"零 import 编译产物"当成**语言本质约束** | 它只是为了让产物能在 Node `data:` URL / 浏览器 Blob URL 里加载而做的**实现取舍**。语言层该有的能力不应被实现取舍反向阉割 |
| **E5** | 用"宿主注入"回避模块解析 | 回避的是**真问题**。真正的解法是给 faijs 配一套**正常的模块运行时** |

**一句话总结**：上一版是在给"faijs 现在的实现"打补丁；这一版是让"faijs 这门语言"先长成正常的样子，再谈加载。

### 0.3 目标场景（车床）—— 贯穿全文的例子

依赖图（四层，含一个**非 CAD** 的纯数据包）：

```
mech-lib@1.4.0          机械模型库（第三方，TS 编写，发布到 npm）
  ├── import { solid, type Shape, type ExecContext } from '@faicad/faijs/sdk'   ← CAD 宿主 SDK
  ├── import { helicalGear, spurGear } from 'gear-lib@2.1.0'                    ← 齿轮库（第三方 CAD 库）
  │        └── import { GB_BEARINGS, GB_BOLTS } from 'bearing-db@3.0.0'         ← 标准件数据库（非 CAD，纯数据）
  └── import { tol } from '@faicad/std-tolerance'（举例）
```

faijs（UI 录制 + 手改）里的用法：

```js
import * as mech from 'mech-lib'

let part0 = cad.box({ size: [1200, 600, 500] })         // 床身毛坯（内置 op）
let part1 = mech.makeHeadstock({ spec: 'C6140' }, )     // 主轴箱（第三方，内部用到 gear-lib + bearing-db）
let part2 = mech.makeGearTrain({ ratio: 3.5, module: 2 })
let part3 = cad.drill(part0, { diameter: 12, at: [0, 0, 0] })
let part4 = cad.assembly({ members: [part0, part1, part2] })
```

要求：`part1` 内部的齿轮几何来自 gear-lib，齿轮的轴承规格来自 bearing-db 的纯数据表——**faijs 引擎对 gear-lib / bearing-db 的存在完全无感知**。

---

## 1. 重新定位：faijs 与 faits

### 1.1 两个方言的边界（来自 `Faijs语言的思考.md`）

| | **faits**（`.faits`） | **faijs**（`.faijs`） |
|---|---|---|
| 作者 | AI | UI 录制（AI/用户可编辑） |
| 语言 | **TypeScript**（带类型） | **JavaScript**（不带类型） |
| 控制流 | ✅ 完整支持（if/for/while/try/函数/类） | ❌ **禁止**（唯一限制，§4 of 思考文档） |
| `import` | ✅ 正常 import | ✅ **允许**（模块声明，非控制流） |
| 执行 | sucrase 去类型 → JS VM 整段执行 | parse → ScriptIR → 编译 → **按语句增量执行** |
| 与 UI 的耦合 | 无（UI 不参与编辑） | 有（timeline / feature / 增量回放） |

**关键澄清**：faijs 禁止控制流是为了保护两件事（思考文档 §4）——
1. **DAG 活跃性**（决定 canvas 显示哪些几何）不被破坏；
2. **timeline 线性结构**（一行 = 一次操作 = 一个 feature）不被破坏。

`import` **不威胁这两者**：它既不影响变量消费关系，也不产生 timeline 节点。所以**没有理由禁止它**。

### 1.2 "正常语言"对 faijs 实现的实际要求

| 能力 | 现状 | 差距 |
|---|---|---|
| 顶层 `import` | ❌ 被包装塞进函数体 → 语法错误 | 需把 import 提到模块顶层（§6.1） |
| 命名空间调用 `ns.op()` | ❌ parser 硬编码 `cad`（6 处） | 需放开（§6.2） |
| 函数定义 `function f() {...}` | ❌ 未支持 | V1 后期（§10 V1.3），思考文档 §3 已预设"未来支持" |
| 第三方库作为 npm 依赖 | ❌ 无模块加载能力 | 本文档主体（§3–§5） |
| faits 执行路径 | ❌ 无（只有 faijs） | 需新增（§7） |

### 1.3 现状与目标的本质差距

现状执行链（`src/cad-runtime/module-executor.ts:34-47`）：

```
源码 → parseScript → ScriptIR → compileToModule（零 import ESM 文本）
     → Blob URL（浏览器）/ data: URL（Node）→ import() → 逐语句 fn
```

这条链的价值是**增量执行**（UI 录制按行追加，`runtime.append/update/plan`）。**它必须保留**。

但它把"模块依赖"整个绕过去了。需要补的是：**在 parse 之前/之中，把第三方库的模块图解析好**，让编译产物能够引用到活的库对象。

---

## 2. 目标场景拆解：四层依赖各自由谁负责

| 层 | 包 | 谁负责解析 | faijs 引擎是否感知 |
|---|---|---|---|
| L4 | `mech-lib`（faijs 直接引用） | 宿主 `ModuleResolver`（§5） | ✅ 感知（作为命名空间 `mech`） |
| L3 | `@faicad/faijs/sdk`（mech-lib 的上游） | 宿主 importmap / external → **必须指向宿主那份运行时** | ✅ 感知（身份状态必须共享） |
| L2 | `gear-lib`（mech-lib 的传递依赖） | **构建期 bundle 或 CDN 自动改写**（§5.2 / §5.3） | ❌ **完全不感知** |
| L1 | `bearing-db`（非 CAD 纯数据包） | 同上 | ❌ **完全不感知** |

> **这是关键判断**：L1/L2 这类传递依赖（尤其非 CAD 库）**faijs 一行代码都不该为它们写**。它们是模块层的职责，交给标准 ESM 模块系统（打包器或 CDN）即可。faijs 唯一需要操心的是 **L3（自身 SDK 的单例）** 与 **L4（命名空间注册）**。

---

## 3. 总体架构

### 3.1 四层职责

```
┌─ 宿主（3d_editor 主线程）────────────────────────────────────────────┐
│ ModuleResolver：specifier → 绝对 URL（配置驱动，见 §5）                 │
│   ① 解析 'mech-lib' → https://static/bundles/mech-lib@1.4.0-<hash>.js │
│   ② 解析 '@faicad/faijs/sdk' → /vendor/faijs-sdk.js（宿主自托管那份）   │
│ ③ import(url) → 活模块对象（其内部的 gear-lib/bearing-db 已在构建期打进 │
│    bundle，或被 CDN 改写成绝对 URL）                                    │
│ ④ runtime.registerLib('mech', mod)                                     │
└──────────────────────────┬────────────────────────────────────────────┘
                           ▼
┌─ CadRuntime（faijs 引擎，L2）────────────────────────────────────────┐
│ libs: { 'cad': 内置, 'mech': <活模块> }                                │
│ parse → ScriptIR（namespace='mech', callee='makeHeadstock'）           │
│ compile → exec.libs.mech.makeHeadstock(ctx.part0, {…}, exec)          │
│ 执行 → 逐语句 fn（增量语义不变）                                        │
└──────────────────────────┬────────────────────────────────────────────┘
                           ▼
┌─ mech-lib（第三方 npm 包，普通 TS）───────────────────────────────────┐
│ import { solid, type Shape, type ExecContext } from '@faicad/faijs/sdk'│
│ import { helicalGear } from 'gear-lib'                                │
│ export function makeHeadstock(opts, exec): Shape { … }                │
└──────────────────────────┬────────────────────────────────────────────┘
                           ▼
┌─ 运行时状态锚点 globalThis.__FAICAD_FAIJS_RUNTIME__（§3.4）───────────┐
│ created: WeakSet（isShape 依据）· slots: WeakMap · kernel 单例          │
│ ← 宿主 engine 与第三方 SDK 共享同一份 → Shape 身份天然互通              │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.2 关键决策 1：第三方库 = 普通 npm 包（推翻 E2）

第三方库的 `package.json`：

```json
{
  "name": "mech-lib",
  "version": "1.4.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "dependencies": {
    "@faicad/faijs": "^1.0.0",
    "gear-lib": "^2.1.0"
  },
  "peerDependencies": { "@faicad/faijs": ">=1.0.0 <2" }
}
```

库源码（**完全是普通 TS，无任何本项目专属魔法**）：

```ts
// mech-lib/src/index.ts
import { solid, compound, isShape, resolvePath } from '@faicad/faijs/sdk'
import type { Shape, ExecContext, SolidShape } from '@faicad/faijs/sdk'
import { helicalGear } from 'gear-lib'          // 传递依赖，faijs 完全不感知

export function makeHeadstock(opts: HeadstockOpts, exec: ExecContext): SolidShape {
  const body = exec.cad.box({ size: [400, 300, 350] }, exec)   // 用内置 op
  const gear = helicalGear({ teeth: opts.gearTeeth, moduleSize: 2 })  // ← 来自 gear-lib，
  //   gear-lib 内部的轴承规格又来自 bearing-db（纯数据）。faijs 一行都不知情。
  const merged = exec.cad.union(body, gear, exec)
  return solid(merged)
}
```

**库作者的开发体验**：`npm i @faicad/faijs gear-lib` → tsc 构建 → `npm publish`。与写一个普通的 npm 包没有任何区别。**这是"正常语言"的硬性验收标准（R1）。**

### 3.3 关键决策 2：faijs 包拆分（`engine` / `sdk`）

**问题**：现在的 `@faicad/faijs` 一个包身兼两职，而两者的约束完全相反。

| 角色 | 使用者 | 体积/依赖约束 |
|---|---|---|
| **引擎**（parser / compile / CadRuntime / stdlib / occt / manifold） | 宿主（3d_editor）、faijs CLI | 可以重；依赖 three、occt-wasm、manifold-3d、acorn |
| **SDK**（Shape 类型 / 构造器 / 身份查询 / 路径判定 / ExecContext 类型） | **第三方库** | **必须轻、零 heavy 依赖** |

实测证据：`dist/` 共 **130 个 JS 文件**，`dist/index.js` 及子模块**静态 import `three`**（`grep` 命中 `import * as THREE from 'three'` 十余处），`node-host` 静态 import `node:fs`/`node:path`。若第三方库直接依赖 `@faicad/faijs`（根入口）：

- 浏览器加载会尝试解析 `node:fs` → 必须走 `/browser` 入口；
- 会把 three（~600KB+）拖进第三方库的依赖闭包——**每个库都拖一份**，完全不可接受；
- 130 个模块的瀑布请求，无法作为 CDN/importmap 目标。

**方案**：单包双入口（`package.json` `exports`），共享同一份运行时状态。

| 入口 | 路径 | 内容 | 依赖 |
|---|---|---|---|
| `@faicad/faijs` | 根 | 引擎全量（现状 `src/index.ts`） | three / occt-wasm / manifold-3d / acorn |
| `@faicad/faijs/browser` | 已有 | 引擎浏览器版 | 同上（不含 node-host） |
| **`@faicad/faijs/sdk`** | **新增** | **库开发 SDK** | **零运行时依赖**（仅 `type` 依赖 occt-wasm 的类型） |

SDK 导出面（§4）——**全部是纯数据/纯函数，不含任何几何引擎实现**。

### 3.4 关键决策 3：运行时状态全局锚点（Runtime Anchor）—— 单例的根本解法

**问题**（上一版已识别但解法错误）：`isShape` 依赖模块级 `WeakSet`（`src/stdlib/shape.ts:37`），身份槽依赖模块级 `WeakMap`（`:79`），OCCT kernel 是模块级单例（`src/occt-kernel/occtKernel.ts:23-32`）。宿主一份 faijs + 第三方库一份 faijs → 两份状态 → 几何孤岛。

**上一版的错误解法**：要求库不 import faijs（E2）。
**正确解法**：把"状态"从"模块"里提出来，挂到**全局锚点**，让**任意份 faijs 代码共享同一份状态**。

```ts
// src/runtime-state.ts（新增，零依赖，engine 与 sdk 共用）
export interface FaijsRuntimeState {
  /** 状态契约版本（独立于包版本；破坏性变更才 +1） */
  readonly stateVersion: number
  /** Shape 构造器登记（isShape 的唯一依据） */
  readonly created: WeakSet<object>
  /** Shape 身份槽：solid / faceEvolution / meshShape / behavior */
  readonly slots: WeakMap<object, ShapeSlot>
  /** OCCT 内核持有者（保证全进程只有一份 WASM 实例） */
  readonly kernel: { instance: OcctKernel | null; initPromise: Promise<OcctKernel> | null }
}

const KEY = '__FAICAD_FAIJS_RUNTIME__'

export function getRuntimeState(): FaijsRuntimeState {
  const g = globalThis as Record<string, unknown>
  const existing = g[KEY] as FaijsRuntimeState | undefined
  if (existing) {
    if (existing.stateVersion !== STATE_VERSION) {
      // 不静默、不降级：结构不兼容必须炸（贴合 3d_editor CLAUDE.md「不准写各种回退」）
      throw new Error(
        `[faijs] runtime state version mismatch: loaded=${existing.stateVersion}, expected=${STATE_VERSION}`,
      )
    }
    return existing
  }
  const created = createRuntimeState()
  g[KEY] = created
  return created
}
```

改造点（**改的是取状态的方式，不是语义**）：

| 现状 | 改为 |
|---|---|
| `src/stdlib/shape.ts:37` `const created = new WeakSet<object>()` | `const created = getRuntimeState().created` |
| `src/stdlib/shape.ts:79` `const slots = new WeakMap<object, ShapeSlot>()` | `const slots = getRuntimeState().slots` |
| `src/occt-kernel/occtKernel.ts:23-24` `let kernelInstance` / `let initPromise` | `getRuntimeState().kernel.instance` / `.initPromise` |

**为什么这是架构级正解**：把"单例"从**模块实例唯一**（对打包器/importmap/CDN 是否正确极度敏感）降级为**共享状态唯一**（对加载方式完全不敏感）。

- importmap / external / dedupe 做得完美 → 只有一份 faijs 代码，**省体积**（优化）；
- 它们做得不完美（版本漂移、CDN 与自托管并存、库打了 faijs 进去）→ 有锚点兜底，**正确性仍然成立**。

**局限（必须如实说明）**：
- 两份 faijs 代码 = 两份体积/两遍解析（性能问题，不是正确性问题）；
- `stateVersion` 不兼容时抛错（**不静默降级**），因此 SDK 的状态结构必须严格向后兼容；
- `WeakSet`/`WeakMap` 无法跨 realm（Worker），跨 realm 场景见 §8。

### 3.5 关键决策 4：ModuleResolver —— 宿主侧的模块解析

宿主持有一张 **specifier → 绝对 URL** 的解析表，并在**加载前把裸名重写为绝对 URL**。

为什么不全靠 importmap：

| 限制 | 影响 |
|---|---|
| importmap **只在主线程（Window）生效**，Worker/SharedWorker 内无效 | 未来 CAD 执行挪进 Worker 就断了 |
| importmap 必须**在首个模块加载前**声明，且一个文档一个合并 map | 运行时新增库要重建 map（多数浏览器不支持多 map） |
| 不支持"同一裸名的多个版本共存"（需 `scopes`，覆盖规则复杂） | 库 A 要 gear-lib@1、库 B 要 gear-lib@2 时难办 |

**因此**：importmap 只用于 **`@faicad/faijs/sdk` 这一个**必须宿主单例的 specifier（§5.5），其余全部走 **ModuleResolver 静态重写**——宿主已知完整解析表，在**转译/编译阶段**把裸名替换为绝对 URL，产物里不再有裸名。

> 重写必须用 **acorn 解析 import 声明**后按节点位置替换，**禁止正则替换代码文本**（会误伤字符串/注释）。这与 brepjs §3.4 的 `rewriteUserCode` 同构，但**只动 import 说明符、不碰任何业务代码**。

---

## 4. faijs SDK 契约（新增入口 `@faicad/faijs/sdk`）

### 4.1 导出面（设计契约）

```ts
// ── 数据（纯数据，无 heavy 依赖）──
export interface Shape { positions: Float32Array; indices: Uint32Array }
export type ShapeKind = 'solid' | 'shape2d' | 'curve' | 'compound'
export interface SolidShape extends Shape { kind: 'solid' }
export interface CompoundShape { kind: 'compound'; children: Shape[] }

// ── 构造器与身份（全局锚点共享状态）──
export function solid(mesh: Shape): SolidShape
export function compound(children: Shape[]): CompoundShape
export function isShape(v: unknown): v is Shape
export function isCompound(v: unknown): v is CompoundShape

// ── 执行上下文（引擎注入，库只消费）──
export interface ExecContext {
  readonly mode: ExecutionMode
  readonly kernels: { occt: OcctKernel | null; csg: CsgBackend | undefined; sdf: SdfBackend | undefined }
  /** 内置命名空间（宿主实现，等价于 faijs 的 cad） */
  readonly cad: StdlibNamespace
  getSolid(shape: Shape): ShapeHandle | undefined
  setSolid(shape: Shape, solid: ShapeHandle): void
  getFaceEvolution(shape: Shape): Map<number, number[]> | undefined
  setFaceEvolution(shape: Shape, evo: Map<number, number[]>): void
  dependentsOf(shape: Shape): Shape[]
  touch(shape: Shape): void
  readonly fonts / texture / assets / events
}

// ── 双链路静态判定（BREP/mesh 红线：静态判定，禁止 try-catch 回退）──
export function resolvePath(exec: ExecContext, inputs: Shape[], brepImpl?: unknown): 'brep' | 'mesh'
export class BrepUnsupportedError extends Error { readonly stmt?: StatementIR }

// ── 版本协商 ──
export const FAIJS_SDK_VERSION: string
export const FAIJS_STATE_VERSION: number
```

**注意**：`ExecContext` 新增 **`readonly cad: StdlibNamespace`**（宿主内置 op 集合）。这是第三方库调用内置 op（`exec.cad.box(...)`）的入口——**不需要全局锚点存 cad**，因为它本来就随 exec 注入。`src/cad-runtime/exec-context.ts:49-81` 加一个字段即可，指向 `createInternalStdlib()` 产物。

### 4.2 依赖约束（硬）

- SDK **零运行时 import**：不 import three / occt-wasm 的实现，只 `import type`；
- SDK 的 `ShapeHandle` / `OcctKernel` 等类型从 `occt-wasm` **只取类型**（`import type`），编译后消失；
- SDK 产物必须是**单文件 ESM**（`dist/sdk.js`，由 build 脚本产出，见 §5.5）。

### 4.3 版本协商

| 版本 | 含义 | 变更规则 |
|---|---|---|
| `FAIJS_SDK_VERSION` | 包版本（semver） | 新增导出 = minor；删改签名 = major |
| `FAIJS_STATE_VERSION` | **运行时状态结构版本**（整数） | WeakSet/WeakMap/kernel 的结构或语义破坏性变更才 +1；不兼容即抛错（§3.4） |

库在 `package.json` 声明 `"peerDependencies": { "@faicad/faijs": ">=1.0.0 <2" }`，宿主在加载库时校验 `FAIJS_STATE_VERSION` 一致。

---

## 5. 模块解析与加载（Web Host）

### 5.1 三层解析表

| 层 | specifier 例 | 解析方式 | 时机 |
|---|---|---|---|
| **A. 宿主单例** | `@faicad/faijs/sdk` | importmap → `/vendor/faijs-sdk.js`（宿主自托管，与宿主引擎同版本） | 页面加载前（静态） |
| **B. 第三方库** | `mech-lib` | ModuleResolver 表 → 绝对 URL（预构建 bundle 或 CDN） | 运行期（宿主配置驱动） |
| **C. 传递依赖** | `gear-lib` / `bearing-db` | **构建期打进 bundle**（路径 A）或 **CDN 递归改写**（路径 B） | 与 B 同时完成 |

### 5.2 路径 A（主推荐）：预构建 bundle + 自托管

```
库作者 npm publish mech-lib
        ↓
上架到 Faicad 库市场 / 或宿主 CI 触发构建
        ↓
后端用 esbuild 打包：
  entry  = mech-lib
  external = ['@faicad/faijs/sdk']        ← 关键：不打进去，留给 importmap
  → 产出一个单文件 ESM（gear-lib / bearing-db 全部内联）
        ↓
发布到对象存储：https://static.faicad.cn/libs/mech-lib@1.4.0-<contentHash>.js
        ↓
宿主 ModuleResolver 登记：'mech-lib' → 该 URL
        ↓
运行时 import(url) → 活模块 → registerLib('mech', mod)
```

**为什么是主干**：

| 优点 | 说明 |
|---|---|
| 传递依赖**构建期解决** | 运行时无递归 fetch 瀑布（gear-lib + bearing-db 已内联） |
| 确定性 | 内容 hash 固定，可 SRI、可强缓存 |
| 体积可控 | tree-shaking，bearing-db 只留用到的表 |
| 无供应链漂移 | 不依赖第三方 CDN 的可用性 |
| 可审核 | 上架前可扫描产物 |

**代价**：需要一个后端构建服务（3d_editor 已有后端，vite proxy 指向 `/api/internal`，见 `vite.config.ts`）。

### 5.3 路径 B：CDN ESM（零后端，开发者友好）

```ts
await import(/* @vite-ignore */ 'https://esm.sh/mech-lib@1.4.0?external=@faicad/faijs/sdk')
```

- esm.sh 递归把 `gear-lib` / `bearing-db` 改写成它自己的绝对 URL；
- `?external=@faicad/faijs/sdk` 保留 faijs 为裸名 → importmap（层 A）解析到宿主那份 → **单例打通**；
- 可用 `?deps=gear-lib@2.1.0` 锁定传递依赖版本。

**风险**：网络可用性、供应链、CDN 版本漂移、无 SRI 保证。**定位为开发者/自建部署路径，不作为生产主干。**

### 5.4 路径 C：自研模块解析器（仅 Worker 沙箱需要）

若要把第三方库放进 Worker 沙箱（§8.2），importmap 不可用，需要宿主自己喂模块图：

1. 从 bundle/CDN 拿到每个模块的源码文本；
2. acorn 解析 `import` 声明 → 收集依赖 specifier；
3. 递归加载每个依赖 → 建 `specifier → Blob URL` 映射；
4. 按映射重写每个模块的 import 说明符 → 生成 Blob 模块；
5. 拓扑装配完成后 `import(entryBlobUrl)`。

**只在需要 Worker 沙箱时才做**（V5，§10）。主线程路径（A/B）不需要它。

### 5.5 importmap 的精确用法

3d_editor 已在 build 时注入 importmap（`vite.config.ts` 的 `cdnExternalPlugin.transformIndexHtml`，当前含 three / manifold-3d / occt-wasm）。**新增一条**：

```html
<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js",
    "three/": "https://cdn.jsdelivr.net/npm/three@0.184.0/",
    "manifold-3d": "…", "occt-wasm": "…", "occt-wasm/": "…",
    "@faicad/faijs/sdk": "/vendor/faijs-sdk@1.0.0.js"     ← 新增，宿主自托管单文件
} }
</script>
```

**配套工程项（必须）**：构建脚本产出 `dist/sdk.js` 单文件 ESM 并复制到 `public/vendor/`，版本与宿主所用 faijs 严格一致。

> **注意**：宿主自身用的引擎 `@faicad/faijs` 目前是**打进 bundle 的**（`vite.config.ts` 未 external 它）。这不影响正确性——因为引擎与 SDK 通过 **§3.4 全局锚点**共享状态。也就是说：**importmap 指向的 SDK 与 bundle 内的引擎是两份代码，但一份状态**。这正是锚点设计的价值。

---

## 6. faijs 语言层改动

### 6.1 faijs 顶层 `import` 段

**问题**：`src/lang/parser.ts:504-520` 把扁平代码包成

```js
export default async (cad) => {\n${code}\n}
```

→ 用户写的 `import` 会落进函数体 → 语法错误。

**改法**：parse 前**预扫描**顶层 import 声明，把它们提到模块顶层，其余代码照旧包装。

```js
// 用户 faijs 源码
import * as mech from 'mech-lib'
import { tol } from '@faicad/std-tolerance'
let part0 = cad.box({ size: 20 })

// 内部 parseCode（import 提升后）
import * as mech from 'mech-lib'
import { tol } from '@faicad/std-tolerance'
export default async (cad) => {
let part0 = cad.box({ size: 20 })
}
```

- `ScriptIR` 新增 `imports: ImportIR[]`，`ImportIR = { specifier: string; kind: 'namespace' | 'named' | 'default'; localName: string; packageName: string }`；
- `packageName` 由 specifier 推导（`@scope/pkg/sub` → `@scope/pkg`；`pkg/sub` → `pkg`）——这是 timeline 的"**带包名**"标识来源（思考文档 §3）；
- `codegen.ts` 打印时把 import 段写回文件头，保证 **round-trip 往返**（现有 S-5 不变式）；
- 行号偏移计算（`parser.ts:509` 的 `lineOffset`）需同步修正。

**约束（保持 faijs 的"特殊"）**：
- 只允许 **import**，不允许 `export`（保持自动 export 方案，思考文档 §2 末尾）；
- import 必须在文件**头部连续段**（UI 录制时由宿主统一维护）；
- 不支持动态 `import()`（那是控制流范畴）。

### 6.2 命名空间与调用形态

parser 放开硬编码的 `cad`（`src/lang/parser.ts:127,190,291,613,679` 五处；`:550` 的包装参数名保持 `'cad'` 不变）。

三种 import 形态统一为 `(packageName, callee)` 二元组：

| 源码 | namespace（`packageName`） | callee | 发射 |
|---|---|---|---|
| `cad.box({...})` | `'cad'`（内置，缺省） | `box` | `cad.box(...)` — **逐字不变** |
| `import * as mech from 'mech-lib'` → `mech.makeHeadstock(...)` | `'mech-lib'`（绑定名 `mech`） | `makeHeadstock` | `exec.libs.mech.makeHeadstock(...)` |
| `import { makeLathe } from 'mech-lib'` → `makeLathe(...)` | `'mech-lib'` | `makeLathe` | `exec.libs['mech-lib'].makeLathe(...)` |

**发射位置**：`exec.libs`（沿用并确认上一版的 D5' 修正——**不改 fn 签名**，`src/cad-runtime/exec-context.ts` 加一个 `readonly libs` 字段，`module-executor.ts:137` 调用点零改动）。

### 6.3 Feature = `包名.函数名`（思考文档 §3）

- `src/lang/statement-summary.ts` 的 `StatementSummary` 增加 `namespace?: string` + `packageName?: string`；
- 3d_editor 的 `getFeatureByOp(op)`（`src/engine/script-engine/ScriptEngine.ts:43-58`）升级为 `getFeatureByOp(packageName, op)`；
- **未知第三方函数**（无匹配 Feature）：按思考文档 §3——timeline 只显示**只读函数名**，不支持特征编辑面板。这与现有"内置 Feature 有图标/编辑面板"的分层天然一致。

### 6.4 其它语言层改动点（与上一版一致，保留）

- `src/lang/types.ts`：`StatementIR.namespace?` / `CallRefIR.$call.namespace?` / `ScriptIR.imports`
- `src/lang/codegen.ts:82,135`：打印 `${ns}.${callee}`
- `src/lang/code-to-args.ts:25-28`：`NON_DECL` 增加可选 `namespaces` 参数（L0 不得感知注册表）
- `src/cad-runtime/module-executor.ts:260-273`：`computeKey` 首段必须改 `${packageName}.${callee}` —— **否则 `cad.chamfer` 与 `mech-lib.chamfer` 的 statementKey 碰撞，增量执行静默产错几何**（上一版已识别的修正 C2，仍然成立）
- `src/cad-runtime/terminal-dag.ts`：形态规则表（沿用前版 §5.3），`IMPLICIT_RETAIN` **限定 `namespace === 'cad'`**（修正 C1，仍然成立）
- `src/lang/allocate-id.ts`：`DerivePartNameInput.namespace`
- `src/cad-runtime/runtime.ts:967-979`：check ②符号检查改 `knownCallee(ns, callee)`

---

## 7. faits 执行路径（新增）

faits 是**完整 TS**，不需要增量执行（UI 不编辑它），因此走一条**更简单的路径**：

```
.faits 源码
  → sucrase 去类型（保留行号，便于报错定位）
  → acorn 解析 import 声明 → ModuleResolver 把裸名重写为绝对 URL
  → Blob URL → import() → 整段执行
  → 收集输出结果（按返回的 Shape 集合 / 显式声明）
```

与 faijs 的差异：

| | faijs | faits |
|---|---|---|
| 解析 | parseScript → ScriptIR（结构化，可增量） | sucrase → 纯文本（不建 IR） |
| 执行粒度 | 逐语句 fn（支持 append/update/plan） | 整段一次执行 |
| DAG 活跃性 | ✅ 引擎自动推导 | ❌ 需**显式**声明输出（见下） |
| timeline | ✅ 一行一节点 | ❌ 不参与 timeline |

**faits 的输出声明**：因为 faits 有控制流，无法静态推导终端集合。约定 faits 通过**顶层 `return` 或 `export default`** 声明输出（与 faijs 的自动 export 方案并列，思考文档 §2 已说明"写 export 更难，但 faits 是 AI 写的，可以接受"）。

**faijs 与 faits 互操作**：faijs 可以 `import` 一个 faits 模块（它编译后就是普通 ESM），反之亦然——两者共享同一套 `cad` API 与 Shape 契约。这直接满足思考文档 §1.3「UI 和 AI 代码要能够交替生成，互相兼容」。

---

## 8. 安全模型

### 8.1 信任分级

| 级别 | 来源 | 执行域 | 控制 |
|---|---|---|---|
| **L0 内置** | 随应用打包 | 主线程 | 等同应用自身 |
| **L1 市场库** | 预构建 bundle（§5.2），经审核 | 主线程 | 内容 hash + SRI + 市场审核 + 用户显式安装 |
| **L2 任意 URL** | CDN / 用户提供的 URL | 主线程 | 需用户确认风险；**默认关闭** |
| **L3 沙箱** | 任意 | **Worker** | 无 DOM/cookie/storage；需路径 C 自研解析器（§5.4） |

**现状必须明示**：3d_editor 的 CadRuntime 在主线程（`src/engine/script-engine/ScriptEngine.ts:83-93`），L0–L2 都意味着**第三方代码获得完整页面权限**。在 L3 落地前，L2 必须在 UI 层明确警示。

### 8.2 Worker 沙箱的固有限制（如实说明）

跨 realm 时：
- `WeakSet`/`WeakMap` 身份**无法跨 realm** → Worker 内造的 Shape 到主线程不认；
- OCCT `ShapeHandle` 不可结构化克隆 → 跨 realm 下**恒为 mesh 路径**；

因此 L3 的库只能走**数据平面**（输入 `MeshData` → 输出 `MeshData`），由宿主侧 `solid()` 包装成 Shape。**这是 realm 的物理限制，不是设计选择**——ABI 形态上一版已描述，此处从略（放到 V5）。

---

## 9. 宿主（3d_editor）改动

| 模块 | 职责 |
|---|---|
| `src/engine/plugin/module-resolver.ts` | specifier → URL 解析表（配置/后端拉取），import 说明符重写（acorn，禁正则） |
| `src/engine/plugin/plugin-registry.ts` | 已安装库清单：`packageName → { url, version, contentHash, exports, manifest }` |
| `src/engine/plugin/load-plugin.ts` | `import(url)` → 校验 `FAIJS_STATE_VERSION` → `runtime.registerLib(name, mod)` |
| `src/engine/script-engine/ScriptEngine.ts` | **注册必须先于 check/execute**（`getRuntime()` 尾部，`:86-92`） |
| `src/engine/features/*` | `getFeatureByOp(op)` → `getFeatureByOp(packageName, op)` |
| 快照持久化 | `sceneScript` 真源里若含第三方 import，快照**必须**记录库清单（对齐既有 `SvgAssetStore` 的 `export/restore` 范式）；restore 后先注册再 check |

---

## 10. 路线图（faijs 后续开发规划）

> 每个 Version 都给出**目标、交付物、验收判据**。V1/V2 是第三方库场景的前置，V3 打通场景，V4/V5 是生态与加固。

### V1 —— 语言正常化（faijs 成为一门正常语言）

| # | 内容 | 交付物 |
|---|---|---|
| V1.1 | faijs 顶层 `import` 段（§6.1）：预扫描提升、IR 化、codegen 往返、行号修正 | `src/lang/parser.ts`、`types.ts`、`codegen.ts` |
| V1.2 | 多命名空间调用 `ns.op()`（§6.2）：parser 五处放开、`StatementIR.namespace`、compile 按 ns 发射、`exec.libs` | `src/lang/*`、`src/cad-runtime/exec-context.ts` |
| V1.3 | faijs **函数定义**（思考文档 §3 已预设）：顶层 `function` 声明，DAG 跳过非几何语句，feature = `包名.函数名` | `src/lang/parser.ts`、`terminal-dag.ts` |
| V1.4 | 命名空间/变量冲突规则 + check 校验 | `src/cad-runtime/runtime.ts` |
| V1.5 | 控制流禁令的**显式校验**：faijs 出现 if/for/while/try/switch/动态 import → `stage:'parse'` 明确报错（当前是笼统的"unsupported statement"，需给专用错误码） | `src/lang/parser.ts:749-750` |

**V1 验收**：一份含 `import` + 命名空间调用 + 自定义函数的 faijs，`parse → codegen → parse` 往返逐位相等；控制流语句报专用错误。

### V2 —— 可发布（让第三方 `npm i @faicad/faijs`）

| # | 内容 | 交付物 |
|---|---|---|
| V2.1 | **运行时状态全局锚点**（§3.4）：`src/runtime-state.ts`；`shape.ts:37,79`、`occtKernel.ts:23-24` 改为读锚点 | 新增 + 3 处改造 |
| V2.2 | **SDK 入口** `@faicad/faijs/sdk`（§4）：导出面、零运行时依赖、单文件 ESM 产物 `dist/sdk.js` | 新增 `src/sdk.ts`、build 脚本 |
| V2.3 | **ExecContext 增加 `cad` 字段**（`exec-context.ts`）：第三方库用 `exec.cad.box(...)` 调内置 op | 1 处 |
| V2.4 | **包元信息**：去掉 `private: true`、补 `license`/`repository`/`keywords`、`exports` 加 `./sdk`、README 补库开发指南 | `package.json` |
| V2.5 | **发布流水线**：版本号策略（AGENTS.md「打包发布前必须更新版本号」）、`npm publish --access public`、changeset 或手工 | CI |
| V2.6 | `markShape` 相关决策作废（锚点 + `solid()` 已覆盖，无需新增导出） | — |

**V2 验收**：
- `npm i @faicad/faijs` 装得到；`import { solid, isShape } from '@faicad/faijs/sdk'` 在裸浏览器（仅 importmap 指向 `dist/sdk.js`）可用；
- 两份独立加载的 faijs（不同 URL）构造的 Shape 互相 `isShape()` 成立；
- `stateVersion` 不匹配时抛错（不静默）。

### V3 —— 模块运行时（打通车床场景）

| # | 内容 | 交付物 |
|---|---|---|
| V3.1 | `ModuleResolver`（§3.5）：specifier → URL 表、acorn 重写 import 说明符 | 新模块（`src/module/` 或宿主侧，见开放问题 O1） |
| V3.2 | 宿主加载器：`import(url)` → 校验 `FAIJS_STATE_VERSION` → `registerLib` | 宿主侧 |
| V3.3 | `CadRuntime.registerLib` + `HostPorts.extLibs`；check ②改 `knownCallee(ns, callee)` | `src/cad-runtime/{runtime,ports}.ts` |
| V3.4 | 预构建 bundle 通道（§5.2）：后端 esbuild 服务 `@faicad/faijs/sdk` external → 对象存储 → 内容 hash URL | 后端 |
| V3.5 | CDN 通道（§5.3）作为开发者路径 | 宿主侧 |
| V3.6 | importmap 增加 `@faicad/faijs/sdk`；`dist/sdk.js` 复制到 `public/vendor/` | 3d_editor 构建 |
| V3.7 | 快照持久化库清单（§9） | 3d_editor |

**V3 验收（= R4/R5 的端到端判据）**：
1. 四层依赖库按 §0.3 发布/构建；
2. faijs 里 `import * as mech from 'mech-lib'` + `mech.makeHeadstock(...)` → 执行成功，产物进 `ExecutionResult.outputs`；
3. `makeHeadstock` 内部经 gear-lib 造的齿轮几何、经 bearing-db 查的轴承规格，全部正确生效；
4. 齿轮 Shape 与宿主内置 op 产物可混合参与 `cad.union` / `cad.assembly`（**身份互通**）；
5. 保存 → 重载 → check 通过、几何一致。

### V4 —— 生态

| # | 内容 |
|---|---|
| V4.1 | 库市场：上架/审核/版本/内容 hash/下架；库清单接口 |
| V4.2 | 第三方 op 的 UI 参数表单：约定库附带 JSON Schema（`export const schemas`），宿主通用渲染；无 schema → 仅代码层可用（符合思考文档 §3"不支持特征编辑"） |
| V4.3 | **faits 执行路径**（§7）：sucrase 去类型 → 说明符重写 → Blob 执行；faijs ⇄ faits 互操作 |
| V4.4 | 库开发脚手架（`create-faicad-lib`）+ 模板 + 本地调试宿主 |
| V4.5 | 文档站点：语言手册、API 参考、库开发指南（思考文档 §8.1「语言需要开源，方便 AI 学习」） |

### V5 —— 加固与扩展

| # | 内容 |
|---|---|
| V5.1 | Worker 沙箱（§8.2）：路径 C 自研模块解析器 + 数据平面 ABI |
| V5.2 | 多版本共存：ModuleResolver 支持 `scopes`（库 A 用 gear-lib@1、库 B 用 @2） |
| V5.3 | BREP 链路上的第三方 op：库声明 `brepImpl`，走 `resolvePath` 静态判定（与内置 op 同机制） |
| V5.4 | 按需加载：大库（如完整标准件数据库）的动态切片 |
| V5.5 | 引擎切换（思考文档 §1.2）：brep 后端 occt → 其它；第三方库不应绑定具体引擎 |

---

## 11. 验收标准（测试提纲，分层）

**L0 语言层（V1）**
- `import * as mech from 'mech-lib'` / `import { makeLathe } from 'mech-lib'` → `ScriptIR.imports` 结构正确，`packageName` 推导正确（`@scope/pkg/sub` → `@scope/pkg`）
- `parse → codegen → parse` 往返逐位相等（含 import 段、命名空间前缀）
- 控制流语句（if/for/while/try/switch、动态 `import()`）→ 专用错误码
- `codeToArgs('mech.chamfer(part0, {size:2})', { namespaces:['mech'] })` → `{size:2}`
- statementKey：`cad.chamfer` ≠ `mech-lib.chamfer`（修正 C2 回归锚点）

**运行时锚点（V2）**
- 同一 realm 内两份 faijs（模拟不同 URL 加载）→ 互相 `isShape()` 成立
- `stateVersion` 不匹配 → 抛错（不静默、不降级）
- OCCT kernel 只 init 一次（两份 faijs 共享）

**SDK（V2）**
- `dist/sdk.js` 单文件、零 `three`/`node:*` 静态 import
- `solid({positions,indices})` → `isShape() === true`；普通对象 → `false`
- `exec.cad` 键集 == `createInternalStdlib()` 键集

**模块解析（V3）**
- ModuleResolver 重写：多 import、重命名 import、含字符串/注释里形似 import 的文本**不被误伤**
- 未登记的 specifier → 明确报错（不回退、不静默）
- 版本校验失败 → 抛错

**端到端（V3，核心）**
- §10 V3 验收五项全过
- 库内部抛异常 → `runWithFailureHandling` 转 `failedAt`，携带 `packageName.callee`
- 库返回非 Shape（查询结果）→ 按普通值处理，不进 DAG

**宿主（V3，3d_editor）**
- 组件测试（`__tests__/`）：安装库后 timeline 出现只读的 `mech-lib.makeHeadstock` 节点
- 快照 export/restore 往返：库清单恢复后先注册再 check，几何一致

---

## 12. 风险与开放问题

| # | 问题 | 处置/待裁定 |
|---|---|---|
| **O1** | ModuleResolver 放 **faijs** 还是 **宿主**？ | 建议 **faijs 提供纯函数**（`resolveImports(code, table)`，可测），宿主提供**表与 IO**（fetch/build）。符合"引擎不感知环境"的分层 |
| O2 | `@faicad/faijs` 与 `@faicad/faijs-sdk` 拆成两个包 vs 单包 `/sdk` 子路径？ | 建议**单包子路径**（状态锚点已保证共享，拆包反而增加版本协调成本）。待裁定 |
| O3 | faijs 是否允许 `export`？ | 建议**不允许**（保持自动 export，思考文档 §2 已论证）；faits 允许 |
| O4 | 第三方 op 的 UI 表单 | V4.2；无 schema 时仅代码层可用（思考文档 §3 已给答案） |
| O5 | 主线程全权限风险 | V5.1 Worker 沙箱；在此之前 L2 需显式用户确认 |
| O6 | 大体积纯数据库（标准件）导致 bundle 膨胀 | V5.4 按需切片；V3 阶段先接受（tree-shaking 已能削减） |
| O7 | 库的 BREP 支持 | V5.3；V3 阶段第三方库恒 mesh 路径，`mode='brep'` 下由 `resolvePath` 抛 `BrepUnsupportedError` → `failedAt` |
| O8 | `stateVersion` 破坏性变更的逃逸阀 | 无。结构不兼容即抛错——贴合"不准写回退"红线 |
| O9 | 专利考量（思考文档 §8.1：核心思想不放入 faijs 仓库） | 本方案涉及的**通用机制**（全局锚点、模块解析）属常规工程手法；语言核心思想的文档化另行管理 |

---

## 13. 证据索引

| 事实 | 位置 |
|---|---|
| faijs/faits 语言定位（唯一权威） | `C:\my\Faicad\3d_editor\Faijs语言的思考.md` §1-§8 |
| faijs 禁止控制流（**仅**控制流） | 思考文档 §4 |
| 第三方库加载参考 brepjs | 思考文档 §5 |
| feature = 函数名（**带包名**） | 思考文档 §3 |
| 未知第三方函数：只读显示、不支持特征编辑 | 思考文档 §3 |
| 未知第三方函数：只读显示、不支持特征编辑 | 思考文档 §3 |
| parser 把代码包进 `export default async (cad) => {}` | `src/lang/parser.ts:504-520`（:545-552 校验参数名） |
| parser 拒绝非白名单语句（import 在此被拒） | `src/lang/parser.ts:749-750` |
| parser 五处 `cad` 硬编码 | `src/lang/parser.ts:127,190,291,613,679` |
| codegen 两处 `cad` 硬编码 | `src/lang/codegen.ts:82,135` |
| compile 五处 `cad` 发射点 | `src/lang/compile.ts:83,172,181,186,190` |
| `codeToArgs` 的 `NON_DECL` | `src/lang/code-to-args.ts:25-28` |
| statementKey（需加 ns 前缀） | `src/cad-runtime/module-executor.ts:260-273` |
| 编译产物零 import + Blob/data URL 加载 | `src/lang/compile.ts:1-19,249`；`src/cad-runtime/module-executor.ts:34-47` |
| stdlib 构建期静态装配 | `src/cad-runtime/internal-stdlib.ts:32-43`；`runtime.ts:230,235,793` |
| ModuleExecutor 持有 cad、fn 调用 | `src/cad-runtime/module-executor.ts:75,82-89,137` |
| Shape 身份单例（**锚点改造对象**） | `src/stdlib/shape.ts:37,54-56,79` |
| OCCT kernel 单例（**锚点改造对象**） | `src/occt-kernel/occtKernel.ts:23-32` |
| `ExecContext` 接口（需加 `cad` / `libs` 字段） | `src/cad-runtime/exec-context.ts:49-81` |
| `Shape` = 纯数据 `{positions, indices}` | `src/mesh/types.ts:30-33` |
| `resolvePath`（双链路静态判定，未导出） | `src/stdlib/internal/resolve-path.ts:30` |
| symbol table 三消费点 | `terminal-dag.ts:36,46,48`；`allocate-id.ts:66-73`；`runtime.ts:967-979` |
| faijs `private: true`（V2 要去掉） | `package.json:3` |
| faijs 依赖 three/occt/manifold/acorn | `package.json:49-55` |
| dist 为 130 个 ESM 文件、静态 import three | `dist/`（`grep "from 'three'"` 十余处） |
| node-host 静态 import `node:fs`/`node:path` | `dist/node-host/*.js`（浏览器不可加载根入口） |
| 3d_editor CadRuntime 主线程单例 | `src/engine/script-engine/ScriptEngine.ts:83-93,105-109` |
| 3d_editor Feature 按 op 名唯一（需升级为包名+op） | `src/engine/features/types.ts:94-98`；`ScriptEngine.ts:43-58` |
| 3d_editor build 时注入 importmap | `vite.config.ts` `cdnExternalPlugin.transformIndexHtml` |
| 3d_editor 后端接口存在（可供 V3.4 构建服务） | `vite.config.ts` proxy `/api/auth` `/api/internal` |
| 3d_editor 资产 key 范式（库清单持久化参照） | `src/engine/version-store/SvgAssetStore.ts` |
| 上一版被废弃方案 | `docs/plans/2026-08-28-web-host-dynamic-lib-loading-design.md`（见 §0.2） |
