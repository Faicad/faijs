# cq-compat 剩余 CadQuery 特性支持 —— 现状盘点与开发计划（2026-09-28）

日期：2026-09-28
状态：**方案（未实施）**
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

`add`、`addSubshape`、`remove`、`traverse`、`load`、`importStep`、`export`（`solve`/`toCompound`/`save`/`constrain` 已有）

现状：`buildAssembly` 返回 `CqAssembly` 接口对象（`packages/cq-compat-assembly/src/assembly.ts:378+`），已带 `solve()`/`toCompound()`；mini_lathe 已用 `asm.solve()` 验证过**对象方法调用在脚本面可用**。
⇒ 9-22 判定的"类式 API 无法在 `.fai.js` 表达"**需要修正**：真正的限制不是语法，而是"不可变语义 + 递归遍历"的实现成本。**Assembly 是单块最大缺口（52 条 blockedBy）**。

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

## 4. 分期开发计划

> 排序原则：**先解除阻断（回归 + 基线失真）→ 再做"低成本高条数"回收 → 再补 op → 再建类模型 → 最后收口内核与永久 block**。每个 Stage 独立可验收、可中断。

### Stage 0｜解除阻断：回归修复 + 真实 parity 基线（前置，必做）

- **目标**：把 cq-compat 从"21 红、parity 数字失真"恢复到可信基线，并让 CI 能真正拦住回归。
- **动作**：
  1. 修 `rotate_euler` 参数名：`src/workplane.ts:832`、`:3687`、`:4083` 的 `{ anglesDeg }` → `{ angles }`（core 现签名 `packages/core/src/api/transform.ts:227`）。**先确认是 cq-compat 侧未跟进改名，而非 core 侧 breaking**——查 `git log -p -- packages/core/src/api/transform.ts` 定位改名提交；若 core 侧改名未同步兼容层，则兼容层改；若 core 曾兼容 `anglesDeg` 后移除，需在 core 侧补断言测试防止再次静默移除。
  2. 补防回归单测（GOTCHA 标记）：断言 `rotate_euler` 只接受 `angles` 键，且 `orientZTo` 在任意法向上产出与 CQ 一致的孔位（覆盖 hole/cboreHole/cskHole/cutThruAll/cylinder 五条路径）。
  3. 重跑 `npm run test -w @faicad/cq-compat` → 154 全绿（含 stderr 零容忍）。
  4. 重跑 `npx tsx packages/cq-compat/tests/compare.ts`（先 `run-cand.ts` 全量再 compare），产出新的 `out/report.json` + `report.md`，**记录真实 PASS/FAIL/parity 水位**作为后续 Stage 的起点。
  5. **CI 预算修正**：`scripts/ci.ps1:87` 的 5 分钟预算 < 实测 351.9s（且 `npm run test` 含 build）。二选一：把 `@faicad/cq-compat` 单列更长预算（建议 900s），或把 cq-compat 测试分片（慢的 brep/parity smoke 单独一份）。否则 Stage 1+ 的回归仍会被看门狗吃掉。
- **验收**：单测 154 全绿；`out/report.md` 有新时间戳且 PASS 数 ≥ 修复前理论水位；CI 能在 5 分钟内跑完或已提预算；3 处 `anglesDeg` 归零。
- **风险**：若 core 侧近期还有其它参数改名（units 重构引入），可能不只 `rotate_euler` 一处——修复后必须**全量重跑**而非只跑失败用例。

### Stage 1｜低成本回收：stale 重扫 + ref 覆盖扩展

- **目标**：不写新 op，先回收"历史标记过期"的条目，并把 parity 分母补完整。
- **动作**：
  1. **stale 重扫**：对 `face`(13)、`workplaneFromTagged`(4)、`save`(4)、`twistExtrude`(3)、`wedge`(3) 五组逐条读上游用例 + 现导出面，判定：能镜像 → 写镜像；不能 → 用 `mark-blocked.ts` 改写**准确** blockedBy（不得沿用过期根因）。
  2. **ref 覆盖扩展**：上游 `out/cache/v2.8.0/tests/` 已缓存 `test_sketch.py`(36 用例)/`test_nurbs.py`(19)/`test_hull.py`(2)，`run-ref.py` 支持 `--modules`，python = `C:\Users\ylt\cadquery-env\Scripts\python.exe`（baseline 指定，本机存在）。跑 `python tests/ref-harness/run-ref.py --modules test_sketch,test_nurbs,test_hull`，产出新 ref STEP + 合并进 `out/ref/manifest.json`，再跑 `gen-manifest.ts` 重生成三态表（分母 697 → 预计 750+）。
  3. 重跑 `compare.ts` 记录扩展后的 parity（分母变大 → 百分比会先降，属正常，需在报告里注明"分母扩展"）。
- **验收**：stale 组 27 条全部有明确结论（镜像 or 准确 blockedBy）；`out/ref` 出现 `test_sketch*`/`test_nurbs*`/`test_hull*` STEP；manifest 重生成且条数与 ref 一致。
- **风险**：sketch/nurbs 用例大量依赖类模型与回调 → ref 能出但镜像率可能极低，**这是可接受结果**（先把分母做实，避免"分母缺口掩盖真实完成度"）。

### Stage 2｜高价值 op 补齐（内核已具备，缺封装）

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
- **验收**：上述每组至少一个镜像 PASS；manifest ported 342 → **≥ 385**；单测不回归；`compare` PASS 数提升。
- **风险**：`text` 的字体资源在浏览器/Node 宿主下可用性需实测（字体 loader 通道）；`shells` 依赖 shell 构造入口，内核未必有 → 需先探针。

### Stage 3｜Assembly 类式 API（单块最大缺口，52 条）

- **目标**：把 `CqAssembly` 从"构造即求解"扩成 CQ 的迭代式类式面，解锁 Assembly blocked 的大头。
- **动作**：
  1. `add(shape, name?, color?)` / `addSubshape(subshape, name?)` / `remove(name)`：不可变语义（返回新的 `CqAssembly`，不原地改），与 `.fai.js` 的 `let asm2 = asm.add(...)` 语句模型兼容；
  2. `traverse()`：递归遍历成员 + 子形状（产出 name/shape/parent 列表），用于镜像上游 `test_assembly` 的遍历类断言；
  3. `load(path)` / `importStep(path)`：封装 `cad.import_step`（平台 op 已落地），产出成员；
  4. `export(path, mode?)`：STEP/STL 写出（走 CLI 既有导出通道，浏览器面不含 `save`/`export` 的文件写入）；
  5. 保持 `solve()`/`toCompound()`/`save()` 语义不变（幂等求解、封装 core 求解器、**禁止消费方直调 core 求解器**——9-22 修订要求 3）；
  6. 镜像：从 107 条 blocked 中挑可表达用例（优先 `traverse`/`add`/`addSubshape`/`remove`/`importStep`），不可表达（pytest fixture、类继承形态）的用 `mark-blocked` 登记准确根因。
- **验收**：Assembly blocked 107 → **≤ 60**；新增镜像 PASS ≥ 20；assembly 包单测（现 21）≥ 30 且全绿；3d_editor 装配消费面不破坏（H3 纪律：改 API 须同步 `../3d_editor`）。
- **风险**：不可变语义 + 递归遍历在 `.fai.js` 语句模型下需验证（对象方法调用已验证可用，但"返回新对象再赋给新变量"的语句级确定性扫描是否放行需实测）。

### Stage 4｜Sketch 完整化（几何 + 模式 + 变换 + 约束）

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

### Stage 5｜Shape 类模型与选择器体系（评估后再全量立项）

- **目标**：评估并落地 CQ `Shape` 类模型的高价值子集，解锁 `face` 13 / `shells` 12 / `makeCompound` 8 / `remove` 5 / `replace` 4 / `addCavity` 3。
- **动作**：
  1. 先做**可行性评估文档**（1 份 analysis）：类模型在 `.fai.js` 的表达方式（工厂函数 + 对象方法链 vs 真正的类）、句柄生命周期、与 Workplane 层的互操作；
  2. 高价值子集：`Face.makePlane`（无限面，Assembly 约束缺它导致 8 条 `op:assembly-solve`）、`Face.makeSplineApprox`（已有 `splineFace` 可复用）、`Shape.shells/solids/compounds` 选择器、`Compound.makeCompound`(8)；
  3. `remove`/`replace` 需 `BRepTools_ReShape`，内核未暴露 → 归 D 层；内核 `defeature` 语义与 CQ `remove` 不同（9-23 已实测：返回 6 面实体 vs CQ 的 5 面开放壳），**不得拿 defeature 冒充 remove**；
  4. 选择器类体系（`Selector`/`TypeSelector`/`DirectionSelector`/`NearestToPointSelector`/`StringSyntaxSelector`）按镜像需求逐条加，不一次性全做。
- **验收**：`makeCompound` 8 条清零；`face`/`shells` 合计解锁 ≥ 10；评估文档给出 Shape 类模型全量化的工作量估算。
- **风险**：工作量最大（81 方法），务必先评估再立项，避免摊子铺开后无法收口。

### Stage 6｜内核缺口攻坚与永久 block 收口

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

### Stage 7｜收尾：门禁、文档、消费方同步

- 全量重跑 `gen-manifest.ts`；block 用例同步删除对应 `out/cand/*.step`（最高频坑）；
- `docs/ops-api-inventory.md` 重生成（新增 op 后 stale）+ doc-sync 12 项门禁；
- 守卫：`check-ghost-deps`（新增依赖）/ `check-workspaces-order` / lockstep 版本 / madge 无环；
- 3d_editor 消费面同步（H3）；`docs/plans/2026-09-19-npm-publish-plan.md` 发布清单同步；
- 若新增导出面，评估是否需要 Agent Note 记录设计裁决。

---

## 5. 验收指标（当前 → 目标）

| 指标 | 当前（2026-09-28 实测） | Stage 0 | +1 | +2 | +3 | +4 | +5 |
|---|---|---|---|---|---|---|---|
| cq-compat 单测 | **21 红 / 133 绿** | 154 绿 | 不回归 | 不回归 | ≥170 | ≥180 | 不回归 |
| manifest ported | 342 | 342 | ≥360 | ≥385 | ≥415 | ≥430 | ≥445 |
| manifest blocked | 308 | 308 | ≤290 | ≤265 | ≤235 | ≤220 | ≤205 |
| Assembly blocked | 107 | 107 | 107 | 107 | **≤60** | — | — |
| Workplane 覆盖率 | 56/92 (60.9%) | — | — | ≥70/92 | — | — | — |
| Sketch 覆盖率 | 19/51 (37.3%) | — | — | — | — | ≥40/51 | — |
| parity（重跑后基线） | 未知（9-23 记 45.08%） | 取得真值 | 记得分母扩展 | ≥基线+5pct | — | — | — |
| CI 能拦住 cq-compat 回归 | **否（预算不足）** | 是 | 是 | 是 | 是 | 是 | 是 |

> parity 不作发版门禁（9-22 Q3 拍板），仅作观测指标。

**每个 Stage 收尾 DoD**：
- [ ] 新增/改判后重跑 `gen-manifest.ts`；block 用例同步删对应 `out/cand/*.step`；
- [ ] `npm run test -w @faicad/cq-compat`（+ 涉改的 assembly/sketch 包）全绿、stderr 零容忍；
- [ ] `npm run typecheck` / `lint` 全绿（core 侧对 HEAD 基线取差，不新引入）；
- [ ] 新增 op 已补 `paramDims` 量纲 + 防回归单测；
- [ ] 结论写回本文件 §8 实施记录。

---

## 6. 纪律与红线（沿用 + 新增）

1. **fail-loud**：内核缺口 → 显式抛错 + `blocked` 登记，**禁止**启发式逼近或放宽容差（handover 红线 4）；
2. **量纲声明（新增，2026-09-28 units 系统引入）**：新增 op 必须在 arg-spec/`paramDims` 声明参数量纲（angle/length/…），否则 units 校验与 codegen 通道会红；
3. **镜像 = 唯一 ported 判据**：`gen-manifest` 只按镜像文件存在判定 ported，禁止手改 status 造假；
4. **防回归**：与预期不符的 API 用法必须落成 `GOTCHA:` 标注的测试（本次 `rotate_euler` 参数名即典型，Stage 0 动作 2）；
5. **消费方同步（H3）**：改 API 必须同步 `../3d_editor`；装配消费面禁止直调 core 求解器（9-22 修订要求 3）；
6. **依赖最小化**：`fai_cq_gears` 运行时零改动；LGPL 依赖（planegcs）只走独立包 + peer/optional，不进运行时依赖链；
7. **后台任务纪律**：长任务串行，跑 cq-compat 全量测试/compare 期间不叠加其它长任务。

---

## 7. 开放问题（需授权后动）

| 编号 | 问题 | 建议 |
|---|---|---|
| Q1 | `rotate_euler` 改名是 core 侧 breaking 未同步，还是 cq-compat 漏改？是否需在 core 侧保留旧键兼容？ | Stage 0 动作 1 用 `git log -p` 定性后再定；倾向**兼容层改 + core 加断言测试** |
| Q2 | CI 里 `@faicad/cq-compat` 预算 5 分钟不够（实测 351.9s + build） | 提预算到 900s，或拆分测试文件；需拍板 |
| Q3 | `cq-compat-sketch` 引入 `@faicad/faijs-sketch`（planegcs，LGPL）的形态 | peerDependencies + optional import；需法务口径确认 |
| Q4 | Assembly 类式 API 的不可变语义在 `.fai.js` 语句模型下是否放行 | Stage 3 先做 1 个探针用例验证，再铺开 |
| Q5 | Shape 类模型（81 方法）是否全量立项 | 先 Stage 5 评估文档，再决定；不建议一次性全做 |
| Q6 | `text` 的字体资源在 Node/浏览器宿主下的一致性 | Stage 2 实测后决定镜像范围，2D 定位测量类可判 skipped |

---

## 8. 实施记录

（每个 Stage 收尾追加；本文件创建时为空。）

- 2026-09-28：完成现状盘点（§1–§3 数据均为当日实测）与计划编制（§4–§7）。**未实施任何代码改动**。
