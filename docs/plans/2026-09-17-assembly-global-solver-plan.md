# 纯 TS global 装配求解器 — 开发计划（执行版）

日期：2026-09-17
状态：方案（未实施）
作者：按 faijs 现有设计推导，落地执行版
依赖设计依据：`docs/plans/2026-09-08-assembly-dual-solver.md`（下称「双求解器方案」，含 B1–B10 源码标定与 裁定 1–6）
范围：`packages/core/src/api/assembly/solvers/`（新增模块）、`api/assembly/solve.ts`、`api/compound.ts`、`packages/cq-compat/src/assembly.ts`、`packages/cq-compat/src/assembly-compare.ts`、`packages/cq-compat/tests/ref-harness/`

> **与双求解器方案的关系**：本计划不重述其论证，直接承接其 裁定 1–6 与代价表，补齐它在 2026-09-08 之后暴露的落地缺口（约束种类覆盖不全、无端到端单测、比对器成员配对阻断），并给出**当前代码库的真实行号与精确改动点**。双求解器方案是设计依据，本计划是执行清单。

---

## 0. 当前状态基线（2026-09-17 实测）

| 项 | 状态 | 证据 |
|---|---|---|
| cq-compat 约束翻译层 | 已实现（仅 Plane/Axis） | `packages/cq-compat/src/assembly.ts:74` `type: 'Plane' | 'Axis'` |
| faijs 侧约束类型面 | 齐全 | `api/assembly/types.ts:52-125`：mate/align/coincident/concentric/distance/angle/parallel/perpendicular/fixed |
| `cad.assembly` 求解器选项 | **不存在** `solver` 字段 | `grep 'solver\?:' packages/core/src/api/` → 0 命中 |
| 实际求解器 | 仅 vendored brepjs 链式 `solveConstraints` | `solve.ts:92` 无分支；`compound.ts:109` 直调 |
| `global` 求解器 | **未实现** | `api/assembly/solvers/` 目录不存在；git 无 `global-solver` 提交 |
| 比对器成员配对 | **阻断**（`matchNames` 默认 true，CQ 名 `SOLID` vs faijs `shape_x`） | `assembly-compare.ts:30-31,164-165` |
| 装配端到端单测 | **零引用** | `grep buildAssembly packages/cq-compat/src/*.test.ts` → 0 |
| 已知位姿偏差 | mini_lathe 6–19mm | 双求解器方案 §1.2 |

**结论**：装配"外形"已接（翻译+chain 求解可出装配体），"求解语义"未接（global 缺位、结果与 CQ 不等价、仅支持 Plane/Axis）。本计划目标即补齐语义层。

---

## 1. 目标与非目标

### 目标
1. 实现纯 TS 的 global 求解器，复刻 CQ `occ_impl/solver.py`（CasADi `Opti` + IPOPT）的**语义**（全局 NLP、模长参数化旋转、9 类代价、Axis 缺省反平行、Plane=Axis(π)+Point(0)、包围盒对角长缩放），**不引入 CasADi/IPOPT/WASM**。
2. 在 mini_lathe 装配上，global 求解出的每成员位姿与 CQ 2.8.0 参考收敛到公差内（平移 ≤1e-3 mm、旋转 ≤1e-4 rad，最终以 P0 实测定标）。
3. 两种求解器（chain / global）共用现有 `normalize → lower → solve` 管线；`global` 为新增模块，不进 vendored。
4. 补齐 CQ 公共约束种类到 cq-compat 翻译层（当前仅 Plane/Axis）。
5. 给装配适配层加端到端单测，防止 chain→global 切换静默回归。

### 非目标（沿用双求解器方案 §3）
- 不引入 CasADi/IPOPT 或任何原生/WASM 依赖。
- 不改 chain 风格的现有行为与测试。
- 不做约束图奇异性/冗余诊断（仅以 `warnings` 透明化残差）。
- 不动 vendored `brepjs/solverAdapter.ts`（chain 继续原地复用）。

---

## 2. 核心技术裁定（承双求解器方案，附落地口径）

- **裁定 1 — 初值 T0=R0=0**：faijs `Shape` 不携带 placement（`solve.ts:68-72` 的 `members` 仅入 `memberMap` 供 TopoRef 解析，不参与位姿）。故 global 初值恒 `ΔT=0, ΔR=(1e-2,1e-2,1e-2)`（CQ `solver.py:619-620`）。**关键推论**：solve 开始时所有成员 pose 为 identity → world 系 == 本地系，故 lower 产物（ref 侧经 `transformEntity` 转世界）的 marker 在起始点即等于本地系 marker，可直接作为 local-frame marker 使用（见 §4.3 落地）。
- **裁定 2 — 坐标系统一**：global 对**每个成员**施加 `(T0+ΔT, R0+ΔR)`，ref 与 dep 两侧 marker 必须同域（本地系）。因裁定 1 的 identity 起始不变式，直接用 lower 产出的 marker（起始即本地系）即可，无需回变换；此不变式写入 `global-solver.ts` 顶部注释，并加一条断言守卫（若未来成员带初始 placement 则失效并抛错提示）。
- **裁定 3 — 残差取 CQ 代价的「平方前内层量」**（非对代价开方），映射表见 §4.3。
- **裁定 4 — 线性求解自实现**：在 `solvers/` 下自写 `solveLinearSystem`（Cholesky 优先、退化回落带部分主元 Gauss-Jordan），规模 ≤30 阶对称正定；不 import vendored `ikFns.ts:solveLinear`（模块私有、只读约定）。
- **裁定 5 — pivot 恒为 [0,0,0]**：global 旋转是 `Rotate(v,R)+T`（绕世界原点先转后平移），无 pivot 概念；`poseToAssemblyTransform(pose, [0,0,0], index)`（`solve.ts:107-108` 改为按 solver 分支传 pivot）。
- **裁定 6 — 锚定用 CQ 策略（assembly.py:455-490）**：① `name == self.name` 或 `Fixed` 锁定；② 无锁定时先收集 unary_objects，再取 binary_objects 中第一个不在 unary 里的；③ 仍无 → 锁实体 0；④ 锁定成员变量冻结（非设初值）。

---

## 3. 模块布局

```
packages/core/src/api/assembly/
├── solve.ts                 # 入口；按 opts.solver 分派（新增 SolveOptions.solver）
├── solvers/
│   ├── types.ts             # SolveOptions、CostSpec、GlobalSolverPose、Residuals
│   ├── global-solver.ts      # 核心：变量化 + 代价族 + LM + 锚定 + 诊断
│   ├── linalg.ts             # 自实现 Cholesky / Gauss-Jordan 线性求解
│   ├── global-solver.test.ts # 单元（§6.1）
│   └── pose-from-delta.ts    # ΔT/ΔR → SolverPose（模长参数化四元数）
├── solve.test.ts            # chain 回归（不动）
└── ...
```

---

## 4. 方案设计（执行细化）

### 4.1 分派入口（`solve.ts`）

- 新增 `SolveOptions { solver?: 'chain' | 'global' }`（默认 `'chain'`，向后零兼容）。
- `solveAssembly(members, memberNames, constraints, opts?)` 与 `solveAssemblyAndKinematics(..., opts?)` 增加 `opts` 末参；旧签名不动（重载或可选参）。
- 在 `solve.ts:92` 处：`if (opts?.solver === 'global') result = solveGlobal(...)` else `result = solveConstraints(...)`。
- pivot 分支（§4 裁定 5）：chain 沿用 `depOrigins.get(node)`，global 传 `[0,0,0]`。

### 4.2 接线（`compound.ts`）

| 位置 | 改动 |
|---|---|
| `compound.ts:37` `AssemblyParams` | 增 `solver?: 'chain' \| 'global'` |
| `compound.ts:81` `AssemblyBehavior` | 增 `solver?: 'chain' \| 'global'` |
| `compound.ts:109` `solveTransforms` | 透传 `behavior.solver` 到 `solveAssemblyAndKinematics` 第 6 参 |
| `compound.ts:210` `solve: () => solveTransforms(members, behavior)` | 闭包已含 behavior，无需改 |
| `compound.ts:212` 直调 | 同透传 `behavior.solver` |

### 4.3 global-solver.ts 核心

**输入**：`memberNames`、`constraints: AssemblyConstraint[]`、`env: EntityResolutionEnv`（复用 `solve.ts:81` 构造的 env，含 kernel + memberOf）。

**marker 提取**：对每个约束用 `entities.ts` 的 `resolveFaceGeometryOfRef` / `resolveSolverEntity`（lower.ts:17 已 import）在**本地系**解析两侧 marker。产出 CQ 语义所需元组：
- plane → `{center, normal}`
- axis → `{origin, direction}`
- point → `{origin}`

> 不复用 `lowerStructuralConstraint` 的 concentric 轴编码（那是 brepjs chain 的 hack）；global 直接吃原始 CQ 语义。

**变量化**（裁定 1、B2/B3）：每个自由成员 6 变量 `ΔT=[tx,ty,tz]`、`ΔR=[a,b,c]`；旋转用 CQ 模长参数化（`solver.py:309-316`）：`m=a²+b²+c²`，四元数 `(2a/(m+1),2b/(m+1),2c/(m+1),(1−m)/(m+1))`，`Rotate(v,R)=2⟨u,v⟩u+(s²−⟨u,u⟩)v+2s(u×v)`；`ΔR` 初值 `(1e-2,1e-2,1e-2)`，`ΔT` 初值 0；锁定成员无变量。

**代价→残差映射（裁定 3，平方前内层量）**：

| faijs 约束 | entity 对 | global 残差分量（CQ 语义） |
|---|---|---|
| `mate` | plane-plane | `axis_cost(nA,nB,π)` + `point_cost(cA,cB,0)`（= CQ `Plane`，B8） |
| `align` | plane-plane | `axis_cost(nA,nB,0)` + `point_cost(cA,cB,0)` |
| `coincident` | point-point | `point_cost(0)` |
| `coincident` | plane-point / point-plane | `point_in_plane_cost(0)` |
| `coincident` | axis-axis / axis-point / point-axis | `axis_cost(0)` + `point_on_line_cost(0)`（= CQ 同心） |
| `concentric` | axis-axis | 同 `coincident` axis-axis |
| `distance` | point-point | `point_cost(val)`（`(Σr²−(val/scale)²)²` 的平方前量） |
| `distance` | 其余 | 按 `point_in_plane`/`point_on_line` 带 val 形式（`solver.py:434-435,470-474`） |
| `angle` | plane-plane | `axis_cost(val=angleRad)`（B7 第三分支） |
| `parallel` | plane-plane | `angle` 0 |
| `perpendicular` | plane-plane | `angle` 90° |
| `fixed` | — | 锁定变量，无残差 |

代价公式（取自 `solver.py:331-559, B6`）：
- `point_cost(val)`: `dummy=(m1'−m2')/scale` → 残差 `dummy`（3 维）；val≠0 用 `[Σdummy²−(val/scale)²]`（1 维）。
- `axis_cost(val)`: val=0 → `d1−d2`（3 维）；val=π → `d1+d2`（3 维）；其他 → `[dot(d1,d2)−cos(val)]`（1 维）。其中 `d1,d2` 为两侧**单位方向**在各自成员变换后的向量。
- `point_in_plane_cost`: 点 to 平面有符号距离（1 维）。
- `point_on_line_cost`: 点 to 轴线有符号距离（1 维）。
- `scale = 装配包围盒对角线长度`（B5），点类代价除以 scale，方向类不缩放，`DIR_SCALING=1e2`（B6）。

**数值求解**（替代 IPOPT，无依赖）：
- Levenberg-Marquardt：法方程 `(JᵀJ+λI)δ=−Jᵀr`，数值雅可比（中心差分）。
- 差分步长：`ΔT` 用 `1e-7·scale`（有量纲），`ΔR` 用 `1e-7` **绝对值**（模长参数化无量纲）。
- λ 自适应：成功步 λ/=3，失败步 λ*=2，初值 λ=1e-3。
- 终止：`|Δobj| < 1e-12·max(1,|obj|)` 或 `‖δ‖∞ < 1e-10` 或 `iter ≥ 2000`（对齐 B10）。
- 确定性：固定初值 + 确定性迭代 → 同输入必同输出（验收 §6.4）。

**输出**：`Map<member, SolverPose>` → 现有 `poseToAssemblyTransform`（裁定 5 pivot=[0,0,0]）→ `AssemblyTransform[]`。恒等位姿成员不输出。

**诊断语义（裁定，写入 §6.4 / `docs/api-contract.md` 装配条目）**：

| 字段 | global 定义 |
|---|---|
| `converged` | LM 终止即 `true`（不因残差大置 false，否则 CQ 折中解被 `solve.ts:94` 抛错） |
| `dof` | 恒 `0`（数值求解不做 DOF 分析） |
| `unsupported` | 仅约束类型无法映射为代价时 |
| `residuals` | 新增：逐约束最终残差 |
| `warnings` | 残差 > 1e-6·scale 的约束逐条写入（折中可见，满足「绝不静默」） |

> global 唯一抛错路径 = 约束类型不支持；其余以 warnings 体现，不抛错。

### 4.4 cq-compat 约束种类补全（`assembly.ts`）

当前 `constraint()` 仅 Plane/Axis。扩展为支持 CQ 公共种类并映射到 faijs 类型面（`types.ts:52-125`）：

| CQ `constrain` kind | faijs `AssemblyConstraint` |
|---|---|
| `Plane` | `mate`（faceRef→plane） |
| `Axis` | `align`（faceRef→plane，axis 编码） |
| `Point` | `coincident`（EntityRef.point） |
| `Cylinder` | `concentric` + `coincident`(point_on_line)（拆两条） |
| `Distance` | `distance`（value=val） |
| `Fixed` | `fixed` |
| `Revolute` | `fixed` 轴（`FixedAxis`，降级为 fixed 占位，后续补旋转 DOF） |

新增 `constraintEx(partA, selA, shapeA, partB, selB, shapeB, kind, param?)` 统一分发；旧 `constraint()` 保留为 Plane/Axis 便捷封装（向后兼容现有调用方）。`faceRef` 已支持 `part/face{surfaceType,center,normal}`（`assembly.ts:46-53`）；新增 `pointRef`/`axisRef` 解析点/边引用（复用 `resolveFaceSelector` 同族 API）。

### 4.5 比对器成员配对（阻断项 P0b，`assembly-compare.ts`）

`compareAssemblyFiles` 增加 `pairing?: 'names' | 'xcmf-labels' | 'order-centroid'`（默认 `'names'` 保持现状）：
- `names`：现有逻辑（精确名匹配），用于 faijs 两侧比对。
- `xcmf-labels`：导出时写 XCAF 标签（PRODUCT name）并读取，使 CQ 侧 `SOLID` 与 faijs 侧同名可配对（候选②）。
- `order-centroid`：按 leaf 数相等 + 质心就近配对（候选①），用于 CQ 参考 vs faijs 候选的跨命名比对（§6.3）。

P0b 与 P1 可**串行先后**，但必须在 P3 验收前完成（双求解器方案 §5.3 前置）。

---

## 5. 任务分解（P0 → P3，串行）

> 用户铁律：所有后台/长任务**串行**，cq-compat 与 `mini_lathe/scripts/verify-all.ts` 基线改动尤其不能并行。

| 阶段 | 内容 | 产出 / 验收 |
|---|---|---|
| **P0 基线定标** | `packages/cq-compat/tests/ref-harness/run-ref-assembly.py`：用 cadquery-env 构造 mini_lathe 装配 + `constrain` + `solve()`，导出每成员 `Location.toTuple()` 为 JSON；同步记录 faijs chain 现状位姿与 diff（6–19mm 精确定标） | 基线 JSON + 公差目标（平移/旋转）写入 `ref-harness/baseline.json` |
| **P0b 成员配对** | `assembly-compare.ts` 加 `pairing` 选项 + 实现 `order-centroid`（跨命名比对用） | 比对器可 pair CQ `SOLID` ↔ faijs `shape_x`，§6.3 可跑 |
| **P1 核心求解器** | `solvers/types.ts` + `solvers/linalg.ts` + `solvers/global-solver.ts` + `solvers/pose-from-delta.ts`；`solve.ts` 分派；`compound.ts` 两处透传 | 模块 + `global-solver.test.ts` 全绿（§6.1） |
| **P1.5 约束补全** | `assembly.ts` 加 `constraintEx` + `pointRef`/`axisRef`，覆盖 Plane/Axis/Point/Cylinder/Distance/Fixed/Revolute | 翻译层单测覆盖 7 类 |
| **P2 接线** | `AssemblyParams.solver`/`AssemblyBehavior.solver` 全链路透传；`cq-compat/src/assembly.ts` 的 `buildAssembly` **默认 `global`**（cq-compat = CQ 兼容） | API 生效；语义对拍 §6.2 通过 |
| **P3 端到端与回归** | mini_lathe 装配切 global 重导出；`verify-all.ts` 基线/断言同步更新（leaf 数断言 `verify-all.ts:107` 仍成立，SLIDE_TOP_EXPECTED 体积/zmax 必要时更新）；chain 回归 `solve.test.ts`/`kinematics.test.ts`/`preview.test.ts` + cq-compat 现有测试全绿 | 验收清单全绿，mini_lathe 位姿进公差 |

---

## 6. 测试与验收

### 6.1 单元（`global-solver.test.ts`，P1）
1. **代价函数数值对拍**：每 cost 分支（point/axis 三分支/point_in_plane/point_on_line）与 Python 参考值对拍（venv 跑 `solver.py` 对应函数或 numpy 复算同式），固定 marker/位姿 ≥8 组；
2. **模长参数化往返**：随机 R → `Rotate` 公式与四元数旋转一致（误差 <1e-12）；
3. **锚定**：fixed 成员位姿不变；无 fixed 时 B4 回退次序正确；
4. **退化**：平行轴、重合点、单成员装配；
5. **确定性**：同输入连跑 5 次逐位一致；
6. **残差构造（裁定 3 回归锁）**：每 cost 分支断言残差与 CQ 内层量逐位一致；专门覆盖 `point_cost(val≠0)` 在 `Σdummy²≈(val/scale)²` 邻域的符号连续性（误用开方必炸）；
7. **pivot（裁定 5 回归锁）**：同约束 chain/global 各解一次，断言 global 旋转中心是原点；
8. **锚定四条（裁定 6）**：含 `name==self.name` 与 unary 排除用例。

### 6.2 语义对拍（扩展 parity harness，P2）
- `ref-harness/` 新增装配导出模式：Python 侧构造 `cq.Assembly`+`constrain`+`solve()`，导出每成员 `Location` 为 JSON；
- JS 侧同约束跑 `global`，比对每成员平移/旋转；
- 用例：plane-plane 贴合、axis 反平行（val 缺省）、axis 平行（val=0）、angle 带值、distance、复合冲突对（mini_lathe 侧面 Axis × Plane）、fixed + 链式三件套。

### 6.3 端到端（mini_lathe，P3）
- global 装配导出 vs `export-cadquery-ref.py` 参考 STEP：每成员位姿差进公差（P0 定标），体积/质心比对沿用 compare 管线（`pairing:'order-centroid'`）；
- chain 回归：`solve.test.ts`、`kinematics.test.ts`、`preview.test.ts`、cq-compat 现有测试全绿，输出与今日一致。

### 6.4 性能（P3）
- 实测 mini_lathe 一次求解耗时写入 `baseline.json`（6 成员→5×6=30 变量、9 约束、残差维 ~15）；
- 验收：`verify-all.ts` 全流程不因 global 引入可感知卡顿（<100ms）；**不把估算当验收**。

---

## 7. 风险与开放问题

1. **反平行语义波及面**：CQ `Axis` 缺省反平行（B7）会使 mini_lathe 侧面 Axis 约束在 global 下产生与 chain 不同的旋转分量——属语义对齐必然结果，P3 须重录基线。
2. **IPOPT vs LM 一致性**：凸性良好的小型装配两者收同点；冲突约束折中解不保证逐位一致，验收以 P0 定标公差为据，不追位级相等。
3. **identity 起始不变式**（裁定 1/2 前提）：若未来 faijs `Shape` 携带初始 placement，global 的 marker 同域假设失效 → `global-solver.ts` 顶部断言守卫须在此时改为显式回变换。
4. **成员配对未定**（阻断，P0b）：本计划选 `order-centroid` 作为跨命名比对默认，若精度不足再上 `xcmf-labels`；此为 P3 前置，必须在 P3 前落地。
5. **`global` 失败模式 ≠ chain**：chain 靠 `converged=false` 抛错，global 靠 warnings（§4.3）；若有调用方依赖"装配求解失败抛错"，global 下行为会变，须同步进 `docs/api-contract.md`。
6. **Revolute 降级**：P1.5 将 Revolute 暂降级为 `fixed` 占位（旋转 DOF 留待后续），mini_lathe 用例不含 Revolute，不影响 P3；若后续需真实运动副，应走现有 `joints` 机制而非 global 求解器。

---

## 8. 执行顺序约束

1. P0（基线）→ P0b（配对）→ P1（求解器）→ P1.5（约束补全）→ P2（接线）→ P3（验收）**严格串行**。
2. 每阶段完成先跑自己写的测试，再跑可能受影响的测试，全绿后才进下一阶段；禁止靠跑 CI 找 bug。
3. cq-compat 与 `mini_lathe/scripts/verify-all.ts` 的基线改动不得并行（用户铁律）。
