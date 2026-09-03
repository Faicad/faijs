# faijs BREP 兼容 API 方案（v3.2）：语义对齐 brepjs，库「改包名即可」移植并在 `.fai.js` 中调用

> 状态：方案（未实施） · 作者：AI · 日期：2026-09-03（v3.1 同日修订：§4.3 具体例子、§11 风险实测核查、
> §7.2 域结论修正、§8/§9 按实测重写；**v3.2 同日二修：Q1–Q8 用户全部拍板，Q2 改判为参数双形态 D11，
> §4.1/§4.2/§4.3.2/§4.4/§6.3/§9 同步**）
> 取代：`docs/plans/2026-09-03-brepjs-ecosystem-compat.md`（v2，同日早些时候，整体取代）
> 方向取代：`docs/plans/2026-09-02-faijs-api-surface-completion.md` 的方向层（该方案已实施到 P14，
> 其**工程资产全部保留复用**，见 §3.1；方向层——throw 主面、一切经 defineOp 投影到 `cad.*`——被本轮否决）

---

## 0. 用户原始要求（原话，需求基线，不准删改）

> 「我需要让faijs的api尽量兼容brepjs的api，brepjs的第三方库比如brepjs-sheetmetal，能够在只换包名
> (或者最小改动)的情况下，移植到faijs生态。」

> 「这个方案里的一句话架构：库内部用 brepjs 形态的建模链（改包名即可），库边界由 faijs 收口
> （Shape 进、Shape 出、BREP-only 静态分派）。我同意这个方向。」

> 「至于错误处理，完全可以采纳brepjs的方案，采用Result体系。而faijs现有的throw方案要改过来。
> 总之，如果不涉及到faijs特有的特性，比如UI生成代码、增量执行、.fai.js代码就是CAD模型本身、
> mesh/brep双槽和静态分配等。其他的api部分，如果faijs和brepjs不兼容，都可以把faijs的方案改成
> 和brepjs兼容的方向。」

> 「brepjs库里还有大量非brep建模的部分，完全无关，本项目不支持。」

> 「sheetmetal必须是一个第三方库，怎么可能允许访问@faicad/faijs-core/vendored/brepjs？这不彻底
> 违反了项目的前提？……第三方库，不准出现任何的brepjs的内容。用mech-lib、sheetmetal这两个库来测试。
> 它们就是第三方库，只是为了演示的原因，和faijs放在了一起。要求能在fai.js脚本里，调用这些第三方库。
> 把这个流程走通。」

> 「总之：最终的评判标准是，brepjs的第三方库，可以很容易的转换为faijs的第三方库（理想情况是只换包名，
> 做不到的话要有明确的最小改动面），且能够在.fai.js脚本中调用，符合faijs的执行语义。」

> 「还有，类似box/cylinder/sphere/translate/intersect 这样的符号，一个库里绝对不准出现两份。
> 但是，你要考虑Shape/throw 语义等问题。整个代码的执行，必须符合faijs的语义，在brep/mesh双槽的
> 环境下执行，支持多个宿主，支持增量执行等。」

> 「还有一些问题，这是上一个agent的思考：brepjs子形状句柄体系（getFaces/wire/line）。核实句柄生命周期
> 机制与收养语义。shape.ts:72-73 揭示了函数 BREP 域机制已存在。核实它的释放时机——这是库内部句柄
> 生命周期的答案。关键缺口实测证实：函数 BREP 域只对 source?.local === true（.fai.js 本机函数）开启，
> 第三方库函数调用不在域内。核实库调用路径与增量键。」

> 「此外，我希望的是，最好在底层api层封装defineOp，这样上层api就不用考虑brep链的问题。」

> 「请根据我的需求，当前的代码现状，写一份完全全新的方案。让faijs导出和brepjs基本兼容的api，
> 能用这个faijs自己的api写第三方库，第三方库能够在.fai.js脚本中被使用。」

> 「文档里底层封装：`compatOp()` 与 `admitCompatLib()`到底怎么做，请在文档给一个具体的例子。
> 然后风险的部分，到底是否真正有风险，如果有要提前排除。把方案做到可以直接交给deepseek v4 flash执行的水平。」

> 「除了Q2 对象参数形态仅限脚本面，其它的都按你的建议来。如果Q2指的是类似box的参数，那么必须
> 支持这两种参数。如果参数明显可以区分，可以box函数内部根据参数来切换实现。如果不明显，
> 只要是人类看来不明显，那么用两个名字。」（2026-09-03 第二轮拍板：Q1/Q3–Q8 按建议定案，Q2 改判）

**配套事实声明（用户）**：`docs/plans/2026-09-02-faijs-api-surface-completion.md` 第 5 部分已分析同名冲突；
当前代码已完成到该方案 **P14**，但因整个大方向不符合要求而**暂停**。

---

## 1. 结论摘要

**一句话架构**（在用户认可的 v2 架构上按本轮要求修正）：

> **库内部用 brepjs 形态的建模链（改包名即可，含 Result 体系）；库边界由 faijs 收口
> （Shape 进、Shape 出、BREP-only 静态分派）；faijs 的对外 API 面本身就是 brepjs 兼容形态——
> Result 原生、同名同签名——`.fai.js` 脚本面由同一个底层封装在语句边界自动适配。**

| # | 决策 | 内容 |
|---|---|---|
| **D1** | **错误体系 = Result** | faijs 对外 API 全面采用 vendored 已有的 `Result`/`BrepError` 体系（`vendored/brepjs/core/result.ts:12-48`、`core/errors.ts:222-273`）。throw 只保留在**语句边界**：引擎 unwrap 时把 `err` 转成带语句上下文的失败（`.fai.js` 行为与今天完全一致，存量脚本零修改） |
| **D2** | **一套实现，三个面** | 实现只有一份（vendored brep 实现 + mesh 实现）。投影出三个面：**TS 兼容面**（库作者 import，brepjs 形态）、**cad 脚本面**（`.fai.js`，对象参数 + 自动 unwrap）、**第三方库边界面**（`registerLib` 自动包装）。符号唯一性由「投影而非重实现」保证 |
| **D3** | **底层封装 `compatOp()`** | 用户「在底层 api 层封装 defineOp」的落地：一个统一封装把任意 brepjs 形态函数提升为语句级 op——参数透传（双形态归一在被包函数内，D11）、输入借入、静态分派门、Result unwrap、输出收养，全部内建（具体例子见 §4.3）。库作者与上层 API **零 BREP 链感知**；cad 命名空间与第三方库注册都经它 |
| **D4** | **TS 兼容面 ≠ 脚本面** | 这是相对 9-02 方向的根本修正。TS 面全量投影（op、子形状、Sketcher/Blueprint/Drawing DSL、Result 组合子、类型守卫——库作者写 brepjs 代码需要的一切）；脚本面只投影语句级 op。9-02 的 399 个 skip 大部分是「不适合 defineOp」而非「不能兼容」（§6.1） |
| **D5** | **兼容范围继承既有裁决** | 只搬 brep 建模部分；`csg`/`voxel`/`implicit`/`lattice`/`worker` 不引入（9-02 §2.6 的六项裁决逐字继承，含 U9 不移植 csg） |
| **D6** | **最小改动面显式化** | mech-lib：改包名 + 删 3 块引擎管理模板代码。sheetmetal：改包名 + 删 `compat.ts` + 折弯表注册表显式化 + 1 个显式几何终端函数。Result 消费点（约 350 处）**零改动**——这是 D1 的直接收益（§9） |
| **D11** | **参数双形态（用户拍板，Q2 改判）** | 位置形态与对象形态**都必须支持**。参数明显可区分 → **单名**，函数内部按参数形态切换实现（如 `box`）；人类看来不明显 → **两个名字**（先例 `rotate_euler`；实测样例 `thread(options: ThreadOptions)`，`arg-spec.ts:1543`）。规则与判别式见 §4.2 |

---

## 2. 方向诊断：三版方案各对了什么

| 维度 | 9-02（已实施到 P14，方向暂停） | 9-03 v2（同日，被本版取代） | **本版（v3.2）** |
|---|---|---|---|
| 错误体系 | throw 主面 + 可选 Result 镜像（E3） | 库边界 Result→throw 翻转（`adaptBrepLib`） | **Result 原生到底**；脚本边界 unwrap（D1） |
| TS 面形态 | `cad.*` 对象参数 + throw（faijs 形态为尊，brepjs 形态靠双形态判别器挤入） | 独立子路径 `@faicad/faijs-core/brep`（brepjs 形态） | **主导出即 brepjs 兼容面**（位置参数 + Result）；参数双形态——可判别单名、不可判别双名（D11，用户拍板） |
| 投影目标 | 一切经 `defineOp` 投影到 `cad.*` | 库作者面 + `adaptBrepLib` | TS 面全量（含 DSL/组合子/子形状），脚本面只接语句级 op（D4） |
| 兼容覆盖率 | 441/852 投影、399 skip（52%） | 未量化 | TS 面接近全量（§6.1 重估） |
| 第三方库语义 | sheetmetal 的 350 处 Result 消费点要改 throw（E8） | Result→throw 由边界翻转 | **库内 Result 零改动**（D1） |
| 库边界 | 未设计 | `adaptBrepLib` 六职责 | `admitCompatLib`（= `compatOp` 的批量应用，去掉了 Result 翻转，§4.3） |
| 「底层封装 defineOp」 | 无（生成器逐 op 展开模板） | 无 | **`compatOp()`**（D3，§4.3 具体例子） |

**9-02 的真实教训**：它把「兼容」理解为「把 brepjs 能力翻译成 faijs 语义投影进 `cad.*`」，于是
① 每个符号都要过 defineOp 这道模具，放不进模具的（DSL、子形状句柄、组合子）只能 skip；
② throw 主面迫使库侧做 350 处 Result→throw 改写，「改包名即可」彻底落空。
用户本轮的裁决把两个前提都反转了：**语义向 brepjs 对齐，而不是反过来**；**TS 面不需要过 defineOp 模具**。

**9-02 的工程资产不动**（§3.1）：vendored 树、生成器与适配表、符号清单、更名成果、守卫脚本——
它们是实现层与清单层资产，与方向无关。

---

## 3. 代码现状（2026-09-03 实测）

### 3.1 已落地资产（全部保留复用）

| 资产 | 位置 | 状态 |
|---|---|---|
| vendored brepjs 树（47475 行/237 文件 + P12 补全根 barrel 与 `ns/` 9 文件） | `packages/core/src/vendored/brepjs/` | ✅ P12 落地（commit 67192ac）；`csg` 从未搬入，`ns/csg.ts` 不存在 |
| **Result 体系**（`ok`/`err`/`isOk`/`isErr`/`map`/`andThen`/`unwrap`/`tryCatch`/`pipeline`） | `vendored/brepjs/core/result.ts:12-48` 等 | ✅ 已在树内，只需提升为公共契约 |
| **BrepError 错误码体系**（kind/code/message/suggestion/metadata + `BrepErrorCode` 常量表） | `vendored/brepjs/core/errors.ts:35-229` | ✅ 同上 |
| **句柄生命周期全套机制**：`ShapeHandle`（`Symbol.dispose`/`delete`/`onDispose`）、FinalizationRegistry 兜底、`createBorrowedHandle`、`DisposalScope`、`unregisterFromCleanup` | `vendored/brepjs/core/disposal.ts:117-470` | ✅ 在树内；内核侧 occt-wasm arena `release(id)`（`occtWasmAdapter.ts:37-38`） |
| **子形状级联释放**：`getFaces`/`getEdges`/`getSolids`（`topologyQueryFns.ts:171-218`）返回 branded `ShapeHandle`；按父 shape 缓存于 WeakMap `topoCache`（`:101`），父 dispose 时 `onDispose` 级联释放（`:143-148`） | vendored | ✅ 机制实测存在——**这就是上一个 agent 问的「子形状句柄生命周期」的答案** |
| 生成层 + 签名适配表 | `packages/core/scripts/gen-l3-surface.ts`、`api/surface/arg-spec.ts`（3520 行） | ✅ P13 落地（739e1a1） |
| 符号清单 | `api/surface/upstream-surface.json`（852 符号）、`upstream-exclusions.json` | ✅ P10 落地 |
| 生成面 13 个模块文件（441 个 export：brep-op / query / pure / type 四类） | `api/generated/{topology,operations,core,kernel,2d,gear,io,measurement,ns,projection,query,sketching,text}.ts` | ✅ P14 落地（至 64610e1） |
| L3 桥三原语：`borrowBrepjsShape`（借入零拷贝）/`adoptBrepjsProduct`（收养 = `fromHandle` 三角化+身份槽）/`callBrepjs` | `api/internal/l3-bridge.ts:41-85` | ✅ D10 单实例保证句柄空间一致；**收养缺 finalizer 注销，见 R1（§11）** |
| 更名成果：`fai_drill`/`fai_extrude`/`fai_split`/`rotate_euler`（faijs 特有 op 与 brepjs 同名符号已全部错开） | `api/{fai_drill,fai_extrude,fai_split}.ts`、`api/transform.ts` | ✅ 已落地且 3d_editor 同步 |
| U8 品牌守卫 + U9 边界守卫 | `scripts/check-vendored-branding.mjs`、`check-layer-boundaries.mjs` | ✅ P10/P11 落地 |
| `registerLib(binding, ns, {default:true})` 任意绑定名 | `runtime.ts:332-343`、`src/index.ts:29` | ✅ P10b 落地 |
| TPMS 模板 `schwarzP`/`diamond`（补 lattice 缺口） | `sdf/templates.ts` | ✅ P14b 落地 |
| 第三方库 brep 分派矩阵测试 | `packages/tests/faijs/v53-lib-brep-dispatch/v53-lib-brep-dispatch.test.ts`（mode × 实现集 × 在链性，:80-173） | ✅ 在仓 |
| 全流程可运行样本 | `packages/mech-lib/src/c3-brepjs-scenario.test.ts`（registerLib → `.fai.js` 调用 → BREP 路径布尔 → STEP `ADVANCED_FACE`） | ✅ 在仓（但库源码违规，§3.3 B5） |

### 3.2 关键事实：生成面是「断头路」

P14 把 441 个符号投进了 `api/generated/`，但**没有接到任何消费面**：

- `packages/core/src/index.ts:242` 只有 `export * from './api'`，而 `api/index.ts`（35 行）只导出 30 个 faijs 特有 op，**不含 `generated/*` 的任何符号**；
- `api/api-namespace.ts:39-51` 装配的 `cad.*` 仍只有 31 个函数，不含生成面；
- 生成面只能经深路径 `@faicad/faijs-core/api/generated/topology` 摸到（靠 `./api/*` 通配 exports），无任何文档、无符号表、无手册。

即：**能力已投影，但没有门**。这恰好意味着方向反转的沉没成本很低——生成面还没被任何消费者依赖，
我们可以按新方向决定它接什么门，而不是拆旧门。

### 3.3 缺口清单（本方案要修的，全部实测）

| # | 缺口 | 证据 |
|---|---|---|
| **B1** | 生成面未接线（§3.2）：导出面 ≡ `cad` 面 ≡ `check()` 符号表的三源一致不变量从未达成 | `core/src/index.ts:242`、`api/index.ts`、`api-namespace.ts` |
| **B2** | **增量键无库身份**：`computeKey` 对库调用只取 `` `${source.namespace ?? this.defaultNsName}.${source.callee}` ``（字符串 `"sheet.hem"`），同名不同版本/不同实现的库会命中旧缓存，**静默产出错误几何**。对照本机函数有 `local.${callee}#${bodyHash}` 内容寻址 | `module-executor.ts:585-602`（库分支 `:594`） |
| **B3** | **函数 BREP 域只对本机函数开启**：`const isLocal = source?.local === true`（`module-executor.ts:258`），只有它为真才 `enterFunctionBrep()`（`:259-262`）。第三方库函数调用不在域内——上一个 agent 标记的缺口属实。**但 v3.1 实测修正：域无需扩展，真正的修复在收养侧（R1），见 §7.2** | `module-executor.ts:255-271`、`runtime-state.ts:154-185` |
| **B4** | **裸 brepjs 函数可静默入库**：`assertLibConforms` 对没有 `DUAL_OP_META` 的函数直接 `continue`（`define-op.ts:247-248`）。一个「只改包名」的 brepjs 生态库今天就能 `registerLib` 进去而不报错——同时完全不受 faijs 语义管辖（无分派、无收养、无域、无增量键保护）。引擎必须在准入口收口 | `define-op.ts:236-251` |
| **B5** | 两处 brepjs 耦合仍在：① core 的 `./vendored/*` 两条 exports 仍开（`packages/core/package.json:32-33`，P11 只清了字面量没删路径）；② mech-lib 仍 `dependencies: {"brepjs": "18.119.2"}`、`brepjs-gear.ts:32` `from 'brepjs'`、`:64` 自行 `registerKernel`、`:75` 模块级 `pinned` 数组只钉不释；sheetmetal `compat.ts` 集中 22 处 `vendored/**` 深路径 | 各文件实测 |
| **B6** | **收养不注销 finalizer（v3.1 新发现，R1）**：vendored `createHandle` 把包装对象注册进 FinalizationRegistry（`disposal.ts:224-232`），GC 后 finalizer 调 `kernel.dispose(ocShape)`（`:117-124`）释放 arena 槽。`adoptBrepjsProduct`（`l3-bridge.ts:62-68`）只取 `.wrapped` 不注销——包装对象被 GC 后 faijs 已收养的句柄被释放，**arena 槽复用后静默指向错误几何**。mech-lib 的 `pinned` 数组正是这个 bug 的 workaround | `disposal.ts:117-124,224-232`、`l3-bridge.ts:62-68`、`brepjs-gear.ts:70-75` |

---

## 4. 目标架构

### 4.1 一套实现，三个面

```
                        ┌─────────────────────────────────────────┐
                        │  实现层（全局各一份）                      │
                        │  vendored brepjs（brep 实现）            │
                        │  mesh/（manifold 实现）                  │
                        └───────┬─────────────────┬───────────────┘
                                │                 │
              ┌─────────────────┘                 └──────────────────┐
              ▼                                                      ▼
┌─────────────────────────────┐                    ┌──────────────────────────────┐
│ ① TS 兼容面（库作者面）       │                    │  faijs 特有 op（31 个 dual）   │
│ @faicad/faijs 主导出         │                    │  box/knurl/sdf/fai_* …        │
│ brepjs 形态：同名同签名、     │                    │  defineOp({mesh,brep})        │
│ 双形态参数(D11)、Result原生、   │                    └──────────────┬───────────────┘
│ 句柄/DSL/组合子全量          │                                   │
└──────────────┬──────────────┘                                   │
               │  compatOp() / admitCompatLib()（D3 底层封装）      │ defineOp（既有）
               ▼                                                  ▼
┌────────────────────────────────────────────────────────────────┐
│ ② cad 脚本面：同一批函数经语句级包装注入（双形态透传 + unwrap）     │
│ ③ 第三方库边界面：registerLib 时对裸 brepjs 函数自动做同一包装      │
└────────────────────────────────────────────────────────────────┘
```

| 面 | 消费者 | 形态 | 经过 defineOp 模具？ |
|---|---|---|---|
| ① TS 兼容面 | 第三方库（TS 代码） | brepjs 原样：`box(10,20,30)` → `ValidSolid`；`fuse(a,b)` → `Result<Shape3D>`；`Sketcher`/`Blueprint`/`draw` DSL；`ok`/`err`/`isErr`/`pipe` 组合子；**对象形态同受**（D11：`box({size:20})` 在 TS 面同样合法） | **否**——这是 D4 的关键：TS 面是**投影**不是**包装** |
| ② cad 脚本面 | `.fai.js`（UI/AI 生成代码） | `cad.box({size:20})` 对象参数（位置形态同受，D11）；语句边界 unwrap（err→语句失败）；产物 = faijs `Shape`（mesh 载荷 + BREP 槽） | 是（`compatOp` / 既有 `defineOp`） |
| ③ 库边界面 | `registerLib` 注册的第三方库导出函数 | 库作者写纯 brepjs 代码；入口 Shape→借入，出口 Solid→收养，Result 原样传递 | 是（`admitCompatLib` 自动包装） |

### 4.2 ① TS 兼容面的定义

**落点**：`@faicad/faijs` 主导出（替换现有 throw 形态的 30 个 op 导出；faijs 特有 op 保留同名导出，
但 impl 内部 Result 化——见 §5.2）。这是 major 版本变更（Q1 已拍板：主导出替换，不开子路径）。

**内容**（四类，全部从 vendored 投影，零重实现）：

| 类 | 内容 | 投影方式 |
|---|---|---|
| 建模/查询/测量 op | `box`/`fuse`/`cut`/`fillet`/`extrude`/`loft`/`getFaces`/`measureVolume`… | 精选 re-export；有 arg-spec 条目的 op 包一层**双形态归一**（D11）+ 单实例断言 |
| 子形状体系 | `getFaces`/`getEdges`/`getSolids`/`wire`/`line`/`faceCenter(face)` 及 `Face`/`Edge`/`Wire` branded 类型 | 原样 re-export（生命周期 = vendored 既有机制，§8.2） |
| 状态化 DSL | `Sketcher`/`Sketch`/`Blueprint`/`draw`/`Drawing` 工厂与变换 | 原样 re-export——**库写轮廓离不开它们，9-02 把它们 skip 是因为塞不进 defineOp，不是因为不能用** |
| 纯函数/组合子/类型 | `vec*`、`ok`/`err`/`isOk`/`isErr`/`map`/`andThen`/`pipe`、`BrepError`、全部类型导出 | 原样 re-export |

**语义封装**（投影时附加，区别于裸 re-export）：
1. **内核单实例断言**：面内 op 首次调用时断言 faijs 内核已绑定（D10），报错文案引导宿主见 `initOcctWasm`——
   **库作者永远不写 `registerKernel`**（对照 `brepjs-gear.ts:64` 的违规现状）；
2. **品牌**：面与报错零 `brepjs` 字面量（U8 守卫已存在，扩展断言到本面）；
3. **不投影**：内核管理符号（`getKernel`/`registerKernel`/`withKernel`——faijs 独占引擎管理）、
   `csg`/`voxel`/`implicit`/`lattice`/`worker`（D5 继承裁决）、文件读写型 IO（走宿主 `HostPorts`，§6.2）。

**参数双形态（D11，用户拍板 2026-09-03，Q2 改判）**：

> 用户原话：「如果Q2指的是类似box的参数，那么必须支持这两种参数。如果参数明显可以区分，
> 可以box函数内部根据参数来切换实现。如果不明显，只要是人类看来不明显，那么用两个名字。」

- **判别式（机械可执行，全仓统一）**：调用时首参是 plain object
  （`Object.getPrototypeOf(a) === Object.prototype`）且非 Shape、非句柄、非数组 → **对象形态**；
  否则 → **位置形态**。该判别式对「首参为 number/Vec3 数组/Shape/句柄」的 op 无歧义。
- **A 类（明显可区分 → 单名双形态）**：brepjs 位置形态首参不是 plain object 的 op（实测占绝大多数：
  `box(10,20,30)`/`fuse(a,b)`/`torus(majorRadius, minorRadius, options?)`/`extrude(face, height)`……）。
  函数内部先判别、归一到实现原生形态，再调实现。`box` 即用户点名样例：
  `box(10, 20, 30)` 与 `box({ size: [10,20,30] })`（或 `{width, depth, height}`，以 arg-spec 为准）同函数同实现。
- **B 类（人类看来不明显 → 两个名字）**：brepjs 位置形态**首参本身就是 plain object**（配置对象）的 op，
  与对象形态在首参上撞型，判别式失效。实测样例：`thread(options: ThreadOptions)`（`arg-spec.ts:1543`）。
  命名约定：**brepjs 形态占正名**（兼容为尊），faijs 对象形态加**描述性后缀**——先例 `rotate_euler`
  （commit 262d9c7，brepjs 轴角形态占 `rotate` 正名，faijs 欧拉形态改名）。
  细分：B1——faijs 侧无独立对象 schema 时，直接以 brepjs options 对象为唯一对象形态（单名单形态，
  无需判别，如 `thread` 默认归属此类）；B2——两边对象 schema 语义不同时才拆双名（P20 产出清单逐条定名）。
- **归一化位置（用户指定）**：在 **TS 面导出函数内部**，不是脚本面适配层。compat op（vendored 实现）
  归一方向 = 对象→位置；faijs 特有 dual op（impl 原生对象形态，如 `box({size})`）归一方向 = 位置→对象。
  两个方向共用同一份数据源：arg-spec 的 `params: string[]` 机器参数名表（P20 补）。
- **判别器是同一个工具**：`packages/core/src/api/internal/dual-form-args.ts`（P20 建，纯函数，
  `resolveArgs(args, spec) → positional`），compat 投影包装（P21）与 dual op 外包（P23）共用；
  归一失败抛 `E_ARGS_FORM`（错误文案列出该 op 的两种签名形态）。
- **效果**：库作者写 `box(10,20,30)` 或 `box({size:20})` 都合法；`.fai.js` 里 `cad.box(...)` 两种形态
  同样都合法（脚本面零适配层，见 §4.4）；UI/AI 生成代码继续只生成对象形态（faijs 特性，不变）。

### 4.3 ③ 底层封装：`compatOp()` 与 `admitCompatLib()`（D3，用户点名要求 + 具体例子）

> 用户原话：「最好在底层api层封装defineOp，这样上层api就不用考虑brep链的问题。」
> 「`compatOp()` 与 `admitCompatLib()`到底怎么做，请在文档给一个具体的例子。」

#### 4.3.1 设计要点：compatOp 是 defineOp 的**同级封装**，不是它的调用方

`defineOp` 的产物包装器（`define-op.ts:203-219`）对 brep 实现返回值只做 `wrapBrepOne`：
非 Shape 非句柄的**纯数据/混合记录**（如 `SheetMetalWarning[]`、`{flat, bends}`）会被误送进
`fromHandle` 而崩。第三方库大量函数返回数据（sheetmetal 的 `validate`/`report`/`unfold`），
所以 compatOp **直接组合** defineOp 内部的两个公共件——`dispatchPath`（分派门）与
`DUAL_OP_META`（元数据约定）——产物在 `assertLibConforms`/符号表/UI 眼里与普通 dual-op 无异。
faijs 特有 op 继续用 defineOp，不动。

#### 4.3.2 具体例子一：`compatOp` 完整契约（可直接据以实现）

新文件 `packages/core/src/api/internal/compat-op.ts`（P22 建）。以下代码是**契约级完整实现**
（所有 import 路径与函数签名均已对照现状核实）：

```ts
/**
 * compat-op — 把任意 brepjs 形态函数提升为 faijs 语句级 op（brep-only）。
 *
 * 六步边界职责（全部复用已验证设施）：
 *   1. 参数透传：位置/对象双形态归一由被包函数内部完成（D11，§4.2）；compatOp 不做形态映射
 *   2. 静态分派门：深收集几何输入 → dispatchPath（brep-only；mesh 模式/断链 → 抛错不回退）
 *   3. 输入借入：深遍历，任何 faijs Shape → createBorrowedHandle 视图（零拷贝、delete 为 no-op）
 *   4. 调用 + Result unwrap：isResultLike → err 抛带 op 名与 BrepError.code 的执行错误
 *   5. 输出收养：顶层句柄 / spec.geometryFields 声明字段 → adoptEntity（注销 finalizer + fromHandle）
 *   6. 返回：收养的 Shape 由 defineOp 同款消费方（runtime outputCache / solidCache）接管
 */
import { dispatchPath } from '../../cad-runtime/backend-dispatch'
import { DUAL_OP_META, type DualOpMeta, type ConsumeSpec } from '../../define-op'
import { isShape } from '../../shape'
import { borrowBrepjsShape, adoptEntity, callBrepjs } from './l3-bridge'
import type { Shape } from '../../mesh/types'

/** compatOp 的静态规格。库边界面由 admitCompatLib 推导；cad 面同构（双形态归一在被包函数内，D11）。 */
export interface CompatSpec {
  /** op 名（错误信息用）。 */
  name: string
  /** 返回对象中需要收养的几何字段名（缺省：仅当返回值本身是句柄时收养顶层）。 */
  geometryFields?: string[]
  /** 时间线消费声明（缺省 'all'，与 defineOp 一致）。 */
  consumes?: ConsumeSpec
  /** L3 schema（codegen + UI 面板，透传元数据）。 */
  schema?: Record<string, string>
}

const MAX_WALK_DEPTH = 4

/** 深收集几何输入（与步 3 同一 Shape 判定），供分派门静态判定。 */
function collectShapes(v: unknown, out: Shape[], depth: number): void {
  if (depth > MAX_WALK_DEPTH || v === null || typeof v !== 'object') return
  if (isShape(v)) { out.push(v as Shape); return }
  if (Array.isArray(v)) { for (const x of v) collectShapes(x, out, depth + 1); return }
  if (Object.getPrototypeOf(v) !== Object.prototype) return // 类实例不深入（防御）
  for (const x of Object.values(v)) collectShapes(x, out, depth + 1)
}

/** 步 3：入向深遍历——结构内任何 faijs Shape 换成借入视图；其余原样（库私有句柄透传，§4.3.4）。 */
function borrowDeep(v: unknown, depth: number): unknown {
  if (depth > MAX_WALK_DEPTH || v === null || typeof v !== 'object') return v
  if (isShape(v)) return borrowBrepjsShape(v as Shape)
  if (Array.isArray(v)) return v.map((x) => borrowDeep(x, depth + 1))
  if (Object.getPrototypeOf(v) !== Object.prototype) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = borrowDeep(x, depth + 1)
  return out
}

/** Result 形态判别（与 vendored result.ts:12-21 的 Ok/Err 结构对齐）。 */
function isResultLike(v: unknown): v is
  { ok: true; value: unknown } | { ok: false; error: { code?: string; message?: string } } {
  return typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean'
}

/** 步 4：语句边界 unwrap——err 转带 op 名与错误码的执行错误（不静默；引擎语句级 catch 既有）。 */
function unwrapOrThrow(r: unknown, name: string): unknown {
  if (!isResultLike(r)) return r
  if (r.ok) return r.value
  const e = r.error ?? {}
  throw new Error(`[faijs/compat] ${name}: ${e.code ?? 'E_OP_FAILED'}: ${e.message ?? 'operation failed'}`)
}

/** 步 5：出向收养——顶层句柄或 geometryFields 声明字段；已收养句柄去重（WeakMap 在 adoptEntity 内）。 */
function adoptOut(v: unknown, spec: CompatSpec): unknown {
  if (isShape(v)) return v                              // 已是 faijs Shape：原样（防二次收养）
  if (spec.geometryFields && typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const rec = v as Record<string, unknown>
    for (const f of spec.geometryFields) rec[f] = adoptEntity(rec[f], spec.name)
    return v
  }
  return adoptEntity(v, spec.name)                      // 顶层：句柄→收养；纯数据→adoptEntity 内透传
}

export function compatOp(
  fn: (...args: unknown[]) => unknown,
  spec: CompatSpec,
): (...args: unknown[]) => Promise<unknown> {
  const impl = async (...args: unknown[]): Promise<unknown> => {
    // 步 1：参数透传——双形态归一（D11）在被包函数内部完成，compatOp 原样传递。
    // collectShapes/borrowDeep 本来就深遍历 plain object，对象形态下的 Shape 输入照样被发现。
    // 步 2：静态分派门——brep-only：mesh 模式抛 E_MESH_UNSUPPORTED；auto 输入断链抛
    // E_MESH_UNSUPPORTED（无 mesh 实现可降）；brep 模式输入断链抛 E_BREP_UNSUPPORTED。
    // 零输入（构造类，如 author/torus）：[].every(hasBrep) === true → 'brep'。
    const shapes: Shape[] = []
    for (const a of args) collectShapes(a, shapes, 0)
    dispatchPath(shapes, { brep: impl }, undefined)
    // 步 3：输入借入
    const borrowed = args.map((a) => borrowDeep(a, 0))
    // 步 4：调用 + Result unwrap
    const value = unwrapOrThrow(callBrepjs(fn as never, borrowed), spec.name)
    // 步 5/6：输出收养并返回
    return adoptOut(value, spec)
  }
  // 元数据与 defineOp 同约定：assertLibConforms / 符号表 / UI 统一识别（kind: 'dual-op', brep-only）。
  const meta: DualOpMeta = {
    kind: 'dual-op',
    brep: impl,
    consumes: spec.consumes ?? 'all',
    schema: spec.schema,
  }
  Object.defineProperty(impl, DUAL_OP_META, { value: meta, enumerable: false })
  return impl
}
```

配套修改 `packages/core/src/api/internal/l3-bridge.ts`（P22，**R1 修复点**）：

```ts
// 新增 import：注销工具与句柄类型（disposal.ts:420 / :131）
import { unregisterFromCleanup, type ShapeHandle } from '../../vendored/brepjs/core/disposal.js'

/** 已收养句柄去重表：同一 vendored 句柄第二次收养 → 返回同一个 faijs Shape（防双重所有权/双重释放，R6）。 */
const adoptedMap = new WeakMap<object, Shape>()

/**
 * 收养一个 vendored 句柄为 faijs Shape（compatOp 步 5 的唯一收养入口）。
 * ① 纯数据（无 .wrapped）→ 原样透传（query/数据函数）；
 * ② 子形状类别（face/edge/wire/vertex/shell）→ 抛 E_SUBSHAPE_BOUNDARY（v1 边界拒收，R4；
 *    brand 是 phantom 编译期类型——shapeTypes.ts:93-95，运行时类别用 occt-wasm 句柄自带
 *    的 type 字段，kernel 侧 getShapeType 同款，helpers.ts:77-79）；
 * ③ 实体（solid/compound）→ unregisterFromCleanup（★ R1：摘除 finalizer，否则包装对象
 *    被 GC 时 disposal.ts:117-124 会 kernel.dispose 掉 faijs 已收养的槽）→ adoptBrepjsProduct。
 */
export function adoptEntity(product: unknown, opName: string): unknown {
  if (product === null || typeof product !== 'object' || !('wrapped' in product)) return product
  const h = product as ShapeHandle
  const prev = adoptedMap.get(h)
  if (prev) return prev
  const type = (h.wrapped as { type?: string }).type
  if (type !== undefined && type !== 'solid' && type !== 'compound') {
    throw new Error(
      `[faijs/compat] ${opName}: E_SUBSHAPE_BOUNDARY: sub-shape handle ('${type}') ` +
      'must not cross the library boundary; return entity solids or plain data',
    )
  }
  unregisterFromCleanup(h)                    // ★ R1：一行修复，替代 mech-lib 的 pinned 数组
  const s = adoptBrepjsProduct(h)             // fromHandle：三角化 + 身份槽 + BREP 槽（l3-bridge.ts:62）
  adoptedMap.set(h, s)
  return s
}
```

**`unwrapOrThrow` 抛出的错误如何变成语句失败**：dual-op impl throw 的既有路径（如
`borrowBrepjsShape` 的 `E_BREP_ONLY_INPUT` 抛错）已被引擎语句级 catch 归并进
`ExecutionResult.errors`，compatOp 复用同一路径，零新机制。

#### 4.3.3 具体例子二：`admitCompatLib` 完整契约 + sheetmetal 注册走查

新文件 `packages/core/src/cad-runtime/admit-compat-lib.ts`（P22 建）：

```ts
/**
 * admit-compat-lib — registerLib 的准入口增强（B4 修复）。
 * 顺序硬约束：先 assertLibConforms 后包装——DUAL_OP_META 以 enumerable:false 挂函数对象
 * （define-op.ts:221），assertLibConforms 用 Object.values 遍历取值判元数据；
 * 先包装后校验会让裸函数静默跳过整段严格校验（实测证实，R8）。
 */
import { assertLibConforms, DUAL_OP_META } from '../define-op'
import { compatOp } from '../api/internal/compat-op'

/** 库可在导出函数上挂一行静态标注（最小改动面⑥）：返回对象里哪些字段是几何产物。 */
type GeometryFieldsCarrier = { geometryFields?: string[] }

export function admitCompatLib(ns: Record<string, unknown>): Record<string, unknown> {
  assertLibConforms(ns)                              // ① 先校验（顺序红线）
  const out: Record<string, unknown> = {}
  for (const [name, v] of Object.entries(ns)) {
    if (typeof v !== 'function') { out[name] = v; continue }        // contractVersion/资源对象透传
    if ((v as Record<string, unknown>)[DUAL_OP_META]) { out[name] = v; continue } // 原生 dual-op 原样通过
    out[name] = compatOp(v as (...a: unknown[]) => unknown, {       // ② 裸函数 → compatOp 包装
      name,
      geometryFields: (v as GeometryFieldsCarrier).geometryFields,  // 库的一行标注（可缺省）
    })
  }
  return out
}
```

`registerLib` 接入（`runtime.ts:332-343` 改两处，B2 前置一并落地）：

```ts
registerLib(binding: string, ns: StdlibNamespace, options?: { default?: boolean }): void {
  assertContractVersion(ns)                            // 容忍缺失（runtime-state.ts:82-88，R5 排除）
  const admitted = admitCompatLib(ns)                  // B4：裸函数不再静默绕过
  this.libs[binding] = admitted as StdlibNamespace
  this.libIds.set(binding, computeLibId(ns))           // B2：库身份 = 包名+版本+各导出 fn.toString() 哈希
  // …options.default / setNamespaces 同现状；setNamespaces 时把 libIds 一并传给 executor
}
```

**走查：sheetmetal 经 `registerLib('sheet', sheet)` 时每个导出的处置**（导出清单实测
`packages/sheetmetal/src/api.ts:87-457`、`index.ts`）：

| 导出 | 类别判定 | admitCompatLib 处置 |
|---|---|---|
| `author(spec): Result<SheetMetalPart>` | 裸函数 | compatOp：数据进数据出；返回 part 内嵌 `solid` 保持**库私有**（不透明，§4.3.4） |
| `hem(part, spec): Result<SheetMetalPart>` | 裸函数 | compatOp：入向遍历 part（plain object）无顶层 Shape → 透传；`part.solid` 是 vendored 句柄 → 透传（库私有状态）；err → 语句失败 |
| `solidOf(part): Result<Solid>`（新增，最小改动面⑦） | 裸函数 | compatOp：返回顶层 `Solid` 句柄 → **收养**（unregister + fromHandle）→ 脚本拿到 faijs Shape |
| `unfold(part): Result<UnfoldResult>` | 裸函数 | compatOp：v1 返回数据记录（`{flat, bends}` 内嵌句柄不透明）；若需 `flat` 进脚本，库加一行 `unfold.geometryFields = ['flat']`（⑥） |
| `validate(part): SheetMetalWarning[]` | 裸函数 | compatOp：非 Result → 不 unwrap；纯数据透传 |
| `report(part): Result<BendReport>` / `toDXF(...): Result<string>` | 裸函数 | compatOp：unwrap 后纯数据透传 |
| `registerBendTable`/`getBendTable`/`bendTables`（⑤改造后） | 函数 + 资源对象 | 函数 → compatOp；`bendTables` 资源对象 → 透传并计入 libId |
| `contractVersion` | 非函数 | 透传（缺省也容忍，R5） |

**走查：mech-lib（改造后，§8.1）经 `registerLib('gear', gear)`**：

| 导出 | 类别判定 | 处置 |
|---|---|---|
| `external(params): Result<ValidSolid>`（`map(makeExternalGear(params), g => g.solid)` 扁平化后） | 裸函数 | compatOp：返回顶层实体句柄 → 收养 → Shape |
| `thread(params): Result<ValidSolid>` | 裸函数 | 同上 |
| `planetary(params): Result<{sun, planets, ring}>` | 裸函数 + 一行 `planetary.geometryFields = ['sun', 'planets', 'ring']`（⑥） | compatOp：三字段各自收养 |

#### 4.3.4 边界契约（库作者三条款 + 不透明数据规则）

compatOp 的 inward/outward 规则表：

| 方向 | 规则 | 理由 |
|---|---|---|
| 入向（脚本→库） | 深遍历（深度 ≤ 4，仅 plain object/数组）：faijs Shape → `createBorrowedHandle` 视图；**vendored 句柄原样透传** | 库私有状态（如 `part.solid`）不接管，避免双重所有权 |
| 出向（库→脚本） | `isShape` → 透传；顶层 vendored 句柄 → 收养；`geometryFields` 声明字段 → 收养并替换；**其余内嵌句柄保持库私有** | 几何只在显式点跨境（性能：中间态零三角化，R10） |
| 库私有句柄的存活 | 由 ctx 中的数据对象引用保活；语句回收 → GC → finalizer 兜底释放 | 与 brepjs 原生语义一致（`disposal.ts:117-124`） |

**库作者三条款**（写进库开发手册，P27）：
1. **输入句柄不得跨调用保留**：入向借入视图仅在该次调用内有效；派生新句柄返回，不要存输入。
2. **已返回的句柄所有权已转移**：函数返回的实体句柄被 faijs 收养后，库不得再 `delete()` 它
   （brepjs 惯例本来就是「返回即转移」，上游库天然满足）。
3. **返回结构里只有顶层句柄与 `geometryFields` 声明字段会被收养**；其余内嵌句柄是库私有状态，
   跨调用一致性由库自己保证（sheetmetal 上游的做法：part 是纯数据 + 一个 `solid`，每次调用从
   feature graph 重建子形状引用，天然满足）。

#### 4.3.5 两个完整执行轨迹（验收用例的精确预期）

**轨迹 A（cad 脚本面）**：`let p2 = cad.fuse({ a: p0, b: p1 })`（auto 模式，p0/p1 在 BREP 链）

1. 编译产物 `ns.cad.fuse({a: p0, b: p1})`；`cad.fuse` = `compatOp(fuseDualForm, { name:'fuse', consumes:'all' })`，
   其中 `fuseDualForm` 是 P21 的 TS 面投影包装（内部含 `['a','b','options']` 归一表，D11；P20 给 arg-spec
   条目补机器参数名表，P23 装配到 `cad` 面）。
2. 步 1：`{a,b}` 原样透传（对象形态归一在 `fuseDualForm` 内部发生，最终调 `vendoredFuse(p0, p1, undefined)`）。
3. 步 2：`collectShapes` 深遍历对象形态实参 → `[p0, p1]`；`dispatchPath`：auto + 均 `hasBrep` → `'brep'`。
4. 步 3：`borrowDeep` → `[borrowedA, borrowedB, undefined]`（`createBorrowedHandle`，`disposal.ts:249-264`）。
5. 步 4：`fuseDualForm(borrowedA, borrowedB, undefined)`（内部归一后调 `vendoredFuse`）→ `Result<ValidSolid>`；
   `ok` → 取 `.value`。
6. 步 5：`adoptEntity`：`wrapped.type === 'solid'` → `unregisterFromCleanup` → `fromHandle`（三角化 + 身份槽）→ Shape。
7. 语句写入 `ctx.p2`；`runtime.ts:765` `isShapeLike` → outputCache/solidCache 登记——**与内置 op 产物同构**。
8. 若 `err`：步 4 抛 `[faijs/compat] fuse: <CODE>: <message>` → 语句失败进 `ExecutionResult.errors`。

**轨迹 B（库边界面）**：`let p1 = sheet.hem(p0, { edge: 'front', radius: 3, length: 10 })`

1. `sheet.hem` = admitCompatLib 包装的 compatOp（库函数自带签名，参数原样透传——D11 的双形态归一
   只作用于 faijs 官方 op 面，不改写库函数自己的参数约定）。
2. 步 2：`collectShapes(p0)` —— p0 是 plain object（SheetMetalPart 数据），无顶层 Shape → 空集；
   `dispatchPath([], {brep})` → auto 模式 `impls.brep && [].every(...)` → `'brep'`。
3. 步 3：`borrowDeep(p0)`：`p0.solid` 是 vendored 句柄（非 faijs Shape）→ **透传**；spec 对象逐字段透传。
4. 步 4：`hem(p0, spec)` → `Result<SheetMetalPart>` → unwrap → part。
5. 步 5：无 `geometryFields` → 顶层 part 是 plain object 无 `wrapped` → `adoptEntity` 透传。
6. `ctx.p1` = 数据对象（内嵌 `solid` 库私有，由 ctx 引用保活）。
7. 后续 `let s1 = sheet.solidOf(p1)`：步 4 返回 `ok(p1.solid)` → 步 5 顶层实体句柄 → 收养 →
   `ctx.s1` 是 faijs Shape（outputCache 登记）；此后 `cad.union(s1, ...)` 走既有 BREP 路径。

### 4.4 ② cad 脚本面

- `cad.*` = ① 面全量语句级 op 经 `compatOp` 包装（参数透传；双形态归一在 ① 面函数内部，arg-spec
  `params` 表同源，P20 补机器参数名）+ faijs 特有 31 个 dual-op（既有 `defineOp`），同源于一份清单
  （B1 修复：导出面 ≡ `cad` 面 ≡ `check()` 符号表，生成层单一数据源）。
- **参数双形态（D11，用户拍板）**：对象形态不再是脚本面专属——① 面与脚本面是同一批函数，
  位置/对象两种形态都可用（可判别单名、不可判别双名，§4.2）；对象形态 schema 全仓只有一份
  （arg-spec），UI/AI 生成代码继续只生成对象形态（faijs 特性，在用户的例外清单内，保留）。
- **脚本语义零变化**：语句失败 = err unwrap 成带上下文的错误；产物 = 完整 `Shape`。
  存量 `.fai.js` 与 3d_editor 生成代码零修改（U1）。
- dual-op 的 mesh 实现全部保留：`cad.box` 仍是 `{mesh, brep}` 双实现、静态分派（U4 不动）。
  compat 包装只产生 **brep-only** op——mesh 模式调用抛 `E_MESH_UNSUPPORTED`，不回退。

### 4.5 依赖方向硬规则

| 规则 | 内容 |
|---|---|
| 库只 import `@faicad/faijs` | 第三方库 `dependencies` 零 brepjs、零 `@faicad/faijs-core/vendored/**` 深路径；peer 依赖 `@faicad/faijs` + `occt-wasm`（单实例） |
| vendored 是 core 私有实现 | 删 `packages/core/package.json:32-33` 两条 `./vendored/*` exports（B5①；与 sheetmetal 迁移同期，避免中间态） |
| 面与实现可替换 | vendored 是当前实现；中期换 Remus/自研时 ① 面契约不变（Q3 已拍板） |

---

## 5. Result 体系统一（D1，核心语义反转）

### 5.1 三层错误语义

| 层 | 形态 | 说明 |
|---|---|---|
| 库内部 / TS 兼容面 | **`Result<T>` 原生**，`BrepError`（kind/code/message/suggestion/metadata） | 与 brepjs 完全一致——库代码的 `if (isErr(r)) return r` 等全部惯用法零改动 |
| 语句边界（`compatOp` 第 4 步） | `err` → **throw**（携带 `BrepError.code` + 语句上下文） | `.fai.js` 是单行语句语言，无法表达 Result 链；unwrap 是脚本语义的必然，不是「改回 throw」 |
| 引擎内部（faijs 特有 op 的 impl） | 迁移为返回 `Result`，由同一边界 unwrap | 全引擎一种错误体系；见 §5.2 |

### 5.2 「faijs 现有 throw 方案改过来」的准确范围

- **对外可见行为零变化**：`.fai.js` 脚本（语句失败语义）、`ExecutionResult.errors`、宿主消费方式全部不变。
  变化发生在 impl 协议层：`defineOp` 的 impl 由「返回值或 throw」演进为「返回 `Result`」，
  由统一边界 unwrap。过渡期内边界同时接受两种 impl 形态（throw 捕获归一为 `err`），终态全 Result。
- `CONTRACT_VERSION` 升一位，`assertLibConforms` 按新版本校验（既有机制，`define-op.ts:239-243`）。
- **BrepError 体系提升为公共契约**：错误码表（`errors.ts:35-204`）从 vendored 私有变成 faijs 官方错误码，
  faijs 特有 op 的错误逐步换发 `BrepError`（带 code/suggestion），替代现在的裸 `new Error(...)`。
- 3d_editor 影响面：它经「生成 `.fai.js` → runtime 执行」消费，不经 TS 直接调 op——脚本行为不变 ⇒ 零改动。
  （若有个别直接调用点，属 major 版本变更的正常适配，迁移指南随 P23 给出。）

### 5.3 相对 9-02 方向的减负（量化）

9-02 E8 要求 sheetmetal 把约 **350 处** Result 消费点（`ok` 77 / `err` 186 / `validationError` 186 的调用规模）
改写为 throw 语义——这是「faijs 语义为尊」的代价。D1 反转后：**这 350 处全部零改动**，
「改包名即可」在错误处理维度真正成立。

---

## 6. 兼容覆盖策略：852 符号重估

### 6.1 P14 的 399 个 skip 重判（D4 的直接后果）

P14 的 skip 理由实测分布（`arg-spec.ts`）。按「TS 面是否投影」重新裁决：

| skip 原因（实测条数） | 9-02 判定 | **本版判定** | 理由 |
|---|---|---|---|
| 入参 Face/Edge/Wire 子形状句柄（10+11） | skip | **TS 面投影**；脚本面 v1 不投 | 库内部子形状操作完全合法（vendored 机制自洽，§8.2）；脚本面跨语句持有 Face 有失效风险，持久引用走 faijs naming 体系（faijs 特性） |
| 状态化草图/绘图 DSL（6+6+7+6≈25） | skip | **TS 面投影** | 库写轮廓离不开 Sketcher/Blueprint/Drawing；DSL 是对象不是 op，本就不该过 defineOp 模具 |
| 2D 曲线基元 / kernel-句柄 Curve2D（7+6） | skip | **TS 面投影** | 同上，库内部使用 |
| 迭代器（子形状句柄流，6） | skip | **TS 面投影** | 库内部遍历 |
| Blueprint 句柄对象（5） | skip | **TS 面投影** | 同上 |
| Result 组合子（6）、错误构造器（9）、类型守卫（5） | skip（标「纯函数」） | **TS 面投影** | 库写 Result 链必需；re-export 零成本 |
| 拓扑谓词（KernelShape，14） | skip | **TS 面投影**（接受 brepjs 句柄形态） | 库内部使用 |
| IO/字节 → host ports（11） | skip | **拆分**：返回纯数据（字串/字节）的投 TS 面；读写文件的不投，走 `HostPorts` | 库的内存态导出需求合法；文件访问必须经宿主（多宿主红线） |

**净效果**：TS 兼容面覆盖率从 52%（441/852）提升到 **接近全量**——剩余缺口只有 D5 继承的
§2.6 排除项（已登记 `upstream-exclusions.json`，反静默跳过断言继续有效）与文件型 IO。

### 6.2 范围红线（继承，不重议）

不投影：`csg`（U9，用户明示保留）、`voxel`（依赖未发布 wasm）、`implicit`（与 faijs `sdf` 冲突）、
`lattice`（已被 `sdf` 模板覆盖，P14b 已补 `schwarzP`/`diamond`）、`worker`（与 host 层冲突）、
内核管理符号（faijs 独占引擎管理）。裁决细节逐字引用 9-02 §2.6，不在本文档重复。

### 6.3 同名冲突终态（9-02 §5.1 实测结论 + 代码实际落地修正）

faijs 特有 op 与 brepjs 同名符号**已经全部错开**——冲突在命名层面已清零：

| brepjs 符号 | faijs 特有侧 | 状态 |
|---|---|---|
| `drill` / `extrude` / `split` | `fai_drill` / `fai_extrude` / `fai_split` | ✅ 已更名落地（3d_editor 已同步） |
| `rotate`（轴角） | `rotate_euler`（欧拉） | ✅ 已更名落地（commit 262d9c7；9-02 的 D-ROTATE 双形态**未实施**，以代码为准） |
| `fillet` | faijs `{radius}` 形态已删 | ✅ D-FILLET 步骤 1 已落地，brepjs 版独占该名 |
| `box`/`sphere`/`cylinder`/`cone`/`translate`/`scale`/`intersect`/`chamfer` | 同名 | 不冲突：**单名双形态**（D11）——首参 plain object → 对象形态，否则位置形态，函数内部归一到同一实现（§4.2 判别式）。**一份实现，两种调用约定** |
| `faceCenter` | 现 `cad.*` 无此符号（`api/geom.ts` 导出的是 `faceNormal`/`bboxCenter`/`bboxMin`/`bboxMax`） | 无冲突，brepjs `faceCenter(face): Vec3` 直接投影 |

**双名清单（D11 B 类，P20 产出）**：凡 brepjs 位置形态首参本身是 plain object（配置对象）的 op，
判别式失效、人类看不明显 → 拆两个名字。命名约定：**brepjs 形态占正名**，faijs 对象形态加描述性后缀
（先例 `rotate_euler`）。实测已定位的首个候选：`thread(options: ThreadOptions)`（`arg-spec.ts:1543`）——
其默认归 B1（brepjs options 即唯一对象形态，不拆名）；仅当 faijs 侧需要语义不同的对象 schema 时才归
B2 拆名。全量 A/B 分类清单是 P20 的交付物（逐条标注 A / B1 / B2，B2 给出两个名字）。

**符号唯一性守卫**（用户红线「一个库里绝对不准出现两份」）：
判定标准 = 同一调用面上两个同名**实现**。本方案中每个符号全仓只有一份实现（vendored 或 mesh），
三个面都是投影/包装。守卫断言：① `cad` 面键集 ≡ 导出面键集 ≡ `check()` 符号表键集（B1）；
② 任意包内 `export const box` 类定义唯一（生成层单一数据源保证）；③ 第三方库 import 说明符守卫
（零 `brepjs`、零 `vendored`）。

---

## 7. faijs 执行语义落实

### 7.1 mesh/brep 双槽与静态分派（不变）

- compat op = **brep-only**：mesh 模式调用抛 `E_MESH_UNSUPPORTED`，不回退（红线不动）；
  auto 模式输入在链 → brep；输入断链 → `MeshUnsupportedError`（无 mesh 实现可降），不静默降级
  （`backend-dispatch.ts:67-118` 既有矩阵，`v53-lib-brep-dispatch.test.ts` 已覆盖）。
- faijs 特有 dual-op（mesh+brep）原样保留；库产物经收养带 BREP 槽进 `solidCache`，
  与 `cad.*` 产物同构，后续 mesh-only op 断链发 `part-brep-lost`——与内置 op 完全一致。
- **库内部不分派**：库在 brep 路径下执行（否则入口借入即抛错），库内部 op 序列是库的实现细节。
  分派发生在**语句级**（继承 v2 §8.1，用户已认可该架构）。

### 7.2 句柄生命周期（v3.1 实测修正：域无需扩展，修复在收养侧）

**问题一「子形状句柄体系与收养语义」——实测答案**（无需新发明）：
vendored 的 `Face`/`Edge`/`Wire` 是 branded `ShapeHandle`（`shapeTypes.ts:115,125`），
按父 shape 缓存于 WeakMap `topoCache`（`topologyQueryFns.ts:101`），父 dispose 时经 `onDispose`
级联释放（`:143-148`），FinalizationRegistry 兜底（`disposal.ts:117-124`）。
**库内部使用完全自洽**——brepjs 库本来就这么活。

**问题二「函数 BREP 域的释放时机」——实测答案**：
域 = `runtime-state.ts:154-185` 的深度计数 + 句柄登记表；hook 点在 `fromBrep`
（`shape.ts:73` 调 `registerFunctionBrep`），`fromHandle` 同源（`handle-bridge.ts:77-78`
委托 `fromBrep`）；语句 `finally` 里 `releaseFunctionBrepDomain`（`module-executor.ts:405-420`）
释放**除语句 writes 可达句柄外**的全部。

**v3.1 修正（R3，实测排除域扩展的必要性）**：
- 本机函数体内调库：`isLocal === true` 语句已进入域（`module-executor.ts:258-262`），
  库调用收养的句柄经 `fromHandle → fromBrep` 自动登记，随域在 `finally` 释放非逃逸部分——
  **现有机制已覆盖，零改动**。
- 语句级库调用（`let p1 = sheet.hem(...)`）：收养产物是语句 writes 可达的，由
  outputCache/solidCache 长期持有、随语句回收释放；**域本来就不管语句级产物，无需扩展**。
- 库内部中间句柄：vendored ops 自带 `DisposalScope`/`withScopeResult` 纪律（`disposal.ts:424-470`），
  漏网的由 finalizer 兜底——与 brepjs 原生运行完全一致，faijs 无需也无力接管。

**结论：B3 的修复不是扩展域，而是 R1——收养必须 `unregisterFromCleanup`**（§4.3.2 `adoptEntity`）。
`module-executor.ts` 在本方案中**唯一改动是 B2 的 computeKey 一行**。

**逃逸收养规则**（明确写出，防悬空句柄）：
- 语句级：收养（`adoptEntity`）即转入 faijs 身份槽/`solidCache`，域退出不释放；
- 子形状逃逸（库把 `Face` 返给脚本）：v1 拒收——`adoptEntity` 按 `wrapped.type` 判别
  （实体 `solid`/`compound` 才收养，其余抛 `E_SUBSHAPE_BOUNDARY`，§4.3.2）；
- 脚本面跨语句的持久面/边引用：走 faijs 既有 naming/EdgeTopoRef 体系（faijs 特性，与兼容面正交）。

### 7.3 增量执行（B2 修复）

- `computeKey`（`module-executor.ts:594`）库分支从 `` `${ns}.${callee}` `` 改为
  `` `${ns}.${callee}#${libId}` ``；`libId` 在 `registerLib` 时计算并登记（§4.3.3）：
  `computeLibId(ns)` = 对「绑定名 + 排序后的导出名表 + 每个导出函数的 `fn.toString()`」做哈希
  （与 `local.${callee}#${bodyHash}` 同款内容寻址思路；`bodyHashOf` 先例在 `:610-612`）。
  executor 侧经 `setNamespaces` 同批接收 `Map<binding, libId>`。
  **换库版本/改库实现 → 全量重算；库不变 → 零额外开销。**
- **库纯函数性守卫**：sheetmetal 上游的模块级可变状态（`bendTableFns.ts` 折弯表注册表）
  会破坏「同输入同输出」——增量跳过语句时展开结果可能漂移。处置：注册表显式化为库导出的
  资源对象（`bendTables`），经 `admitCompatLib` 透传并计入 `libId`（资源对象的序列化键）；加纯函数守卫测试
  （同输入两次执行结果一致，参照 v53 测试的纯函数用例）。

### 7.4 多宿主

| 宿主 | 库加载 | 约束 |
|---|---|---|
| Node（`node-host`） | 真 `import()` | 库 peer 依赖 `@faicad/faijs` + `occt-wasm` |
| 浏览器（`browser-host`） | bundler 同 chunk / CDN+importmap | **必须与 faijs 共用同一份 `occt-wasm` 实例**（D10 单实例；打进第二份 wasm 则句柄空间分裂、直接崩）。OCCT 在主线程、与脚本执行同上下文（`browser-host/` 零 occt 引用实测），compat 同步调用链天然成立 |

`.fai.js` 侧机制不变：parser 只取 import binding 名，compile 发射 `ns.<binding>.<callee>`，
说明符字符串不参与模块解析；宿主负责真实加载并 `registerLib(<binding>, ns)`（继承 v2 §3.2，已实测）。

---

## 8. 两个库的改造与最小改动面（D6）

### 8.1 mech-lib

| 项 | 现状 | 改动 | 性质 |
|---|---|---|---|
| `package.json` | `dependencies: {"brepjs": "18.119.2"}` | 删除；peer 改 `@faicad/faijs` + `occt-wasm` | **改包名** |
| `brepjs-gear.ts:32` | `from 'brepjs'`（`registerKernel`/`OcctWasmAdapter`/`makeExternalGear`/`thread`/`isErr`） | `from '@faicad/faijs'`；`makeExternalGear`/`thread`/`isErr`/`map` 同名继续用 | **改包名** |
| `:64` 自行 `registerKernel(...)` | 库管引擎 | 删除（兼容面单实例断言接管，§4.2） | 删模板（最小改动面①） |
| `:75` 模块级 `pinned` 数组 | 防 GC 只钉不释 | 删除（`adoptEntity` 的 `unregisterFromCleanup` 接管，R1） | 删模板（最小改动面②） |
| 手写 `fromHandle(rawIdOf(...))` 出口（`:104-116`） | 库管收养 | 删除；改为 `export const external = (params) => map(makeExternalGear(params), (g) => g.solid)`——返回 `Result<ValidSolid>`，收养由 `admitCompatLib` 完成 | 删模板（最小改动面③） |
| `planetary` | 手写 `compound([...])` | 返回 `Result<{sun, planets, ring}>` + 一行 `planetary.geometryFields = ['sun','planets','ring']` | 元数据标注（⑥） |
| `mock-mech-brep.ts` | defineOp 双路径 fixture，已合规 | 不动（对照组） | — |

验收：`c3-brepjs-scenario.test.ts` 四项断言（BREP 产物 / BREP 路径布尔 / STEP `ADVANCED_FACE` /
几何交叉校验）零改动通过；源码 `grep -c brepjs` = 0（NOTICE 除外）。

### 8.2 sheetmetal

| 项 | 现状 | 改动 | 性质 |
|---|---|---|---|
| `compat.ts`（144 行，集中 22 处 `vendored/**` 深路径） | 穿透 faijs 内部 | **整文件删除** | 删桥（最小改动面④） |
| 27 个源文件的 import | 经 `./compat.js` 间接深路径 | `from '@faicad/faijs'`（单一说明符） | **改包名** |
| Result 消费点（约 350 处） | brepjs Result 惯用法 | **零改动**（D1 的直接收益，§5.3） | — |
| 折弯表模块级注册表（`bendTableFns.ts`） | 模块级可变状态 | 显式化为导出资源对象（§7.3） | 状态显式化（最小改动面⑤） |
| 多几何产物函数（`planetary` 类、`unfold` 若需 `flat` 入脚本） | 普通对象返回 | 加一行静态 `geometryFields` 标注（供 compatOp 出向收养） | 元数据标注（最小改动面⑥） |
| **缺几何终端**：`author`/`hem` 返回数据对象，`part.solid` 无法从脚本取出——`.fai.js` 参数白名单**不含 MemberExpression**（`parser.ts:264` 实测），脚本写不了 `p1.solid` | 无 | 新增一个显式终端函数：`export function solidOf(part: SheetMetalPart): Result<Solid> { return part.solid ? ok(part.solid) : err(validationError('NO_SOLID', 'part has no authored solid')) }`（约 5 行，`api.ts` 同款风格） | 终端提取（最小改动面⑦，v3.1 新增） |

验收：`grep -rn vendored packages/sheetmetal/src` = 0；227 个 `it` 保绿
（`reference.test.ts` 5 位小数、`invariants.test.ts` `toBeCloseTo(…,6)` 不动）。

### 8.3 「最小改动面」的完整定义（回应用户的最终评判标准）

「只换包名」做不到的部分，**全部改动 = 上两表中带序号的 7 项**，且每一项有明确理由：
①②③ 删「库越权管引擎/生命周期」的模板（这些在 brepjs 生态里本就是库不该做但被迫做的）；
④ 删穿透桥（违规产物）；⑤ 增量纯函数性（faijs 特性要求）；⑥ 多几何处物的静态标注
（出向收养点显式化）；⑦ 脚本面无属性访问语法的几何终端提取函数（faijs 语法约束，实测
`parser.ts:264`）。除此之外，**库源码逐行不变**。

### 8.4 端到端验收场景（两库各跑一遍；v3.1 按真实 API 签名改写）

**sheetmetal**（数据中心流：`author` → 特征链 → `solidOf` 终端 → 与 cad 互操作）：

```js
import * as sheet from '@faicad/sheetmetal'
let p0 = sheet.author({ thickness: 2, baseLength: 100, width: 60 })
let p1 = sheet.hem(p0, { edge: 'front', radius: 3, length: 10 })
let s1 = sheet.solidOf(p1)                        // 显式几何终端（最小改动面⑦）
let b1 = cad.union(s1, cad.box({ size: [10, 10, 10] }))
let u1 = sheet.unfold(p1)                         // 多输出数据记录：{ flat, bends }
let r1 = sheet.report(p1)                         // 纯数据查询
```

**mech-lib**（几何直出流）：

```js
import * as gear from '@faicad/mech-lib'
let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })
let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })
let u1 = cad.union(g1, cad.box({ size: [30, 30, 5] }))
```

断言：① `s1`/`g1` 是 faijs `Shape`（`hasBrep === true`，mesh 载荷非空）；② `b1`/`u1` 布尔走 BREP 路径；
③ 多输出记录结构正确；④ 导出 STEP 含 `ADVANCED_FACE`；⑤ 增量：改 `author` 参数只有下游重算，
换库版本全量重算（验 B2）；⑥ `mode='mesh'` 调 `sheet.hem` → `E_MESH_UNSUPPORTED` 不回退；
⑦ 库调用语句执行后无句柄泄漏（收养句柄在 solidCache；中间句柄 finalizer 兜底——
验法：重复执行 N 次后 arena 存活句柄数有界）。

---

## 9. 分期计划（v3.1 重排；每期附执行卡：改哪些文件、加什么、跑什么验证）

> 纪律：每期独立验证；严禁跑 CI 找 bug；每期通过才进下一期。沿用 9-02 的编号断点，从 P20 起。
> v3.1 变化：原 P23（域扩展）经实测取消（R3），B2 并入 P22；后续期号前移。
> v3.2 变化：Q1–Q8 全部拍板（§11），Q2 改判为 D11 参数双形态——P20 增 A/B 分类清单与判别器，
> P21 投影包装内含双形态归一，P22 增双形态测试。

| 期 | 内容 | 风险 | 依赖 |
|---|---|---|---|
| **P20** | **基线冻结 + D11 分类**：① 回归套件全绿确认；② §6.1 重估结论回写 `arg-spec.ts` 的 skip 处置；③ arg-spec 条目补**机器参数名表**（`params: string[]`，从现有 `args` 人读串机械提取，供双形态归一）；④ **A/B 分类清单**（§4.2：逐条标 A 单名双形态 / B1 单名单形态 / B2 双名并定名）；⑤ 判别器 `dual-form-args.ts`（纯函数 + 单测）；⑥ `upstream-exclusions.json` 断言复核 | 低 | — |
| **P21** | **TS 兼容面落地**：新建 `api/compat/`（从 vendored 精选投影四类内容，§4.2；有 arg-spec 条目的 op 包**双形态归一**，B2 条目按 P20 清单拆两个导出）+ 单实例断言 + 品牌守卫扩展；**暂不切换主导出**（先共存，P23 切换） | 中 | P20 |
| **P22** | **底层封装与准入口**：`compatOp()`（§4.3.2）+ `adoptEntity`/R1 修复（l3-bridge）+ `admitCompatLib()`（B4，§4.3.3）+ 库身份登记与 computeKey 修复（B2） | **高**（机制验证点） | P21 |
| **P23** | **cad 脚本面同源重建 + 主导出切换**：`cad.*` 与导出面、`check()` 符号表同源于一份清单（B1）；faijs 特有 op impl Result 化（§5.2，`CONTRACT_VERSION` 升位）；major 版本号 | **高**（触碰全量 op） | P22 |
| **P24** | **mech-lib 改造**（§8.1）+ c3 四项断言转绿 | 中 | P23 |
| **P25** | **sheetmetal 改造**（§8.2）+ 227 `it` 保绿 + 删 core 两条 `vendored` exports（B5①，同期进行避免中间态） | **高**（用户最关心的验证点） | P24 |
| **P26** | **端到端验收**（§8.4 七项断言 × 两库）+ 3d_editor 回归 | 中 | P25 |
| **P27** | **文档与工具链**：API 手册分层生成、符号表同源、库开发手册（§4.3.4 三条款）、`AGENTS.md` 错误体系/op 三分类文案同步、两份旧方案文档状态更新 | 低 | P26 |

**三个卡点**：P22（`compatOp` 机制是否成立）、P23（同源重建 + Result 化是否零行为回归）、
P25（sheetmetal 是否真的只改包名 + 删桥就能跑）。

### P20 执行卡

- 改：`packages/core/src/api/surface/arg-spec.ts`（每条 brep-op/query 条目加 `params: string[]`；
  skip 条目按 §6.1 改标 `ts-face`/`script-face` 投影去向；每条加 `formClass: 'A' | 'B1' | 'B2'`）。
- 建：`packages/core/src/api/internal/dual-form-args.ts`（D11 判别器，纯函数）：
  `resolveArgs(args: unknown[], spec: { name: string; params?: string[]; formClass: 'A'|'B1'|'B2' }): unknown[]`——
  首参 plain object（非 Shape/句柄/数组）→ 对象形态，按 `params` 表映射为位置数组（缺省键 → `undefined`）；
  否则原样返回；对象形态含 `params` 外未知键、或两形态都无法匹配 → 抛 `E_ARGS_FORM`
  （文案列出该 op 的两种签名形态）。B2 条目不走判别器（两个名字各自固定形态）。
- 测：`dual-form-args` 单测（plain object / Shape / 数组 / number / 未知键 / 空对象六路）。
- 交付：`arg-spec.ts` 的 A/B 分类清单（A 单名双形态 / B1 单名单形态 / B2 双名 + 两个名字），
  首个 B 类候选 `thread`（`arg-spec.ts:1543`）默认标 B1。
- 验证：`npm run typecheck`；`npm run test -w @faicad/faijs-core`（基线全绿）；
  `npx tsx packages/core/scripts/gen-l3-surface.ts` 重跑确认生成面零 diff（params/formClass 只进元数据）。

### P21 执行卡

- 建：`packages/core/src/api/compat/index.ts`（四类投影：op 精选 re-export、子形状、DSL、组合子/类型；
  有 arg-spec 条目的 op 包两层——**双形态归一**（调 P20 的 `resolveArgs`；B2 条目按 P20 清单拆两个导出，
  各自固定形态不调判别器）+ **单实例断言**（`getBackends().kernel.brep` 为空则抛引导性错误））。
- 改：`packages/core/src/index.ts` 增加 `export * as compat from './api/compat'`（暂存子路径）；
  `scripts/check-vendored-branding.mjs` 断言范围扩到 `api/compat/`。
- 验证：`npm run typecheck`；新增 `packages/tests/faijs/compat-face/smoke.test.ts`：
  从门面 import `fuse`/`isErr`/`ok`/`Sketcher` 各调一次（fuse 两 box 求并，`isOk` 为真）；
  **双形态断言**：`box(10,20,30)` 与 `box({size:[10,20,30]})` 产出几何一致（bbox 全等）；
  错误形态（如 `box('x')`）抛 `E_ARGS_FORM`。

### P22 执行卡（核心机制期）

- 建：`packages/core/src/api/internal/compat-op.ts`（§4.3.2 完整代码）；
  `packages/core/src/cad-runtime/admit-compat-lib.ts`（§4.3.3 完整代码）。
- 改：`packages/core/src/api/internal/l3-bridge.ts` 加 `adoptEntity` + `adoptedMap` +
  `unregisterFromCleanup`（§4.3.2）；`cad-runtime/runtime.ts` `registerLib` 接入
  admitCompatLib + libIds 登记（§4.3.3）；`cad-runtime/module-executor.ts:594` 库分支 key 加
  `#${libId}`、`setNamespaces` 同批接收 libId 表。
- 测（新建 `packages/tests/faijs/compat-op/`）：
  ① 单测：borrowDeep 对 Shape/plain object/数组/类实例四形态；unwrapOrThrow 的 err→throw 带 code；
  adoptEntity 的实体收养 / 纯数据透传 / 子形状拒收（`E_SUBSHAPE_BOUNDARY`）/ 同句柄二次收养去重；
  ② 集成：裸库（无 defineOp、无 contractVersion）`registerLib` → `.fai.js` `let g = lib.make(...)` →
  断言 Shape + hasBrep；③ 增量：改库函数实现（另一导出对象）重注册 → 下游重算；同库重注册 → 不重算；
  ④ 泄漏：循环执行库调用 50 次，断言 arena 存活句柄有界（对照 `disposal.ts` 的 stats）；
  ⑤ 双形态透传：compatOp 包装的 op 分别以位置/对象两形态调用，断言 `collectShapes` 对对象形态
  实参同样发现 Shape 输入（分派门行为一致）。
- 验证：`npm run test -w @faicad/faijs-tests -- compat-op`；v53 测试不回退。

### P23 执行卡

- 改：生成器 `gen-l3-surface.ts` 产物从「逐 op 展开 defineOp」改为「`compatOp(fn, spec)` 一行/符号」
  （`fn` 为 P21 的双形态投影包装）；`api/api-namespace.ts` 与导出面、`check()` 符号表同源于生成清单；
  `api/index.ts` 导出兼容面；根门面 `src/index.ts` 主导出切换；faijs 特有 op impl 逐个 Result 化 +
  `CONTRACT_VERSION` 升位；faijs 特有 dual op 外包 `resolveArgs` 判别器（位置→对象方向，D11）。
- 验证：存量 `.fai.js` 全量回归（`packages/tests` + `packages/core/src/**/*.test.ts`）零修改通过；
  三源一致断言（导出面 ≡ `cad` 面 ≡ `check()` 符号表）进测试；
  `cad.box(10,20,30)` 与 `cad.box({size:[10,20,30]})` 在 `.fai.js` 中各执行一次，产物几何一致。

### P24 执行卡

- 改：`packages/mech-lib`（§8.1 表逐项）；`brepjs-gear.ts` 改名 `gear.ts`。
- 验证：`npm run test -w @faicad/mech-lib`（c3 四项断言）；`grep -rn "brepjs" packages/mech-lib/src` = 0。

### P25 执行卡

- 改：`packages/sheetmetal`（§8.2 表逐项：删 compat.ts、27 文件 import 换名、折弯表显式化、
  `solidOf` 终端、按需 `geometryFields` 标注）；`packages/core/package.json` 删两条 `./vendored/*` exports。
- 验证：`npm run test -w @faicad/sheetmetal`（227 `it`）；`grep -rn "vendored" packages/sheetmetal/src` = 0；`grep -rn "brepjs" packages/sheetmetal/src` = 0（NOTICE 除外）。

### P26 执行卡

- 建：`packages/tests/faijs/compat-e2e/sheetmetal-flow.test.ts` 与 `mech-lib-flow.test.ts`
  （§8.4 脚本逐字作为 fixture，七项断言）。
- 验证：两个 e2e 全绿；3d_editor 侧 `npm run pack` 重打 tarball 后其既有回归套件通过
  （3d_editor 消费面是「生成 `.fai.js` → runtime 执行」，脚本行为不变 ⇒ 预期零适配；
  若其直接 import 了被切换的 30 个 op 导出，按 major 迁移指南逐个对齐）。

### P27 执行卡

- 改：`docs/ops-api-inventory.md` 分层重写（① ② ③ 三面分章）；`docs/api-contract.md` 错误体系章
  Result 化；`AGENTS.md` op 三分类文案；新建库开发手册（§4.3.4 三条款 + 最小改动面清单 +
  `geometryFields`/`solidOf` 模式）；两份旧方案文档按状态流转约定标注（已做）。
- 验证：`npm run doc-sync` 12 项门禁全绿。

---

## 10. 验收标准

| 维度 | 断言 |
|---|---|
| **兼容性（核心）** | ① 取 brepjs-sheetmetal 上游任意 3 个文件：`sed "s|from 'brepjs'|from '@faicad/faijs'|"` 后通过类型检查（符号全在 TS 兼容面内）；② mech-lib/sheetmetal 的实际改动 == §8.3 的 7 项清单，无第 8 项 |
| **流程走通** | §8.4 七项断言 × 两库全绿 |
| **语义对齐** | ① TS 面 `fuse` 返回 `Result`（`isErr`/`isOk` 可用）；② 库内 `err` 到脚本层 = 带语句上下文的执行错误，`ExecutionResult.errors` 形态不变；③ 存量 `.fai.js` 全量回归零修改（U1） |
| **符号唯一性** | §6.3 守卫三条全绿 |
| **参数双形态（D11）** | ① A 类样例 `box`：TS 面与 `cad` 面各以 `box(10,20,30)` / `box({size:[10,20,30]})` 调用，产物几何一致；② 错误形态抛 `E_ARGS_FORM`；③ B 类按 P20 清单落地（`thread` 默认 B1 单名单形态）；④ 存量 `.fai.js`（对象形态）零修改回归 |
| **双槽** | v53 分派矩阵不回退；mesh 模式调 compat op = `E_MESH_UNSUPPORTED` |
| **生命周期** | 收养句柄入 solidCache、语句回收即释放；库调用 50 次循环 arena 存活句柄有界（验 R1）；mech-lib 删 `pinned` 后无泄漏/无悬空；同句柄二次收养返回同一 Shape（验 R6） |
| **增量** | 库身份进键：换库版本/实现全量重算；库不变只下游重算；sheetmetal 纯函数守卫通过 |
| **去 brepjs 化** | 两库源码零 `brepjs`/零 `vendored`；core 零 `./vendored/*` exports；U8 守卫全绿 |
| **回归** | 9-02 §7 的 U1–U6 锚点套件 + 3d_editor 12+ feature 生成脚本全部可执行 |

---

## 11. 风险核查（v3.1：每条均经代码实测判定「真/假」，真风险的预案已内置对应章节）

> 用户原话：「风险的部分，到底是否真正有风险，如果有要提前排除。」
> 判定方法：逐条对照现状代码验证，给出证据行号；真风险 → 预案写进 §4/§7/§9 对应位置；
> 假风险 → 写明排除理由，执行者**不要**为它加机制。

| # | 风险 | 实测判定 | 证据与处置 |
|---|---|---|---|
| **R1** | 收养后 vendored 包装对象被 GC → FinalizationRegistry 释放 faijs 已收养的 arena 槽 → **句柄悬空、槽复用后静默指向错误几何** | **真风险（最高危）** | `disposal.ts:224-232` 注册（unregister token = 包装对象本身）、`:117-124` finalizer 调 `kernel.dispose`；现 `adoptBrepjsProduct`（`l3-bridge.ts:62-68`）只取 `.wrapped` 不注销。mech-lib `pinned` 数组（`brepjs-gear.ts:75`）正是此 bug 的 workaround。**预案**：P22 在 `adoptEntity` 内 `unregisterFromCleanup(h)`（`disposal.ts:420`，对未注册 token 是 no-op，天然安全）——这才是删 `pinned` 的真正前提 |
| **R2** | sheetmetal 不是「Shape 进 Shape 出」，而是数据链（`part` 内嵌 `solid`）——原 §8.4 示例 `sheet.hem(p0 /* Shape */, ...)` 与真实签名不符 | **真风险（设计偏差，已修正）** | `api.ts:339` `hem(part: SheetMetalPart, spec: HemSpec): Result<SheetMetalPart>`；`types.ts:496-505` `SheetMetalPart.solid?: Solid`。**预案**：compatOp 结构化深遍历 + 不透明数据规则（§4.3.2/§4.3.4）；§8.4 已按真实签名改写；新增 `solidOf` 终端（最小改动面⑦） |
| **R3** | 函数 BREP 域只对 `local` 开启，库调用不在域内 → 需要扩展域 | **假风险（实测排除）** | 域 hook 在 `fromBrep`（`shape.ts:73`），`fromHandle` 同源（`handle-bridge.ts:77-78`）→ 本机函数体内调库已被 `isLocal` 路径覆盖；语句级产物由 solidCache 持有、域本来就不管；库内部中间句柄由 vendored 自带 scope 纪律 + finalizer 兜底。**结论：`module-executor.ts` 唯一改动是 B2 的一行 key，不要动域**（§7.2） |
| **R4** | 子形状句柄（Face/Edge/Wire）跨库边界 → 父释放后悬空 | **真风险（v1 拒收）** | brand 是 phantom 编译期类型（`shapeTypes.ts:93-95`），运行时判别用 occt-wasm 句柄自带 `type` 字段（内核 `getShapeType` 同款，`helpers.ts:77-79`）。**预案**：`adoptEntity` 类别检查，非 `solid`/`compound` 抛 `E_SUBSHAPE_BOUNDARY`（§4.3.2）；持久面/边引用走 faijs naming 体系（Q4 已拍板） |
| **R5** | 裸 brepjs 库无 `contractVersion`，注册会被 `assertContractVersion` 拒绝 | **假风险（实测排除）** | `runtime-state.ts:82-88`：仅当存在且不等时才抛错，缺失容忍。**无需任何处置** |
| **R6** | 同一 vendored 句柄被两次收养（如 `solidOf` 对同一 part 调两次）→ 两个 Shape 双重所有权、双重释放 | **真风险（边角）** | **预案**：`adoptEntity` 内 `adoptedMap: WeakMap<wrapper, Shape>` 去重，二次收养返回同一 Shape（§4.3.2，与 R1 同点修复） |
| **R7** | 库跨调用保留输入的借入视图 → 视图失效后使用 | **真风险（契约类，低概率）** | 借入视图仅在调用内有效（`createBorrowedHandle` 语义，`disposal.ts:249-264`）。**预案**：边界契约条款①（§4.3.4）；brepjs 生态惯例是派生新句柄返回而非保留输入（P22 用 mech-lib/sheetmetal 实测确认无此模式，作为验证项） |
| **R8** | `admitCompatLib` 先包装后校验 → `DUAL_OP_META`（`enumerable:false`）不可见 → 严格校验被静默跳过 | **真风险（顺序红线，已预防）** | `define-op.ts:221` 挂元数据方式 + `assertLibConforms:237` 用 `Object.values` 取值。**预案**：§4.3.3 代码内硬约束「先 `assertLibConforms` 后包装」，并写入注释防回退 |
| **R9** | 深遍历性能/循环引用 | **小（已限定）** | `MAX_WALK_DEPTH = 4` + 仅 plain object/数组深入，类实例不透入；句柄/Shape 引用天然浅层。**无需额外机制** |
| **R10** | 每次收养即三角化（`fromHandle → meshHandle`）的性能 | **中（设计已规避大部分）** | 不透明数据规则（§4.3.4）使中间态零收养零三角化，只有显式终端（`solidOf`/顶层返回）三角化——与显示需求天然重合。**验证项**：P25 sheetmetal 链 10 特征耗时基线；若仍不足，懒三角化另立项（不在本方案） |

### 用户已拍板（2026-09-03 第二轮，全部定案，执行者直接照做，不再有悬而未决项）

> 用户原话：「除了Q2 对象参数形态仅限脚本面，其它的都按你的建议来。如果Q2指的是类似box的参数，
> 那么必须支持这两种参数。如果参数明显可以区分，可以box函数内部根据参数来切换实现。如果不明显，
> 只要是人类看来不明显，那么用两个名字。」

| # | 问题 | 拍板结果 |
|---|---|---|
| **Q1** | TS 兼容面落点 | ✅ **主导出替换 + major 版本**（按建议；不开子路径） |
| **Q2** | 参数形态 | ✅ **用户改判：位置/对象两种形态都必须支持**。明显可区分 → 单名、函数内部按参数切换实现（如 `box`）；人类看来不明显 → 两个名字（先例 `rotate_euler`）。已落为 **D11**，规则/判别式/A-B 分类/命名约定见 §4.2，全量清单是 P20 交付物 |
| **Q3** | 兼容面当前实现落 vendored brepjs | ✅ 接受（按建议；契约/实现分离，未来可换 Remus/自研） |
| **Q4** | 脚本面 v1 不投子形状句柄 op | ✅ 按建议（`getFaces` 等只进 TS 面；持久引用走 faijs naming 体系） |
| **Q5** | 多几何产物的 `geometryFields` 静态标注 | ✅ 保留一行标注（按建议；出向收养点静态可查，R10 不恶化） |
| **Q6** | 状态化 DSL 只进 TS 面 | ✅ 按建议（`.fai.js` 单行语句无法表达 DSL 链） |
| **Q7** | 同义异名符号并存（`union`/`subtract` vs `fuse`/`cut`） | ✅ 按建议（并存，底层同一实现，清单登记） |
| **Q8** | faijs 特有 op impl Result 化过渡 | ✅ 双形态过渡（按建议；边界 throw 捕获归一为 err，风险低） |

---

## 附录：关键证据索引（2026-09-03 实测）

| 事实 | 位置 |
|---|---|
| Result 体系定义（Ok/Err 结构） | `vendored/brepjs/core/result.ts:12-48`；`core/errors.ts:35-229` |
| 句柄生命周期（dispose/FinalizationRegistry/borrow/scope/unregister） | `vendored/brepjs/core/disposal.ts:117-124`（finalizer 触发）、`:224-232`（注册）、`:249-264`（借入视图）、`:420-422`（unregister）、`:424-470`（scope 纪律） |
| 子形状查询与级联释放 | `vendored/brepjs/topology/topologyQueryFns.ts:101,143-148,171-218`；`shapeTypes.ts:93-95`（brand 为 phantom）、`:115-125` |
| 运行时形状类别判别 | `vendored/brepjs/kernel/occtWasm/helpers.ts:77-79`（`kernel.getShapeType`）；句柄 `wrapped.type` 字段 |
| L3 桥三原语 + R1 修复点 | `packages/core/src/api/internal/l3-bridge.ts:41,62,83` |
| defineOp 模具与元数据 | `packages/core/src/define-op.ts:163-223`（wrapped）、`:120-122`（DUAL_OP_META）、`:236-276`（assertLibConforms）、`:247-248`（裸函数跳过） |
| 分派矩阵 | `cad-runtime/backend-dispatch.ts:67-118`；测试 `packages/tests/faijs/v53-lib-brep-dispatch/v53-lib-brep-dispatch.test.ts:80-173` |
| 函数 BREP 域机制 | `runtime-state.ts:154-185`；hook `shape.ts:73`（fromBrep）+ `handle-bridge.ts:77-78`（fromHandle 同源）；释放 `module-executor.ts:405-420`；仅 local 开启 `module-executor.ts:258-271` |
| 增量键缺库身份 | `cad-runtime/module-executor.ts:585-602`（库分支 `:594`）；`bodyHashOf` 先例 `:610-612` |
| registerLib 现状（default 已落地；contractVersion 容忍缺失） | `cad-runtime/runtime.ts:332-343`；`runtime-state.ts:82-88`；`src/index.ts:29` |
| `.fai.js` 参数白名单不含 MemberExpression（`solidOf` 终端的依据） | `lang/parser.ts:264`（callee  MemberExpression 例外 `:662-664`） |
| sheetmetal 真实 API 形态（数据中心） | `packages/sheetmetal/src/api.ts:87-457`（`author:87`、`hem:339`、`unfold:96`）；`types.ts:496-505`（`SheetMetalPart.solid`）、`:593`（`UnfoldResult`）；`authorFns.ts:192,250`（author 内建 solid） |
| mech-lib 违规三处与 pinned 语义 | `packages/mech-lib/package.json:14`、`src/brepjs-gear.ts:32,64,75`（`:70-75` 注释自述 finalizer 悬空风险） |
| sheetmetal 深路径集中点 | `packages/sheetmetal/src/compat.ts:22-68`（22 处）；227 个 `it` |
| 生成面样例（defineOp + throw flip + adopt） | `packages/core/src/api/generated/topology.ts:44-66`（`fuse`）、`:76-78`（`getBounds`） |
| 生成面未接线 | `packages/core/src/index.ts:242`；`api/index.ts`（35 行）；`api/api-namespace.ts:39-51` |
| vendored exports 仍开 | `packages/core/package.json:32-33` |
| skip 分类实测 | `packages/core/src/api/surface/arg-spec.ts`（§6.1 表） |
| 全流程样本 | `packages/mech-lib/src/c3-brepjs-scenario.test.ts:44-109` |