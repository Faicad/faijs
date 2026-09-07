# 兼容面统一投影：导出流程简化方案

**日期**：2026-09-07
**性质**：技术实施方案（仅分析 + 设计，不含实现）
**状态**：方案（未实施）
**修订**：v2（2026-09-07 复核后重写。修正提取源口径、目标数、手写面独有逻辑、
库层面与脚本面的准入差异；v1 的 §3.1/§3.6/§5.3/§5.4/§8 结论与实测不符，已替换）

---

## 0. 术语表（先钉死，全文只用这里的词）

| 术语 | 定义 | 代码位置 | v2 实测规模 |
|---|---|---|---|
| **上游基线** | brepjs 上游导出面快照 | `api/surface/upstream-surface.json` | 852（value 564 / type 288） |
| **vendored 树** | 移植进本仓的 brepjs 源码，上游的**裁剪快照** | `packages/core/src/vendored/brepjs/**`（259 个 `.ts`） | 1629（value 1323 / type 306） |
| **库层面**（兼容面 / compat 面） | 第三方库源码 import 的 TS 面，brepjs 形态 | `api/compat/index.ts` + 门面 `src/compat.ts` | **81** |
| **生成面** | 由 `arg-spec.ts` 生成的中间产物，faijs 形态 | `api/generated/*.ts` | 171（其中 84 个是 op） |
| **脚本面**（cad 面） | `.fai.js` 里 `cad.*` 可见的 op 集合 | `api/api-namespace.ts` + `generated/script-face.ts` | **61** |
| **check 符号表** | CLI `check` 用的符号存在性表，与脚本面同源 | `lang/symbol-table.generated.ts` | 61（与脚本面一致） |

**禁止混用**：本方案不再使用 v1 的 "L3 面 / brep 面 / cadOps 面" 三个词，一律对应到上表。

---

## 1. 目标

### 1.1 用户原话（方向裁决，本方案的唯一目标来源）

> 「brepjs 支持的 api，应该都导出啊。而且我未来要移植更多的 cadquery 库，所以不能只看
> mini_lathe 用到了哪些。如果不显著增加移植难度，能导出的 api 都应该导出。」

> 「维持不导的只有两类：IO/字节类（走 host ports）和 voxel/implicit/lattice/csg
> （与 faijs sdf 冲突，在 upstream-exclusions.json 里）。请按照这个标准，并分析目前的
> 代码现状，写一份独立的新的技术实施方案，简化目前的导出处理流程。」

> 「库层面是否所有 brepjs 的 api 都导出，而脚本面的导出则有何不同？」（2026-09-07 追加）

### 1.2 两个面的目标必须分开（v2 核心修正）

v1 把「导出 818 个」当成单一 KPI，**错误地把库层面和脚本面绑在了一起**。实测判据完全不同：

| | **库层面**（compat） | **脚本面**（cad） |
|---|---|---|
| 准入方式 | **排除式**：除 A/B 两类外全导 | **准入式**：逐个人工/规则放行 |
| v2 目标数 | **799**（见 §1.3 / §3.1，非 v1 的 818） | **不随库层面扩张**，现状 61，按需增量 |
| 现状 | 81 | 61（= faijs 原生 34 + brepjs 投影 27） |
| 是否受另一面影响 | 否 | 否 |

**为什么必须分开**：`scriptFace` 是 `arg-spec.ts` 里的人工布尔标记
（`gen-l3-surface.ts:252` 的过滤条件为 `kind === 'brep-op' && scriptFace === true`），
与库层面导出面**相互独立**。库层面补到 799 之后，脚本面仍然是 61 个，除非逐个放行。

### 1.3 排除规则（仅两条）

| 排除项 | 范围 | 理由 |
|---|---|---|
| **A. IO / 字节类** | `io` 模块（28）+ 散落各模块的 `import*` / `export*`（6）= **34 个** | 字节流走 host ports，不在兼容面 |
| **B. sdf 冲突模块** | `voxel` / `implicit` / `lattice` / `worker` 整模块 + `ns/csg` | 与 faijs sdf 冲突，`upstream-exclusions.json` 已裁决 |

B 类不在 852 内（`upstream-surface.json` 已是排除后基线，排除的 98 条单独登记在
`upstream-exclusions.json`），故不参与相减。

**⚠️ A 类规则有一个漏洞，执行时必须显式堵上**：规则写的是 `module === 'io'`，
但 `upstream-surface.json` 里 `ns` 模块的 `io` 命名空间对象（`booleans construction
io measurement modifiers patterns primitives query transforms` 共 9 个）其 `module`
字段是 **`'ns'` 不是 `'io'`**，按字面规则不会被排除——而它转发的正是字节类 API。
⇒ 覆盖表必须显式登记 `io: { kind: 'skip', note: 'A-io' }`（§5.4）。

**目标数实测（精确）**：

```
852 − A类 34                        = 818   （理论值）
818 − 目录树不可达 27                = 791
791 + ns 命名空间对象 9 − ns.io 1     = 799   ← 本方案可执行目标
```

（不可达 27 = kernel D10 裁切 15 + ns 命名空间 9 + `CurveLike` 1 +
`BoxOptions` / `RotateOptions` 2；详见 §3.1。）

---

## 2. 现状链路：5 个环节，2 个人工维护点，1 个外部依赖

```
[C:/git/OpenCascade/brepjs/src/index.ts]   ← ① 仓库外硬编码绝对路径
        │
        │ gen-upstream-surface.ts (182 行，用 ts API)
        ▼
upstream-surface.json (852)  +  upstream-exclusions.json (98)
        │
        │ ② 人工维护：arg-spec.ts (866 条 × 13 字段)
        ▼
ARG_SPEC：skip 395 / type 286 / pure 111 / brep-op 42 / query 18
        │
        ├─ gen-l3-surface.ts (370 行) ──► api/generated/*.ts (171，其中 84 个 op)
        │                              └─► script-face.ts (27) + manifest
        ├─ gen-symbol-table.ts (122 行) ─► symbol-table.generated.ts (61)
        └─ gen-api-dts.ts (334 行) ──────► mesh/api.d.ts
        │
        │ ③ 人工维护：api/compat/index.ts (440 行，81 个导出)
        ▼
@faicad/faijs/compat  ← 库作者唯一入口
```

### 2.1 各环节实测（2026-09-07）

| 环节 | 文件 | 规模 | 自动化 |
|---|---|---|---|
| ① 提取上游面 | `scripts/gen-upstream-surface.ts` | 182 行 | ⚠️ **手动运行**，`UPSTREAM_INDEX` 是硬编码绝对路径（`:28`） |
| ② 人工分类表 | `src/api/surface/arg-spec.ts` | 866 条，161 KB | ❌ **全手工** |
| ③ 投影生成 | `scripts/gen-l3-surface.ts` | 370 行 | ⚠️ 手动运行 |
| ④ 符号表 | `scripts/gen-symbol-table.ts` | 122 行 | ⚠️ 手动运行 |
| ⑤ 手写兼容面 | `src/api/compat/index.ts` | 440 行 / 81 导出 | ❌ **全手工** |

**4 个生成脚本均未接入 `package.json`**（根 `package.json` 只有 `gen-ops-api-inventory`）。

### 2.2 库层面 81 个的构成（v2 实测）

只有 **15 个经过包装**，其余 **66 个是裸 re-export**（零成本、零语义改动）：

| 包装方式 | 数量 | 符号 |
|---|---|---|
| `wrapDual`（kernel 断言 + D11 双形态） | 3 | `cone` `torus` `ellipsoid` |
| `wrapGuarded`（仅 kernel 断言） | 10 | `fuse` `cut` `extrude` `revolve` `loft` `intersect` `makeExternalGear` `makeInternalGear` `makePlanetaryGear` `thread` |
| 手写（含独有逻辑，见 §3.6） | 2 | `box` `rotate` |
| 裸 re-export | 66 | 组合器、向量、平面、错误、常量、类型、查询、度量、2D 端口 |

⇒ 「补到 799」的绝大部分工作只是把名字转出来，**真正的决策点只有 15 个**。

### 2.3 脚本面 61 个的构成（v2 实测）

```
cad 面 = faijs 原生 dual op（34）+ scriptFaceOps（27）= 61
```
与 `lang/symbol-table.generated.ts` 的 61 条**完全一致**（B1 三源一致，已有测试守卫：
`lang/op-set-consistency.test.ts`）。

27 个投影 op（`generated/script-face-manifest.ts`）：
`torus fuse cut split offset rotate mirror clone applyMatrix transformCopy locate heal
simplify autoHeal fixShape healSolid ellipsoid`（topology 17）
`linearPattern circularPattern gridPattern drill pocket boss mirrorJoin rectangularPattern
convexHull`（operations 9）`makeBaseBox`（sketching 1）。

### 2.4 生成面 171 个里 87 个不是 op

实测 `compatOp(` 出现 84 次（topology 50 / operations 32 / sketching 2），
其余 87 个是纯 re-export 的类型 / 常量 / 组合器。
且**只有 script-face 的 27 个有公开入口**（`api/index.ts:51` + `api-namespace.ts:60`），
其余 144 个除一个测试引用（`compat-op.test.ts` 用了 `generated/topology` 的 `clone`）外零引用。

---

## 3. 实测数据（2026-09-07，TypeScript 编译器 API + 正则扫描）

> 以下全部为当日实测，非文档推断。**v1 的 §3.1 / §3.6 结论已被本节推翻。**

### 3.1 提取源必须是目录树，不能是 barrel（v2 关键修正）

v1 §5.1 说「从 `vendored/brepjs/index.ts` 读 834 个符号」。**实测该前提不成立**：

| 口径 | value | type | 合计 |
|---|---|---|---|
| `index.ts` 顶层 `export {}` 块 | 531 | 115 | **646** |
| index.ts 顶层 + 9 个 `export * as` 命名空间展开 | 538 | 115 | 653 |
| **整个 vendored 目录树（259 文件）** | **1323** | **306** | **1629** |

三个致命事实：

1. **核心建模 op 不在 barrel 顶层**。`box` `fuse` `fillet` `heal` `line` `wire`
   `translate` `cast` `applyGlue` `isNumber` 都在 9 个命名空间下：
   `export * as primitives / booleans / modifiers / transforms / measurement / io /
   query / construction / patterns`（`index.ts` 内 9 处）。
   只扫 barrel 顶层 ⇒ 最重要的 op 全部丢失。
2. **核心类型根本不在 barrel**。`Result` `Ok` `Err` `BrepError` `ClosedWire`
   `ValidSolid` `GearGeometry` 等都不在 barrel 顶层导出，
   而 `api/compat/index.ts` 是**直接 import 子模块**（如 `vendored/brepjs/core/result.js`）拿到的。
   生成面同样如此（实测 vendored 来源：`topology/api.js` 23 次、`core/result.js` 31 次、
   `index.js` 38 次、`gear/index.js` 14 次…）。
3. **vendored 是上游的裁剪快照，不是 1:1**。`index.ts:7-9` 有 `FAIIS-CUT` 注释：
   kernel init machinery（`init` `withKernel` `withTier` `prewarm` `getKernelTier`
   `registerKernelTier` `initFromOC` `initFromManifold` `withQuality`
   `resetPerformanceStats` `getPerformanceStats` + 类型 `BrepkitAdapter`
   `BrepkitHandle` `OcctWasmHandle` `PerformanceStats`）**按 D10 单内核冻结故意裁掉**。

**⇒ 可达目标数（目录树口径）**：818 个目标中 791 个可达，27 个不可达：

| 不可达原因 | 数量 | 清单 | 处置 |
|---|---|---|---|
| D10 裁切（kernel） | 15 | `init` `initFromOC` `initFromManifold` `prewarm` `withKernel` `withQuality` `withTier` `getKernelTier` `registerKernelTier` `resetPerformanceStats` `getPerformanceStats` `BrepkitAdapter` + 类型 `BrepkitHandle` `OcctWasmHandle` `PerformanceStats` | **不得补回**，manifest 记 `excluded / rule: D10-cut` |
| `ns.*` 命名空间对象 | 9 | `primitives` `booleans` `modifiers` `transforms` `measurement` `io` `query` `construction` `patterns` | **以命名空间对象形式导出**（除 `io`，见 §1.3） |
| vendored 未移植 | 3 | `CurveLike`(type)、`BoxOptions`(type)、`RotateOptions`(type) | manifest 记 `missing`，需同步上游才可达 |

**可执行目标 = 799**（791 + ns 命名空间 9 − `ns.io` 1）。

**命名空间与扁平名会重复暴露同一实现**（如 `compat.primitives.box` 与 `compat.box`
指向同一个 vendored 函数）。这是**有意为之**：命名空间保上游 1:1（`import * as
primitives` 的库代码原样可用），扁平名保库作者便利。二者不冲突，也不违反
"一个名字一份实现"（实现仍只有一份）。

### 3.2 签名可机器提取（保留 v1 结论）

vendored 是 259 个带完整类型标注的 TS 源文件，实测可提取：

```
fillet   (shape: Shapeable<T>, radius: FilletRadius) -> Result<T>
shell    (shape, faces: Face[] | FinderFn<Face> | ShapeFinder<Face>, thickness, options?) -> Result<T>
loft     (wires: Shapeable<Wire<Dimension>>[], options?: LoftOptions) -> Result<Shape3D>
rotate   (shape: Shapeable<T>, angle: number, options?: RotateOptions) -> T
```

`name` / `params` / `args` / `returnType` / `geometryArgs` 五个字段可由 AST 推导。

### 3.3 覆盖度：现状产物 100% 在 vendored 树内

生成面 171 个 + compat 面 81 个，全部能在目录树里找到。

### 3.4 自动 `kind` 判定准确率（对比 852 条人工表全量，v1 实测）

| 人工 kind | 数量 | 自动命中 | 准确率 |
|---|---|---|---|
| `type` | 286 | 276 | 96.5% |
| `brep-op` | 42 | 40 | 95% |
| `query` | 18 | 16 | 89% |
| `pure` | 111 | 89 | 80% |
| **四类小计** | **431** | **421** | **97.7%** |

### 3.5 395 个 `skip` 中 349 个按签名可投影

人工 skip 的理由（"子形状句柄""数组入参""装配场景"）不是技术不可行，
而是当时生成模板不支持（独立反证：`loft` / `normalAt` / `getShells` / `faceCenter`
在 arg-spec 里都是 `skip`，但手写面照样能用）。

### 3.6 「手写面无独有逻辑」不成立（v2 推翻 v1 §3.6）

v1 称 compat 面导出「全部是模板调用」。实测 **4 类手写独有逻辑**：

| 符号 | 独有逻辑 | 位置 |
|---|---|---|
| `box` | 45 行手写对象形态解析：`box({size})` / `box({size:[w,d,h]})` / `box({width,depth,height})`，含自定义 `E_ARGS_FORM` 报文 + `BoxDimensions` interface | `compat/index.ts:96-171` |
| `rotate` | 手写 upstream-18 `{at, axis}` options 适配。**vendored 源与生成面不同**：手写用 `transformFns.rotate`（四参位置式），生成面用 `api.rotate`（原生 options 式） | `compat/index.ts:435-441` |
| `cylinder` `sphere` | P25 **故意裸 re-export**，连 kernel 断言都不要（注释："raw morph form is what portable libraries call"） | `compat/index.ts:178-180` |
| `cone` `torus` `ellipsoid` | 参数名与生成面不一致（手写 `bottomRadius`/`topRadius`，生成面 `radiusBottom`/`radiusTop`） | `compat/index.ts:182-190` |

⇒ **v1 的 S2「生成器产出、无手写独有逻辑」做不到**，除非覆盖表能表达这些（见 §5.4）。

### 3.7 两个面的准入标准（本轮新增，回答「脚本面有何不同」）

| 判据 | 库层面 compat（81） | 脚本面 cad（61） |
|---|---|---|
| 调用形态 | **同步**，brepjs 句柄 / `Result` 进出 | **async**，`Promise<faijs Shape>` |
| 装饰要求 | 无，普通 TS 函数 | 必须 `defineOp` / `compatOp`，带 `DUAL_OP_META`（供 `assertLibConforms` 校验） |
| 子形状 `Face`/`Edge`/`Wire` | **允许**自由传递 | **禁止跨界**（句柄不受 faijs GC 管理，也无法 `adoptEntity`） |
| 数组入参 / 复合记录 | **允许**（如 `SheetMetalPart` 内嵌 `solid`） | 须可 `borrowDeep` 借入、`adoptOut` 收编 |
| 能力路由 | 无，纯 brep-only，kernel 未绑定即抛 `assertKernelBound` | 有，mesh 模式对 brep-only op 抛 `E_MESH_UNSUPPORTED` |
| 引擎可用性 | 任何模式都要求 brep kernel | 34 个原生 op 走 mesh 也能跑 |

**机制位置**：`projectBrepOp`（`internal/compat-projection.ts:72`）= kernel 断言 +
`resolveArgs`(D11) + `callBrepjs` ⇒ brepjs 形态；
`compatOp`（`internal/compat-op.ts:182`）= `defineOp` 再包一层 ⇒
`borrowDeep` → `unwrapResult` → `adoptOut`，faijs 形态。**两者是叠加不是并列**。

**典型反例（必须记住）**：
`loft`（`Wire[]` 入参）、`getFaces` / `getEdges` / `normalAt` / `faceCenter` /
`sharedEdges`（子形状级）—— **全在库层面，全不在脚本面**。
反过来 `split`（返回两个产物）却在脚本面 27 个里 ⇒ **「返回单一 Shape」不是脚本面判据**，
v1 §5.3 的那条推导规则会误杀 `split` 一类符号。

### 3.8 compat 面的两个入口与实测使用方（2026-09-07）

**两个入口，同一份 81 个符号**：

| 入口 | 形态 | 定义位置 |
|---|---|---|
| 扁平子路径 `@faicad/faijs/compat` | `import { box, fuse, ok } from '@faicad/faijs/compat'` | `src/compat.ts`（一行 `export * from '@faicad/faijs-core/api/compat'`） |
| 顶层命名空间 `compat` | `import { compat } from '@faicad/faijs'` → `compat.box` | `core/src/api/index.ts:86` `export * as compat from './compat'`，经 `core/src/index.ts:264` `export * from './api'` 与 `browser.ts:267` 上浮到门面 |

**实测使用方（grep 全仓，2026-09-07）**：

- **扁平子路径：唯一真实消费者 = `packages/sheetmetal`**（钣金库，`@faicad/sheetmetal`）。
  实测 import **53 个符号**，全部落在 compat 面现有 81 个内（0 个缺失）。高频：
  `Result`(22 文件) `err`/`ok`/`validationError`(21) `Solid`(16) `isValid`(15)
  `Vec3`(13) `getEdges`(10) `measureVolume`(10) `getSolids`(9) `vecAdd`/`vecScale`(9)
  `Wire`(8) `curveStartPoint`(8) `getBounds`(7) `box`/`cut`/`fuse`/`line`/`translate`/`wireLoop`(6)。
  次高频恰是**脚本面禁止**的那类：`getFaces` `normalAt` `faceCenter` `sharedEdges`
  `outerWire` `isPlanarWire` `curveStartPoint` —— 直接印证 §3.7 的分工：这些 API
  **只在库层面有意义**。
- **顶层命名空间 `compat`：零外部消费者**。仓内无任何 `compat.xxx` 的业务调用，
  只有 `lang/op-set-consistency.test.ts` 经 `import * as apiIndex` 做三源一致断言。
- `packages/gear-lib-demo` **不走 compat 面**：它 import `@faicad/faijs` 顶层 +
  `@faicad/faijs-core/sdk`（`defineOp` 作者面），与 brepjs 移植路径无关。

⇒ **Q4 的硬数据**：一个已移植完成的真实钣金库只用 **53 个**符号，而库层面目标是 799。
这是"按调用集驱动"最直接的证据（见 §11.2 Q4）。

---

## 4. 问题诊断

| # | 问题 | 实测证据 | 影响 |
|---|---|---|---|
| **P1** | `arg-spec.ts` 866 条 × 13 字段全手工 | §2.1 | 主复杂度源 |
| **P2** | 表中大部分信息已存在于 vendored 源码 | §3.2 | 人工重复录入，易失同步 |
| **P3** | 手写面与生成面**互不引用** | §2.1 | 语义来源分裂（但冲突已被命名空间隔离，见 §5.5） |
| **P4** | 生成面 171 个里 144 个无公开入口 | §2.4 | 生成了拿不到 |
| **P5** | `scriptFace` 是手工标记，无推导规则 | §1.2 | 每次加脚本面 op 都要记得打标 |
| **P6** | 依赖仓库外硬编码绝对路径 | `gen-upstream-surface.ts:28` | 换机器/换分支即失效，无法进 CI |
| **P7** | 4 个生成脚本未接入 npm scripts | §2.1 | 产物与源码易失同步 |
| **P8** | **v1 提取源（barrel index.ts）不成立** | §3.1 | 核心 op 与核心类型都会丢失，P0 第一步就卡住 |
| **P9** | **手写面有 4 类独有逻辑** | §3.6 | v1 的 S2 做不到 |
| **P10** | **目标数 818 在 vendored 上不可达** | §3.1 | v1 验收①永远达不到（应为 799） |
| **P11** | **v1 把两个面绑在同一个 KPI 上** | §1.2 / §3.7 | 会诱导把库层面 799 个全推进脚本面，破坏红线 |

---

## 5. 简化方案

### 5.1 新链路：5 环节 → 3 环节，2 人工点 → 1 人工点

```
[vendored/brepjs/**/*.ts]  ← 目录树（259 文件，1629 导出名）★不是 index.ts
        │
        │ ① extract —— TS 编译器 API 读签名 / JSDoc / 模块归属
        ▼
   符号表（含完整签名，按 §3.1 口径）
        │
        │ ② classify —— 模块排除(A/B) → kind 推导 → 包装策略推导 → 覆盖表修正
        ▼
   投影计划（库层面 799 + 排除项 + N 条例外）
        │
        │ ③ emit —— 双投影（同一个符号可同时产出两个形态）
        ▼
   generated/brepjs/*.ts          ← 库层面：brepjs 形态（raw / guard / dual / custom），目标 799
   generated/cad/*.ts             ← 脚本面：faijs 形态（compatOp 再包一层）
                                     ★ 只对 scriptFace=true 的符号产出（现状 27 个），
                                       不随库层面扩张——这是 §1.2 的硬约束
   symbol-table.generated.ts      ← 由 generated/cad 导出面生成，须恒为 61 条
   projection-manifest.json       ← 覆盖度自检表（四态）
```

**人工维护点只剩一个：例外覆盖表（§5.4）。**

### 5.2 简化项（相对 v1 有修正）

| # | 简化 | 现状 | 简化后 |
|---|---|---|---|
| **S1** | 取消 `arg-spec.ts` 手工表 | 866 条 × 13 字段 | 删除，改机器推导 + 覆盖表 |
| **S2** | 取消手写 compat 面 | 440 行 / 81 导出 | **仅 66 个裸 re-export 可自动产出**；15 个包装项需覆盖表显式声明（§3.6） |
| **S3** | 取消外部路径依赖 | `C:/git/OpenCascade/...` | 读仓库内 vendored 目录树 |
| **S4** | 消灭同名冲突 | 两套清单 | 同源双投影 + 命名空间隔离（§5.5） |
| **S5** | `scriptFace` 手工标记 → 规则 + 覆盖表 | 手工打标 27 个 | 规则推导（修正版，§5.3）+ 覆盖表兜底 |
| **S6** | 脚本接入 npm + CI 守卫 | 4 脚本手工运行 | `npm run gen:surface` + `--check` |

### 5.3 分类规则

**第一层：模块排除（用户标准 A / B）**

```ts
const EXCLUDED_MODULES = { voxel, implicit, lattice, worker }             // B 类
const EXCLUDED_BY_IO   = module === 'io' || /^(import|export)/.test(name)  // A 类（34 个）
const EXCLUDED_BY_D10  = KERNEL_CUT_LIST   // §3.1 表格里的 15 个，逐字照抄，不得补回
const EXCLUDED_NS_IO   = name === 'io' && module === 'ns'  // §1.3 的漏洞：module 是 ns 不是 io
```

**第二层：kind 推导**（v1 实测准确率 97.7%，规则不变）

```ts
type    → 声明为 interface / type alias / enum
pure    → 参数与返回值均不含 Shape 类型
query   → 参数含 Shape、返回值不含 Shape
brep-op → 返回值含 Shape（含 Result<T> 解泛型后）
```
关键：**必须解泛型**。`fillet` 返回 `Result<T>`，不解 `T` 会误判为 `query`。

**第三层：包装策略推导（v2 新增维度，对应 §3.6）**

```ts
wrap: 'raw'    → 纯函数 / 类型 / 常量 / 组合器：直接 re-export，不加 kernel 断言
                 （现状 66 个属于此类，含 P25 的 cylinder / sphere）
     'guard'   → 建模 op：assertKernelBound + 原样转发（现状 wrapGuarded 10 个）
     'dual'    → 建模 op + D11 双形态：assertKernelBound + resolveArgs（现状 3 个）
     'custom'  → 需要手写适配器（现状 box / rotate），覆盖表必填 adapter 字段
```

**第四层：scriptFace 推导（v2 修正版）**

```ts
scriptFace = (kind === 'brep-op')
          && 入参不含子形状句柄（Face / Edge / Wire / Vertex / Shell）
          && 入参不含 Shape 数组          // loft(Wire[]) 因此被排除
          && 不在 faijs 同名冲突表内
          // ❌ 不要写「返回单一 Shape」—— split 是多产物却在现状 27 个里
```
现状 27 个必须能被规则完整复现，否则 P1 阶段判定失败（v1 未做此验证）。

### 5.4 例外覆盖表（唯一人工维护点）

`src/api/surface/projection-overrides.ts`。**v1 的字段不够用**（表达不了 §3.6 与 §9.1），
v2 扩为 **8 个字段**：

```ts
export interface Override {
  kind?: 'type' | 'pure' | 'query' | 'brep-op' | 'skip'
  wrap?: 'raw' | 'guard' | 'dual' | 'custom'
  semantics?: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'ok' | 'unknown'
  //   §9.1 语义分级。S1/S2 由分类器自动填；S3–S6 必须人工填。
  //   未判定 = 'unknown'，禁止进入 exported 状态（§8 验收 9）
  adapter?: string        // wrap === 'custom' 时必填：手写适配器模块名（放在 api/compat/adapters/）
  params?: string[]       // D11 参数名表（对象形态 → 位置形态）
  scriptFace?: boolean    // 脚本面准入（§5.3 第四层）
  rename?: string         // faijs 同名冲突时的导出名（不改上游名）
  source?: string         // 指定 vendored 源文件（默认自动解析；rotate 必须显式指定）
  note: string            // 必填：为什么这条不能被规则推导
}

export const OVERRIDES: Record<string, Override> = {
  box:      { wrap: 'custom', adapter: 'box-adapter', source: 'topology/primitiveFns.js',
              note: '§3.6：{size} 对象形态 + 自定义 E_ARGS_FORM' },
  rotate:   { wrap: 'custom', adapter: 'rotate-adapter', source: 'topology/api.js',
              note: '§3.6：upstream-18 {at,axis} 适配（勿用 transformFns 四参位置式）' },
  cylinder: { wrap: 'raw', note: 'P25 决定：库作者要 raw morph 形态' },
  sphere:   { wrap: 'raw', note: '同上' },
  split:    { scriptFace: true, note: '多产物也放行（现状 27 个之一，勿被规则误杀）' },
  loft:     { scriptFace: false, note: 'Wire[] 入参，仅库层面' },
  io:       { kind: 'skip', note: '§1.3：ns.io 转发字节类 API，module 字段是 ns 故规则漏判' },

  // —— §9.1 语义分级条目（S3–S6 人工判，样板见下，P2 阶段逐条补完）——
  fuseWithEvolution:  { semantics: 'S1', note: '§9.1：Result<EvolutionResult<T>>，需再取 .shape' },
  solveAssembly:      { semantics: 'S2', note: '§9.1：返回值是变换矩阵，纯数据，非几何' },
  createAssembly:     { semantics: 'S2', note: '§9.1：返回 XCAF kernel handle，非 Shape 且需 dispose' },
  resetDisposalStats: { semantics: 'S3', note: '§9.1：破坏性全局状态，导出前需确认是否可接受' },
  getDisposalStats:   { semantics: 'S3', note: '§9.1：读模块级单例 _stats' },
  getFont:            { semantics: 'S4', note: '§9.1：依赖字体来源，宿主注入 vs vendored 内部路径' },
  loadFont:           { semantics: 'S4', note: '同上' },
  sketchText:         { semantics: 'S4', note: '同上' },
  box:                { semantics: 'ok', note: '§9.1 S6：at=中心语义，faijs 已对齐，无需额外适配' },
  rotate:             { semantics: 'ok', note: '§9.1 S6：3D 用度，与 faijs 契约一致' },
  // …（unresolved 约 60 条 + D10 裁切 15 条 + ns 命名空间 9 条 + 2d 模块 45 条待人工比 S6）
}
```

**规模估算**：约 **60~80 条**（unresolved + D10 cut + ns 命名空间 + 15 个包装决策 +
faijs 同名冲突）。对比现状 866 条手工表，维护量下降 ~90%。

### 5.5 产物结构与命名空间（v2：不改名）

```ts
// @faicad/faijs
export * as compat from './generated/brepjs'   // 库层面：brepjs 形态（现状 api/compat 的继任）
// 脚本面继续走 api-namespace.ts 注入的 cad 命名空间，不新增 cadOps 名
```

**v1 提议改名为 `brep` / `cadOps`——仍然否决**，但理由**不是**"不改名"：
`brep` 是引擎层概念（与"面"混淆），`cadOps` 与既有 `cad` 命名空间混淆；这两个名字都不好。

**"不改名"的理由已作废（用户裁决，2026-09-07）**：

> 「本项目未上线，不需要 api 层面的任何兼容性，可以直接改掉。」

即 `compat` 是既有公开 API（`@faicad/faijs/compat` 子路径 + 顶层 `compat` 命名空间）
**不再构成改名阻力**。新名字见 §11.2 Q5（建议 `brepjsCompat` / 子路径
`@faicad/faijs/brepjs-compat`）。

**连带项已裁决（2026-09-07）**：`registerLib` 上那个与"兼容"无关的参数
`{ compat }` 改名 **`{ autoLift }`**，默认值改为**推断式**（§11.2 Q5-b）。

**全文称呼约定**：名字未最终裁决前，本文继续用「库层面 / compat 面」指代这个面；
Q5 定名后全文机械替换。

**S4 如何消灭同名冲突**：`box` / `cut` / `fuse` / `rotate` 等重名符号，
现在两套各写一份；简化后**同一份 vendored 实现按 wrap 策略生成一次，按形态生成两次**：

```
compat.fuse = guard(projection)                  // 一层：brepjs 形态，同步 / Result
cad.fuse    = compatOp(projectBrepOp('fuse',…))  // 两层：faijs 形态，async / Shape
```

不合并、不改名（保住"一个名字一份实现"红线与上游 1:1 对应），实现只有一份。
**注意**：`cad.box` / `cad.intersect` 是 faijs 原生 dual op
（`api/primitives.ts:138`、`api/boolean.ts:162` 的 `defineOp({mesh, brep})`），
与 brepjs 投影**毫无关系**，只是名字撞了——这类冲突靠命名空间隔离，不进覆盖表。

### 5.6 覆盖度自检表（四态，v2 修正）

`projection-manifest.json` 记录每个上游符号的状态，供移植新库时查缺口：

```json
{ "fillet":     { "status": "exported", "kind": "brep-op", "faces": ["compat"] },
  "fuse":       { "status": "exported", "kind": "brep-op", "faces": ["compat", "cad"] },
  "loft":       { "status": "exported", "kind": "brep-op", "faces": ["compat"] },
  "exportSTEP": { "status": "excluded", "rule": "A-io" },
  "sdfBox":     { "status": "excluded", "rule": "B-sdf-conflict" },
  "withKernel": { "status": "excluded", "rule": "D10-cut" } }
```

四态：`exported` / `excluded` / `missing`（vendored 里没有，需先同步上游）/
`unresolved`（提取器判不出）。

---

## 6. 迁移与兼容

| # | 风险 | 对策 |
|---|---|---|
| **M1** | `compat` 面 81 个符号是既有公开 API | 改名与否见 §11.2 Q5——**用户已明确"未上线、不需要 API 兼容"，故既有 API 不再构成阻力**。无论改不改名，81 个符号都要逐个断言等价 |
| **M2** | 生成面 144 个此前零引用 = 从未被执行验证 | 全量展开前先跑冒烟（§8 验收 3） |
| **M3** | 新增符号可能与 faijs 自有 op 同名 | 冲突表驱动，显式 `rename`，不改上游名 |
| **M4** | `arg-spec.ts` 的消费者 | 实测只有 **1 个**：`gen-l3-surface.ts:24`（v1 说"3 个脚本"是错的；`gen-symbol-table.ts` 只是注释里提到，实际从 `api-namespace` 生成）。P3 双轨跑通后删表，改动面比 v1 估计的小 |
| **M5** | 子形状句柄跨界红线 | 只影响 `scriptFace` 判定；库层面不受限（§3.7） |
| **M6** | ~~与 no-IR 通道重构排期冲突~~ **已消除（2026-09-07 实测）** | no-IR 重构**已完成**：`17eb190` 把默认 executor 翻转为 direct、`97a0484` 删除 IR pipeline（`packages/core/src/lang/` 下已无 `parser.ts` / `compile.ts`）。`direct-executor.ts` 不 import `api/index.ts`（TS 兼容面与执行通道无交集）。⇒ **P4 无前置等待**。切换前唯一要确认的是 `api/index.ts` 的 `export * as compat` 形态在新产物里保持不变（§5.5） |

---

## 7. 分期

| 阶段 | 内容 | 交付 / 门禁 |
|---|---|---|
| **P0** | 提取器 `extract`：扫描 **vendored 目录树**（非 index.ts），产出符号表 | 与 `upstream-surface.json` 逐项比对；**同时产出"不可达 27 个"清单**（§3.1） |
| **P1** | 分类器 `classify`：模块排除 + kind + **包装策略** + **scriptFace 规则必须复现现状 27 个** | 门禁（三条全过才进 P2）：① kind 准确率 ≥ 95%（v1 实测基线 97.7%）；② 包装策略与现状 15 个包装项一致率 ≥ 14/15；③ **scriptFace 复现率必须 27/27** |
| **P2** | 例外覆盖表（60~80 条，含 §9.1 语义分级 S1–S6）+ 生成器 `emit`（双投影） | 产出 `generated/brepjs` + `generated/cad`；`exported` 条目 `semantics` 不得为 `unknown`（验收 9） |
| **P3** | 等价性验证：`compat` 81 个逐个不变；生成面 84 个 op 逐个冒烟 | 回归报告 |
| **P4** | 切换入口 + 删除 `arg-spec.ts` 与手写 compat 面 + 接入 npm/CI | 覆盖度自检表（四态） |
| **P5** | 展开剩余符号至库层面 799。**脚本面不参与本阶段** | `projection-manifest.json` 全量 |

---

## 8. 验收（v2：全部改为可执行）

1. **库层面覆盖度**：导出符号数 = **799**（推导见 §1.3）。
   `projection-manifest.json` 中每条 `excluded` 都能对上 A / B / D10 之一，
   每条 `missing` 都能在 §3.1 表格里找到。
2. **零外部依赖**：全流程不读 vendored 之外的任何路径；断网、换机器可跑。
3. **分层冒烟**（v1 的「818 个逐个调用」不可执行，v2 改为三层，参数来源已指定）：
   - **L1 全部导出符号**：`typeof x` 断言 + 类型编译通过（`tsc --noEmit`）。无参数问题。
   - **L2 84 个 `compatOp` op**：实参来源按优先级取——① vendored 的 JSDoc `@example`；
     ② 由参数类型自动生成最小合法值（`number → 1`、`Vec3 → [0,0,0]`、
     `Shape → 用 compat.box(1,1,1) 现造一个`）；③ 两者都取不到则退回 L1，
     并在 manifest 记 `smoke: skipped`（**不允许为了让冒烟通过而伪造断言**）。
     断言：不抛"参数形态 / 参数数量"类错误（签名错配在此暴露）。
   - **L3 手写面 81 个**：与现状行为逐个断言等价（等价性回归，`box` 的四种形态
     与 `rotate` 的 `{at,axis}` 形态必须有专门用例）。
4. **G2 不回归**：`compat` 命名空间现有 81 个导出逐个不变；`check` 符号表仍为 61 条。
5. **脚本面不扩张**：P5 结束后 `cad` 面仍是 61 个，除非覆盖表显式放行。
6. **维护量**：例外覆盖表 ≤ 80 条（对比现状 866 条）。
7. **CI 守卫**：`npm run gen:surface --check` 能检出"源码变了但产物未重生成"。
8. **stderr 零输出**。
9. **语义分级门禁**（对应 §9.1 / R3）：`projection-manifest.json` 里状态为 `exported`
   的每一条都必须有非 `unknown` 的 `semantics` 值；S3 / S4 / S5 / S6 类必须附人工
   判定记录（覆盖表 `note` 字段写明判据与实测位置）。**出现任何 `exported + unknown`
   即判 P2 未通过**——不允许靠"冒烟过了"放行。

---

## 9. 风险与如实标注

| # | 风险 | 说明 |
|---|---|---|
| **R1** | 自动判定有 2.3% 误差（421/431） | `pure` 类 80% 偏低，覆盖表必需 |
| **R2** | 约 60 个 unresolved | 探针未能解析（2d/Blueprint 命名空间再导出），P2 前必须解决 |
| **R3** | 新展开符号的语义正确性未验证 | 机器只判"能否投影"，判不了"语义是否正确"；装配类与演化遥测类需逐个验证 |
| **R4** | vendored 是上游裁剪快照 | 818 里 27 个在 vendored 里不存在（§3.1）。若将来要追平 852，得先同步 vendored，那是独立任务 |
| **R5** | ~~与 no-IR 通道重构的排期冲突~~ **已消除** | 见 M6。该风险在上一轮口头答复中被表述为"更紧迫"，**实测为误判**：重构已合入，本方案与执行通道零文件交集 |
| **R6** | 导出面扩大约 10 倍 = 未验证面扩大 10 倍 | 799 个符号里移植库真正会用的可能只有几十个。建议移植新库时以"实际调用集"驱动优先级，而非全量 |

### 9.1 「语义正确性」到底判什么（把 R3 变成可执行任务）

**"能投影" ≠ "语义对"**。投影器自动能做的只有三件事：符号存在、类型签名可解析、能套进
`defineOp` / `compatOp` 模板。这三条过了，`typeof x === 'function'`、`tsc --noEmit`、
L2 冒烟**全都会绿**——但函数干的可能已经不是它在 brepjs 里干的那件事。

下表 6 类判据，全部附实测位置（2026-09-07）。**前 2 类机器可判，后 4 类必须人工判。**

| # | 判据：投影后它表示的还是不是"同一件事" | 机器能判 | 实测证据 |
|---|---|---|---|
| **S1** | **返回值层级**：unwrap 一层 `Result` 之后拿到的是不是 Shape | ✅ 能（解泛型 + 结构比对） | `fuseWithEvolution`（`evolutionFns.ts:126`）返回 `Result<EvolutionResult<Shape3D>>`，而 `EvolutionResult<T>` = `{ shape, evolution }`（`:32-35`）。按"op 返回 Shape"模板投影 ⇒ 编译过、冒烟过，但调用方拿到的是**记录不是几何**，得再取 `.shape` |
| **S2** | **返回值到底是不是几何**：Shape / 纯数据 / 非几何句柄 | ✅ 能（返回值分类） | `solveAssembly`（`mateFns.ts:154`）→ `Result<AssemblySolveResult>`，是约束求解出的**变换矩阵（纯数据）**；`createAssembly`（`exporters.ts:38`）→ `AssemblyExporter`，是 XCAF 文档的 **kernel handle**（末行 `createKernelHandle(doc)`），既不是 Shape 也需要 dispose。两者的收编/释放语义与建模 op 完全不同 |
| **S3** | **是否有全局副作用**：模块级可变状态、破坏性操作 | ❌ 不能 | `getDisposalStats` / `resetDisposalStats`（`disposal.ts:88-99`）读改模块级单例 `_stats`；`resetDisposalStats` 是**破坏性**——第三方库调一次就把 faijs 自己的句柄统计清零。导出去能跑，但语义有害 |
| **S4** | **是否依赖宿主注入的资源**：字体 / 文件 / 网络 | ❌ 不能 | text 模块 8 个（`getFont` `loadFont` `sketchText` `textMetrics` …）：faijs 走 `HostPorts.fonts` 注入，vendored 内部另有取字体路径。换宿主（node ↔ browser）行为不同——**本机冒烟过 ≠ 语义一致** |
| **S5** | **失效/取消契约**在 faijs 侧有没有对应机制 | ❌ 不能 | `BooleanOptions.signal?: AbortSignal`，`evolutionFns.ts:141` 的 `if (signal?.aborted) throw signal.reason`。faijs 侧无对应取消机制 ⇒ 投影后会暴露一个**无效开关**：传了没反应 |
| **S6** | **单位 / 轴向 / 原点约定**是否与 faijs 契约（mm、+Z 向上、角度用度）一致 | ❌ 不能（只能人工比对） | **已核对一致的两条**：3D `rotate` 用**度**（`DEG2RAD` 只出现在 2d blueprint，见 `api.ts:61-69`）；`box` 的 `at` 是**中心**语义，faijs mesh 实现已对齐（`mesh/primitives.ts:49-50` 注释明写 "brepjs box semantics"）。**未核对**：2d 模块 45 个符号（`DEG2RAD` 密集出现在 `baseSketcher2d.ts` / `blueprint.ts` / `ellipseUtils.ts`），需单独比一遍 |

**⇒ 对策**：覆盖表新增 `semantics` 字段（§5.4），799 个符号逐条标 S1–S6 之一；
S3–S6 未人工判定的一律记 `unknown`，**`unknown` 不允许进入 `exported` 状态**（§8 验收 9）。
这样 R3 就从"一句风险提示"变成"有门禁、可验收的任务"。

---

## 10. 与既有方案的关系

- 本方案**取代** `docs/plans/2026-09-06-cadquery-compat-and-multifile-faijs.md` §4.5 的
  C1-a / C1-b 手工增补路线，改为统一生成。该文档其余部分不受影响。
- 本方案不改动 `.fai.js` 执行通道。no-IR 双通道重构**已完成**（`17eb190` 翻转默认
  executor 为 direct、`97a0484` 删除 IR pipeline；2026-09-07 核实
  `packages/core/src/lang/` 下已无 `parser.ts` / `compile.ts`），**不存在排期冲突**，
  P4 阶段 `api/index.ts` 入口切换无前置等待。切换前唯一要确认的是该文件现有的
  `export * as compat` 形态（注释已写明"op 符号不平铺"）在新产物里保持不变（§5.5）。
- **v2 相对 v1 的实质变更**：提取源（barrel → 目录树）、目标数（818 → 799）、
  手写面可替代性（全部 → 66/81）、新增包装策略维度与两个面准入差异（§3.7）、
  修正 `scriptFace` 规则（`split` 反例）、验收改为分层冒烟。

---

## 11. 交给第三方执行前的自检

### 11.1 已消除的歧义（可直接执行）

| # | v1 的歧义 | v2 处置 |
|---|---|---|
| 1 | "L3 面 / brep 面 / cadOps 面" 三个词混用 | §0 术语表钉死 6 个词，全文一致 |
| 2 | 提取源写 `vendored/brepjs/index.ts`，实测会丢核心 op | §3.1 改为目录树，并给出三种口径的实测数 |
| 3 | 目标数 818 无法达成 | §1.3 给出精确推导：799 |
| 4 | `arg-spec.ts` 被"3 个脚本"引用 | §6 M4 实测只有 1 个 |
| 5 | "手写面全部是模板调用" | §3.6 列出 4 类反例，§5.4 新增 `wrap` / `adapter` / `source` 字段承载 |
| 6 | `scriptFace` 推导规则会误杀 `split` | §5.3 第四层删除"返回单一 Shape"条件 |
| 7 | "818 个逐个调用一次"无参数来源 | §8 验收 3 改三层，并指定实参来源优先级 |
| 8 | 两个面绑在同一 KPI | §1.2 明确分离，§8 验收 5 加"脚本面不扩张"门禁 |
| 9 | `brep` / `cadOps` 新命名 | §5.5 否决（名字本身不当）。`compat` 面是否改名见 Q5（**面名待选**）；`registerLib` 参数已裁决改 `autoLift`（Q5-b） |
| 10 | A 类规则漏掉 `ns.io` | §1.3 + §5.3 显式堵上 |
| 11 | 口头结论"R5 排期风险更紧迫" | 实测 no-IR 重构已合入（`17eb190` / `97a0484`），风险不存在，§6 M6 / §9 R5 标记消除 |
| 12 | R3 只写"判不了语义"，第三方不知从何下手 | §9.1 拆成 S1–S6 六类判据（附实测位置），§5.4 加 `semantics` 字段，§8 验收 9 设门禁 |
| 13 | `registerLib` 参数名（`compat`）与默认值不确定，第三方无从下手 | **已裁决（Q5-b）**：改 `autoLift`，默认推断式 `?? !hasDualOp(ns)`；27 处调用点逐点归类（§11.2 Q5-b ③），仅 `runtime.test.ts` 5 处需显式补 `false` |

### 11.2 执行前仍须用户裁决的事项（第三方不得自行决定；已裁决项标注裁决结果）

| # | 待裁决 | 影响 | 建议 |
|---|---|---|---|
| **Q1** | `ns.*` 命名空间 9 个是否导出？ | 目标数 791 ↔ 799；API 形态（详见下方实测修正） | **v2 改为建议不导**，理由见下；若坚持保上游 1:1 也可导，需接受 87 个双入口 |
| **Q2** | D10 裁掉的 kernel 15 个是否永久不导？ | 目标数；若将来要 runtime 切内核则需补回 | 建议维持不导，manifest 记 `D10-cut` |
| **Q3** | `CurveLike` / `BoxOptions` / `RotateOptions` 是否同步 vendored 补上？ | 属"同步上游"独立任务，不在本方案范围 | 建议不在本方案做，登记为 `missing` |
| **Q4** | P5 是全量铺到 799，还是按移植目标库的实际调用集驱动优先级？ | 工作量与风险（R6） | 建议按调用集驱动。**实测支撑（§3.8）**：已移植完成的 `packages/sheetmetal` 只用 **53 个**符号 |
| **Q5** | `compat` 这个面要不要改名（如 `brepjsCompat`）？**用户 2026-09-07 提出** | 命名占据与未来扩展；改名的连带范围 | **部分已裁决**：连带参数定 `autoLift` + 推断式默认（Q5-b，已裁决）；**面名本身（A/B/C/D 四方案）仍待用户选**，见下方 |

#### Q1 的实测修正（v1 的表述是错的，必须按这条执行）

v1 说"导了会出现 `compat.primitives.box` 与 `compat.box` 两条路径**访问同一实现**"。
2026-09-07 实测展开 9 个命名空间后，**结论不同**：

| 事实 | 实测 |
|---|---|
| 9 个命名空间成员合计 | **114 个**（`ns.io` 20 个属 A 类，本就排除 ⇒ 有效 94 个） |
| 与顶层**同名**（会形成双入口） | **107 个**（扣除 ns.io 后 **87 个**） |
| **仅**命名空间下才有、顶层没有的 | 只有 **7 个**：`box` `line` `wire`（primitives）、`fuse`（booleans）、`fillet` `heal`（modifiers）、`translate`（transforms） |
| 这 7 个在 compat 面里的状态 | **已有扁平导出**：`line`/`wire`/`translate` 等在 P25 段直接从子模块 re-export（`compat/index.ts:403`，注释明写 "same names, same signatures as upstream brepjs"）；`box`/`fuse`/`fillet`/`heal` 为手写或包装导出 |

⇒ 两条修正：

1. **不是"两个实现"，是"一个底层实现、两套调用契约"**。`compat.box` 走手写 D11 双形态
   （`box({size})` 可）+ kernel 断言；`compat.primitives.box` 是裸 vendored
   `primitiveFns.box(width, depth, height, options?)`，**传对象形态会静默错**。
   双入口的真正风险是"哪个能吃对象形态"不明确，不是实现分叉。
2. **导出 ns.\* 不带来任何新能力**——独有的 7 个在扁平面里全都有了。唯一价值是让
   照抄上游源码的 `primitives.box(...)` 写法不改；代价是 87 个符号出现两个入口。

**更轻的替代**（建议）：不导 `ns.*`；移植库时在库源码顶部写一行
`import * as primitives from '@faicad/faijs/compat'` 即可得到同样的命名空间调用形式，
且不污染导出面。**若用户坚持保上游 1:1，则导，但必须在 manifest 标注 `dual-path`。**

#### Q5 的实测依据与四个方案（用户 2026-09-07 提出）

**用户原话**：

> 「它是 brepjs 形态的 TS 兼容面。既然如此，为何不取名 brepjs_compat？未来 faijs
> 还需要兼容更多的 api，不应该用一个 compat」

**实测：`compat` 在本仓已有 4 个语义**（2026-09-07 grep）：

| # | 语义 | 位置 | 说明 |
|---|---|---|---|
| 1 | brepjs 形态 TS 兼容面（81 符号） | `api/compat/index.ts`、子路径 `@faicad/faijs/compat`、顶层 `export * as compat`（`api/index.ts:86`） | 本方案的对象 |
| 2 | `registerLib` 的**准入开关** | `runtime.ts:356-363`，`options?.compat === true` → `admitCompatLib` | 语义是"这个第三方库的裸函数要不要经 `compatOp` 准入"，**与 brepjs 毫无关系**（`cad` 自己注册时就传 `{ compat: false }`） |
| 3 | `compatOp` 包装器 | `api/internal/compat-op.ts:182` | 把 brepjs 函数包成 faijs op 的**动词机制**，不是面 |
| 4 | AGENTS.md 的 op 分类名 | `AGENTS.md:51`「② compat op（`compatOp(fn, spec)`，brep-only）」 | 指**一类 op**（brep-only），不是导出面 |

⇒ 用户的质疑成立，且比"未来扩展"更迫切：**语义 1 与 2 已经撞车**。读
`registerLib('cad', ns, { compat: false })` 的人第一反应是"cad 不走兼容面"，
实际它的意思是"cad 的函数自带 `defineOp` 元数据，不用再经 `compatOp` 收口"。

**改名成本实测（低）**：

- 子路径 `@faicad/faijs/compat`：**42 个源文件**（`packages/sheetmetal/src` 41 +
  `src/compat.ts` 1）+ 24 个 `dist/*.d.ts`（构建产物，自动重生成，不算成本）；
- 顶层命名空间 `compat`：**零外部消费者**（§3.8）；
- 定义点 2 处：根 `package.json` `exports["./compat"]`、core `exports["./api/compat"]`；
- 文档：7 个 `docs/*.md` 提到 compat（其中 2 个在 `docs/plans/`，属临时文档不计）。

**四个方案**：

| 方案 | 子路径 | 顶层导出名 | 评价 |
|---|---|---|---|
| **A. 直接改名**（推荐） | `@faicad/faijs/brepjs-compat` | `brepjsCompat` | 契合用户直觉。子路径风格与现有 `runtime-state` / `module-resolver` 一致（kebab），导出名 camelCase 与 `createApiNamespace` 一致。代价：sheetmetal 41 个文件机械改 import 行 |
| **B. 短名** | `@faicad/faijs/brepjs` | `brepjs` | 最短，移植库写 `from '@faicad/faijs/brepjs'` 极自然。风险：可能被误读为"brepjs 本身"（其实是 faijs 提供的 brepjs 形态面） |
| **C. 族容器** | `@faicad/faijs/compat/brepjs`（新增） | `compat.brepjs` | `compat` 回归"兼容面集合"本义，未来 `compat.cadquery` 自然扩展。代价：现有 `compat.box` 变 `compat.brepjs.box`，**多一层**；只有一个成员时显得冗余 |
| **D. 不动名** | 保持 | 保持 | 零成本。代价：加第二个兼容面时必然再改一次，且语义 1/2/3/4 继续混用 |

**连带项（已裁决 2026-09-07）**：把语义 2 的 `registerLib({ compat })` 改成语义明确的
**`{ autoLift }`**，默认值改为推断式，让 `compat` 只保留"兼容面"一个含义。
详见 §11.2 Q5-b。此项不在本方案 P0–P5 范围内，属独立小重构，
但**只改面名不改它，撞车只解决一半**。

**改名（`compat` 面）的实测改动点**：

- 42 个源文件 import 行（`packages/sheetmetal/src` 41 + `src/compat.ts` 1）；
- 2 处 `exports` 定义（根 `package.json` `./compat`、core `./api/compat`）；
- 7 个 `docs/*.md`（其中 2 个在 `docs/plans/`，属临时文档可不改）；
- `dist/` 重新构建即可，不算改动成本。

**连带项 `registerLib({ compat })` → `{ autoLift }` 的实测改动点**（均在 §11.2 Q5-b 裁决后执行）：

| 位置 | 现状 | 改后 |
|---|---|---|
| `runtime.ts:356` | 签名 `{ default?, compat?, packageName? }` | 字段改 `autoLift` |
| `runtime.ts:359` | 注释说明为何默认 off | 改为说明推断式规则 |
| `runtime.ts:904` | 自动装载：`compat: ….options?.compat ?? true` | 走同一条推断式规则，去掉 `?? true` |
| `ports.ts:192` | `libLoader.options` 字段名 + 注释（"缺省 `{ compat: true }`"） | 同步改名 |
| `define-op.ts:304` | `hasDualOp` 是 `assertLibConforms` 的**局部变量，未导出** | 抽为导出的 `hasDualOp(ns)` 工具（推断式默认需要它），建议从 `sdk.ts:78` 一并导出 |
| `src/index.ts:34`、`src/browser.ts:26` | `registerLib('cad', …, { compat: false })` | **直接删掉这个参数**（推断式下 cad 自动 false，§11.2 Q5-b ②） |
| `cli.ts:55` / `cli.ts:167-169` | libLoader 默认 `{ compat: true }`；注册 cad 时 `{ compat: false }` | libLoader 默认删掉；cad 那处删掉 |
| `packages/gear-lib-demo/src/c3-scenario.test.ts:40`、`gear.test.ts:85/102` | `{ compat: true }` | 可删（gear 全裸函数，推断为 true）；保留亦可，语义更显式 |
| `packages/sheetmetal` | 无 `defineOp`、`compat` 传参在宿主侧 | 不受影响，推断为 true |
| 测试（不传 options 的调用点，精确归类见 §11.2 Q5-b ③） | defineOp 类（`gearLib`/`meshLib`/`mockMech*`）推断 false 不变；**裸函数 fixture 仅 `runtime.test.ts` 4 类 5 处**（`mechLib`:839、`badLib`:856、`geom` box:864、`gearNs`:880 ×2） | 这 **5 处必须显式补 `{ autoLift: false }`**，否则被包装成 brep-only op、mesh 模式抛 `E_MESH_UNSUPPORTED` |

**执行原则（用户已裁决，2026-09-07）**：**直接改名，不做 alias 过渡、不标
`@deprecated`**——项目未上线，`@faicad/faijs/compat` 的唯一消费者是仓内的
`packages/sheetmetal`，无外部依赖需要照顾。

#### Q5-b：命名与默认值——**已裁决（2026-09-07）：`autoLift` + 推断式默认**

**用户原话**（两轮）：

> 「这个参数 admit 默认值应该 true 吧。而且 admit 这个名字也很怪，它做的是自动
> 封装裸函数呀，改名 autoOp 如何？」
>
> 「这样，名字用 autoLift，默认值用推断式。」

**裁决结果**：`registerLib` 的字段 `{ compat }` → **`{ autoLift }`**；
默认值采用**推断式**：`autoLift = options.autoLift ?? !hasDualOp(ns)`。

##### ① 命名定 `autoLift` 的理由（记录备查）

| 候选 | 结论 |
|---|---|
| `compat`（现状） | 否决。与"兼容面"撞车（§11.2 Q5 语义表），真实语义是准入/包装，与 brepjs 无关 |
| `admit` | 否决。裁决视角，没说清做了什么；且内部函数已叫 `admitCompatLib`，同词两用 |
| `autoOp` | 用户曾提议，最终未选——被 `autoLift` 取代 |
| **`autoLift`（定名）** | `compat-op.ts:2` 的机制动词本就是 "lift an arbitrary brepjs-shaped function into a faijs statement op"——`lift` 是这个机制自己的词；`autoLift` = "自动提升裸函数为语句级 op" |

##### ② 推断式默认的定义（实施契约）

```ts
// 判据：库命名空间里是否有任一函数携带 DUAL_OP_META（'__faijs__dualOp'，
// define-op.ts:120 定义、:287 以 enumerable:false 挂载）
// hasDualOp 目前是 assertLibConforms 的局部变量（define-op.ts:304），须抽为导出工具
autoLift = options.autoLift ?? !hasDualOp(ns)
```

规则：**库里已有任一 dual-op ⇒ 不包装（它们自带元数据）；全是裸函数 ⇒ 包装；
显式传值最高优先级覆盖。** 适配"框架默认（可推导）→ 作者声明覆盖 → 调用点显式指定"
的分层模型，`cad` / `sheetmetal` / `gear-lib-demo` 都不用再传。

`registerLib` 内部顺序**保持硬约束不变**：先 `assertLibConforms(ns)` 再按需
`admitCompatLib`（`admit-compat-lib.ts:6-8` 注释：先包装会让 `Object.values`
枚举不到 `DUAL_OP_META`，裸函数静默跳过严格校验）。

##### ③ 现存 27 处 `registerLib` 调用在推断式下的实测归类（2026-09-07 逐点核对）

| 类别 | 调用点 | 推断结果 vs 现状 |
|---|---|---|
| `cad` 注册（`src/index.ts:34`、`src/browser.ts:26`、`cli.ts:167-169`） | 现传 `{ compat: false }` | 推断 false（全带 `DUAL_OP_META`）⇒ **结果不变，参数可删**。源码注释"until P23 rebuilds…"的理由已被 P23 完成淘汰 |
| `sheetmetal`（宿主侧注册） | 全裸函数 | 推断 true ⇒ 与现在 `{ compat: true }` 等效，**无需改动** |
| `gear-lib-demo`：`gear.ts`（裸函数）、`mock-mech-brep.ts` / `mock-mech-mesh.ts`（defineOp） | 前者推断 true、后两者推断 false | 均与现状等效 |
| `runtime.test.ts` **裸函数 fixture（行为会变的 4 类 5 处）**：`mechLib`（:839）、`badLib`（:856）、`geom` 的 `{ box: () => solid(cubeMesh(20)) }`（:864，`{ default: true }`）、`gearNs`（:880，2 处） | 不传 options，现状 = false | 推断 true ⇒ **行为改变**：裸函数被 `compatOp` 包装成 brep-only op，mesh 模式抛 `E_MESH_UNSUPPORTED`。**必须显式补 `{ autoLift: false }`**（或按测试意图改写） |
| `runtime.test.ts` defineOp fixture：`gearLib`（:959）、`meshLib`（:982） | 不传 options | 推断 false ⇒ 不变 |
| `gear-lib-demo` 测试：`b7-no-face-evolution.test.ts`（2 处）、`mock-lib.test.ts`（4 处） | 不传 options，注册的是 defineOp mock | 推断 false ⇒ 不变 |

⇒ 迁移工作量集中在 `runtime.test.ts` 的 **5 处显式补 `false`**，其余全部自动正确。

##### ④ 顺带修掉的不对称（推断式落地时一并做）

手动 `registerLib` 不传 = `false`、自动装载（libLoader）不传 = `true`
（`runtime.ts:904` 的 `?? true`、`ports.ts:192` 注释"缺省 `{ compat: true }`"）——
同一件事两条默认。改后**两条路径都走同一条推断式规则**，`?? true` 删除。

##### ⑤ 验收门禁（并入本方案 §8 执行时适用）

- 改名 + 推断式落地后，`npm run test --workspaces` 全绿且 stderr 零输出；
- `cad` / `sheetmetal` / `gear-lib-demo` 三个真实库**不显式传 `autoLift`** 也能全绿
  （证明推断式默认正确）；
- 全仓 grep 无 `compat:` 作为 `registerLib` 选项的残留。

### 11.3 执行顺序（各阶段门禁见 §7，不得跳阶段）

```
P0 → P1（三条门禁全过）→ P2（含语义分级，验收 9）→ P3（等价性回归）→ P4（入口切换，无前置等待）→ P5
```

**任何阶段发现与本文实测数不符，先更新本文再继续**——本方案的每一个数字都标注了
实测日期（2026-09-07）与获取方式；faijs 处于高频重构期，复用前必须重跑核对。
