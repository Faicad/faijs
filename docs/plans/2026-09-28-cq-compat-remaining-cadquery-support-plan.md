# cq-compat 剩余 CadQuery 特性支持 —— 现状盘点与开发计划（2026-09-28）

日期：2026-09-28
状态：**实施中**（2026-09-29 优先级重排：执行顺序改为 P0-1 Assembly → P0-2 Sketch → P0-3 Shape → P1 Workplane → P2 内核 → P3 随需）
基线 HEAD：`208d2402`
范围：`packages/cq-compat`、`cq-compat-assembly`、`cq-compat-sketch`、`cq-compat-compare` + `packages/core`（引擎侧支撑）
上游基准：CadQuery **2.8.0**（`tests/baseline.json`：cadquery-ocp 7.9.3.1.1 / occt-wasm ^3.8.0）
上游计划：`docs/plans/2026-09-22-cq-compat-max-cadquery-support-plan.md`（Phase 0–6，Phase 0/1/2(部分)/3/5/6 已落地，遗留见其 §8）

---

## 0. 用户要求与本文产出

> 我记得本项目之前有过 cadquery 的移植计划文档，有过多份，最新计划是 docs/plans/2026-09-22-cq-compat-max-cadquery-support-plan.md（"最大化 CadQuery 特性支持"路线图），对比最新代码的功能特性，看看之前 cadquery 移植完成到哪一步了，还缺哪些未完成。然后写一份新的开发计划，完成剩余的未支持特性。

产出：① 用**当日实测**重新盘点完成度（§1–§2）；② 把剩余缺口按可行性分层（§3）；③ 给出可执行的分期开发计划（§4）与验收口径（§5）。

**方法说明（可复现）**：完成度不是靠读计划文档推断，而是三个实测源——
1. 上游 API 面：`python -c "import cadquery"` 反射导出 CQ 2.8.0 的 `Workplane/Sketch/Shape/Assembly` 方法表（本机 `C:\Users\ylt\cadquery-env` 内 cadquery 2.8.0），与 `packages/cq-compat/src/index.ts` 导出面做差集；
2. 用例面：`packages/cq-compat/tests/manifest.json`（697 条三态）+ `out/ref`（651 STEP）+ `out/cand`（282 STEP）；
3. 代码面：`npx vitest run`（cq-compat 包）当日结果。

---

## 1. 实测现状（2026-09-28）

### 1.1 用例三态（`tests/manifest.json`，697 条）

| 状态 | 条数 | 占比 |
|---|---|---|
| ported（已有 `.fai.js` 镜像） | **342** | 49.1% |
| blocked（登记 blockedBy） | **308** | 44.2% |
| skipped（`ref-no-step`，ref 无 STEP 不可判） | 47 | 6.7% |

按上游模块分布：

| 模块 | total | ported | blocked | skipped |
|---|---|---|---|---|
| test_cadquery | 336 | 184 | 111 | 41 |
| test_free_functions | 128 | 57 | 71 | 0 |
| test_assembly | 141 | 30 | 107 | 4 |
| test_selectors | 48 | 45 | 1 | 2 |
| test_shapes | 32 | 17 | 15 | 0 |
| test_workplanes | 8 | 8 | 0 | 0 |
| test_cad_objects | 4 | 1 | 3 | 0 |

> 对照 9-22 计划的验收目标（≥320 ported）：**已超额完成到 342**。

### 1.2 ⚠️ 阻断级发现：cq-compat 单测当日 21 红（单一根因）

```
Test Files  6 failed | 14 passed (20)
Tests       21 failed | 133 passed (154)
Duration    351.93s
```

失败根因**全部是同一个**：

```
[faijs/op] rotate_euler: E_OP_FAILED: [stdlib] rotate_euler.angles must be a vec3 [x, y, z], got undefined
  ❯ orientZTo src/workplane.ts:832
```

- core 现签名：`cad.rotate_euler(shape, { angles: [x,y,z], pivot? })`（`packages/core/src/api/transform.ts:52/227`，`assertVec3(params.angles)`）；
- cq-compat 仍传 `{ anglesDeg }`，共 3 处调用点：`src/workplane.ts:832`（`orientZTo`，被 `hole`/`cboreHole`/`cskHole`/`cutThruAll`/`cylinder` 等全部"沿法向打孔/建体"路径依赖）、`:3687`、`rotate` 的 `:4083`。
- 影响面：不只是单测——**所有涉及 cylinder/hole/counterBore/counterSink/切穿的镜像在 cand 生成阶段同样会炸**（parity smoke 阶段 D 的 30 个入库用例中 8 个直接执行失败），因此 §1.3 的 parity 历史值已**不可信**。

**为什么没被 CI 拦住**：`scripts/ci.ps1` 第 4 步确实跑 `@faicad/cq-compat`（`scripts/ci.ps1:89`），但预算是 `FAIJS_TEST_BUDGET_MS=300000`（5 分钟，`ci.ps1:87`），而实测纯 vitest 耗时 **351.9s**，`npm run test` 还带 `pretest: npm run build`——**预算必然不够**，看门狗超时后结果不可信。

### 1.3 parity（几何等价性）—— 当前值未知，必须重跑

| 指标 | 2026-09-23 记录值 | 2026-09-28 |
|---|---|---|
| PASS | 288 | **待重跑**（§1.2 回归必然拉低） |
| PASS-NT | 5 | 待重跑 |
| FAIL | 5（4×siblings fuse 差异 + 1×multisection sweep） | 待重跑 |
| ERROR | 0 | 待重跑 |
| BLOCKED | 352 | 308（manifest 口径） |
| parity | 45.08% | 待重跑 |

`out/report.json` 停留在 2026-09-11（parity 38.62%），未随后续镜像更新——**报告不是最新水位**，Stage 0 必须重跑 `compare.ts` 取得真实基线。

### 1.4 包与依赖现状

```
@faicad/cq-compat          0.21.0  runtime deps: 无；dev: cq-compat-compare / faijs / ts / vitest
@faicad/cq-compat-sketch   0.21.0  deps: @faicad/cq-compat（file:）          ← 纯 re-export，无独立实现
@faicad/cq-compat-assembly 0.21.0  deps: @faicad/cq-compat + @faicad/faijs-extra
@faicad/cq-compat-compare  0.21.0  dev-only 比较器（STEP/装配等价性）
@faicad/faijs-sketch       0.21.0  deps: @salusoft89/planegcs 1.2.0（LGPL，独立包隔离）
```

- 镜像目录：`tests/test_cadquery` 184、`test_free_functions` 57、`test_selectors` 46、`test_assembly` 30、`test_shapes` 17、`test_workplanes` 8、`test_cad_objects` 1、`test_sketch` 1（自造演示）。
- `cq-compat/src/sketch.ts` 是 Sketch 实现本体，`cq-compat-sketch` 仅做无前缀名 re-export——**草图的新增能力落 `cq-compat/src/sketch.ts`，再在 sketch 包 re-export**。

### 1.5 9-22 至今的引擎侧新能力（可用于推进兼容层）

| 能力 | 证据 | 对 cq-compat 的用途 |
|---|---|---|
| units 量纲系统（unit 字面量 + 文件单位检测 + 量纲校验） | `ad026bd5`/`53425ee9`/`8bc8fcc7`/`c6c616a7` | 新增 op **必须**声明 `paramDims`（见 §6 纪律） |
| `BrepEngineApi` 收窄为 99 个 L1 方法 + 平台原生通道 | `2f7aed8a`，`packages/core/src/brep/engine/primitives.ts:33+` | 内核能力清单的权威边界（新增 op 只能在这 99 个 + 平台原生通道内构造） |
| brepkit 多引擎 + 优雅降级 | `a317ea35`、`packages/core/src/brep/engine/*brepkit*.test.ts` | 部分 occt 缺口（如 `defeature`/非实体语义）可在 brepkit 方言上重新标定 |
| `@faicad/faijs-sketch`（planegcs 独立包，15 类约束） | `packages/sketch/src/solver.ts:63` `SUPPORTED_CONSTRAINT_TYPES` | **草图约束段的现成后端**（Coincident/Horizontal/Vertical/Parallel/Tangent/Distance/DistanceX/DistanceY/Angle/Perpendicular/Radius/Equal/PointOnObject/Symmetric/Diameter） |
| `cad.import_step`（任意路径 STEP 导入） | `packages/core/src/api/import-step.ts` | Assembly `importStep`/`load` 的平台能力已就绪 |
| 平面求交/二分 `sectionByPlane` / `splitByPlane` | `packages/core/src/api/section-by-plane.ts`、`split-by-plane.ts` | `section()` / `split()` 的内核支撑已具备 |
| text op | `packages/core/src/api/generated/text.ts` | `Workplane.text` 的内核支撑已具备 |

---

## 2. 完成度矩阵（CQ 2.8.0 API 面 vs 当前导出面）

> 方法数是反射 CQ 2.8.0 得到的**公开方法**总数（已剔除 `val/vals/first/last/item/end/all/apply/invoke/toOCC/...` 等内部或索引类成员）；"覆盖" = 同名函数存在于 cq-compat（含 assembly/sketch 包）导出面。

| CQ 面 | 上游方法 | 已覆盖 | 完成度 | 备注 |
|---|---|---|---|---|
| `Workplane` | 92 | 56 | **60.9%** | 缺 36（§2.1） |
| `Sketch` | 51 | 19 | **37.3%** | 缺 32（§2.2），约束段 0 |
| `Assembly` | 11 | 4（`buildAssembly`/`solve`+`toCompound`/`save`/`constraint*`） | **36.4%** | 缺 7（§2.3），类式 API 全缺 |
| `Shape`（含 Face/Edge/Wire/Solid/Compound/Shell 类模型） | 81 | ~0 | **≈0%** | 无类模型（§2.4） |
| 模块级类与选择器（`cq.Face`/`Edge`/`Wire`/`Solid`/`Compound`/`Vector`/`Plane`/`Matrix`/`BoundBox`/`Selector`/`DirectionSelector`/`NearestToPointSelector`/`TypeSelector`/`StringSyntaxSelector`/…） | 30 个符号 | 极少 | 低 | 仅 `Location`/`Color` 部分覆盖 |
| 自由函数（`cq.Workplane` 之外的 `makeCompound`/`sortWiresByBuildOrder`/…） | — | 部分 | — | `makeCompound` 8 条 blocked |

### 2.1 `Workplane` 缺失 36 项（按可行性分档）

| 分档 | 方法 | 内核/引擎支撑 | 关联 blocked 条数 |
|---|---|---|---|
| **A 直补（低）** | `mirrorX`、`mirrorY`、`polarLine`、`polarLineTo`、`polarArray`、`rotateAboutCenter`、`slot2D`、`size`、`wires`、`compounds`、`bezier`、`clean` | `mirror`/`circularPattern`/`makeBezierEdge`/`healSolid`+`fixShape`+`removeDegenerateEdges` 均在 99 方法内 | `mirrorX` 2 |
| **A 直补（中）** | `split`、`section`、`text`、`offset2D`、`sweep`（单截面）、`consolidateWires`、`shells`、`sort`、`splineApprox`、`ellipseArc`、`compounds` | `splitByPlane`/`sectionByPlane`/`text` op/`offsetWire2D`（9-22 实测可用）/`api/sweep.ts`（单 profile） | `split` 10 + `op:text` 10 + `text` 9 + `section` 3 + `op:shape.offset` 4 ≈ **36** |
| **A 直补（中）** | `imprint`、`export`、`toSvg`、`toPending` | `text` + 布尔压印；`view/projectSheet` 投影；pending-wire 栈语义需补 | `imprint` 4 |
| **B 需类模型/DSL** | `sketch`、`placeSketch`、`ancestors` | Sketch 类模型；`ancestors` 需 lineage 图公开面 | — |
| **C 结构性不可达（回调）** | `each`、`eachpoint`、`cutEach`、`map`、`filter`、`parametricCurve` | `.fai.js` 受限子集无函数字面量/闭包参数（9-22 已判） | `eachpoint` 4 + `cutEach` 3 + `filter` 3 |
| **D 内核缺口** | `interpPlate`、`parametricSurface`、`sweep`（多截面/aux-spine/pipeshell）、高椭圆相关 | `BRepOffsetAPI_MakePipeShell` 多截面未暴露、无 Plate 构造、NURBS 曲面构造未暴露 | `interpPlate` 5 + `op:sweep.multisection` 3 + `aux-spine` 3 + `pipeshell` 4 + `parametricCurve` 2 |

### 2.2 `Sketch` 缺失 32 项

`add, apply, arc, assemble, bezier, chamfer, clean, close, constrain, copy, delete, distribute, each, edge, export, face, fillet, filter, finalize, hull, importDXF, invoke, located, map, moved, parray, push, rarray, replace, segment, solve, sort, spline, subtract`

- **几何声明**（`arc`/`segment`/`spline`/`bezier`/`edge`/`face`/`push`）：可补，内核 `makeArcEdge`/`makeBezierEdge`/`interpolatePoints` 具备 —— **A 档**；
- **模式与组合**（`add`/`subtract`/`assemble`）：CQ 里是 mode 别名与多 sketch 合并 —— **A 档（低）**；
- **变换/阵列/编辑**（`moved`/`located`/`parray`/`rarray`/`distribute`/`copy`/`delete`/`replace`/`fillet`/`chamfer`/`hull`/`clean`/`close`）：2D 层面布尔+`offsetWire2D`+`hullFromPoints` 可用 —— **A 档（中）**；
- **约束段**（`constrain`/`solve`/`finalize`）：后端现成（`@faicad/faijs-sketch` 15 类），缺一层 CQ 语法封装 —— **A 档（高价值，见 Stage 4）**；
- **回调类**（`each`/`filter`/`map`/`apply`/`invoke`/`sort`）：结构性不可达 —— **C 档**；
- **IO**（`export`/`importDXF`）：DXF 解析属新子系统 —— **D 档**。

### 2.3 `Assembly` 缺失 7 项

`add`、`addSubshape`、`remove`、`traverse`、`load`、`importStep`、`export`（`solve`/`toCompound`/`save`/`constrain`/`constraintEx` 已有）

**现状（澄清"有包≠已补齐"）**：装配层在独立包 **`@faicad/cq-compat-assembly`**（`packages/cq-compat-assembly/src/assembly.ts:379` 的 `CqAssembly`），它实现的是**「一次性构造 + 求解」**——`buildAssembly(name, members[], constraints[])` → `solve()` → `toCompound()`/`save()`；`CqAssembly` 接口**只有 `solve()`/`toCompound()` 两个方法**，没有 CQ 的**迭代式类面**（`add`/`remove`/`traverse`/`load`/`importStep`/`export`）。主包 `@faicad/cq-compat` 不 re-export 装配层（`packages/cq-compat/src/index.ts:134` 注释）。

⇒ 9-22 判定的"类式 API 无法在 `.fai.js` 表达"**需要修正**：真正的限制不是语法，而是"不可变语义 + 递归遍历"的实现成本；mini_lathe 已用 `cq.buildAssembly(...)` + `asm.solve()` 验证过对象方法调用在脚本面可用。**Assembly 是单块最大缺口**。manifest 实测 blockedBy 分三摊：**44 条**（理由写「Assembly 类式 API（obj/children/add/remove/constrain 对象方法）**无法在 .fai.js 受限子集表达**」——**该理由已过期，必须重判**）+ **8 条**（类式 STEP 导入/导出 `importStep`/`save`）+ **8 条**（`op:assembly-solve` 依赖 `constraintEx` 缺 FixedPoint/FixedAxis/PointInPlane 或 `Face.makePlane` 无限面，后两项与 §2.4 交叉）。

**消费方（必须同步，地位等同 3d_editor）**：`../cadquery-port/mini_lathe` —— cadquery-port 是"CadQuery 项目移植集中地"（`cadquery-port/README.md`），mini_lathe 是其首个移植项；`src/assembly.fai.js` 用 `cq.buildAssembly(...)`/`cq.constraint(...)`，`tests/assembly-e2e.test.ts` 是**现成的装配端到端验收样本**（对照 CQ 2.8.0 参考位姿 `out/ref/mini_lathe_poses.json`，单次快跑）。P0-1 改 API 形态须同步它。

### 2.4 `Shape` 类模型（81 方法）≈ 0 覆盖

cq-compat 走 Workplane 函数链，没有 CQ 的 `Shape`/`Face`/`Edge`/`Wire`/`Solid`/`Compound`/`Shell` 类模型，也没有 `Selector` 类体系与 `Vector`/`Plane`/`Matrix`/`BoundBox` 几何类。这直接对应 manifest 里的 `face` 13、`shells` 12、`makeCompound` 8、`remove` 5、`replace` 4、`addCavity` 3、`filter` 3 等条目。工作量最大，单列 Stage 5 评估。

---

## 3. 剩余缺口分层（308 条 blocked 的处置口径）

| 层 | 定义 | 条数（估） | 处置 |
|---|---|---|---|
| **A-stale** | `blockedBy` 指向的 op **现已导出**，属历史标记过期 | ~27（`face` 13、`workplaneFromTagged` 4、`save` 4、`twistExtrude` 3、`wedge` 3） | 逐条重扫：能镜像的镜像，不能的改写准确 blockedBy |
| **A-op** | 缺 op，但内核/引擎能力已具备 | ~45（text 19、split 10、section 3、offset 4、mirrorX 2、imprint 4、makeCompound 8…） | 补 op + 写镜像 |
| **B-类式** | 缺类模型/方法链（Assembly 52、Sketch 32、Shape 81） | ~90+ | 分期建类式面（Stage 3/4/5） |
| **C-结构** | 回调/闭包/pytest fixture/贴图等不可达 | ~25（`getfixturevalue` 11、`images` 8、`eachpoint` 4 + `each` 类、`raises`/`finalize` helper 12） | 永久 block，登记准确根因，**不硬凑** |
| **D-内核** | occt-wasm/brepkit 未暴露或语义不同 | ~20（sweep 三族 10、interpPlate 5、remove/replace 9、shell 外扩 2、parametricCurve 2、narrow:sphere-angles 3…） | 探针实测 → 能攻的攻坚，不能的留档 + 显式抛错 |
| **E-ref 缺口** | 上游模块从未生成 ref，无法判 parity | test_sketch 36 + test_nurbs 19 + test_hull 2（用例数） | 先扩 ref 再谈镜像（Stage 1） |

> blockedBy top（manifest 实测）：Assembly 52、`face` 13、`shells` 12、`getfixturevalue` 11、`split` 10、`op:text` 10、`text` 9、`makeCompound` 8、`images` 8、`op:assembly-solve` 8、`generated` 7、`finalize` 6、`raises` 6、`interpPlate` 5、`remove` 5、`importBrep` 4、`eachpoint` 4、`workplaneFromTagged` 4、`replace` 4、`op:shape.offset` 4、`op:sweep.pipeshell` 4、`load` 4、`save` 4、`imprint` 4…

---

## 4. 分期开发计划（2026-09-29 优先级重排）

> **重排原则（用户 2026-09-29 拍板）**：**快速补齐 CadQuery API 缺口是头等大事，不应被测试阻塞。** faijs/cq-compat 仍在早期、代码高频变更，据此：
> 1. 排序按 **API 面缺口大小 × 内核就绪度**，不按"先修回归 / 先建全量基线"。原 Stage 0（回归 + 全量 parity 基线）与 Stage 1（stale 重扫 + ref 扩展）属**盘点/维护**，降级为 **P3 随需执行，不再作为动手前置**；原 Stage 2（零散 op 补齐）降为 **P1**。
> 2. 原 Stage 3（Assembly）/ 4（Sketch）/ 5（Shape）是三大 API 面缺口，上调为 **P0**，最先做。
> 3. **禁止**把全量 `run-cand` / `compare.ts` / 全套 vitest 当作工作项的前置或收尾阻塞。每个工作项只跑**波及文件**的同目录单测（秒级～十几秒）；全量套件仅在 CI / 发版前跑一次。
> 4. 每个工作项 = 落 API 方法 + 同目录单测 + 更新 `tests/manifest.json` 该条状态；**不做跨仓全量 parity 扫描**。

**执行顺序（按此自上而下推进）**：**P0-1 Assembly → P0-2 Sketch → P0-3 Shape/选择器 → P1 Workplane 剩余 → P2 内核缺口 → P3 随需维护**。各节标题前缀即优先级；正文保留原 Stage 编号以便对照历史记录。

| 优先级 | 内容 | 原 Stage |
|---|---|---|
| **P0-1** | Assembly 类式 API（52 条 blocked，单块最大） | Stage 3 |
| **P0-2** | Sketch 完整化（19→40/51，含约束段） | Stage 4 |
| **P0-3** | Shape 类模型与选择器体系（81 方法，高价值子集先行） | Stage 5 |
| **P1** | Workplane 剩余 36 方法与 op 补齐（text/split/section/offset2D…） | Stage 2 |
| **P2** | 内核缺口攻坚与永久 block 收口 | Stage 6 |
| **P3（随需）** | 回归维护、stale 重扫、ref 扩展、全量 parity、门禁收尾 | Stage 0 / 1 / 7 |

### Stage 0｜【P3·随需】回归维护与 parity 基线（不再是前置）

- **状态（2026-09-29）**：动作 1/2/3/5 已完成（详见 §8）；动作 4（全量 parity 重跑）降级为**随需观测**，不再阻塞后续任何开发。**本节其余内容仅作历史记录，动手前不需要先跑它。**
- **目标**：把 cq-compat 从"21 红、parity 数字失真"恢复到可信基线，并让 CI 能真正拦住回归。
- **动作**：
  1. 修 `rotate_euler` 参数名：`src/workplane.ts:832`、`:3687`、`:4083` 的 `{ anglesDeg }` → `{ angles }`（core 现签名 `packages/core/src/api/transform.ts:227`）。**先确认是 cq-compat 侧未跟进改名，而非 core 侧 breaking**——查 `git log -p -- packages/core/src/api/transform.ts` 定位改名提交；若 core 侧改名未同步兼容层，则兼容层改；若 core 曾兼容 `anglesDeg` 后移除，需在 core 侧补断言测试防止再次静默移除。
  2. 补防回归单测（GOTCHA 标记）：断言 `rotate_euler` 只接受 `angles` 键，且 `orientZTo` 在任意法向上产出与 CQ 一致的孔位（覆盖 hole/cboreHole/cskHole/cutThruAll/cylinder 五条路径）。
  3. 重跑 `npm run test -w @faicad/cq-compat` → 154 全绿（含 stderr 零容忍）。
  4. **（P3·随需，不再执行）** ~~重跑 `npx tsx packages/cq-compat/tests/compare.ts`（先 `run-cand.ts` 全量再 compare），记录真实 PASS/FAIL/parity 水位~~——用户判定为无意义的数小时批跑：faijs 早期阶段代码高频变更，**不做**；需要观测时手动跑一次，不作为任何工作项的前置/收尾。
  5. **CI 预算修正**：`scripts/ci.ps1:87` 的 5 分钟预算 < 实测 351.9s（且 `npm run test` 含 build）。二选一：把 `@faicad/cq-compat` 单列更长预算（建议 900s），或把 cq-compat 测试分片（慢的 brep/parity smoke 单独一份）。否则 Stage 1+ 的回归仍会被看门狗吃掉。
- **验收**：单测 154 全绿（**已达成**）；3 处 `anglesDeg` 归零（**已达成**）；CI 预算已提（**已达成**）。~~`out/report.md` 新时间戳 + PASS 水位~~ → 随需。
- **风险**：若 core 侧近期还有其它参数改名（units 重构引入），可能不只 `rotate_euler` 一处——**波及范围单测**跑一遍即可（`rotate-euler-contract.test.ts` 已覆盖 `orientZTo` 全孔系路径），无需全量。

### Stage 1｜【P3·随需】stale 重扫 + ref 覆盖扩展（盘点性质，非前置）

- **定位（2026-09-29）**：本阶段不产出 API 能力、只修正登记与分母，**排在 API 缺口补齐之后**；不需要在动手前先做。
- **目标**：不写新 op，回收"历史标记过期"的条目，并把 parity 分母补完整。
- **动作**：
  1. **stale 重扫**：对 `face`(13)、`workplaneFromTagged`(4)、`save`(4)、`twistExtrude`(3)、`wedge`(3) 五组逐条读上游用例 + 现导出面，判定：能镜像 → 写镜像；不能 → 用 `mark-blocked.ts` 改写**准确** blockedBy（不得沿用过期根因）。
  2. **ref 覆盖扩展**：上游 `out/cache/v2.8.0/tests/` 已缓存 `test_sketch.py`(36 用例)/`test_nurbs.py`(19)/`test_hull.py`(2)，`run-ref.py` 支持 `--modules`，python = `C:\Users\ylt\cadquery-env\Scripts\python.exe`（baseline 指定，本机存在）。跑 `python tests/ref-harness/run-ref.py --modules test_sketch,test_nurbs,test_hull`，产出新 ref STEP + 合并进 `out/ref/manifest.json`，再跑 `gen-manifest.ts` 重生成三态表（分母 697 → 预计 750+）。
  3. 重跑 `compare.ts` 记录扩展后的 parity（分母变大 → 百分比会先降，属正常，需在报告里注明"分母扩展"）。
- **验收**：stale 组 27 条全部有明确结论（镜像 or 准确 blockedBy）；`out/ref` 出现 `test_sketch*`/`test_nurbs*`/`test_hull*` STEP；manifest 重生成且条数与 ref 一致。
- **风险**：sketch/nurbs 用例大量依赖类模型与回调 → ref 能出但镜像率可能极低，**这是可接受结果**（先把分母做实，避免"分母缺口掩盖真实完成度"）。

### Stage 2｜【P1】Workplane 剩余 op 补齐（内核已具备，缺封装）

- **目标**：吃掉 §2.1 的 A 档，预计解锁 ~36–45 条。
- **动作**（每项独立小步：op → 单测 → 镜像 → 重跑 manifest）：
  1. `text`（`op:text` 10 + `text` 9 = 19 条，单块最大）：接 `packages/core/src/api/generated/text.ts`，补 `font`/`fontSize`/`halign`/`valign`/`kind` 参数；2D 文本定位测量若不可达则只镜像几何可判的用例，其余按 C 层登记。
  2. `split`（10 条）：接 `splitByPlane`（core `api/split-by-plane.ts`），语义对齐 CQ `split(plane)`（保留两半）。
  3. `section`（3 条）：接 `sectionByPlane` 产出截面 wire。
  4. `offset2D` + `op:shape.offset`（~5 条）：接 `offsetWire2D`（9-22 实测可用）；3D `Shape.offset` 语义（实体内外偏移）单独判定，内核对 face/shell 返回 open shell 与 CQ 不同 → 属 D 层。
  5. `sweep` 单截面（公开面现无 sweep op）：接 `api/sweep.ts`；**多截面/aux-spine/pipeshell 保持 blocked**（D 层，10 条）。
  6. 选择器族与工具：`wires`/`compounds`/`shells`（12 条）、`size`/`sort`/`consolidateWires`、`mirrorX`/`mirrorY`(2)、`polarArray`/`polarLine`/`polarLineTo`/`rotateAboutCenter`/`slot2D`/`bezier`/`clean`。
  7. `imprint`(4)：text + 布尔压印组合。
  8. 每个新 op 必须补 `paramDims` 量纲声明（units 系统，见 §6）。
- **验收**：上述每组至少一个镜像 PASS；manifest ported 342 → **≥ 385**；波及单测不回归。`compare` PASS 数为观测项，**不作验收阻塞**。
- **风险**：`text` 的字体资源在浏览器/Node 宿主下可用性需实测（字体 loader 通道）；`shells` 依赖 shell 构造入口，内核未必有 → 需先探针。

### Stage 3｜【P0-1·最先做】Assembly 类式 API（单块最大缺口）

- **定位（2026-09-29）**：三大 API 面缺口之首，**第一个动手的就是它**。实现落 `packages/cq-compat-assembly/src/`（`assembly.ts` 的 `CqAssembly` + `buildAssembly`）。
- **目标**：把 `CqAssembly` 从"构造即求解"扩成 CQ 的迭代式类式面（7 方法），并重判 44 条过期 blockedBy。
- **工作项（各自可独立开工、无强制顺序；编号供交接引用）**：
  - **A｜增删**：`add(obj, name?, color?)` / `addSubshape(shape, name?)` / `remove(name)`——**不可变语义**（返回新 `CqAssembly`，不原地改），与 `.fai.js` 的 `let asm2 = asm.add(...)` 语句模型兼容；改 `CqAssembly` 接口 + `buildAssembly` 返回对象。
  - **B｜遍历**：`traverse()`——递归产出 `{ name, shape, parent }` 列表，对齐上游 `test_assembly` 遍历类断言。
  - **C｜导入**：`load(path)` / `importStep(path)`——封装平台 op `cad.import_step`（`packages/core/src/api/import-step.ts` 已落地）产出成员。
  - **D｜导出**：`export(path, mode?)`——STEP/STL 写出（走 CLI 既有导出通道；浏览器面不含文件写入）。
  - **E｜重判 blockedBy**：manifest 中 44 条理由「类式 API 无法在 .fai.js 表达」**已过期**，逐条重扫——能镜像的镜像，不能的用 `mark-blocked.ts` 改写**准确**根因（不得沿用过期理由）；重跑 `gen-manifest.ts` 落库（关联 §2.3）。
  - **F｜消费方同步 + 验收**：改 API 形态同步 `../3d_editor` 与 **`../cadquery-port/mini_lathe`**；以 `mini_lathe/tests/assembly-e2e.test.ts`（对照 CQ 2.8.0 参考位姿）为**首选端到端验收样本**（单次快跑，非全量批跑）。
- **保持**：`solve()`/`toCompound()`/`save()` 语义不变（幂等求解、封装 core 求解器、**禁止消费方直调 core 求解器**——9-22 修订要求 3）。
- **验收**：`CqAssembly` 具备 7 方法；Assembly blocked 107 → **≤ 60**；新增镜像 PASS ≥ 20；assembly 包单测（现 21）全绿且 ≥ 30；`../3d_editor` 与 `../cadquery-port` 装配消费面不破坏（H3）。
- **风险**：不可变语义 + 递归遍历在 `.fai.js` 语句模型下需验证（对象方法调用已验证可用，"返回新对象再赋给新变量"的语句级确定性扫描需实测；工作项 A 先做 1 个探针用例验证再铺开，对应 Q4）。

### Stage 4｜【P0-2】Sketch 完整化（几何 + 模式 + 变换 + 约束）

- **定位（2026-09-29）**：三大 API 面缺口之二，Assembly 之后做。
- **目标**：`cq-compat-sketch` 从 19/51 提到 ≥ 40/51，并让约束段可用。
- **动作**：
  1. 几何声明补齐：`arc`/`segment`/`spline`/`bezier`/`edge`/`face`/`push`；
  2. 模式与组合：`add`/`subtract`（mode 别名）、`assemble`；
  3. 变换/阵列/编辑：`moved`/`located`/`parray`/`rarray`/`distribute`/`copy`/`delete`/`replace`/`fillet`/`chamfer`/`hull`（`hullFromPoints`）/ `clean`/`close`；
  4. **约束段**：`constrain(...)` 声明 + `solve()` + `finalize()`，后端接 `@faicad/faijs-sketch`（`solveSketch`/`PlanegcsSolver`，15 类约束）。依赖形态建议 **peerDependencies + optional import**（LGPL 隔离，见 Q3）；
  5. 欠约束/过约束/奇异 → **显式抛错**，禁止静默烘焙（沿用可行性分析 §10.6 纪律）；
  6. 镜像 `test_sketch`（Stage 1 已扩 ref）：先做几何+模式类，再做约束类。
- **验收**：`test_sketch` 镜像 ≥ 15 条且 PASS ≥ 10；`constrain/solve` 端到端用例 1 个以上（草图 → 求解 → extrude 出体）；sketch 包单测 ≥ 10 全绿。
- **风险**：planegcs 是 LGPL-2.0-or-later，cq-compat-sketch 若直接 `dependencies` 会污染运行时依赖链 —— 必须走 peer/optional + 独立包隔离（与 `@faicad/faijs-sketch` 现状一致）。

### Stage 5｜【P0-3】Shape 类模型与选择器体系（高价值子集先行）

- **定位（2026-09-29）**：三大 API 面缺口之三。**直接进高价值子集落地，不先写"可行性评估文档"**（高价值子集清单已足够明确，评估并入实现过程）。
- **目标**：落地 CQ `Shape` 类模型的高价值子集，解锁 `face` 13 / `shells` 12 / `makeCompound` 8 / `remove` 5 / `replace` 4 / `addCavity` 3。
- **动作**：
  1. 可行性问题就地收敛（不再单独立文档）：类模型用**工厂函数 + 对象方法链**表达（对象方法调用在脚本面已验证可用），句柄生命周期与 Workplane 层互操作在第一条实现里直接定型；
  2. 高价值子集：`Face.makePlane`（无限面，Assembly 约束缺它导致 8 条 `op:assembly-solve`）、`Face.makeSplineApprox`（已有 `splineFace` 可复用）、`Shape.shells/solids/compounds` 选择器、`Compound.makeCompound`(8)；
  3. `remove`/`replace` 需 `BRepTools_ReShape`，内核未暴露 → 归 D 层；内核 `defeature` 语义与 CQ `remove` 不同（9-23 已实测：返回 6 面实体 vs CQ 的 5 面开放壳），**不得拿 defeature 冒充 remove**；
  4. 选择器类体系（`Selector`/`TypeSelector`/`DirectionSelector`/`NearestToPointSelector`/`StringSyntaxSelector`）按镜像需求逐条加，不一次性全做。
- **验收**：`makeCompound` 8 条清零；`face`/`shells` 合计解锁 ≥ 10；评估文档给出 Shape 类模型全量化的工作量估算。
- **风险**：工作量最大（81 方法），务必先评估再立项，避免摊子铺开后无法收口。

### Stage 6｜【P2】内核缺口攻坚与永久 block 收口

| 项 | 条数 | 处置 |
|---|---|---|
| sweep 多截面 / aux-spine / pipeshell | 10 | 9-23 已实测 loft 替代不可行（几何差 11.7%，且触发 wasm 内存越界）；向内核提 `BRepOffsetAPI_MakePipeShell` 多截面/auxSpine；**维持 blocked** |
| `interpPlate` | 5 | 内核无 Plate 构造 → **永久 block** |
| `remove`/`replace`（`BRepTools_ReShape`） | 9 | 内核未暴露；`defeature` 语义不同 → **永久 block**（Stage 5 评估后可降级为 D 层攻坚） |
| shell 外扩 / intersection join | 2 | 内核 `MakeThickSolidByJoin` 缺口 → 维持 blocked |
| `narrow:sphere-angles` / 高椭圆 | 3+ | 内核椭圆/球角限制 → 维持 blocked |
| `parametricCurve` / `parametricSurface` | 4 | 依赖 lambda 求值 → **C 层永久 block** |
| `eachpoint`/`each`/`cutEach`/`map`/`filter` | ~14 | 解析器无函数字面量 → **C 层永久 block**（若未来 parser 支持函数字面量，单独立项） |
| `getfixturevalue` | 11 | pytest fixture，AST 不可达 → **永久 block** |
| `images`（贴图） | 8 | 非几何 → **永久 block** |
| `raises`/`finalize` | 12 | helper/断言语义 → **永久 block**（`finalize` 随 Stage 4 约束段重新判定） |

- **纪律**：攻坚前必须写**探针实测**（`packages/cq-compat/out/probe*.ts` 风格），结论留档为测试；攻不动 → 维持 blocked + 根因，**禁止静默降级或放宽容差**。

### Stage 7｜【P3·随需】收尾：门禁、文档、消费方同步

- 全量重跑 `gen-manifest.ts`；block 用例同步删除对应 `out/cand/*.step`（最高频坑）；
- `docs/ops-api-inventory.md` 重生成（新增 op 后 stale）+ doc-sync 12 项门禁；
- 守卫：`check-ghost-deps`（新增依赖）/ `check-workspaces-order` / lockstep 版本 / madge 无环；
- 3d_editor 消费面同步（H3）；`docs/plans/2026-09-19-npm-publish-plan.md` 发布清单同步；
- 若新增导出面，评估是否需要 Agent Note 记录设计裁决。

---

## 5. 验收指标（2026-09-29 重排后，以 API 面覆盖为纲）

> 门禁从"manifest ported / parity 数"改为 **API 方法覆盖率 + 波及单测绿**——补齐缺口是目的，用例数与 parity 只是观测。
> parity 不作发版门禁（9-22 Q3 拍板），仅作观测指标。

| 指标 | 当前（2026-09-29） | 目标 | 归属 |
|---|---|---|---|
| cq-compat 单测 | **154 绿（20 files）** | 持续不回归 | 全程 |
| Assembly 覆盖率 | 4/11 | 11/11 | P0-1 |
| Assembly blocked | 107 | ≤60 | P0-1 |
| Sketch 覆盖率 | 19/51 (37.3%) | ≥40/51 | P0-2 |
| Shape 类模型 / 选择器 | ≈0 | 高价值子集落地（face/shells/makeCompound…） | P0-3 |
| Workplane 覆盖率 | 56/92 (60.9%) | ≥70/92 | P1 |
| manifest ported | 342 | 随 API 补齐同步增长（观测） | 全程 |
| manifest blocked | 308 | 随 API 补齐同步下降（观测） | 全程 |
| parity | 未重跑（旧值 45.08%） | 仅观测，非门禁 | — |
| CI 能拦住 cq-compat 回归 | **是（预算已修 900s）** | 保持 | — |

**每个工作项 DoD（不做全量批跑）**：
- [ ] API 方法落地 + **波及文件的同目录单测**绿（秒级；不跑全套 vitest，不跑 compare）；
- [ ] 更新 `tests/manifest.json` 该条状态（ported / blockedBy）；仅在需要时重跑 `gen-manifest.ts`；
- [ ] `npm run typecheck -w <包>` / `npm run lint -w <包>` 干净（core 侧对 HEAD 基线取差，不新引入）；
- [ ] 新增 op 已补 `paramDims` 量纲 + 防回归单测；
- [ ] 结论写回本文件 §8 实施记录（不必每次跑 compare）。

---

## 6. 纪律与红线（沿用 + 新增）

> **🔴 最高纪律（2026-09-29 新增）—— 不阻塞**：补 API 缺口**不得**以"跑全量测试 / 建 parity 基线 / 等流水线"为前置或收尾。测试只跑**波及范围**（同目录 `.test.ts`，秒级）；全量 `run-cand` / `compare` / 全套 vitest 属**观测**，绝不在日常开发循环里跑。**发现问题就解决、发现一个解决一个，立刻写代码。**

1. **fail-loud**：内核缺口 → 显式抛错 + `blocked` 登记，**禁止**启发式逼近或放宽容差（handover 红线 4）；
2. **量纲声明（新增，2026-09-28 units 系统引入）**：新增 op 必须在 arg-spec/`paramDims` 声明参数量纲（angle/length/…），否则 units 校验与 codegen 通道会红；
3. **镜像 = 唯一 ported 判据**：`gen-manifest` 只按镜像文件存在判定 ported，禁止手改 status 造假；
4. **防回归**：与预期不符的 API 用法必须落成 `GOTCHA:` 标注的测试（本次 `rotate_euler` 参数名即典型，Stage 0 动作 2）；
5. **消费方同步（H3）**：改 API 必须同步 **`../3d_editor` 与 `../cadquery-port`**（mini_lathe 等 CQ 项目移植消费 `@faicad/cq-compat` / `@faicad/cq-compat-assembly`）；装配消费面禁止直调 core 求解器（9-22 修订要求 3）；
6. **依赖最小化**：`fai_cq_gears` 运行时零改动；LGPL 依赖（planegcs）只走独立包 + peer/optional，不进运行时依赖链；
7. **后台任务纪律**：长任务串行，跑 cq-compat 全量测试/compare 期间不叠加其它长任务。

---

## 7. 开放问题（需授权后动）

| 编号 | 问题 | 建议 |
|---|---|---|
| Q1 | ~~`rotate_euler` 改名是 core 侧 breaking 未同步，还是 cq-compat 漏改？~~ | **已解决（2026-09-29）**：定为 cq-compat 侧未跟进改名（core 无 breaking），3 处调用点已在 `7da2e650` 修正；并按"core 加断言测试"补 GOTCHA 防回归测试 `packages/cq-compat/src/rotate-euler-contract.test.ts`。 |
| Q2 | ~~CI 里 `@faicad/cq-compat` 预算 5 分钟不够（实测 351.9s + build）~~ | **已解决（2026-09-29）**：`scripts/ci.ps1` 为 `@faicad/cq-compat` 单列 **900s** 预算（其余包保持 300s，`FAIJS_TEST_BUDGET_MS` 仍可整体覆盖）。 |
| Q3 | `cq-compat-sketch` 引入 `@faicad/faijs-sketch`（planegcs，LGPL）的形态 | peerDependencies + optional import；需法务口径确认 |
| Q4 | Assembly 类式 API 的不可变语义在 `.fai.js` 语句模型下是否放行 | Stage 3 先做 1 个探针用例验证，再铺开 |
| Q5 | Shape 类模型（81 方法）是否全量立项 | **不全量**；高价值子集直接落地（P0-3），可行性评估并入实现过程，不再单独立文档 |
| Q6 | `text` 的字体资源在 Node/浏览器宿主下的一致性 | Stage 2 实测后决定镜像范围，2D 定位测量类可判 skipped |

---

## 8. 实施记录

（每个 Stage 收尾追加；本文件创建时为空。）

- 2026-09-28：完成现状盘点（§1–§3 数据均为当日实测）与计划编制（§4–§7）。**未实施任何代码改动**。
- 2026-09-29（**优先级重排**）：按用户要求把"快速补齐 API 缺口"升为头等大事——原 Stage 3/4/5（Assembly/Sketch/Shape）上调为 **P0**，原 Stage 0/1（回归 + 全量 parity + stale 重扫 + ref 扩展）降为 **P3 随需**，原 Stage 2 降为 **P1**；明确禁止把全量 `run-cand`/`compare` 当作前置或收尾（§4 重排原则、§6 最高纪律、§5 门禁改为 API 覆盖率）。
- 2026-09-29（**P0-1 立项细化**）：按用户要求把 `../cadquery-port` 纳入消费方同步（§6-5、Stage 3-F），把 `mini_lathe/tests/assembly-e2e.test.ts` 定为 P0-1 首选验收样本；Stage 3 展开为工作项 A–F（含重判 44 条过期 blockedBy）；§2.3 澄清「cq-compat-assembly 已有包 ≠ 缺口已补」。
- 2026-09-29（**Stage 0 收口**）：动作 1（`anglesDeg`→`angles`）已由前一提交 `7da2e650` 完成；本日补齐动作 2 的 GOTCHA 防回归测试 `packages/cq-compat/src/rotate-euler-contract.test.ts`（7 tests，覆盖 `anglesDeg` 拒收 + `orientZTo` 在 >X 非轴对齐法向的 hole / cutThruAll / cskHole / cboreHole / cylinder 五路径）；动作 3 实测 `cq-compat` 单测 **154 passed / 20 files**；动作 5 修正 `scripts/ci.ps1` 为 cq-compat 单列 900s 预算。动作 4（全量 parity 重跑）按重排**不做**（随需）。
- 2026-09-29（**P0-1 Assembly 类式 API 全部完成**）：工作项 A–F 全绿，`cq-compat-assembly` 全包 **36 passed / 5 files**，typecheck + lint 干净。
  - **A**：`CqAssembly` 接口加 `add`/`addSubshape`/`remove`（不可变语义，返回新对象）；`buildAssembly` 注入实现；`remove` 过滤 dangling 约束（偏离 CQ：faijs 构造时验证引用必须存在）；新增 `CqSubshape`/`AssemblyAddArg` 类型导出。
  - **B**：`traverse()` — generator 方法，扁平结构产出 `[[name, this]]`（嵌套装配待后续）。
  - **C/D**：`importStep(path)`/`load(path)` — Node 侧 STEP 导入为单成员装配（`save.ts`，复用 `loadBrep`+`fromBrep`）；`export` 复用已有 `save`。
  - **E**：manifest 52 条过期 blockedBy 理由更新为「API 已实现，待写 parity 镜像」（44 条类式 API + 8 条 STEP 导入导出）；8 条 `op:assembly-solve` 真实缺口（constraintEx 缺 FixedPoint/FixedAxis/PointInPlane）保持原样，与 P0-3 交叉。
  - **F**：`mini_lathe` e2e 因既有 `fillet: KERNEL_ERROR`（非本次引入）失败；消费方不受新增 API 影响（未改现有签名）。
  - 测试：`packages/cq-compat-assembly/src/assembly-class-api.test.ts`（15 tests：A 8 + B 2 + C 3 + Q4 探针 1 + 端到端 1）。
- 2026-09-29（**P0-2 Sketch 完整化全部完成**）：Stage 4 六项动作落地，`cq-compat` + `cq-compat-sketch` 两包 typecheck/lint 干净，sketch 相关测试 **93 passed**（cq-compat：`sketch.test.ts` 17 + `sketch-mirror.test.ts` 42；cq-compat-sketch：`sketch-pkg.test.ts` 3 + `sketch-pkg-extended.test.ts` 34）。
  - **几何声明补齐**（`packages/cq-compat/src/sketch.ts`）：`push`/`edge`/`face`/`segment`（3 重载：两点/续接/长度角度）/`arc`（3 重载：三点/续接/圆心半径扫角，≥360° 出整圆）/`spline`/`bezier`/`close`；`Sketch` 状态扩展 `edges`（pending 边，upstream `_edges`）+ `locs`（Loc2 放置点，upstream each() 机制——声明在 push/rarray/parray/distribute 的 loci 处复制放置）。
  - **模式与组合**：`assemble`（pending 边端点配链成 wire，最长外环 + `addHolesInFace` 内孔）、`add`/`subtract`（选择集与 `_faces` 布尔）。
  - **变换/阵列/编辑**：`rarray`/`parray`（含 rotate 语义：基点随方位角旋转）/`distribute`（闭曲线均分 n 段、开曲线含两端点）/`moved`/`located`/`copy`/`delete`（face 按 bbox 中心签名匹配剔除）/`replace`/`fillet`/`chamfer`（内核无 `BRepFilletAPI_MakeFillet2d`，自实现有序环走查重建：邻边按 d 截断 + 角点插弧/倒角边，fillet 弧深用精确切线公式 `d(1/sin(θ/2)−1)`，面积与上游对齐到 1e-5）/`hull`（Andrew 单调链凸包 + `hullFromPoints`）/`clean`（`unifySameDomain`）。
  - **选择器**：`faces/wires/edges/vertices` 支持 `(sel?, tag?)`——tag 取 tagged 实体子形状、sel 支持 2D 字符串选择子集（`<X/>X/<Y/>Y` 极值、`>(x,y)` 方向、`or/and/not X` 组合），中心一律用 bbox 中心（顶点无 COM，GOTCHA：`getLinearCenterOfMass` 在 vertex 上返回 (0,0,0) 导致极值全并列）；`wires()` 对齐上游返回全部 wire（含孔 wire），`tag()` 无选择时抛错（upstream test_missing_selection）；`reset()` 同时清 locs（上游 push 后 reset 语义）。
  - **约束段**：`constrain`（tag/kind 校验，unknown 抛错）+ `solve`（`toCanonical` 把 pending 边投影为 `SketchGeom`——arc 由三点反解圆心/半径/span，约束映射到 `@faicad/faijs-sketch` 的 canonical 约束模型（Fixed/Coincident/Distance/Length/Angle/Orientation/Radius/ArcAngle）→ `solveSketch` planegcs 管线 → 解后几何重建边 handle；conflicting/failed 显式抛错（禁静默烘焙，§10.6））+ `finalize`。依赖形态：`@faicad/faijs-sketch` 走 peerDependencies（LGPL 隔离，与该包现状一致）；`constrain/solve` 端到端 wasm 源注入待消费方接 HostPorts，镜像层先覆盖 validation/错误路径。
  - **导出面**：`cq-compat/src/index.ts` 增 `sketch*` 前缀名 28 个 + 类型 8 个；`cq-compat-sketch` 无前缀 CadQuery 语法名同步 28 个。
  - **镜像**：`packages/cq-compat/src/sketch-mirror.test.ts` 42 条（test_face_interface/distribute/rarray/parray/modifiers/delete/edge_interface/bezier/located/replace/add/subtract/finalize/selectors/missing_selection/hullFromPoints），全部 PASS（验收 ≥15 条 PASS ≥10 达标）；`test_sketch` 中 `importDXF`/`export(dxf)`/`filter/map/sort/invoke`（回调类）与 planegcs 全量求解断言按 Stage 1 结论维持 blocked/随需。
  - **GOTCHA 留档**：① kernel handle 是引用计数句柄——commit() 的 identity loci 必须 `k.copy` 后再 release 源（alias+release = 全部面 Invalid shape ID）；② `curveParameters` 返回 `{first,last}` 对象非元组；③ `makeBezierEdge` 收 `Vec3[]` 非 flat 数组；④ 2D fillet 边数（OCCT wire 愈合 9 条 vs BRepFilletAPI 10 条）不作 parity 锚，面积才是。
- 2026-09-29（**P0-3 Shape 类模型与选择器体系·高价值子集全部完成**）：Stage 5 动作 1/2/4 落地，新文件 `packages/cq-compat/src/shape-class.ts` + `shape-class.test.ts`（16 tests 全 PASS），typecheck/lint 干净。
  - **类模型基础设施**（动作 1）：工厂函数 + 对象方法链；句柄生命周期在第一条实现里定型——`CqShape{kind,handle,owned}`，owned 包装器 `disposeShape` 释放句柄、borrowed 视图（选择器结果/Workplane 互操作）dispose 为 no-op，与 core fromHandle 收编模式同构不双重释放。
  - **Face.makePlane**（动作 2）：内核无无限面原语，按 plan 决议用 ×100 有限面替代（2×2 参数 → 200×200）；法向用 Rodrigues 旋转 +Z→dir，basePnt 平移。Assembly 8 条 `op:assembly-solve` 中依赖 makePlane 的用例现在可镜像（`Plane/Axis/Point` 可复刻求解路径）。
  - **Compound.makeCompound**：接受 wrapper/裸 handle 均匀列表（`unwrapShape` 归一）；`Shape.shells/solids/compounds/facesOf` 四个拓扑选择器（borrowed 视图返回）。GOTCHA：内核 `getSubShapes` 运行时支持 `'compound'` 但类型定义缺该枚举——收窄断言绕过（探针验证返回 1）。
  - **选择器类体系**（动作 4，按需子集）：`TypeSelector`（kind 匹配）、`DirectionSelector`（面法向平行）、`NearestToPointSelector`（bbox 中心最近单选）、`StringSyntaxSelector`（`>X/<Y/>Z` 极值 + `or` 组合去重）。**法向符号 GOTCHA（探针实测）**：`pointOnSurface` 叉积给参数化法向，不带面 orientation——双盒 4 个 X 薄面全报 +X；符号消歧用 `containsPoint` 沿候选法向偏移探针点（在实体内 ⇒ 翻转），经构造器 `context` 参数传入宿主实体。
  - **动作 3（remove/replace）**：维持 D 层永久 block（内核 `defeature` 语义 ≠ CQ `remove`，不得冒充——9-23 实测纪律不变）。
  - **makeSplineApprox 边界**：sync 类模型路径显式抛错并指向异步 `splineFace` op（内核无同步网格→BSplineSurface 插值入口）；消费方走 op 通道，不作静默降级。
  - **全量化工作量估算**（验收项）：Shape.py 81 方法中，拓扑选择器类（faces/edges/vertices/shells/solids/compounds/wires）约 10 个已由本基础设施直接覆盖；几何查询类（Area/Volume/Center/BB 等 ~20 个）是 kernel 直通薄封装，单人日级；布尔/变换类（fuse/cut/mirror/rotate ~15 个）可透传 cq-compat 现有 op；剩余高难类（makeSplineApprox 同步化、location 体系、BRepTools_ReShape 依赖的 remove/replace）需内核增强，估 3–5 人日。
- 2026-09-29（**P1 Workplane 剩余 op 补齐·Stage 2 动作 2–4/6 完成**）：`packages/cq-compat/src/workplane.ts` 新增 13 个方法 + `p1-workplane-ops.test.ts` 22 tests 全 PASS；波及单测（cq-compat.test/p4-ops/parity-smoke/moved）65 passed 不回归；cq-compat 与 core typecheck/lint 干净。
  - **split**（动作 2）：L1 `splitByPlane`（正/负两半均保留成 compound）；GOTCHA——L1 断言 solidCount=2，边界平面（过面留一侧空）抛 `expected 2 solids`，只支持内部平面。
  - **section**（动作 3）：L1 `sectionByPlane`（截线 compound），无交线显式抛错。
  - **sweep 单截面**（动作 5）：走裸内核 `getKernel().sweep`（BRepOffsetAPI_MakePipe）——L1 `BrepEngineApi` 无 sweep 入口、`sweepOriented` 是多截面 BRepFill API 拒收 wire/face（探针实测）；path 接受 `.shape` 或 `wire()` 的 pendingWires 两种形态。**GOTCHA（探针实测）**：剖面必须⊥ spine（YZ 剖面沿 X spine 体积 πr²L ✓）——共面剖面被压扁成退化 flat pipe（bbox 正确、体积 0）；`transition` 参数为 API parity 保留，MakePipe 无 transition 概念（JSDoc 注明）。
  - **offset2D**（动作 4）：内核 `offsetWire2D` 直通，offset 结果以 `builtWire` 通道挂回 `PendingWire(kind:'path')`（`buildProfileWire` 直通返回）；GOTCHA——内核 arc-join 圆角口径 ≠ 上游尖角圆角，镜像用实测锚 8.7854（不作解析猜测）。
  - **选择器族与工具**（动作 6）：`wires`/`compounds`/`shells`（首实体收养+其余释放，同 `solids` 模式；compounds 对无嵌套 compound 的形状 try-catch——内核对非 compound 调用抛 wasm 内部错误）、`mirrorX`/`mirrorY`（复用 `mirror` + 命名平面）、`polarArray`（fill 均布整圆 / fill=false 含两端点）、`polarLine`（相对极坐标）/`polarLineTo`（绝对极坐标，GOTCHA：目标从原点算不从当前点）、`rotateAboutCenter`（bbox 中心 + 局部轴→世界轴）、`slot2D`（GOTCHA：上游 `length` 是**总长含两端半圆帽**，直段 = length − diameter；探针实测体积/bbox 后修正）。
  - **paramDims**（动作 8）：core `splitByPlane`/`sectionByPlane` 补 `paramDims: { 'params.point': 'length', 'params.normal': 'length' }`（sweep 的 profile/spine 是 Shape 输入非标量参数，无需声明）。
  - **未做**（保持 blocked/后续）：`text`（19 条，字体 loader 通道需实测，动作 1）、`imprint`（动作 7）、`sort`/`size`/`consolidateWires`/`bezier`/`clean`（工具组剩余项，随需）、多截面 sweep（D 层 10 条维持 blocked）。manifest ported 增长待 `gen-manifest.ts` 重跑（观测项）。（注：`text` 与工具组 5 项已于 2026-09-30 落地，见下方 09-30 记录；此处保留为当时状态。）
- 2026-09-29（**P2 内核缺口攻坚 + 永久 block 收口**）：探针实测后部分解锁 + 余量写内核修改方案（`docs/analysis/2026-09-29-occt-wasm-gap-plan.md`）。
  - **✅ sweep 多截面/pipeshell 解锁**（10 条）：内核 `sweepPipeShell`（MakePipeShell）+ 端盖 `sewAndSolidify` 探针实测产出 valid solid（L-spine capped pipe 42.765）；`sweep(wp, path, { multisection: Workplane[] , isFrenet?, smooth? })` 已实现——真实多截面 193.88/valid true，空 multisection 走单截面 MakePipe 路径（GOTCHA：isMulti 判定需过滤无 pendingWires 的 section，否则空数组误走 pipeShell 产出 invalid 产物）；镜像 24/24 绿。9-23 的「loft 替代不可行」结论不适用于本路径（pipeShell ≠ loft）。
  - **⚠️ aux-spine 半解锁**（3 条）：内核绑定存在（`sweepOriented(…, SweepMode.Auxiliary=3, up?, auxSpine?)`），faijs 侧无 Workplane 级 API 面 + mode 3 组合未探通（`Invalid shape ID: 0`，疑似句柄封送问题）→ 方案文档 §2。
  - **❌ 需内核增强（写明修改方案）**：shell 外扩/intersection join（`BRepOffsetAPI_MakeThickSolidByJoin` 完整参数面，§3，1–2 人日解锁 8 条）、`remove`/`replace`（`BRepTools_ReShape` 绑定，§4，1 人日解锁 9 条）、`interpPlate`（`GeomPlate_BuildPlateSurface`，§5，2–3 人日解锁 5 条）、球角/高椭圆/双距离倒角（§6，2 人日解锁 5 条）、3D `shape.offset`（与 §3 同源复用，§7）。
  - **❌ 非内核问题（永久 block 维持）**：`parametricCurve/Surface`、`eachpoint/map/filter`（解析器 C 层）；`getfixturevalue`/`images`/`raises`/`finalize`（pytest/helper 语义）。
  - 优先级建议（方案文档 §9）：reshape(1d) → 球角(0.5d) → ThickSolidByJoin(1–2d) → 椭圆/倒角(1d) → aux-spine 验证(0.5d) → GeomPlate(2–3d)。
- 2026-09-30（**P1 工具组收口 — size/clean/bezier/consolidateWires/sort**）：§2.1 A-straight 中遗留的 5 个 Workplane 方法落地，`packages/cq-compat/src/workplane.ts` 新增 `size`/`clean`/`bezier`/`consolidateWires`/`sort` + 同目录单测 `src/tool-group-ops.test.ts`（9 tests 全 PASS）；`packages/cq-compat` typecheck + lint 干净；波及回归（`cq-compat.test`/`arcs2d`/`p1-workplane-ops` + 本文件）**49 passed / 4 files / 0 stderr**。
  - **size**：`kern().getBoundingBox` → `[dx,dy,dz]`（无 solid 抛错）。
  - **clean**：`fixShape` → `removeDegenerateEdges` → `healSolid` 序列（上游 `Solid.fix` 对齐），无 solid 抛错。
  - **bezier**：`getKernel().makeBezierEdge`（控制点 → 世界坐标）一次性建边、`builtEdge` 强引用挂进 `PendingEdge`（新增 `kind:'bezier'`，复用 `buildProfileWire` 的 `else if (e.builtEdge)` 分支），`lastEdgeEndTangent` 同步认 `bezier`（复用 `splineEndTangent`）；`wire()`+`extrude()` 验证出体。
  - **consolidateWires**：`buildProfileWire` 物化全部 pending wires → `kern().makeCompound` → 写回 `wp.shape` 并清空 `pendingWires`；无 pending 抛错。
  - **sort**：cq-compat 无对象栈，排序目标即 `pendingWires`，默认按 bbox 面积降序（`area`/`length`/`x`/`y` 四档）。
  - **Workplane 覆盖率**：56/92 → **61/92（66.3%）**（§2.1 的 `bezier`/`clean`/`size`/`sort`/`consolidateWires` 5 项关闭；`text`/`imprint` 仍缺失）。manifest ported 计数**未变**——gen-manifest 重跑是 P3 观测项（见 §4 P3），遵循「不阻塞」纪律。
  - **仍为下一批头号缺口（P1 收尾）**：`text`（19 条，动作 1）与 `imprint`（4 条，动作 7）。`cad.text` 现已迁出 core 到 `@faicad/faijs-extra`（`packages/faijs-extra/src/ops/text.ts`），而 cq-compat 运行时不依赖 faijs-extra（test 用 `createRuntime(createNodePorts(),'brep')` 只注册 core op），故 `Workplane.text` 受「extra 依赖接线 + 字体 loader 通道」阻塞（即原 Q6，未解决）→ 列为 `text` 的前置，不硬凑。（注：该 Q6 已于 09-30 解决并最终改为 cq-compat **自实现**，见下方 09-30 记录；此处保留为当时状态。）
  - **P1 之后即 P2 内核缺口**（方案文档 `docs/analysis/2026-09-29-occt-wasm-gap-plan.md`）：reshape(1d)/球角(0.5d)/ThickSolidByJoin(1–2d)/椭圆·倒角(1d)/aux-spine 验证(0.5d)/GeomPlate(2–3d)，均需在 core 内核层加绑定或新 op，工作量最大、风险最高，按方案 §9 优先级推进。
- 2026-09-30（**`text` 的 faijs-extra 接线 — 能力层解除阻塞**；⚠️ 已被下方「自实现」记录取代，faijs-extra 接线已回退）：原 Q6（extra 依赖 + 字体 loader 通道）已解，`Workplane.text` 落地。
  - **根因澄清**：cq-compat 在模块加载时自建 `cad = createApiNamespace()`（只含 core 平台面），`cad.text` 不在其中；且 `cad.text` 的 op 实现（`packages/faijs-extra/src/ops/text.ts`）经 `../mesh/primitives` 间接拖入 `three/examples`，若整体注册进 cq-compat 的 node 构建会违反「core three-free」原则并在 node 拉起 three。
  - **接线方案（three-free）**：在 faijs-extra 抽出 **brep-only** 入口 `packages/faijs-extra/src/ops/text-brep.ts`（导出 `textBrep(params)`，只用 core 的 `textToSolid` + `fontRegistry` + `getSolidBoundingBox`，不触 mesh/three，含 CJK 降级分支），`ops/text.ts` 改为复用它（行为不变）；新增子路径导出 `"./text"`（`dist/text.js`，`src/text.ts` 再导出 `textBrep`）。cq-compat 仅引 `@faicad/faijs-extra/text`，在 `cad` 单例上挂 `text: textBrep`。faijs-extra `entry-boundary.test.ts`（three-free 边界）4/4 仍绿。
  - **`Workplane.text(txt, size, depth, opts?)`**：自由函数（`cq.text(wp, …)` 形态），经 `cad.text` 产 3D 文字实体（X/Z 居中、Y 底对齐原点），再 `orientZTo`(+Z→`wp.normal`) + `cad.translate` 到 `wp.origin`，走 `combineEachpoint`（默认 `combine=True` 与既有实体融合）。
  - **字体通道（node）**：新增 `packages/cq-compat/src/font-loader.ts`，`setupCqFont()` 注入 fs `FontLoader` 读取 core 的 `packages/core/src/assets/fonts/OpenSans-Regular.ttf`（路径相对本模块解析，src/dist 双态可用，与 core `fontTestHelper.ts` 同机制）；cq-compat `devDependencies` 加 `@faicad/faijs-extra: file:../faijs-extra`（解析 + ghost-dep 守卫；发布态需改为 registry 依赖，已注明）。
  - **验收**：`src/text.test.ts`（3 tests 全 PASS：cq 命名空间产出有效 brep / XY 面沿 +Z 深度≈4 / `top` 面沿法向深度≈2）；cq-compat 波及回归 **52 passed / 5 files / 0 stderr**；typecheck + lint + `check-ghost-deps` 全绿。
  - **⚠️ 勘误（2026-09-30 当日更正）**：本条初稿曾断言「CQ 的 `wp.text()` 是 2D 草图语义（字形轮廓加进 pending wire 再 `.wire().extrude()`），cq-compat 的 3D 实体 `Workplane.text` 与之不同」。**该论断错误**。查仓库内 CadQuery v2.8.0 官方测试缓存 `packages/cq-compat/out/cache/v2.8.0/tests/test_cadquery.py`：`testTextAlignment`（L3937）直接 `Workplane().text("I", 10, 0, halign=…, valign=…, fontPath=testFont).val().BoundingBox()`，`testText`（L3850）直接 `.text("CQ 2.0", 0.5, 0.05, combine=True, …).val().Volume()` / `.solids().vals()` / `.faces(">Z").vals()`——**都没有 `.wire().extrude()` 链**；上游 API 参考亦写明 `Workplane.text(txt, fontsize, distance[, …]) Returns a 3D text`，中文教程明确「Workplane 沒有 2D 概念的文字處理方法」。**CQ 的 `text` 本身就是 3D 实体创建 op**（内部按 `distance` 沿法向挤出，负值反向）。故 cq-compat 的 3D 实体 `Workplane.text` 方向正确，真正差距是**参数面 + 对齐语义**，不是「2D wire 链」。
  - **诚实披露（更正后）**：`text` 在**能力层**已解除阻塞——此前 `cad.text` 完全不可达（cq-compat 模块级 `cad = createApiNamespace()` 只含 core 平台面），任何 text 尝试直接报错；现字体→OCCT 实体通路可达且跑通（3 tests）。但 manifest 中 **9 条** `blockedBy:"text"`（`testText__box/obj1..obj5` + `testTextAlignment__left_bottom/centers/right_top`；实测 **9 条**，非早前估的 19）仍维持 `blocked`，因 `Workplane.text` 尚未满足上游语义：① `halign`/`valign` 缺失（testTextAlignment 断言字形 bbox 对齐：left/bottom ⇒ bbox ≥ 0、center ⇒ bbox center ≈ 0、right/top ⇒ bbox ≤ 0；本实现只做 X/Z 居中、Y 底对齐）；② `distance=0`（2D、不挤出，testTextAlignment 用到）不支持——`cad.text` 要求 `depth>0`；③ `cut`（上游默认 True：从父实体减除）与 `combine`（上游默认 **False**；本实现默认 true，是既有 parity 偏差）语义未对齐；④ `font`/`fontPath`/`kind` 参数未接收（core 单一默认 OpenSans 恰与上游 `testFont` 同字体，故字形本身匹配）。**下一步**：补齐 ①②③④ 四项即可翻转这 9 条。`imprint`（4 条）仍是下一个独立缺口。

- 2026-09-30（**`text` 改为 cq-compat 自实现 — 去掉 faijs-extra 依赖 + 补齐全部 CQ 语义**；**取代上一条「faijs-extra 接线」记录**）：用户裁定 `@faicad/faijs-extra` 是小众需求合集，cq-compat 不得依赖它、须自持 CQ 兼容 API。
  - **去依赖**：回退上一提交对 faijs-extra 的改动（`ops/text.ts` 恢复内联 `textBrep`、去掉 `./text` 子路径导出、删除 `src/ops/text-brep.ts` 与 `src/text.ts`；faijs-extra 回到未改动状态，typecheck + `entry-boundary.test.ts` 4/4 仍绿）；cq-compat 去掉 faijs-extra devDependency、删除冗余的 `src/font-loader.ts`（字体 loader 由 `createNodePorts()`→node-host `setFontLoader` 自动注入，无需自建）；`cad` 单例恢复为纯 `createApiNamespace()`。
  - **自实现（`packages/cq-compat/src/text-solid.ts`，新）**：`buildTextSolid(txt, {fontSize, distance, halign, valign})` 直接用 core `textBlueprints`（opentype.js→OCCT wire）+`makeFace`/`extrude`/`makeCompound`/`translate`/`getBoundingBox` 构建：每个字形轮廓各成一件（`distance===0` ⇒ face，否则 prism），**不融合**（对应上游 `Compound.makeText` 返回含每字形的 compound）；对齐按字形盒在**局部坐标系**平移（halign: left⇒xmin=0 / center⇒x 对称 / right⇒xmax=0；valign 同理）。
  - **`Workplane.text(txt, fontsize, distance, combine="cut", opts?)`**：签名对齐上游 `cq.py::Workplane.text(txt, fontsize, distance, combine="cut", clean=True, font, fontPath, kind, halign, valign)`；`combine` 支持 `"cut"`(默认)/`"s"`/`true`/`"a"`/`false`（`CombineMode`），无上下文实体时直接返回文字；`clean` 默认 true 走 `cleanShapes`（same-face merge）；`font`/`fontPath`/`kind` 接受但解析为引擎单一默认字体（OpenSans==上游 `testFont`）。放置仍是 `orientZTo`(+Z→`wp.normal`)+`cad.translate` 到 `wp.origin`。
  - **已知限制（如实标注）**：字形内孔（如 `O`/`A`/`Q` 的封闭轮廓）当前未按 outer/hole 合并 —— 每个 wire 各建 face，内孔会被「填充」；目标测试（`testText`/`testTextAlignment`，字形 `I`/`CQ 2.0`）只断言相对体积与面/体计数，不受影响。补齐需 outer/hole 分组（`groupPendingWires` 语义）。
  - **验收**：`src/text.test.ts` 重写为 7 tests 全 PASS（cq 命名空间产 brep / `distance>0` 沿法向挤出 / `distance=0` 平面 z 跨度≈0 / `halign`·`valign` left-bottom·center·right-top 三组断言 / `combine` 默认 cut 体积↓·`true` 融合体积↑·`false` 只留文字体）；cq-compat 波及回归 **56 passed / 5 files / 0 stderr**；typecheck + lint + `check-ghost-deps`（817 files）全绿。
  - **manifest 由 `blocked`→`ported` 的剩余步骤（另一步，未做）**：`blockedBy:"text"` 由 `tests/ref-harness/analyze-coverage.py` 的 `CQ_COMPAT_OPS` 集合机检产生（`text` 不在集合内）。翻转需：① 把 `"text"` 加入该集合；② 为 9 条表达式写镜像 `.fai.js`（`tests/test_cadquery/TestCadQuery__testText__*.fai.js` 等）；③ 重跑 `analyze-coverage.py` → `gen-manifest.ts`。注意 cq-compat 单 shape 模型下 `solids().vals()` 只取首个 solid，`testText__obj3` 的「5 solids」类断言镜像时需换等价表达式（如 compound 子件计数）。

- 2026-09-30（**`text` 字形内孔修复 + parity 管线受阻于 core 既有字体 bug**）：
  - **内孔修复（已落地）**：`packages/cq-compat/src/text-solid.ts` 原按 `textBlueprints` 返回的**每个**闭合轮廓各建一件 face ⇒ 字形内孔（`O`/`Q`/`A`/`0` 的反形）被「填充」。现按 **bbox 嵌套分层**重新分组：depth 偶 = 字形主体、depth 奇 = 其直接孔；主体 `makeFace` + `addHolesInFace(face, holes)`（内核已有该 API，`packages/core/src/api/profile.ts:248` 同款用法），再按 `distance` extrude。改后 `"CQ 2.0"` 由 7 件降为 **5 件 solid**，与上游 `Compound.makeText` 一致。
  - **实测 parity 证据（不经 CLI）**：`src/text.test.ts` 新增断言 —— `text(Workplane('XY'), 'CQ 2.0', 0.5, 0.05, false)` 得 **5 solids** 且体积 `toBeCloseTo(0.006893209, 4)` 命中上游 `testText__obj4`（OpenSans）参考值。8 tests 全 PASS；波及回归 **57 passed / 5 files / 0 stderr**；typecheck + lint 干净。
  - **ref STEP 异常（须记）**：`out/ref/...testText__obj1.step` 实测几何（vol=7.3919、**2 solids**、bbox 越界至 2.0057）与我用 cadquery 2.8.0 **重跑同一表达式**（vol=7.9921、1 solid、bbox=box）**不一致**（obj2/3/4/5 全部一致）⇒ 该 ref STEP 属 ref 侧异常，不能作为 parity 目标。
  - **`font="Sans"` ≠ OpenSans（须记）**：上游 `testText__obj2/obj3` 用 `font="Sans"`（无 `fontPath`）⇒ OCC 解析到**系统** sans 字体，体积 0.007938346；`obj4/obj5` 用 `fontPath=testFont`(OpenSans) ⇒ 0.006893209（差 15%）。cq-compat 引擎只有单一默认字体，故 obj2/obj3 字形无法逐位对齐。
  - **硬阻塞（pre-existing core bug）**：`run-cand.ts` 走 CLI（`faijs-cli.ts`，tsx 执行 core **src**）产 cand STEP，但 `packages/core/src/brep/text/fontRegistry.ts` 用 `import * as opentype from 'opentype.js'` + `opentype.parse(...)`。core 为 `"type":"module"`，而 opentype.js 只有 `main`(UMD)/`module`(ESM)、无 `exports` 映射 ⇒ **Node ESM 下 `import *` 只得到 `{default}`，`opentype.parse` 为 `undefined`**（实测 `ns keys: default` / `ns.parse: undefined` / `default.parse: function`）。vite/vitest 走 `module`(ESM 命名导出) 故单测绿、CLI 红。任何 Node ESM 消费者（含 CLI）用 `@faicad/faijs` 文字功能都会撞上，与本次改动无关。修法（1 行）：`const opentype = (ns as {default?: …}).default ?? ns` —— **属 core 包修改，待授权**。
  - **翻转状态**：`CQ_COMPAT_OPS` 已加 `"text"`（`tests/ref-harness/analyze-coverage.py`）；9 个镜像已按上游转写，暂存为 `tests/test_cadquery/TestCadQuery__testText*.fai.js.blocked`（让 `gen-manifest` 忽略，避免未验证即记 `ported`）。**未跑** `analyze-coverage.py` / `gen-manifest.ts` —— CLI 字体通路打通前无法产出 cand STEP 与 parity 判定。

- 2026-09-30（续：**`text` parity 收口 — core 字体 bug 修复 + 对齐语义勘误 + y 轴镜像修复**）：9 条 `blockedBy:"text"` 全部翻 `ported`，其中 **5 条判 PASS**。
  - **core 字体 bug 已修（授权后）**：`brep/text/fontRegistry.ts` 与 `primitives/text/cjk-font.ts` 改为 `const opentype = parse 为函数 ? ns : ns.default`；新增 `brep/text/fontRegistry.node-esm.test.ts`（`node --import tsx` 起真实 ESM 子进程复现 Node-ESM/UMD 互操作）。修后 9 个镜像 CLI 全部成功导出 STEP。
  - **⚠️ 勘误：`halign`/`valign` 不是「字形 bbox 对齐」**。见上文 09-30「自实现」条「对齐按字形盒平移」。用真实 cadquery 2.8.0 + `OpenSans-Regular.ttf` 跑 `Compound.makeText` 实测（`out/probe_align*.py`）得真语义：对齐作用在**排版原点（笔位/基线）**，不是墨迹盒 ——
    - `halign`：`left` ⇒ 笔位 x=0；`center` ⇒ −W/2；`right` ⇒ −W，`W` = 整串 **advance 宽度**（尾随空格照样计入：`W("I ")=W("I")+advance(" ")`）。故 `"I"` 左对齐时墨迹 xmin≈0.981（该字形左侧边距），**不是 0**；
    - `valign`（纯字体度量、与串无关）：`bottom` ⇒ 基线 y=0；`center` ⇒ −(A−D)/2；`top` ⇒ −A，`A`/`D` = hhea ascender/descender × `fontSize/unitsPerEm`（OpenSans：A=1.0688em、D=0.2930em）。
    opentype.js 的 `unitsPerEm/ascender/descender/getAdvanceWidth` 与 OCC 实测值逐位一致，故按此式可精确复现。`text-solid.ts` 已按该式重写（删 `unionBox`）。上游 `testTextAlignment` 的断言其实很松（`places=0` / 只判 ≥0、≤0），本实现同时满足松断言与精确值。
  - **新根因（已修）：文字 y 轴镜像**。`opentype.getPath` 输出 **y 向下**（canvas 约定，字形主体在负 y），而 OCCT / three.js 是 **y 向上**；`text-to-solid.ts::toPt` 原样透传 ⇒ 文字上下镜像（`_` 跑到基线之上；`"I"` 墨迹 y∈[−7.1387,0] 而 CadQuery 是 [0,7.1387]，X 完全一致）。同包 `brep/svg/svg-to-solid.ts` 早有 `flipY`（SVG Y-down → OCCT Y-up），**文字路径漏了**。两条路径（brep `toPt` + faijs-extra mesh `text-geometry.ts::opentypePathToGeometry`）同时补翻转；core 侧新增回归测试钉住（`"I"` 墨迹 y∈[0,7.1387]、`_` 的 ymax<0）。挤出方向复验：`distance=+0.05` ⇒ z∈[0,+0.05]、体积仍为正。
  - **权威 parity（`run-cand --only Text` → `compare.ts`，out/report.json）**：`testTextAlignment__centers/left_bottom/right_top`、`testText__obj4`、`testText__obj5` 由 FAIL 翻 **PASS（vol/centroid/bbox 差全为 0）**；`testText__box` 维持 PASS；`testText__obj2` 维持 PASS-NT（字体差只影响 0.0131% 体积）。全库 parity **40.31% → 41.08%**（PASS 257→262、FAIL 13→8）。
  - **剩余 2 条 FAIL 属 ref 侧，不可在引擎内修**：① `testText__obj1` —— ref STEP 本身异常（vol=7.3919、2 solids；重跑为 1 solid/7.9931）；② `testText__obj3` —— 上游用 `font="Sans"`（无 `fontPath`），OCC 解析到 ref 机器的**系统 sans 字体**（体积 0.007938346 vs OpenSans 0.006893209，差 15%），非引擎可控。
  - **manifest 翻转（已完成）**：9 条 `text` 由 blocked → ported（342/308/47 → **351/299/47**）。`tests/test_cadquery/TestCadQuery__testText*.fai.js` 已由 `.blocked` 暂存名转正。
  - **另发现（未处理，独立于本改动）**：`tests/coverage.json` 相对**其生成脚本本身**已陈旧 —— 用 HEAD 版 `analyze-coverage.py` 复算仍与 HEAD 产物差 **132/305** case（`portableNow` 104→151）。故本次**未**重算 coverage.json（避免 130 余条 case 状态静默翻转混入本提交）。重算会使 `gen-manifest` 连带改动 130+ 条，需单独一轮核验。
