# CadQuery 兼容层 + 多文件 `.fai.js` 项目 —— 技术实现方案

日期：2026-09-06（原始）；**2026-09-07（v3 重写）**；**2026-09-07（已实施）**
状态：**已实施**（2026-09-07 完成全部编码、测试、STEP 导出验证）
样本工程：`C:\git\CADQ\mini_lathe`（**脚本移植**，本方案实施范围）
前瞻工程：`C:\git\CADQ\cq_gears`（**库移植**，**不在本方案实施范围内**，仅提前声明需求）
基线仓库：`C:\my\Faicad\faijs`

## 实施结果摘要（2026-09-07）

- **新增包**：`packages/cq-compat/`（`@faicad/cq-compat`，v0.1.0），已加入根 workspaces 和 CLI 白名单。
- **新增示例包**：`packages/mini_lathe/`（`@faicad/mini-lathe`，private），包含移植后的 7 个零件 `.fai.js` 脚本 + 装配体脚本，依赖 `@faicad/cq-compat`，已加入根 workspaces。
- **Workplane 兼容载体**：`src/workplane.ts`，实现 CadQuery Workplane 链式 API（box/rect/circle/polygon/extrude/cutBlind/hole/cboreHole/cskHole/threadedHole/faces/edges/vertices/workplane/center/pushPoints/translate/rotate/mirror/union/cut/intersect/fillet/shell/val/vals/transformed/setColor），几何藏 `.shape`，自定义 prototype 规避 compatOp borrowDeep 破坏。
- **装配体兼容层**：`src/assembly.ts`，实现 `faceRef`（bbox 近似解析选择器→EntityRef）、`constraint`（Plane→mate，Axis→align）、`buildAssembly`（构造 cad.assembly + memberColors）、`Color` 辅助。
- **Python→.fai.js 转译器**：`src/transpile.ts` + `scripts/transpile-file.ts`，支持链式调用展开、config 常量内联、math 模块映射、列表推导式、切片合并、async/await 注入。
- **mini_lathe 移植**：7 个零件（bottom_plate/middle_bottom/middle_top/top_plate/axk/slide_top/slide_mid）全部转译为 `.fai.js` 并成功导出 STEP；完整装配体（6 零件 + 8 约束 + 颜色）导出 `mini_lathe.step`（7558 ents，344 KB）。
- **测试**：cq-compat 4/4 冒烟用例通过；typecheck 通过。
- **未处理**：handle.py（依赖 cq_warehouse）、misc.py（loft/outerWire）、my_keycap.py（makeSphere/loft/shell([faces],t)）——不在装配体成员中，可后做。

> **v3 重写原因（2026-09-07，全部基于本仓库代码现状实测）**：
>
> 1. **[2026-09-07-compat-surface-unified-projection.md](./2026-09-07-compat-surface-unified-projection.md) 已实现**：
>    brepjs API 的**库层面大部分已导出**（`api/generated/brepjs/index.ts` 1299 个 raw re-export、
>    `api/brepjs-compat/index.ts` 42 个包装面、顶层 `brepjsCompat` 命名空间；`compat` 已改名）。
>    脚本面仍为 61 个（`symbol-table.generated.ts`），新脚本面清单 133 个（P5 skeleton）**尚未接线**。
> 2. **[2026-09-06-faijs-assembly-constraints-brepjs.md](./2026-09-06-faijs-assembly-constraints-brepjs.md) 已实现**：
>    brepjs 装配求解已接入（`api/assembly/` 全套：`solve` / `lower` / `normalize` / `entities` / `pose` /
>    `preview` / `joints` / `kinematics`），约束类型已扩展（`mate` / `align` / `coincident` /
>    `concentric` / `distance` / `angle` / `parallel` / `perpendicular` / `fixed`），
>    `asm1.solve()` 已可用。原方案 §4.4 的「v1 降级：兼容层变换序列」**作废**。
> 3. **旧 IR 通道已彻底删除**：`packages/core/src/lang/` 已无 `parser.ts` / `compile.ts`，
>    `runtime.ts` 的 `executorMode = 'direct' as const`（direct 为**唯一**执行路径，不再有
>    guarded opt-in / module 双路径）。原 §1.1 的「双通道共存」作废。
> 4. **新增用户澄清（v3 的核心）**：faijs 代码分为**库**与**脚本**两种形态，对 API 导出的要求
>    不同（见 §1.8 / §4.6）。**库需要的 API 可能都已导出；若脚本层面需要的 API 没导出，
>    必须给全面方案（脚本面准入机制），而不是缺哪个导哪个。**

---

## 0. 用户原始需求（逐字）

> 分析这个项目C:\git\CADQ\mini_lathe，它是基于cadquery的api实现的一个多零件模型。现在我需要把整体它移植到faijs环境下，用.fai.js实现。未来，我还有很多基于cadquery的模型库，需要移植到faijs。所以你需要考虑如何让faijs兼容cadquery的api，使得移植的工作量尽量小。之前faijs已经兼容了brepjs的api，这一点必须保留，也许可以基于目前的faijs的api再增加一个cadquery api兼容层，当然也可以实现为库，不需要写到faijs的核心代码库里。此外，之前所有的建模，都是假定单文件的。这个mini_lathe是一个多文件的项目，所以也要支持.fai.js多文件的项目，要支持文件之间的引用。之前faijs已经支持加载第三方ts库了，现在则是要求加载本地项目里的.fai.js文件。最后，mini_lathe有单独的装配代码，用到了cadquery自己的装配api，其constrain有独特的语法。这一部分先不支持，可以用brepjs的装配语法实现，要让.fai.js文件里可以写装配代码。请先完整分析，写一份技术实现方案。

**追加澄清一（2026-09-07，parser 重构，已过时，保留原文备查）**：

> 这份文档需要大改。parser的架构已经大改： UI 通道与执行通道解耦 + parser 退化为元数据提取器 + 删除中间层 IR（这部分还在开发中，另外一个agent）。你需要重新核实和重写parser这部分。此外，现在一个.fai.js文件中，可以引用另外一个fai.js文件中所有终端的形状，不需要导出或return语句。

→ v3 状态：该澄清描述的重构**已完成**（旧 IR 已删、direct 唯一通道、多文件隐式导出），
见 §1.1 / §1.2。

**追加澄清二（2026-09-07，v3 新增，双形态需求，逐字）**：

> 此外，原始文档里有一点没有说清楚。faijs代码分为库和脚本两种形态。我需要把C:\git\CADQ\mini_lathe移植为.fai.js的脚本。而我需要把C:\git\CADQ\cq_gears移植为ts语言编写的faijs库。这两种需求对api导出的要求是不一样的。库需要的api可能都已经导出了。如果脚本层面需要的api没有导出，你需要考虑一份全面的方案，而不是那个缺少就导出哪个。cq_gears移植不包括在这个文档的实施范围内，只是提前让你知道有这个需求。

**追加澄清三（2026-09-07，实施指令，逐字）**：

> 颜色必须支持啊，要兼容cq的api，至于爆炸视图，UI层（3d_editor）已经实现，不需要faijs实现。确认移植后只跑brep，选转译器。至于CadQuery Axis约束，我无法拍板，你自己跑代码实际了解情况后自行处理。请先更新文档，然后直接开始实施，完成全部的编码和测试。中间不需要我批准任何事情，全部你自己拍板。我要看到最终的结果，就是能导出一致的step模型。

→ 实施裁决（全部已拍板）：
- **颜色**：必须支持，兼容 cq API。方案：`cad.assembly` 加 `memberColors?: Record<string, [r,g,b]>`，CLI 导出 assembly 时展开成员带颜色用 `exportStepFromSolids`（导出层已支持 color 字段）。
- **爆炸视图**：UI 层（3d_editor）已实现，faijs 不做。
- **运行模式**：只跑 **brep**。
- **链式方案**：**转译器**（不改执行器）。
- **Axis 约束**：经代码分析（`entities.ts:faceGeometryToSolverEntity`：平面→plane entity，`concentric` 直译要求 axis-axis 会报错；`align` 走 `axisFromFace` 手动编码轴，平面可用）→ 映射为 **`align`**（法向同向 + 面中心重合，降级为 concentric + 两侧 axis 不取反）。实施时用 mini_lathe 实际装配结果验证。
- **最终目标**：导出与 CadQuery 一致的 STEP 模型。

拆解为 5 个目标：

| # | 目标 | 本方案结论 |
|---|---|---|
| G1 | CadQuery API 兼容层，移植工作量最小 | 兼容层做**库** `@faicad/cq-compat` + **转译器**自动拆链（§4.2）；兼容层内部用**库面 API** 实现全部 CadQuery 语义 |
| G2 | brepjs 兼容必须保留 | **已由统一投影落地**（`brepjsCompat` 1299+42）；本方案不再触碰导出面，只做脚本面准入决策（§4.5） |
| G3 | `.fai.js` 多文件互引用 | **已落地**（§1.2），本方案补映射规则与约束 |
| G4 | 装配代码可写在 `.fai.js` 里 | **已落地**（`cad.assembly` + 新约束类型 + `asm1.solve()`），转译器把 CadQuery `constrain` 翻译为 faijs 约束对象（§4.4） |
| G5 | 库/脚本双形态的 API 需求差异 | 新增 §1.8 / §4.5 / §4.6：脚本面不需要新增符号（全部 CadQuery 语义沉入兼容层库），cq_gears 库移植提前声明（§4.7） |

---

## 1. 现状基线（2026-09-07 实测）

### 1.1 执行通道：旧 IR 已彻底删除，direct 为唯一执行路径

实测确认（读源码）：

| 组件 | 文件 | 角色 |
|---|---|---|
| `DirectExecutor` | `packages/core/src/cad-runtime/direct-executor.ts` | **唯一执行通道**。`runtime.ts` 中 `readonly executorMode = 'direct' as const`——不再有 module / guarded opt-in 双路径 |
| `extractMetadata` | `packages/core/src/lang/metadata-extractor.ts` | **UI 通道**：元数据提取器，产出 `UiMetadata`，不生成可执行代码 |
| `computeLiveShapes` | `packages/core/src/cad-runtime/live-shapes.ts` | 终端判定 |
| `ModuleRegistry` | `packages/core/src/cad-runtime/module-registry.ts` | 多文件装载 + 隐式导出 |
| `ProjectLoader` | `packages/core/src/cad-runtime/ports.ts` | 宿主注入项目文件表 |
| `lang/` 目录 | 已无 `parser.ts` / `compile.ts` | 旧 IR pipeline 已删除（原 `97a0484` 落地） |

**架构含义（本方案立足点）**：执行通道与 UI 通道已解耦为稳定形态，不再有「双通道接受集
不一致」的历史包袱。`runtime.execute()` 仍调用 `extractMetadata` 供 UI 使用——但两者
现在的接受集已对齐为同一套 direct 语法（§1.3 的链式限制是**执行器本身的限制**，不是
双通道差异）。

### 1.2 多文件：已落地，且为隐式导出（无需 export / return）

`ModuleRegistry` 已实现，导出面 = **存活 shape ∪ 常量 ∪ 函数**（`FaiModuleExports`）。
实测约束（2026-09-06 已验，仍成立）：

- **普通常量只能走 namespace import**：`import * as config` + `config.OUTX`；
  `import { OUTX }` 报 `BINDING_NOT_EXPORTED`（`resolveBinding` 只认 `liveShapes ∪ fns`）。
- mini_lathe 原本就是 `import config` + `config.OUTX` 写法 → **天然一一对应**。
- 函数可 named import（`import { pin_holes }`）；存活 shape 可 named import。

### 1.3 语法接受集：链式仍受限（2026-09-07 复核）→ 转译器路线成立

`direct-executor.ts:855` 仍只处理两级 callee：

```ts
if (callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier' && callee.property?.type === 'Identifier')
```

receiver 为 `CallExpression` 的三级链（`a.b().c()`）仍抛
`expected <ns>.<op>(...) or local function call`（`:870`，`E_STATEMENT`）。

**结论不变：链式支持不改执行器（`direct-executor.ts` 是稳定核心），由转译器把 CadQuery
链拆成「每步一变量」解决（§4.2.2）。** 2026-09-07 复核确认 `emitCall` 判定未变，
本结论有效。

### 1.4 函数体内循环调用 cad：必须显式写 `async function` + `await`

`transformFunction`（`direct-executor.ts`）原样保留函数体，只注入 `const cad = __ns.cad`
绑定，不自动注入 `await`；cad 的 op 全是 async。实测（2026-09-06 已验，仍成立）：

| 写法 | 结果 |
|---|---|
| `function f(s){ return cad.translate(s,…) }`（无循环） | ✅ 返回值在调用点被 `await` |
| 函数体纯计算循环（不调 cad） | ✅ |
| `function f(s){ for(…){ r = cad.translate(r,…) } return r }` | ❌ |
| `async function f(s){ for(…){ r = await cad.translate(r,…) } return r }` | ✅ |

⇒ CadQuery 的 `pin_holes(wp)` 可直接写成 `async function` + `await`（§4.2.3）。

### 1.5 op 可用性：mini_lathe 必须跑 brep 模式

实测（2026-09-06 已验，仍成立）：mesh 模式下 `cut` / `rotate` / `mirror` / `chamfer` /
`pocket` / `drill` / `rectangularPattern` / `circularPattern` / `boss` / `fuse` / `offset` /
`split` 全部 `E_MESH_UNSUPPORTED`。mini_lathe 用到的 `hole`(20) / `fillet`(7) /
`cutBlind`(12) / `shell`(2) / `rotate`(2) 全部落在 mesh 不可用一侧。

**结论：mini_lathe 移植后必须跑 brep 模式。** 附带工程约束：brep 运算慢，no-IR 架构下
`update` = 全量重跑，8 文件全量重跑的交互延迟需在宿主侧评估。

### 1.6 兼容面现状：统一投影已落地（2026-09-07 实测）

`compat-surface-unified-projection` 方案已实施到 P5 skeleton，产物结构：

| 产物 | 规模 | 状态 |
|---|---|---|
| `api/generated/brepjs/index.ts` | **1299 个符号** raw re-export（覆盖全部 vendored 目录树） | ✅ 已生成，公开入口 = 顶层 `brepjsCompat` 命名空间（`api/index.ts:86`） |
| `api/brepjs-compat/index.ts` | **42 个导出**（手写面继任：`box` / `sphere` / `cylinder` / `cone` / `torus` / `ellipsoid` / `fuse` / `cut` / `extrude` / `revolve` / `loft` / `intersect` / gear 系列 / `thread` / `Sketcher` / `FaceSketcher` / `draw` / `makeBaseBox` / Result 组合器…） | ✅ 已接线（含 `wrapDual` / `wrapGuarded` 包装） |
| `api/generated/cad/script-face.ts` | **133 个符号清单**（`CAD_SCRIPT_FACE_SYMBOLS`，含 `cut` `fuse` `fillet`?→**不含**，见下） | ⚠️ **P5 skeleton 仅清单**，注释明写 "TODO(P4): generate actual compatOp wrapping"，**未接线** |
| 脚本面（`cad.*` 生效面） | **61 个**（`symbol-table.generated.ts`：faijs 原生 34 + 投影 27） | ✅ 经根级 `generated/script-face.ts` 的 `scriptFaceOps` + `api-namespace.ts` 注入 |
| `api/surface/` | `projection-overrides.ts`（例外覆盖表）+ `projection-manifest.json`（四态自检表）+ `arg-spec.ts`（仍存，待 P4 删） | ✅ 统一投影的机制已落地 |

**关键缺口（2026-09-07 实测）**：脚本面 61 个里**没有 `fillet` / `shell`**；133 个 P5 清单里
**同样没有 `fillet` / `shell`**。而库面 1299 个里**有**（`generated/brepjs/index.ts` 实测
含 `fillet` / `shell` / `loft` / `polygon` / `circle` / `mirror` / `rotate` / `translate` /
`wire`）。即：**fillet/shell 在库层面已导出，只是脚本面（`cad.*`）未准入**——这正是
「库需要 vs 脚本需要」差异的实证（§1.8）。

### 1.7 装配现状：brepjs 求解已接入（2026-09-07 实测）

`faijs-assembly-constraints-brepjs` 方案 P0+P1 已落地：

- `api/assembly/`：`solve.ts`（委派 vendored `solverAdapter.solveConstraints`）、
  `lower.ts`（faijs 类型 → SolverConstraint，`mate` 降级为 `concentric` + 轴编码）、
  `normalize.ts`、`entities.ts`（EntityRef → SolverEntity，TopoRef 解析）、`pose.ts`
  （brepjs 四元数 `[w,x,y,z]` ↔ faijs `[x,y,z,w]` 转换）、`preview.ts`、
  `joints.ts` / `kinematics.ts`（运动副，P3）、`golden-mate.ts`（等价性基准）。
- 约束类型（`compound.ts` / `api/assembly/types.ts` 实测）：`mate` / `align` /
  `coincident` / `concentric` / `distance` / `angle` / `parallel` / `perpendicular` /
  `fixed`，`face_mate` 规范化为 `mate` 遗留别名。
- 语句：`cad.assembly({ name, members, constraints })` + `asm1.solve()`（`do_assemble()`
  保留为同义别名）；`asm1.add_constraint()` 保持 no-op。
- `cad.jointTrajectory` / `cad.inverseKinematics` / `cad.mechanismDOF` 已在脚本面 61 个中。

**原方案 §4.4 的「v1 降级：兼容层 planeMate/axisMate 变换序列」作废**——直接用
`cad.assembly` 约束对象（§4.4）。

### 1.8 库 / 脚本双形态的 API 需求差异（v3 新增，本方案核心）

faijs 代码分两种形态，对 API 导出的要求不同：

| 维度 | **脚本形态**（mini_lathe → `.fai.js`） | **库形态**（cq_gears → TS 库） |
|---|---|---|
| 代码位置 | `.fai.js` 文本，经 direct-executor 执行 | `packages/*/src`，TS 编译，经 `registerLib` 装载 |
| 可用的 API 面 | **脚本面 `cad.*`**（61 个）+ 第三方库导出的函数（兼容层 `cq.*`） | **库面**（`brepjsCompat` 1299+42 + faijs 原生 op + SDK `defineOp`） |
| 语法约束 | 受 `.fai.js` 子集限制（链式 ❌、for-of ❌、class ❌） | 无限制（class / 链式 / for-of / async 随便写） |
| 子形状引用 | 只能经可序列化 TopoRef / 几何快照 | 可直接持有句柄（`Face` / `Edge` / `Wire`） |
| 数组入参 / 复合记录 | 须 JSON 可序列化 | 允许自由结构 |
| **对导出面的要求** | `cad.*` 只放行**直接在脚本文本里调用**的 op | 库面**尽可能全导**（用户裁决：「能导出的 api 都应该导出」） |

**两个关键推论（本方案的设计依据）**：

1. **库形态的 API 可能都已导出**（用户判断）——库面 1299 raw + 42 包装，`fillet` /
   `shell` / `loft` / 2D 绘图 DSL（`Blueprint` / `BaseSketcher2d` / `curve2d*`）都在。
   cq_gears 需要的 2D wire 构造（`lineTo`/`moveTo`/`close` → 库面 2d 模块）、
   `makeFromWires`（`Wire[] → face`，库面有 `face` / `loft`）、`extrude` / `cut` /
   `circle` / `rotate` 全部在库面可见。**P0 需做一次调用集核对**（§4.7）。
2. **脚本形态的新增需求可以通过「不新增 cad.\* 符号」消化**：CadQuery 特有语义
   （Workplane 载体、选择器、`rect`/`hole`/`cutBlind`/`fillet`/`shell`/阵列/孔型）全部
   沉入兼容层**库** `@faicad/cq-compat`（TS 实现，内部调用库面 API）；
   拆链后脚本里直接 `cad.*` 调用的都是**已有 61 个 op**（`fai_extrude` / `translate` /
   `cut` / `union` / `rotate` / `mirror` / `drill`…）。
   ⇒ **理论上脚本面不需要新增任何符号**（§4.5 的论证）。
   若未来确有无法沉库的脚本面需求，走统一投影已有的**脚本面准入机制**
   （`scriptFace` 判定规则 + `projection-overrides.ts` 覆盖表），**不是缺哪个导哪个**。

---

## 2. mini_lathe 分析

### 2.1 文件依赖（实测 grep，不变）

```
config.py          ← 常量 + def pin_holes(wp)
  ↑
  ├── bottom_plate.py   (bp)
  ├── middle_bottom.py  (mb)
  ├── middle_top.py     (mt)
  ├── top_plate.py      (tp)
  ├── axk.py            (axk)
  ├── slide_top.py      (slide_top)
  ├── slide_mid.py / handle.py / misc.py / my_keycap.py
  ↓
assemb.py / assemb2.py  ← 8 条 constrain + solve()
```

引用形态全部是 `import config` + `config.OUTX` —— 与 §1.2 的 namespace import **天然对应**。

### 2.2 API 使用频次（2026-09-07 重测，全文件正则统计）

```
Workplane 69 | faces 53 | rect 37 | extrude 25 | hole 20 | export 13 | cutBlind 12
edges 12 | val 10 | add 8 | constrain 8 | center 8 | pushPoints 7 | polygon 7
fillet 7 | Color 6 | translate 6 | vertices 5 | cut 5 | transformed 4 | Vector 4
union 3 | threadedHole 3 | circle 3 | cboreHole 3 | wires 2 | shell 2 | rotate 2
Assembly 2 | cskHole 2 | outerWire 1 | mirror 1 | makeSphere 1 | text 1 | solve 1 …
```

（`export` 13 次是 `bp.export("bp.step")` 等 STL/STEP 导出调用，属 IO，走宿主侧，不占 API 面。）

---

## 3. 差距清单（CadQuery → faijs 现状，v3 重写）

| CadQuery | 频次 | faijs 现状（2026-09-07） | 缺口等级 / 处置 |
|---|---|---|---|
| `Workplane(plane)` / `.workplane()` 载体 | 69 | 无 | **高**——兼容层库实现（§4.2.1） |
| 链式 `a.b().c()` | 全局风格 | 执行器仍两级（§1.3） | **高**——转译器拆链（§4.2.2） |
| `.faces('>Z')` / `.edges()` / `.vertices()` 选择器串 | 70 | 无 | **高**——兼容层运行期解析（§4.4.2，用库面 `getFaces`/`getEdges` + 排序） |
| `.rect` / `.circle` / `.polygon` 草图 | 47 | 库面有 `circle`/`polygon`/2d 模块；脚本面无 | 中——兼容层实现（内部用库面 API） |
| `.extrude` / `.cutBlind` | 37 | 脚本面 `fai_extrude` / `cut`+`split` ✅ | 中——转译器直接映射 |
| `.hole/.cboreHole/.cskHole/.threadedHole` | 28 | 脚本面 `drill`/`pocket`/`boss`（brep-only） | 中——兼容层孔型方法（内部组合） |
| **`.fillet` / `.shell`** | **9** | **库面已导出**（`brepjsCompat`/1299），**脚本面未准入** | **中——兼容层实现，无需脚本面放行**（§4.5 论证） |
| `.pushPoints` 阵列 | 7 | 脚本面 `linearPattern`/`circularPattern`/`gridPattern`/`rectangularPattern` | 中——兼容层维护点位列表 |
| `.val()` / `.vals()` | 10 | 无（兼容层终端方法） | 低 |
| Python `for` 循环 | 多处 | `for(;;)` ✅ / for-of ❌ / 函数体内 `async function`+`await`（§1.4） | 中——转译器 |
| `Assembly.constrain(…).solve()` | 8 | **已落地**：`cad.assembly` + `mate`/`concentric` 等 + `asm1.solve()`（§1.7） | ✅ **已解决**（转译映射，§4.4） |
| 多文件 `import config` | 11 | **已支持**（namespace 形态） | ✅ |

**与 v2（上一版方案）的关键差异**：
- `fillet`/`shell` 从「完全缺失 → 需补投影」变为「**库面已导出、脚本面未准入**」，且
  通过兼容层库即可用，**不需要脚本面新增符号**——v2 的 C1-a/C1-b（补投影/补 skip）已被
  统一投影方案整体取代，本方案不再重复。
- 装配从「v1 降级（变换序列）」变为「已落地，直接映射」。

---

## 4. 设计方案

### 4.1 总体原则

> **P-a**：CadQuery 语义（链式、选择器、Workplane 载体、阵列、孔型、fillet/shell）全部
> 实现在 **TS 库 `@faicad/cq-compat`** 里——库是 TS，不受 `.fai.js` 语法限制，可自由使用
> `class`（载体除外，见 §4.2.1 红线）/ `for-of` / `async-await` / 链式；
> 其内部实现调用**库面 API**（`brepjsCompat` 1299+42，已导出）。
>
> **P-b**：`.fai.js` 只保留**声明式组装**（每个 CadQuery 链拆成「每步一变量」），由
> **转译器**自动生成——移植工作量趋近于零，且**零执行器改动**。
>
> **P-c**：core 改动 = **零**（相对于统一投影/装配落地后的现状）。不再新增任何 `cad.*`
> 符号、不再补任何投影。唯一可能触碰 core 的场景是 §4.5 的「未来脚本面需求」，
> 且走统一投影已有的覆盖表机制。

### 4.2 CQ 兼容层：Workplane 载体 + 转译器拆链

#### 4.2.1 载体设计（红线不变，已实测验证）

CadQuery 的 `Workplane` 在 faijs 里实现为 **plain object**，几何藏在 `.shape` 字段：

```ts
// packages/cq-compat/src/workplane.ts（示意，非完整实现）
export interface Workplane {
  __cq: true
  plane: string
  shape: Shape | null      // 几何藏这里，不暴露在顶层
  sel?: string | null      // 当前选择器（'faces'|'edges'|'vertices' + 选择串）
  pts?: Vec3[]             // pushPoints 累积点位（孔型/阵列用）
  edges?: EdgeTopoRef[]    // edges() 选择结果（fillet 用，§4.2.5）
  box(w: number, d: number, h: number): Promise<Workplane>
  faces(sel: string): Promise<Workplane>
  hole(d: number, depth?: number): Promise<Workplane>
  fillet(r: number): Promise<Workplane>
  val(): Shape             // 终端方法：取出几何
}
```

**为什么必须是 plain object 且几何藏在 `.shape`**（两条红线，2026-09-06 实测，仍成立）：
1. **终端污染**：`computeLiveShapes` 候选集来自 `isShapeLike(v)`（`'positions' in v &&
   'indices' in v`）。载体顶层无 `positions`/`indices`/`children` 就**不会成为终端候选**。
   若几何摊在顶层，每个中间态都变终端，UI 堆满半成品。
2. **分派门**：`collectShapes`/`borrowDeep` 遇到 `Object.getPrototypeOf(v) !== Object.prototype`
   直接 return——**class 实例不被遍历**，分派门找不到内嵌 Shape ⇒ `dispatchPath([])`
   恒判 `'brep'`，mesh 模式下静默放行，违反静态分派红线。**载体必须 plain object，
   不能用 class。**

#### 4.2.2 链式：转译器拆成「每步一变量」

实测已验证「每步一变量」形态现在就能跑。转译器把 CadQuery 源码（Python AST）转成
`.fai.js`：

```python
# CadQuery 原码
bp = cq.Workplane("XY").box(OUTX, OUTY, T).faces(">Z").hole(5)
```
```js
// 转译输出（每步一变量，零执行器改动即可执行）
let bp_0 = cq.Workplane('XY')
let bp_1 = bp_0.box(config.OUTX, config.OUTY, config.T)
let bp_2 = bp_1.faces('>Z')
let bp_3 = bp_2.hole(5)
let bp = bp_3.val()
```

命名规则：`${lhs}_${n}` 递增；末行 `.val()` 落回原变量名（保持下游引用不变）。

**转译器同时处理**：
- `import config` → `import * as config from './config.fai.js'`（§1.2 namespace 约束）；
- `from x import y` → 仅当 `y` 是 shape / 函数才转 named import，普通常量强制 namespace；
- Python `for pt in pts:` → `.fai.js` 顶层 `for (let i=0;i<pts.length;i++)` 块（§1.3：for-of 不可用）；
- `def pin_holes(wp)` → §4.2.3；
- `Assembly.constrain(…).solve()` → §4.4。

**为什么不做「真链式」**：需要改 `direct-executor.emitCall`（稳定核心，§1.3）。转译器把
这个问题从运行时挪到移植时一次性解决，且可逆。

#### 4.2.3 函数内循环（`pin_holes`）：直接写 `async function`

§1.4 已实测：写成 `async function` + 每个 cad/cq 调用前 `await`，函数体内的循环加工在
`.fai.js` 里直接可用，且可跨文件导出。

```js
// config.fai.js —— 常量 + 异步加工函数，原样对应 CadQuery 的 config.py
const OUTX = 100
const INX = OUTX - 24
const PIN_PTS = [[0, 0], [12, 8], [-12, 8]]

async function pin_holes(wp, pts) {
  let r = wp
  for (let i = 0; i < pts.length; i++) {
    r = await cq.holeAt(r, pts[i])      // 每个 cq 调用都要 await
  }
  return r
}
```

**移植规约**：CadQuery 的 `def f(...)` 若函数体涉及建模 op → 转译为 `async function`
且体内每个 `cad.*` / `cq.*` 调用加 `await`；若只做纯数据计算 → 普通 `function` 即可。

#### 4.2.4 选择器字符串（faces/edges/vertices）

CadQuery 选择器（`>Z` / `|Z` / `>Z[-2]` / `#Z`）**在兼容层库内运行期解析**（不是转译期）：
`cq.faces('>Z')` 在库内调库面 `getFaces(shape)` → 按选择串排序规则挑面 → 记录到载体
`.sel`，后续 `.hole()` / `.fillet()` / `.workplane()` 消费。**为什么运行期**：`>Z[-2]`
（沿 +Z 排序第 2 个面）依赖几何，转译期无法静态推导；选择串是字符串，直接照抄进
`.fai.js`，语义保真。选择器解析是纯字符串 + 几何排序逻辑，放库里。

#### 4.2.5 `.fillet` / `.shell` 走库面 API（v3 关键新增）

`bp.faces(">Z").edges("|Z").fillet(2)` 的拆链：

```js
let bp_0 = cq.Workplane('XY')
// … 中间步骤 …
let bp_k = bp_k_minus_1.faces('>Z')
let bp_m = bp_k.edges('|Z')           // 库内：getEdges + 排序 → EdgeTopoRef[] 存载体
let bp_n = bp_m.fillet(2)             // 库内：EdgeTopoRef → 活句柄 → brepjsCompat.fillet → 回收
```

`cq` 兼容层的 `fillet` 实现（TS 库内，无语法限制）：

```ts
// packages/cq-compat/src/ops.ts（示意）
import { fillet as brepjsFillet } from '@faicad/faijs'          // 库面已导出（brepjsCompat）
// 或经 brepjsCompat 命名空间：import { brepjsCompat } from '@faicad/faijs'

async function filletOnWorkplane(wp: Workplane, radius: number): Promise<Workplane> {
  // 1. wp.edges 是 edges('|Z') 时解析出的 EdgeTopoRef[]（§1.8：脚本面禁止子形状跨界，
  //    但库形态可直接持有句柄——这里是库内行为，合法）
  // 2. 解析 → 活句柄（复用 chamfer 的 buildEdgeResolutionContext 通道）
  // 3. 调 brepjsFillet(shape, handles, radius) → 立即回收句柄
  // 4. 回写 wp.shape，返回新载体
}
```

**这正是「库形态 vs 脚本形态」差异的直接应用**：`fillet` 的 `edges` 入参是子形状
引用——脚本面按红线不投子形状，但**兼容层是库，可以**。`shell` 同理
（`brepjsCompat` 已导出）。⇒ **mini_lathe 的 fillet/shell 不需要脚本面新增任何符号。**

#### 4.2.6 孔型（hole / cboreHole / cskHole / threadedHole）

兼容层维护载体上的面上下文（`.sel` + `.pts`），孔型方法内部组合脚本面已有 op：

| CadQuery | 兼容层内部实现 | 底层 op |
|---|---|---|
| `.hole(d)` | 在 `.sel` 面的 `.pts` 各点位打通孔 | `cad.drill`（brep-only，脚本面已有） |
| `.cboreHole(d, cboreD, cboreDepth)` | 阶梯孔 = 通孔 + 沉孔 | `cad.drill` + `cad.pocket` |
| `.cskHole(d, cskD, cskAngle)` | 锥形沉孔 | `cad.drill` + `cad.pocket`（角度参数） |
| `.threadedHole(d, depth)` | 螺纹孔 | `cad.drill`（v1 不建模螺纹细节，标注差异） |

### 4.3 多文件映射（不变）

| CadQuery | `.fai.js`（转译目标） | 依据 |
|---|---|---|
| `import config` | `import * as config from './config.fai.js'` | §1.2 namespace 必需 |
| `from bottom_plate import bp` | `import { bp } from './bottom_plate.fai.js'` | named 可用（bp 是存活 shape） |
| 模块出口 | **无**：隐式导出存活 shape ∪ 常量 ∪ 函数 | `ModuleRegistry` 已实现 |
| `config.OUTX` | `config.OUTX` | 逐字对应 |

**⚠️ A-9 约束的移植影响**：零件文件内被后续 op 消费的中间 shape **不能**被别的文件引用。
转译器需保证被跨文件引用的名字是该文件**末态存活**的 shape（通常就是末行 `.val()` 产物）。

### 4.4 装配：直接映射已落地的 `cad.assembly`（v3 重写）

原方案 §4.4 的「兼容层 planeMate/axisMate 变换序列降级」**作废**。装配求解已由
`faijs-assembly-constraints-brepjs` 落地（§1.7）。转译器把 CadQuery 的 `constrain` DSL
翻译为 faijs 约束对象：

#### 4.4.1 约束映射表（已拍板）

CadQuery `constrain(aSel, bSel, type)`（实测 `assemb.py` 8 条，`Plane` ×5 + `Axis` ×3）：

| CadQuery 类型 | faijs 约束类型 | 说明 |
|---|---|---|
| `Plane`（贴合：法向反向 + 面重合） | `{ type: 'mate', a: …, b: … }` | 直译。`mate` 语义 = 法向反向 + 面中心重合（装配方案 §3.7.2 已证等价） |
| `Axis`（轴对齐） | `{ type: 'align', a: …, b: … }` | **已裁决**：经代码分析，平面 face 引用在 `concentric` 直译路径被 `faceGeometryToSolverEntity` 解析为 plane entity（`concentric` 要求 axis-axis → 报错）；`align` 走 `axisFromFace` 手动把平面编码为 axis（origin=面中心，direction=法向，不取反），平面可用。语义 = 法向同向 + 面中心重合。实施时用 mini_lathe 实际装配结果验证 |
| `solve()` | `asm1.solve()` | 已落地，`do_assemble()` 同义 |

#### 4.4.2 选择器 → EntityRef：运行期解析（兼容层）

CadQuery 约束选择器 `"bp@faces@>Z[-2]"` = 零件名 + 选择串。拆链后：

```js
// CadQuery: lathe.constrain("bp@faces@>Z[-2]", "mb@faces@<Z", "Plane")
let asm1 = cad.assembly({
  name: 'mini_lathe',
  members: [bp, mb, mt, tp, axk, slide_top],
  constraints: [
    { type: 'mate',
      a: cq.faceRef('bp', '>Z[-2]'),      // 兼容层：运行期解析选择器 → EntityRef
      b: cq.faceRef('mb', '<Z') },
    { type: 'concentric',
      a: cq.faceRef('bp', '<X'), b: cq.faceRef('mb', '<X') },
    // … 共 8 条
  ],
})
await asm1.solve()
```

- `cq.faceRef(partName, selector)`：兼容层库函数，**运行期**用库面 `getFaces` +
  选择串排序规则解析 → 返回 `EntityRef` 的**几何快照形态**
  （`{ part, face: { surfaceType, center, normal } }`，装配方案 §5.2 已支持）。
- **为什么运行期**：`>Z[-2]` 依赖几何，转译期无法静态推导；选择串原样照抄保真。
  兼容层选择器解析器与 §4.2.4 共用同一套实现。
- **`@` 语法**：`part@faces@selector` 的 `part` 部分映射为 `EntityRef.part`
  （PartName 字符串，与 `members` 下标对应——装配方案 C3 已明确该不对称）。
- **v1 差异标注**：CadQuery `solve()` 是全局联立求解，faijs 是 brepjs `solverAdapter`
  拓扑轮次顺序求解。mini_lathe 的 8 条约束是链式的（`bp→mb→mt→tp` + 轴对齐），
  两者结果一致 ⇒ 映射成立。若出现过约束 / 闭环装配需联立求解，属装配方案 v2 范围。

#### 4.4.3 颜色（必须支持）与爆炸视图（UI 层做）

**颜色**：用户裁决「颜色必须支持，要兼容 cq 的 api」。方案：

1. `cad.assembly` 的 `AssemblyParams` 加 `memberColors?: Record<string, [number, number, number]>`（sRGB 0..1），`AssemblyBehavior` 存储。
2. CLI 导出 assembly 时：展开成员（`behavior.memberNames` + 成员 shape），从 `memberColors` 取色，调用 `exportStepFromSolids(kernel, entries)`（导出层已支持 `StepExportEntry.color`，sRGB→linear 转换已内置）。
3. 兼容层 `cq.assembly({ members: [{shape, name, color}], constraints })` 接受颜色，内部构造 `memberColors` 传给 `cad.assembly`。
4. CadQuery `cq.Color(r, g, b, a)` 的 alpha 通道 v1 忽略（STEP 颜色不支持透明），记录差异。

**爆炸视图**：用户裁决「UI 层（3d_editor）已经实现，不需要 faijs 实现」。`assemb.py` 的 `explode_assembly_along_z` 不移植到 `.fai.js`，由 3d_editor UI 侧做。

### 4.5 脚本面 API：全面准入机制，而非缺哪个导哪个（v3 核心）

用户裁决（v3 原话）：**「如果脚本层面需要的api没有导出，你需要考虑一份全面的方案，
而不是那个缺少就导出哪个。」**

**先论证：mini_lathe 脚本面缺口 = 0（理论）**。所有 CadQuery 特有语义都沉入兼容层库
（§4.2），拆链后脚本里直接 `cad.*` 调用的 op 全部在现有 61 个里：

| 拆链后直接 cad.* 调用 | 脚本面 61 个 | 说明 |
|---|---|---|
| `cad.fai_extrude`（extrude/cutBlind 正反拉伸） | ✅ | |
| `cad.translate` / `cad.rotate` / `cad.mirror` | ✅ | |
| `cad.cut` / `cad.union` / `cad.intersect` | ✅ | |
| `cad.drill` / `cad.pocket` / `cad.boss`（孔型底层） | ✅ | brep-only，brep 模式可用 |
| `cad.assembly` + `asm1.solve()`（装配） | ✅ | 已落地 |
| 其余全部（Workplane/选择器/rect/circle/polygon/hole 系列/fillet/shell/阵列/val） | → 兼容层 `cq.*` | TS 库，内部用库面 API |

⇒ **结论：脚本面无需新增任何符号即可移植 mini_lathe。** 这是比「补 fillet/shell 两个
导出」更全面的答案——不是「缺哪个导哪个」，而是「用形态划分消化需求」：
CadQuery 语义天然属于**库形态**（载体、子形状、链式），就该住在库里；
`cad.*` 只保留**脚本文本直接调用**的原子 op。

**若未来出现无法沉库的脚本面需求**（例如某个 `.fai.js` 片段需要直接
`await cad.fillet(...)`），准入流程走统一投影已建立的机制，三步：

1. **规则判定**：`scriptFace` 推导规则（统一投影方案 §5.3 第四层）——
   `kind === 'brep-op' && 入参不含子形状句柄 && 不含 Shape 数组 && 无同名冲突`。
   `fillet` 的 `edges: Face[]` 入参**会被规则排除**（子形状句柄）⇒ 规则本身已经回答
   「为什么不该直接进脚本面」。
2. **覆盖表显式放行**：`api/surface/projection-overrides.ts` 加一条
   `fillet: { scriptFace: true, note: '…' }`——覆盖表是**唯一人工维护点**，记录放行理由，
   不是临时补导出。
3. **接线 + 冒烟**：统一投影 P4 完成后，`generated/cad/script-face.ts` 按覆盖表生成
   实际 `compatOp` 包装，进脚本面 61+ 个并跑冒烟。

**但本方案不推荐这条路（对 mini_lathe）**：`fillet` 进脚本面需要 edges 参数改
TopoRef 形态 + 手写适配器（等同给执行器加能力），成本高于兼容层库实现（§4.2.5 零
core 改动）。**默认走兼容层；脚本面准入机制只作为未来需求的兜底通道。**

### 4.6 双形态 API 需求矩阵（v3 新增，实施契约）

| 需求项 | 脚本形态（mini_lathe） | 库形态（cq_gears，范围外） | 本方案动作 |
|---|---|---|---|
| 原子 op（box/translate/cut/union/extrude…） | 脚本面 61 个已有 | 库面 1299+42 已有 | 无 |
| 子形状 op（fillet/shell/loft/normalAt…） | **不投**（红线：脚本面禁子形状跨界） | **已导出**（1299 raw） | 兼容层内部使用 |
| 2D 绘图 DSL（lineTo/moveTo/close/Blueprint…） | 不投 | 库面 2d 模块已有（`BaseSketcher2d`/`blueprint.js` 等） | cq_gears 核对（§4.7） |
| Wire→Face/体（makeFromWires 类） | 不投 | 库面 `face`/`loft`/`createFace` 已有 | cq_gears 核对 |
| 装配约束 | **已落地**（`cad.assembly` 9 类型 + solve） | 库面 `solveConstraints` 等经装配子层可用 | 转译映射（§4.4） |
| 选择器字符串 | 兼容层运行期解析（库面 getFaces 驱动） | — | 兼容层实现 |
| 数学（cos/sin/degrees…） | JS 原生 Math | JS 原生 Math（numpy → 手写/库） | 转译/移植时替换 |

### 4.7 cq_gears 前瞻（范围外，提前声明）

> 用户原话：**「cq_gears移植不包括在这个文档的实施范围内，只是提前让你知道有这个需求。」**

**不实施**，仅登记需求与预判，供后续独立方案引用：

- **形态**：TS 库（`packages/cq-gears` 或独立包），经 `registerLib` 装载。
- **规模**：`spur_gear` 524 行 / `bevel_gear` 421 / `ring_gear` 386 / `crossed_helical_gear`
  315 / `rack_gear` 267 / `worm_gear` 229 / `utils` 217 / `__init__` 75，共 ~2400 行。
- **API 使用面**（2026-09-07 实测）：`Workplane` 44 / `add` 47 / `Vector` 36 / `Location`
  21 / `makeFromWires` 11（`Wire[] → face`）/ `edges` 15 / `lineTo` 14 / `moveTo` 10 /
  `close` 8 / `build` 10 / `val`/`vals` 31 / `cut` 9 / `circle` 9 / `rotate` 8 +
  numpy 数学（`cos`/`sin`/`tan`/`linspace`/`concatenate`/`array` 等）。
- **关键依赖**：**2D 轮廓构造**（`lineTo`/`moveTo`/`close` + `makeFromWires`）→ 库面
  2d 模块（`BaseSketcher2d` / `blueprint.js` / `curve2d*`）与 `loft`/`face` 覆盖；
  数学 → TS 侧手写（numpy 等价物）。
- **预判**：库面 1299+42 大概率已覆盖其调用集（用户判断「库需要的 api 可能都已经
  导出了」）。**正式移植前 P0 须做一次调用集核对**（把 cq_gears 全部 API 调用与
  库面 manifest 对照，缺项进 `projection-manifest.json` 的 `unresolved` 处理）。
- **若缺项**：走统一投影的覆盖表机制（§4.5 三步），不临时补导出。

---

## 5. 移植工作量估算（v3 更新）

| 阶段 | 内容 | 人工量 |
|---|---|---|
| 一次性 | 兼容层库 `@faicad/cq-compat`（Workplane + 选择器 + 孔型 + 阵列 + 装配构造 + fillet/shell 桥接） | **主要成本**（TS 库，内部调库面 API） |
| 一次性 | 转译器（Python AST → `.fai.js`，含 constrain → constraints 映射） | **主要成本** |
| 一次性 | 选择器运行期解析器（库内，`>Z`/`|Z`/`>Z[-2]` 排序规则） | 中 |
| 一次性 | cq_gears 调用集核对（P0 前置，范围外需求预检） | 小 |
| **每个模型** | 跑转译器 + 手工收尾（命名、选择器索引、装配） | **趋近于零** |

mini_lathe 预期产物：`config.fai.js` + 6~9 个零件 `.fai.js` + `assemb.fai.js`。

---

## 6. 分期（v3 更新）

- **P0（前置核对）**：① 兼容层内部将用到的**库面 API 逐个冒烟**（`brepjsCompat.fillet` /
  `shell` / `loft` / `getFaces` / `getEdges` 等——1299 raw 中有相当部分从未被执行验证，
  沿用统一投影的 L2 分层冒烟）；② **cq_gears 调用集核对**（范围外需求预检，缺项登记
  manifest）；③ 确认运行模式为 **brep**（§1.5）。
- **P1**：兼容层库 Workplane 载体 + 选择器解析器 + 基础 op 映射（box/translate/…）；
  单文件冒烟（一个零件跑通）。
- **P2**：转译器（拆链 + import 映射 + `async function` 规约）；`config.fai.js` 多文件冒烟。
- **P3**：孔型 / 阵列 / fillet / shell 桥接（§4.2.5–4.2.6）；全量零件文件移植。
- **P4**：装配映射（§4.4：`cq.faceRef` + constraints 数组 + `asm1.solve()`）跑通；
  `Axis` 约束语义验证（§8 待拍板 3）。
- **P5**：回归——脚本面 61 个零改动、既有 `.fai.js` fixture 全绿、stderr 零输出。
- **v2（不占本次）**：真链式（待执行器扩展评估）、脚本面准入机制启用（§4.5 兜底通道）、
  cq_gears 正式移植（独立方案）。

---

## 7. 验收（v3 更新）

1. mini_lathe 各零件在 **brep 模式**下全部产出，与 CadQuery 输出的体积 / 包围盒在容差内一致。
2. 跨文件引用零 `BINDING_NOT_EXPORTED`；普通常量全部走 namespace import。
3. 终端列表**只含每个零件的末态**（中间态 `*_0/_1/_2` 不出现）。
4. 装配各零件位置与 CadQuery `solve()` 结果一致（8 条约束，链式，顺序求解等价）。
5. **脚本面 `cad.*` 61 个符号逐个不变**（`symbol-table.generated.ts` diff 为空）。
6. **零执行器改动**：`direct-executor.ts` / `metadata-extractor.ts` / `api/index.ts` /
   `api/generated/**` 均无改动（`git diff` 核验）——即本方案不触碰统一投影与装配的产物。
7. 全流程 stderr 零输出。
8. **P0 库面冒烟**：兼容层用到的每个库面 API（fillet/shell/getFaces/getEdges/…）逐个
   通过真实调用断言（非只 `typeof`）。
9. cq_gears 调用集核对报告：每条 API 调用 → manifest 四态（exported / excluded /
   missing / unresolved），作为后续库移植的缺口自检表。

---

## 8. 待拍板（v3 更新，全部已裁决）

1. ~~**运行模式**~~ —— **已裁决：只跑 brep**（mesh 下 cut/hole/fillet/shell 全不可用，§1.5）。
2. ~~**转译器 vs 真链式**~~ —— **已裁决：转译器**（零执行器改动、不冲突，§4.2.2）。
3. ~~**CadQuery `Axis` 约束的精确映射**~~ —— **已裁决：`align`**（经代码分析：平面 face 引用在 `concentric` 直译路径报错，`align` 走 `axisFromFace` 手动编码轴可用；语义=法向同向+面中心重合。实施时用 mini_lathe 实际装配结果验证，§4.4.1）。
4. ~~**颜色 / 爆炸视图**~~ —— **已裁决：颜色必须支持**（assembly `memberColors` + CLI 展开导出带色，§4.4.3）；**爆炸视图 UI 层做**（3d_editor 已实现，faijs 不做）。
5. **兼容层库的落地位置**：`@faicad/cq-compat` 放 `packages/cq-compat`（workspace 内新包，参照 `gear-lib-demo` 装载方式）。需加入 CLI 白名单 `CLI_ALLOWED_LIBS`。
6. ~~**C1 投影范围**~~ —— **已过时作废**：统一投影方案已取代 C1-a/C1-b 手工补投影路线（本方案 §4.5 论证脚本面零新增）。
