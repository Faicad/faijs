# cq-compat 最大化 CadQuery 特性支持 —— 能力增量盘点与开发路线图

日期：2026-09-22
状态：已落地（2026-09-22 拆包实施完成；§5 的 Phase 1–5 路线图后续按里程碑推进）
范围：`packages/cq-compat` + `packages/core`（引擎侧支撑能力）+ `packages/fai_cq_gears` + `packages/fai_cq_warehouse`（依赖审计与拆包）
基线：`651fb4e`（2026-09-11，cq-compat parity 交接时 HEAD）→ `7724f22`（2026-09-22，当前 HEAD），区间共 **141 个提交**
依据文档：
- `docs/handover/2026-09-10-cq-compat-handover.md`（parity 体系、手工 block 清单、语义差异）
- `docs/handover/2026-09-17-assembly-global-solver-handover.md`（装配 global 求解器阶段交接）
- `docs/analysis/2026-09-15-sketch-constraint-solver-port-feasibility.md`（草图约束求解移植可行性）
- `docs/plans/2026-09-17-assembly-global-solver-plan.md`、`docs/plans/2026-09-22-topology-identity-development-plan.md`

---

## 0. 用户原始要求（原文引用）

> 分析cq-compat包的最后一次提交，到最新提交之间，faijs增加了哪些能力。然后看cadquery的哪些不支持的功能现在可以支持了，比如草图、装配等。然后据此写一份开发文档，要尽可能多的支持cadquery的特性。

拆解为三条任务：
1. 盘点 `651fb4e → HEAD` 区间 faijs 新增能力（cq-compat + core）。
2. 把「上一轮判为不支持的 CadQuery 特性」对照新能力重新评估（重点：草图、装配）。
3. 输出一份开发路线图，目标 = 尽可能多支持 CadQuery 特性。

**追加要求（2026-09-22 会话，原话引用）：**

> 你需要查看下面这两个库，它们是否依赖cq-compat，是否自己实现了部分cq-compat的功能，它们不能重复实现cq-compat的功能。fai_cq_gears fai_cq_warehouse。然后，我希望别人使用这两个库的时候，即不能有重复实现cq-compat代码，还要依赖少一些。也就是我希望cadquery的功能，分开成多个包。比如装配兼容层是一个独立的包。请更新你的方案，把我上面的要求写进去

拆解为两条新任务：
4. 审计 `fai_cq_gears` / `fai_cq_warehouse` 对 cq-compat 的依赖与重复实现（结论见 §1.3）。
5. 输出「CadQuery 功能拆包 + 依赖最小化」方案：cq-compat 按域拆为多个发布包（装配兼容层独立成包），两库只依赖真正用到的域（§3 + §5 Phase 0）。

**修订要求（2026-09-22 会话，原话引用）：**

> cq-compat为什么要有assembly/2D 全量，这些独立出来呀。不要改已有的fai_cq_gears。

拆解：**只拆两个域——装配、2D 草图**，各自独立成包（§3.1）；`@faicad/cq-compat` 主包**保留 CadQuery 兼容主体**（workplane / 2D 绘图 / 体素 / 特征 / 选择器 / 变换 / 齿轮内核），不挖空；`fai_cq_gears` 的依赖声明、导入路径、源码**一律不改**（§3 + §5 Phase 0）。

**修订要求 2（2026-09-22 会话，用户原话）**：

> compare是什么东西？如果是开发时需要的，这个需要独立出去

拆解：`compare` = cq-compat 的 STEP/装配几何等价性比较器（`step-compare.ts` / `assembly-compare.ts`，parity 测试工具，**非 CadQuery 兼容 API**，仅测试/开发脚本消费）→ **独立成 dev-only 包 `@faicad/cq-compat-compare`**，不进任何运行时依赖链（§3 + §5 Phase 0）。

**修订要求 3（2026-09-22 会话，用户原话）**：

> mini_lathe未来不应该调用core的装配，既然它用cadquery的语法，就要用cadquery的solve相关的api，封装底层的求解器。

拆解：装配消费面必须走 **CadQuery 语法**——`cq-compat-assembly` 暴露 `solve()` / `toCompound()` 等 CQ 风格 solve API，**内部封装 core 求解器**；消费方（含 mini_lathe）**禁止直调 core 求解器**（`getSlot().behavior.solveDetailed()` 是 faijs 内部探针，不在兼容面上）（§3 + §5 Phase 0）。

---

## 1. 能力增量盘点（2026-09-11 → 2026-09-22）

### 1.1 cq-compat 公开 API 面增量（`src/index.ts` diff）

| 新增导出 | 能力 | 提交 |
|---|---|---|
| `solidFromFaces` / `planarCap` | E5/E6：缝合构体 + 平面盖面原语（解除 `fai_cq_gears` 删 shim 的最后阻塞） | `669225c` |
| `pointRef` / `axisRef` / `constraintEx` / `constraint` 扩展 | 装配约束族扩到 Plane/Axis/Point/Cylinder/Distance/Fixed/Revolute，含 selector 解析 | `6083422` / `9cda215` |
| gear primitive 层（`getGearKernel`、`connectEdgesToWires`、`gearFaceFromWires`、`gearShellToSolid`、`gearEdgeEnds`、`buildGearSplineFace`、`soleGearFace`、`gearDistanceToFace`、`gearFaceDeviation` + 策略/类型） | 原始句柄内核层迁入 cq-compat（齿轮库复用） | `01ede80` |

### 1.2 core 引擎能力增量（按能力域）

| 能力域 | 内容 | 提交（代表） |
|---|---|---|
| **装配 global 求解器** | `api/assembly/solvers/`（`global-solver.ts` 507 行 + `linalg.ts` + `pose-from-delta.ts` + `types.ts`）：纯 TS 复刻 CadQuery `solver.py` 代价语义（LM + 中心差分雅可比 + 模长参数化四元数 + 9 类代价 + 锚定），替代 CasADi/IPOPT/WASM；`solve.ts` 按 `opts.solver` 分派 chain/global；cq-compat `buildAssembly` 默认 `global`；CLI STEP 导出**烘焙装配位姿** | `6083422` / `9cda215` / `a8f5dd2` |
| **草图约束求解** | `fcstd/{sketch-parse, sketch-solver, sketch-verify, planegcs-backend}.ts`：`SketchSolver` 接口 + `@salusoft89/planegcs` 1.2.0 WASM 后端；P0 约束 15 类（Coincident/Horizontal/Vertical/Parallel/Tangent/Distance/DistanceX/DistanceY/Angle/Perpendicular/Radius/Equal/PointOnObject/Symmetric/Diameter）；parse→solve→verify 只读通道 | `8e782e6`（M6）及后续 |
| **`cad.sketch` op 新增** | `api/sketch.ts`（区间内新增文件）：`{ contours: SketchLoop[] }`（line/arc segments，z=0），外环=面积最大环、其余为孔；`revolve` 经 compat 投影接入 cad 面（codegen 直连 Pad/Pocket/Revolution） | `8e782e6` |
| **拓扑身份机制** | `RoleName` 升格为结构化值；每语句 lineage 注册 + N1/N2/N3 守卫；绑定 7 个缺失的 `*WithHistory` API 并把 translate/scale 改走它们；`cad.extrude` 产物面命名（E3）；face-evolution 能力按 kernel 函数声明 | `a6a791c` / `4640b94` / `6c638e4` / `f0263ae` / `b444541` / `0b7cf0c` |
| **确定性扫描器** | `.fai.js` 可复现性静态扫描（lang + cad-runtime 集成） | `248d8c8` / `7724f22` |
| **no-eval AST 解释器** | `cad-runtime` 新增不依赖 eval 的解释执行后端 | `e325c03` |
| **并发守卫** | 多 runtime 并发执行拒绝（`E_RUNTIME_CONCURRENT`） | `b54e0c3` |
| **视图投影** | `viewCamera` / `projectView` / `projectSheet` 视图投影 op + CLI `view` 命令 | `fc00078` / `64dc99c` |
| **FCStd→fai.zip 单向转换** | M0–M13 全链路（容器/保留层、坐标帧、Pad/Pocket 语义、Body 排序、表达式绑定、复合体、草图轮廓→`cad.sketch`、edgeRef 锚点倒角、图案阵列、upTo 面）+ H 系列（平面附着、shape-asset、python-opaque）+ C2.x（Pad UpToLast/First/Face）+ B0 批量转换 + 平台 op | `37da83d` ~ `f05131b` |
| **工程/发布** | D2-A 门面并入 core（`@faicad/faijs` 名号由 core 继承）；npm 发布工具链落地，版本 0.13.2；CDN 内核注册表 globalThis 共享；weapp 宿主入口；fs-project-loader 模块解析 | `d301b99` / `19b851f` / `5be1c02` / `400dba1` / `dcf39cf` / `90dd862` / `9c56202` |

### 1.3 依赖与重复实现审计（fai_cq_gears / fai_cq_warehouse，2026-09-22 实测）

| 库 | 运行时依赖（package.json） | 是否重复实现 cq-compat | 审计证据 |
|---|---|---|---|
| `@faicad/fai-cq-gears` | `@faicad/cq-compat ^0.13.0`（唯一 runtime 依赖）+ peer `@faicad/faijs` / `occt-wasm` | **否** | raw kernel 层已于 `01ede80` 迁入 cq-compat（`cq-compat/src/gears.ts`：`GearKernel` / `getGearKernel` / `connectEdgesToWires` / `gearFaceFromWires` / `gearShellToSolid` / `gearEdgeEnds` / `buildGearSplineFace` / …）；`src/spline-face.ts` 是**薄适配层**（保留 v1 导入名 + 测量工具，几何 op 本体在 cq-compat）；fai_cq_gears 直接消费 `getGearKernel` 等，**不再触碰 occt-wasm** |
| `@faicad/fai-cq-warehouse` | `dependencies: {}`；cq-compat 仅 **devDependencies**（测试 parity 判定入口 `compareAssemblyFiles`） | **否** | `src/kernel.ts` 红线：不 import occt-wasm / `GearKernel`，只声明自用 `BrepEngineApi` 成员；全包无 assembly / workplane 实现，直接用 `@faicad/faijs` 的 op |

**结论**：两库都**没有**重复实现 cq-compat 功能（gears 已于 `01ede80` 去重、warehouse 从未重复）。但存在两个**依赖面问题**：
1. `fai_cq_gears` 运行时只为「gear primitive 层」就拖进**整个** cq-compat（workplane / assembly / 2D / compare 全量）——依赖面过宽。**但用户硬约束 `fai_cq_gears` 运行时零改动**，因此依赖瘦身只能通过「把 gears 用不到的域（装配、2D 草图、compare）从 cq-compat 主包拆出」达成：主包保留 workplane/2D 绘图等兼容主体，fai_cq_gears 的运行时依赖声明与 `src/` 导入路径保持不变（dev 侧 compare import 改指，见 §3）；
2. `fai_cq_warehouse` 虽运行时不依赖 cq-compat，但**没有任何 CI 守卫**阻止未来向 `src/` 引入 cq-compat import 或复制其实现。

---

## 2. 之前「不支持」的 CadQuery 特性 → 现在的可支持状态

> 对照上一轮按 core 三个 API 面（cad 脚本面 / brepjs-compat TS 面 / 库边界面）判定的「不支持清单」，结合本区间新能力逐项复核。**判定口径以 cq-compat 为准**（CadQuery 兼容性由该包承担）。

| CadQuery 特性 | 上一轮判定 | 本区间新增能力 | 现在状态 |
|---|---|---|---|
| **装配 Assembly**（Assembly 56 + op:assembly-solve 8 blocked） | 不支持（求解器缺失） | global 求解器 + 全约束族 + STEP 位姿烘焙，mini_lathe 真实装配 e2e 6/6 全绿、位姿与 CQ 2.8.0 参考一致 | ✅ **求解能力已具备**。剩余工作 = 把 blocked 装配用例写成 `.fai.js` parity 镜像（其中 `traverse`/`getfixturevalue`/`importStep` 类需逐条判定） |
| **草图约束求解 Sketch**（Sketch/constrain/solve） | 不支持（无约束求解器） | planegcs WASM 后端 + `SketchSolver` 接口（P0 15 类约束），fcstd 只读求解通道已跑通；`cad.sketch` op 落地 | 🟡 **引擎已具备（fcstd 内部）**。缺 = 公开成 `cq.Sketch` / cad 脚本面约束声明（见 §6 Phase 2） |
| **面/边选择器**（faces/edges role 选择、upTo 面、siblings/shells 12+12 blocked） | 不支持（无选择器机制） | 拓扑身份 `(StmtId, RoleName)` + per-statement lineage + WithHistory 变换命名 + extrude 面命名 | 🟡 **根基已加固**。`faces('>Z')` 等依赖 role 血统的选择器可靠性提升；siblings/shells 语义仍缺 |
| **变换后拓扑引用**（translate/rotate 后 fillet/upTo） | 部分（变换丢身份） | `*WithHistory` API 绑定，translate/scale 走命名链路 | ✅ 变换不再丢拓扑身份 |
| **solidFromFaces / 平面盖面** | 不支持（E5/E6 缺口） | `solidFromFaces` / `planarCap` op 落地 | ✅ 已实现 |
| **确定性建模**（同脚本重复运行几何一致） | 未覆盖 | 确定性扫描器 | ✅ 已实现（可复现性门禁） |
| **FreeCAD 文件导入**（草图/Pad/Pocket/阵列/upTo） | 未覆盖（平台面只有 import_brep） | FCStd→fai.zip 单向转换流水线 | ✅ 已实现（`fai.zip` 产物 + 批量转换 CLI） |

**结论**：上一轮判为「完全不支持」的三套范式机制中——
- **装配**：从「求解器缺失」变为「求解器就绪」，只差 parity 镜像化；
- **草图约束**：数学内核（planegcs）已接入，缺一层公开 API；
- **选择器/命名**：拓扑身份机制为 role 选择器提供了结构化基础。

---

## 3. 包拆分与依赖最小化（CadQuery 功能拆包）

> 用户要求：cadquery 的功能拆成多个包；别人用 `fai_cq_gears` / `fai_cq_warehouse` 时既不能重复实现 cq-compat 代码，依赖也要更少；**装配兼容层独立成包**；**已有 `fai_cq_gears` 一律不改**——拆包只发生在 cq-compat 侧（修订要求）。
>
> **边界澄清（用户原话，2026-09-22）**：「cq-compat的含义是cadquery兼容。你都去掉了，还谈什么兼容？？？明明只说了装配和2D草图，独立出去。」
> 即：`@faicad/cq-compat` 主包**保留全部 CadQuery 兼容主体**（workplane / 2D 绘图 / 体素 / 特征 / 选择器 / 变换 / 齿轮内核），**只拆出三个非兼容域：装配、2D 草图、compare（dev 工具）**。

### 3.1 目标包布局

```
@faicad/faijs                     引擎（不变；occt-wasm 由宿主注入）
@faicad/cq-compat                 CadQuery 兼容主包（保留现状主体，不挖空）：
                                  workplane / 2D 绘图 / 体素 / 特征 / 选择器 / 变换 / TS 兼容面
                                  + 齿轮 primitive 内核层 + 共享类型
                                  **不再内置装配、不再内置 2D 草图、不再内置 compare**
@faicad/cq-compat-sketch          2D 草图（独立包）：2D 草图 / Sketch 层
                                  （cadquery sketch.py 对应物；当前 cq-compat 无此模块，
                                  为 Phase 2 草图公开化的落点，含未来 planegcs 约束 Sketch）
@faicad/cq-compat-assembly        装配兼容层（独立包，自 cq-compat 拆出）：buildAssembly / constraint /
                                  constraintEx / faceRef / pointRef / axisRef / Color
                                  + **CadQuery 风格 solve 系列 API**（solve() / toCompound() /
                                  save()，封装 core 求解器）；**消费方不得直调 core 求解器**
@faicad/cq-compat-compare         （dev-only 独立包，自 cq-compat 拆出）：STEP/装配几何等价性比较器
                                  compareStepFiles / compareAssemblyFiles / printCompareReport /
                                  printAssemblyReport + 全部 Compare 类型；**仅测试/开发脚本消费，
                                  不进入任何运行时依赖链**
@faicad/fai-cq-gears              运行时零改动：仍依赖 @faicad/cq-compat，仍从它导入 getGearKernel 等
                                  （+ occt-wasm peer）；dev 侧 compare import 改指 cq-compat-compare
@faicad/fai-cq-warehouse          运行时依赖 @faicad/faijs（不变）；cq-compat 仅 dev → 改为
                                  cq-compat-compare 仅 dev（测试 parity 用）
```

> **注（2026-09-22 用户拍板）**：① 不做聚合包 `cq-compat-all`（用户：不用）——全量 CadQuery 体验 = 装 `@faicad/cq-compat` 主包 + 按需加装 `cq-compat-assembly` / `cq-compat-sketch`；② `cq-compat-sketch` 包名与边界已确认（用户：可以）。

### 3.2 拆包原则

1. **cq-compat 保持「CadQuery 兼容」含义**：主包内容 = 现有建模兼容主体（workplane / 2D 绘图 / 体素 / 特征 / 选择器 / 变换 / TS 兼容面 / 齿轮内核）**全部保留**，拆包不得挖空主包；
2. **只拆三个非兼容域**：① 装配 → `cq-compat-assembly`；② 2D 草图 → `cq-compat-sketch`（Sketch 层，Phase 2 落点）；③ **compare（dev 工具）→ `cq-compat-compare`（dev-only）**。其余一律不动；
3. **compare 独立 = dev 工具隔离**：`compareStepFiles` / `compareAssemblyFiles` 等**不是 CadQuery 兼容 API**（运行时无人消费），独立成 dev-only 包后，**任何包的运行时依赖链永不出现它**；
4. **fai_cq_gears 冻结（用户硬约束，口径：运行时）**：`fai_cq_gears` 的运行时依赖声明、`src/` 源码**一行不改**——运行时只从 `@faicad/cq-compat` 导入齿轮内核（`getGearKernel` 等），与 compare 独立无关；**dev 侧例外**：`scripts/_chk_phase.ts`、`compare-all.ts` 的 compare import 机械改指 `cq-compat-compare`（compare 独立的必然结果，devDependencies 增补该包）；
5. **消费方只依赖用到的域**：需要装配的用户只装 `cq-compat-assembly`；需要 2D 草图装 `cq-compat-sketch`；测试/开发脚本用 `cq-compat-compare`；**不做聚合包**（用户拍板，2026-09-22）；
6. **防重复实现 = CI 硬约束**：import 边界审计（§5 Phase 0 动作 3）+ `check-ghost-deps`，任何「复制 cq-compat 实现」的提交直接红；
7. **装配兼容面 = 纯 CadQuery 语法（用户修订要求 3）**：`buildAssembly` 返回装配对象并暴露 `solve()` / `toCompound()`（对应 CQ `Assembly.solve()` / `toCompound()`），内部封装 core 求解器；**消费方（含 mini_lathe）禁止直调 core 求解器**——`getSlot().behavior.solveDetailed()` 属 faijs 内部探针，不在兼容面上。

### 3.3 对既有文档/消费面的影响

| 面 | 影响 |
|---|---|
| `docs/plans/2026-09-19-npm-publish-plan.md` | 发布清单增补 `cq-compat-sketch` / `cq-compat-assembly` / `cq-compat-compare`（拓扑序：cq-compat 之后、warehouse/gears 之前）；**不做** `cq-compat-all`（用户拍板） |
| 3d_editor | 装配相关 import 从 `@faicad/cq-compat` 改指 `@faicad/cq-compat-assembly`；workplane/2D 绘图等**保持从 `@faicad/cq-compat` 导入不变**；compare 不被 3d_editor 使用（核实清单见 Phase 0 动作 4）；变更须同步（H3） |
| cq-compat parity 测试 | 镜像随域包走（装配镜像 → cq-compat-assembly；2D 草图镜像 → cq-compat-sketch，Phase 2 起）；parity 判定基础设施（gen-manifest / out 参考导出）从 `cq-compat-compare` 导入 |
| fai_cq_gears / fai_cq_warehouse 测试 | 两库 `src/testing/compare.ts`（薄封装，本地容差/用例配置，非重复实现）底层改调 `@faicad/cq-compat-compare` 的 `compareAssemblyFiles`；`import type { AssemblyCompareResult }` 改指新包 |
| mini_lathe（`../cadquery-port`，独立项目） | **装配消费面改走 CadQuery 语法**：`getSlot(compound).behavior.solveDetailed()`（core 内部探针）→ `asm.solve()` / `asm.toCompound()`（cq-compat-assembly）；作为该包的第一个验证消费方 |

---

## 4. 仍然不可支持的 CadQuery 特性（真缺口，截至 2026-09-22）

> 数据源：`tests/manifest.json`（697 条 = ported 264 / blocked 386 / skipped 47）+ `docs/handover/2026-09-10-cq-compat-handover.md` §6 手工 block 清单。blocked 条目含 `blockedBy` 根因，本节按根因归层。

### 4.1 A 层：未移植 op / 语义（blockedBy 分布，节选 top）

| blockedBy | 条数 | 说明 |
|---|---|---|
| `Assembly` | 56 | 上游 Assembly 类的构造/traverse 语义（求解器已就绪，但类式 API 与 pytest fixture 形态未镜像） |
| `stub:makeBox` | 33 | 上游测试基类 helper |
| `split` / `face` | 13 / 13 | 平面裁切扩展、face 构造入口（现有 splitFace/face 是子集） |
| `shells` / `siblings` | 12 / 12 | 选择器/构造器语义缺口 |
| `getfixturevalue` | 11 | pytest fixture，AST 导出不可达 |
| `op:text` / `text` | 10 / 9 | 文本/字体未支持 |
| `makeCompound` / `generated` / `eachpoint` | 8 / 7 / 7 | compound 构造、生成式用例、多点语义（镜像只推第一点） |
| `images` / `importStep` / `importBrep` | 8 / 8 / 4 | 贴图、STEP 文件 IO |
| `op:assembly-solve` | 8 | 求解器输出几何无法反推（求解器已就绪，属镜像口径问题） |
| `workplaneFromTagged` / `tag` | 5 / 4 | tag 语义未移植 |
| `interpPlate` / `remove` / `replace` | 5 / 5 / 4 | 各缺一个 op |
| `op:shape.offset` / `offset2D` | 4 / 1 | 2D/3D 偏移（内核缺口，见 B 层） |
| `step-export:faces-compound` | 4 | 导出保真 |

### 4.2 B 层：occt-wasm 内核能力缺口（几何不可复刻，已手工 block）

| 特性 | blockedBy | 根因 |
|---|---|---|
| 抽壳外扩/内偏移 | `kernel:shell-outward-opening`、`kernel:shell-intersection-join`、凹轮廓内偏移 | `MakeThickSolidByJoin` 缺口（testSimpleShell__s1/s2/s3、testClosedShell__s3） |
| 正厚度空心（t>0） | `op:shell` / intersection join | 外尖角偏移需 intersection join，kernel offset 只有 arc join |
| 负 taper | LocOpe_DPrism 角部锥面 | offsetWire2D 全 JoinType 失败、loft 拒绝 4↔8 边、draft 失败 |
| sweep 多截面/辅助脊线/管道 | `op:sweep.multisection` 3、`op:sweep.aux-spine` 3、`op:sweep.pipeshell` 4 | 内核只有单 profile sweep + loft 式近似；公开面无 sweep op |
| 高椭圆 | `kernel:ellipse-tall-axis` | 椭圆主轴恒在全局 X 且 major≥minor |
| loft 共面截面 | `kernel:loft-coplanar-sections` | 未暴露 ThruSections 的 continuity/degree 参数 |
| 近重合 B 样条布尔 | 比较器/内核 | `BRepAlgoAPI_Cut` 单向失败（唯一 FAIL testMultisectionSweep 与此同源；E4 twistExtrude 几何机器精度一致但卡同一探针） |
| helix 导出保真 | `kernel:step-export-wire-fidelity` | STEP 控制点 24 vs 85 |
| splineFace 判分 | `comparator:non-solid-metrics` | 非实体无 volume/CoM 定义（bbox 与拓扑全等） |

### 4.3 C 层：明确不在 cq-compat 公开面（无导出符号）

`sweep`、`section`、`offset2D`、`text`、`eachpoint/each`、`hull`、`clean/fix`、`tag`。

---

## 5. 开发路线图：最大化 CadQuery 特性支持

> 排序原则：**Phase 0（拆包）前置**——它决定后续镜像/新 API 落包与依赖边界；其后按「新能力已就绪、只差写镜像的 → 先做」（成本低、parity 提升立竿见影）；「缺公开 API 的 → 做封装」；「内核缺口 → 按可行性攻坚或维持显式 block」。每 Phase 给出目标、动作、验收口径、风险。

### Phase 0｜CadQuery 功能拆包与依赖最小化（用户新要求，前置）

- **目标**：`@faicad/cq-compat` **保持 CadQuery 兼容含义**（主包兼容主体不动，不挖空）；只把 **装配**、**2D 草图**、**compare（dev 工具）** 三个非兼容域独立成包（装配兼容层独立，见 §3.1）；`fai_cq_gears` **运行时零改动**；两库永不重复实现 cq-compat 功能。
- **动作**：
  1. 从 `@faicad/cq-compat` 拆出 `cq-compat-assembly`（buildAssembly / constraint / constraintEx / faceRef / pointRef / axisRef / Color）与 `cq-compat-compare`（step-compare.ts / assembly-compare.ts + 全部 Compare 类型，dev-only）；新建 `cq-compat-sketch` 作为 2D 草图 / Sketch 层的家（Phase 2 落点，含未来 planegcs 约束 Sketch）；主包**保留** workplane / 2D 绘图 / 体素 / 特征 / 选择器 / 变换 / 齿轮内核，**不再导出装配与 compare**；不做聚合包（用户拍板）；
  2. **fai_cq_gears 冻结（运行时）**：运行时依赖声明、`src/` 源码全部保持（仍依赖 `@faicad/cq-compat`、仍从它导入 `getGearKernel` 等）；**dev 侧机械改指**：`scripts/_chk_phase.ts` / `compare-all.ts` 的 compare import 改指 `@faicad/cq-compat-compare`，devDependencies 增补该包；`fai_cq_warehouse` 保持仅 `@faicad/faijs` 运行时依赖，dev 侧 cq-compat → `cq-compat-compare`；
  3. 新增 CI 守卫：import 边界审计（fai_cq_gears `src/` 仍从 `@faicad/cq-compat` 导入 = 白名单；cq-compat 主包内**禁止反向 import** assembly/sketch/compare；fai_cq_warehouse `src/` 禁止任何 cq-compat import；**任何包运行时依赖链禁止出现 `cq-compat-compare`**）+ 复用既有 `check-ghost-deps`；
  4. 发布前全仓 grep `@faicad/cq-compat` 消费方，核实 compare 使用者清单（预期：仅 cq-compat 自身 parity、gears/warehouse 测试与 scripts），同步 `docs/plans/2026-09-19-npm-publish-plan.md` 发布清单与 3d_editor 消费面（§3.3）；
  5. **cq-compat-assembly 提供 CadQuery 风格 solve API（用户修订要求 3）**：`buildAssembly` 返回装配对象，暴露 `solve()` / `toCompound()`（对应 CQ `Assembly.solve()` / `toCompound()`），内部封装 core 求解器；**mini_lathe 消费面迁移**：`getSlot(compound).behavior.solveDetailed()` → `asm.solve()`（CQ 语法，无 core 求解器直调）。
- **验收**：拆包后 `@faicad/cq-compat` 仍导出全部建模兼容面（workplane / 2D 绘图 / 体素 / 特征 / 选择器 / 变换 / 齿轮内核），**不再导出装配、compare，不内置 2D 草图**；`npm ls` 验证任何包运行时依赖图**不含** `cq-compat-compare`；fai_cq_gears 运行时零改动、dev 侧改指后测试全绿；warehouse 测试全绿（dev 改指）；守卫脚本入 CI 全绿；3d_editor 迁移后全绿；**mini_lathe e2e 改走 `asm.solve()` 后 6/6 全绿，消费面无 `getSlot`/`behavior` 探针**。
- **风险**：拆包触碰发布计划与 3d_editor 装配导入面 → 变更 API 须同步 `../3d_editor`（H3 纪律）；`fai_cq_gears` 的 dev 侧改指是「运行时零改动」口径的唯一例外（compare 独立的必然结果，用户已授权）。

### Phase 1｜装配镜像化（依赖 §2 装配求解器）

- **目标**：把 `Assembly` 56 + `op:assembly-solve` 8 中可复刻的用例转 `ported`。
- **动作**：
  1. 用 `buildAssembly` + `constraintEx`（Plane/Axis/Point/Cylinder/Distance/Fixed/Revolute）写 `tests/test_assembly/` 镜像（参照 mini_lathe 装配 e2e 配方；**求解统一走 CQ 风格 `asm.solve()`**，不直调 core 求解器——修订要求 3）；
  2. 逐条判定 `traverse`（Assembly 类遍历语义）——不能镜像的登记 `manual block` 并写根因；
  3. `getfixturevalue`（pytest fixture，AST 不可达）显式 block；`importStep` 按 Q2 映射/补 op（§5 Phase 5）。
- **验收**：`compare.ts` 装配类 PASS 增加，`op:assembly-solve` 归零；单测不回归。
- **风险**：上游部分用例依赖 Assembly 类式构造（非函数链），`.fai.js` 受限子集可能表达不了 → 显式 block，不硬凑。

### Phase 2｜草图公开化（依赖 §1.2 草图求解 + `cad.sketch`）

- **目标**：把 fcstd 内部的 `SketchSolver`（planegcs）公开为可用的草图 API，覆盖 CadQuery `sketch.py` 的约束面。
- **动作**：
  1. 定义公开 `Sketch` API（几何声明 + 约束声明两段式，与 `.fai.js` 扁平语句模型一致；参考可行性分析 §10）；
  2. 复用 `SketchSolver` 接口做 wasm 后端封装（`~300–500 行`），约束集先覆盖 P0 15 类（实测覆盖真实样本 99.5%）；
  3. 补 `sketch → extrude/revolve` 双链路出口：mesh 侧 2D 三角化 + 挤出（照 `svgExtrude` dual-op 范式），brep 侧走现有 `cad.sketch`；
  4. 求解失败（欠/过约束/奇异）显式抛错，禁止静默烘焙（沿用可行性分析 §10.6 纪律）。
- **验收**：`cad` 脚本面可写「带约束的草图 → 拉伸/旋转」完整用例；`cq-compat-sketch` 新增 `Sketch` 镜像（对应上游 `test_sketch` 模块，当前该模块 0 镜像）。
- **前置阻塞**：**planegcs 的 LGPL-2.0-or-later 许可合规结论**（可行性分析 R1）——公开分发前必须拿到法务裁定；不可接受则走自编译（路线 B）或 TS 重写（路线 C，不推荐）。

### Phase 3｜拓扑命名驱动的选择器（依赖 §1.2 拓扑身份）

- **目标**：用 `(StmtId, RoleName)` + lineage 加固/扩展 CadQuery 选择器语义。
- **动作**：
  1. `faces('>Z')` 类字符串选择器解析接 role 血统（cq-compat `faces/edges` 现按几何过滤，可升级为 role 优先）；
  2. 补 `siblings` / `shells`（12+12）语义：`ancestors/siblings` 依赖 lineage 图，`shells` 依赖 shell 构造入口；
  3. `face` 构造入口（13）补齐：`face(*wires)` 吃外部 wire（连接 `planarCap`/`solidFromFaces` 基建）。
- **验收**：`test_selectors` / `test_shapes` 镜像解锁 ≥15 条；`fillet`/`chamfer`/`upTo` 的面/边选择用例全部可写。
- **风险**：`siblings` 的上游语义（CQ 的 `topo.ancestors/siblings` 图遍历）与 faijs lineage 结构不同，需语义标定后映射，不做 1:1 翻译。

### Phase 4｜内核缺口攻坚（B 层，逐项）

| 项 | 现状 | 攻坚路径 | 优先级 |
|---|---|---|---|
| shell 外扩/内偏移（4 项） | kernel `MakeThickSolidByJoin` 缺口 | 向 occt-wasm 申请暴露 `MakeThickSolidByJoin` 的 intersection join / 外扩模式；或内核侧补 offsetWire2D intersection join | 高（抽壳是高频特征） |
| 负 taper | LocOpe_DPrism 角部锥面 | 申请 `LocOpe_DPrism` 投影；或「顶面 = 底轮廓 + 弧 join 偏移」+ loft | 中 |
| sweep multisection/aux-spine | 内核单 profile | 申请 `BRepOffsetAPI_MakePipeShell` 多截面/auxSpine 投影（`sweepPipeShell` legacy 已静默丢 aux spine） | 中 |
| 高椭圆 | 椭圆主轴恒 X | 内核椭圆构造支持 plane 轴 / major<minor（`gp_Elips` 限制） | 低 |
| loft 共面截面 | ThruSections 参数未暴露 | 暴露 continuity/degree/param 参数 | 低 |
| 近重合 B 样条布尔 | `BRepAlgoAPI_Cut` 单向失败 | 比较器侧：布尔差探针加容差判定/退化保护；不修几何 | 中（消除唯一 FAIL） |

**纪律**：任一攻不动 → 维持 `manual block` + 根因留档，**禁止**静默降级或放宽容差（handover 红线 4）。

### Phase 5｜IO / 文本 / 贴图（A 层大块）

- `importStep` / `importBrep` / `images`（8+4+8）：**不整组 skipped（Q2 拍板：按现成能力映射）**——`save`/`export`（写 STEP/STL/3mf）映射 CLI `--out` 既有能力；`load` 映射 `cad.load`（3d_editor FileRef 通道）；`importBrep` 映射 `cad.import_brep`（资产内 BREP）；真缺口 = **任意路径 STEP 文件导入**（`importStep` 8）→ 新增 `cad.import_step` op（任意路径 → OCCT 读 STEP）；`images` 贴图保持 block。
- `text`（10+9）：`cad.text` 已存在（默认字体），补齐 font/fontSize/halign/valign 参数；或裁决 skipped。
- `step-export:faces-compound`（4）：导出保真（与 helix 同一根因族）。

### Phase 6｜杂项 op 补齐（A 层零散）

`workplaneFromTagged`/`tag`（5+4）、`interpPlate`（5）、`remove`/`replace`（5+4）、`offset2D`（随内核）、`eachpoint` 公开化（7）、`makeCompound`（8）、`finalize`/`raises`（6+6，helper 语义）。每项独立小步：能镜像的镜像、不能的显式 block。

---

## 6. 验收指标与 DoD

| 指标 | 当前（2026-09-22） | 目标 |
|---|---|---|
| manifest ported | 264 / 697 | Phase 1 结束 ≥ 320；Phase 2 结束再 +20（test_sketch 首批） |
| manifest blocked | 386 / 697 | 只降不增（新增 blocked 必须 manual + blockedBy） |
| parity（需重跑 ref 导出） | 38.62%（2026-09-11 基线，`out/` 已 gitignore） | 每 Phase 提升 ≥ 5pct；**不作发版门禁**（Q3 拍板：不需要），仅作观测指标 |
| 单测 | cq-compat 124 passed（15 files） | 只增不回归 |
| cq-compat 主包内容 | 含装配 + compare + 未来 2D 草图 | **主包兼容主体全保留**（workplane/2D 绘图/体素/特征/选择器/变换/齿轮内核）；不再含装配、compare，不内置 2D 草图 |
| fai_cq_gears | 依赖 cq-compat（含装配/compare） | **运行时零改动**（依赖声明/`src/` 源码一行不改）；dev 侧 compare import 改指 `cq-compat-compare`（devDependencies 增补） |
| fai_cq_warehouse 运行时依赖 | 无 cq-compat | 保持零 cq-compat 运行时依赖（不变）；dev 侧 cq-compat → `cq-compat-compare` |
| compare 包运行时可达性 | compare 内置在 cq-compat（随主包发布） | **dev-only**：任何包运行时依赖图禁止出现 `cq-compat-compare`（`npm ls` 验证） |
| import 边界守卫 | 无 | CI 强制：cq-compat 主包内禁止反向 import assembly/sketch/compare；warehouse `src/` 禁止 cq-compat import；compare 仅 dev 可达 |
| mini_lathe 装配消费面 | `getSlot().behavior.solveDetailed()`（core 内部探针） | 走 `cq-compat-assembly` 的 `asm.solve()`（CadQuery 语法），无 core 求解器直调（用户修订要求 3） |

**DoD（每个 Phase 收尾）**：
- [ ] 新增镜像后重跑 `gen-manifest.ts`（manifest 与磁盘不脱节）；
- [ ] block 用例时**同时删除对应 `out/cand/*.step`**；
- [x] `npm run test -w @faicad/cq-compat` 全绿（131 passed，`--maxWorkers=2` 稳定）、stderr 零容忍；
- [ ] `npm run typecheck` / `lint` / `doc-sync` 全绿；
- [x] Phase 0 后重跑 `check-ghost-deps`（830 文件）+ `check-workspaces-order` 全绿；import 边界守卫（cq-compat 主包无 assembly/compare 反向 import、warehouse src 无 cq-compat、compare dev-only）由拆包结构保证；
- [x] 发布清单（`docs/plans/2026-09-19-npm-publish-plan.md`）已同步新增子包与拓扑序；
- [ ] 3d_editor 消费面变更已同步（H3 纪律）；
- [x] 阶段记录追加到本计划（状态流转：方案 → 实施中 → 已落地），见 §8。

---

## 7. 开放问题（沿用既有裁决项，需授权后动）

| 编号 | 问题 | 结论 |
|---|---|---|
| Q2 | `importStep` / `load` / `save` / `export` 组（46 var）是否整组 `skipped` | **已拍板（2026-09-22）**：不整组 skipped。`save`/`export` 映射 CLI 既有能力、`load` 映射 `cad.load`、`importBrep` 映射 `cad.import_brep`；真缺口 = 任意路径 STEP 导入（`importStep` 8）→ Phase 5 补 `cad.import_step`（用户：「这些不是都有现成的能力吗？」） |
| Q3 | parity score 是否作为发版门禁（如 ≥60% 才准 pack） | **已拍板（2026-09-22）**：不需要。parity 仅作观测指标，不作发版门禁 |
| Q6 | `fai_cq_gears` 删 shim 后全链验证 | **已闭合（2026-09-22 核实）**：shim 已在增量区间随 `01ede80` 删除（grep 证实 `packages/fai_cq_gears/src` 无 occt-wasm / TEMP-SHIM 残留）；fai_cq_gears 保持零改动，无待验证项 |
| Q7 | `cq_gears` Python 源缺失 → 齿轮类 P2–P5 无法逐字对照 | 独立轨道，不阻塞本路线图 |
| Q8 | 聚合包 `@faicad/cq-compat-all` 是否提供 | **已拍板（2026-09-22）**：不做（用户：不用） |
| 许可 | planegcs LGPL-2.0-or-later 合规（可行性分析 R1） | **Phase 2 前置阻塞**，法务裁定前不公开分发 |

---

## 8. 实施记录（2026-09-22 拆包落地）

**产出包（`packages/`，版本 0.1.0，cq-compat 保持 0.13.2，打包发布前统一升版本）：**
- `@faicad/cq-compat-assembly` — 装配兼容层独立包：`buildAssembly` 返回 `CqAssembly` 对象（`solve()` 幂等、封装 core global 求解器、烘焙 referenced-filtered transforms；`toCompound()` 产出求解后 compound；`save()` 走 node:fs，browser 面不含）；`constraint/constraintEx/faceRef/pointRef/axisRef/Color` + 类型导出。21 测试全绿（constraints / global-e2e / global-p3 / lift-boundary，含借用视图归一守卫）。
- `@faicad/cq-compat-compare` — dev-only 几何等价性比较器（STEP/装配 compare，原 `step-compare.ts`/`assembly-compare.ts` 迁入），不进任何包运行时依赖链；fai_cq_gears / fai_cq_warehouse 的 dev 侧 compare import 全部改指本包。2 测试全绿。
- `@faicad/cq-compat-sketch` — 2D 草图（Sketch 约束驱动参数化草图）骨架：`export {}` + Phase-2 注释（镜像 CQ sketch.py / occ_impl/sketch_solver.py 边界，按 §5 Phase 2 填充）。

**主包 `@faicad/cq-compat`（0.13.2）**：删除 `assembly.ts` / `step-compare.ts` / `assembly-compare.ts` 及 4 个装配测试 + p0b 测试（共 7 文件）；`index.ts` 移除装配/compare 导出、新增 `export { asBrepShape, resolveFaceSelector } from ''./workplane''`；`browser.ts` 只留 workplane + gears；4 处 compare import 改指新包。131 测试全绿。

**接线**：根 workspaces 扩至 11 项（core → cq-compat-compare → cq-compat → cq-compat-assembly → cq-compat-sketch → fai_cq_gears → fai_cq_warehouse → sheetmetal → fixtures → tests → demo；compare 在 cq-compat 前因主包 devDeps 依赖）；`check-workspaces-order` / `check-ghost-deps` 全绿。core 侧修复 3 处存量 typecheck bug：`compound-geom.ts`/`import-brep.ts`/`place.ts` 的 `BrepEngineApi` 导入源 `../brep/engine/types` → `../brep/engine/primitives`（定义在 primitives.ts）。

**消费方**：fai_cq_gears 运行时零改动（dev 侧 `_chk_phase.ts`/`compare-all.ts` compare import 改指新包为唯一例外，devDependencies 增补 file:）；fai_cq_warehouse dev 侧 `src/testing/compare.ts`/`scripts/compare-all.ts` 改指新包（运行时无 cq-compat 依赖）；packages/tests 与 core CLI 无需改（scoped 名自动可解析）。

**mini_lathe 迁移（外部项目 `C:\my\Faicad\cadquery-port\mini_lathe`）**：`assembly.fai.js` 改指 `@faicad/cq-compat-assembly`（本地名 `cqa` 规避与 `cq` 的 autoLoadLibsFromImports 首见冲突），结尾 `asm.solve()` + `let result = asm.toCompound()`；runtime 双注册 `cq` + `cqa`；tsconfig（lib ES2024 / types node / paths 指向 faijs 活包 / 移除非 composite references）、vitest alias、package.json（@types/node + cq-compat-assembly file:）补齐。全量测试 7 通过 2 跳过（跳过 = e2e 数值段，需 CQ python 环境生成 `out/ref/mini_lathe_poses.json`，本机缺失）。调试取证 GOTCHA：faijs 装配成员借用视图生命周期与执行上下文绑定，TS 侧重建装配的 compound children 会出现 dead 视图——测试改为脚本端到端 + 语法面守卫（禁直调 core）。

**守卫结果**：typecheck（相关包全绿；core 2 个既有测试文件红：`place-calibration.test.ts:90`、`fcstd/feature-translate.test.ts:266/882`，与本拆包无关）、lint 4 处既有错误（`import-brep.test.ts:13`、`import-brep.ts:59`、`evolution-declaration.test.ts:86`、`fcstd/convert.ts:26`，git diff 取证非本次改动）、madge 无环、packages/tests 1653 + parity 12 全绿、fai_cq_gears stability 8 例红（68184ef 起自红，骨架未动）与 fai_cq_warehouse params 34 表哈希红（数据守卫）均为既有。

**遗留**：§5 Phase 1–5 路线图（manifest ported 264→320+、`cad.import_step` 补 Q2 真缺口、sketch Phase 2 填充、parity 观测指标）；发布前统一升版本号。

**实施记录（2026-09-22 续，Phase 1 + Phase 5）：**
- Phase 1（装配镜像化）：引擎语句级 lineage 守卫修复（E_TOPO_UNTRACKED_INPUT——registeredStmtId 迁至 runtime-state，define-op 去重标记移除，commit 9031751）；cq-compat-assembly 输入归一支持 Workplane 载体（resolveAssemblyShape，constraintEx/buildAssembly）；test_assembly +12 个 toCompound 镜像（manifest 264→276 ported）；52 个 Assembly/solve 用例登记 manual block 根因（类式 API 依赖 / 缺 constraintEx 类型 FixedPoint/FixedAxis/PointInPlane / Face.makePlane），op:assembly-solve 与 importStep blockedBy 归零。
- Phase 5（IO/文本/贴图）：新增 `cad.import_step` op——任意路径 STEP → OCCT 读入（宿主 assets.resolveFile，loadBrep 自适应，roleTable imported:<i> 同 import_brep 机制）；gen-symbol-table 修复覆盖语义（手写版覆盖 scriptFaceOps 的 cut/split/linearPattern 去重而非误报）；importStep 8 个装配用例登记 manual block（依赖 Assembly 类式 importers.importStep/save，平台 op 已落地但装配级 roundtrip 不可表达）；text halign/valign 裁决 skipped（2D 定位测量；test_text 不在 ref 10 模块范围）；step-export faces/edges compound 导出已支持（brep/export/step.ts）。
**实施记录（2026-09-22 续，Phase 3 + Phase 6 + Phase 2 + Phase 4）：**
- Phase 3（选择器语义补齐，commit f2d181a）：实现 `siblings` op（+selectFaceHandles/selectEdgeHandles/siblingStep/resolveSiblingStarts），核心三个 OCCT 拓扑句柄 GOTCHA——共享边/顶点是同一 TShape 不同 TopoDS 句柄（siblingStep 匹配必须 kernel.isSame）；occt-wasm getSubShapes 每次调用分配全新 handle id（probe_ids.ts 实证）→ 一切去重/排除/visited 用 isSame 数组；BFS 层语义 = CQ exclude（每层开始时把上一层结果整体加入闭集，层内共享同一 exclude）。镜像 29 test_selectors + 12 test_siblings；companion 修复：core `brep/export/step.ts` 对 faces/edges compound 导出兜底、step-compare 无 face/solid 拓扑时跳过 volume/COM/cut（双方都须有才比）。compare 267→274。
- Phase 6（杂项 op，commit 24f0c38）：实现 `tag`/`workplaneFromTagged`（Workplane.tags 快照；workplaneFromTagged 只恢复平面 frame、保留当前 shape——上游 `_fromPlane` 只换平面不动 objects，恢复 shape 会丢掉后续实体）。镜像 5 个（testTag/testTagSelectors×3/testWorkplaneFromTagged）全 PASS；其余显式 block：eachpoint（parser 无函数字面量参数）、interpPlate/offset2D/fuzzy-bool/remove/replace（occt-wasm 内核缺口，见 Phase 4）、finalize/raises（Sketch/assert helper）。manifest 322 ported / 328 blocked。
- Phase 2（草图公开化非 planegcs 部分，commit b63faad）：新增 `sketch.ts`（CadQuery Sketch.py parity）——sketch/rect/circle/ellipse/polygon/regularPolygon/slot/trapezoid + 模式 a/s/i/c/r + faces/wires/edges/vertices 选择器 + tag/select + offset（offsetWire2D）+ sketch→extrude 出口（brep 侧，fromHandle 包装为 part）。新包 `@faicad/cq-compat-sketch`（0.1.0）以无前缀 CadQuery 语法名 re-export（浏览器入口含）。脚本面样例 `tests/test_sketch/TestSketch__testModes__extrude.fai.js`（sketch→extrude 导出实体，compare 链可消费）。实测内核：2D 面级 fuse/cut/common 可用（重叠共面矩形 fuse 保留 2 拓扑面，匹配上游 test_modes s1）；offsetWire2D 可用（0.64）；polygon 需 1e-12 容差去重（OCCT makeFace 拒绝零长度边）；fromHandle 需 configureBackends。约束段（planegcs）因 LGPL 许可未决保持 block。cq-compat 153 测试 / sketch 包 3 测试全绿。
- Phase 4（内核缺口评估与留档，Agent Note `2026-09-22-occt-wasm-kernel-gap-assessment`）：四项探针实测——①shell 外扩+移除面 = 真缺口（kernel.shell 是 MakeThickSolid，缺 MakeThickSolidByJoin 的 intersection join 模式；cq-compat 显式抛错）；②负 taper = API 存在（draftPrism）但语义未标定（wire 负体积 / face 1394 vs 期望 1000），需标定探针；③sweep 多截面 = 真缺口（sweepPipeShell/sweepOriented 均单 profile）；④高椭圆 = 真缺口已硬确认（makeEllipseEdge(2,4) 抛 gp_Elips invalid；主轴恒 X，cq-compat 已用 rotate90 绕过）。附带发现：offsetWire2D、2D 面布尔、removeHolesFromFace 其实可用；remove/replace（BRepBuilderAPI_MakeShape）与 fuzzy 布尔（SetFuzzyValue）仍未暴露。上游需求清单：MakeThickSolidByJoin 外扩+join / MakePipeShell 多截面 / remove-replace / fuzzy 容差。
**实施记录（2026-09-22 收尾）：**
- 版本统一（lockstep）：`@faicad/cq-compat-assembly` / `@faicad/cq-compat-compare` / `@faicad/cq-compat-sketch` 从 0.1.0 统一升至 0.13.2（与主发布链同号），package-lock.json 同步。
- doc-sync 12 项门禁全绿（收尾修复）：ops-api-inventory 重生成（新增 op 后 stale）；Agent Note 格式修复（topology-identity-coordinate 标题/Status 语法/语言切换/嵌套列表结构对齐）；api-contract.zh.md 补译第 8 项（Identity coordinate 段）并 re-record i18n hash；verify-translation-pairing 106 pairs 全一致。
- 3d_editor 消费面验证：`npm run test:unit` 2360 passed / 1 skipped（消费 0.13.2 tgz，本阶段 faijs 主包版本未变、新增能力不破坏现有消费面）。
- parity 观测（final）：PASS=274 / PASS-NT=5 / FAIL=9 / ERROR=0 / BLOCKED=362，parity=42.92%；manifest 322 ported / 328 blocked / 47 skipped（gen-manifest 重跑，新增 test_sketch 演示镜像为自造命名、不进入上游用例清单）。
- 全仓守卫：typecheck 全绿、lint 全绿（cq-compat/cq-compat-sketch 相关文件）、check-ghost-deps 842 files OK、check-workspaces-order 11 workspaces OK、全仓 build 通过。

**实施记录（2026-09-23 攻坚，负 taper 解锁）：**
- Phase 4 遗留项「负 taper」（testTaperedExtrudeHeight__s2，中优先级）攻坚成功：`extrude()` 新增 `taper < 0` 分支 `outwardTaperPrism`——上游负 taper 的 10-face 体（底 + arc-join 顶 + 4 平面侧壁 + 4 圆锥角面）由内核精确缝合构造，不再依赖 draftPrism 尖角截锥（其体积较 ref 偏高 ~2%，无法过 0.01% 容差）。
- 几何解明（探针链实证，`.env/probe/`）：ref 1866667.26 = draftPrism(-20°) 尖角截锥 − 4 方锥 + 4 个 1/4 圆锥；1/4 圆锥实体 = `makeCone(0, off, h)` + 两个 `halfSpace` 切割（vol 精确 πr²h/12）；缝合面构造 = 底 face + offsetWire2D(arc join) 平移顶 face + 4 侧平面（底边 + 顶直线反向 + 2 连接线，头尾连续）+ 4 锥面（母线 apex→弧下游端点 revolve 90°），`sew(1e-2)` + `makeSolid` + `fixFaceOrientations`（pre-fix 体积为负，必须 fix 方向）。
- 内核 GOTCHA 留档：①revolve 母线必须指向弧边 last（下游端点），指向 first 会扫入错误象限；②侧平面顶直线必须手工反向（内核 offset 边方向破坏 wire 头尾连续）；③sew 产出的 shell 面方向不定，makeSolid 后体积可为负，`fixFaceOrientations` 是必需步骤；④loft 4→8 / 8→8（含极小弧底）全失败，revolve(三角形面) 产开放壳 vol=0，均为死路。
- 实现范围：4 直线边矩形轮廓（底 4 边 / 顶 8 边）；圆截面负 taper 由既有 draftPrism 直接覆盖（圆无角部，实测 top>bottom 面积正确）；其他轮廓显式抛错（不静默降级）。非 XY 平面轮廓经 bbox z0 平移通用化，但仅限轴对齐平面。
- 结果：compare s2 `equivalent=true`（vol 差 1.3e-11%、COM 2.2e-12mm、topo f10/e24/v12/s1 全等、布尔差分 0）；manifest s2 blocked→ported（323 ported / 327 blocked）；全量 compare PASS=275 / FAIL=8 / parity=43.08%（+0.16%）；cq-compat 153 测试全绿（顺带修复 4 个存量 lint 红：sketch.test.ts / solid-from-faces.test.ts / sketch.ts / __probe-moved.test.ts 的未使用 import 与 console 残留）。
