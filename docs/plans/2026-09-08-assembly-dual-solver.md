# 装配求解器双风格方案：保留 chain 解析风格 + 新增 cq-global 全局最小二乘风格

日期：2026-09-08
状态：方案（未实施）— **已于 2026-09-08 经源码级评审修订，文中「裁定 1–6」为修订内容**

关联：

- `docs/plans/2026-09-08-cq-compat-cadquery-parity.md`（零件级 STEP 对等，原方案）
- `docs/plans/2026-09-08-cq-compat-parity-phase2.md`（零件级剩余工作，**本方案 P0 的前置**，见 §6 排期约束）
- `docs/plans/2026-09-06-faijs-assembly-constraints-brepjs.md`（约束求解 P0-P3）

> **与本轮修订的关系**：2026-09-08 对本方案做了源码级复核（faijs 侧
> `solverAdapter.ts` / `solve.ts` / `lower.ts` / `compound.ts` / `ikFns.ts` /
> cq-compat `assembly.ts` / `assembly-compare.ts`，CadQuery 侧 venv 内
> `occ_impl/solver.py` / `assembly.py`）。结论：主体论断（A1–A7、B1–B10）
> 与 §1.1 的方向更正**均成立**，但存在 2 个阻断级错漏与 4 处技术错漏，
> 已就地修订为「裁定 1–6」并补齐 §4.6 诊断语义、P0b 阶段、§6 排期约束。
> 唯一仍需拍板的是**成员配对策略**（§5.3 前置 / P0b）。

---

## 1. 背景与问题

mini_lathe 装配（6 成员：axk/bp/mb/mt/tp/slide_top）在 faijs 管线与 CadQuery 2.8.0
参考导出之间存在 **6–19mm 的位姿差**（slide_top/slide_mid 最明显）。零件级几何已通过
STEP 对等验证（5/7 EQUIVALENT），差异全部来自**装配求解阶段**。

### 1.1 重要更正：此前诊断的方向说反了

此前会话中记录的根因描述为「faijs 是全局最小二乘、CadQuery 是顺序 DOF 消除」。
本次通读双方源码后确认**两者恰好相反**，以此文档为准：

- **faijs**（`packages/core/src/vendored/brepjs/kernel/solverAdapter.ts`）是
  **顺序解析求解**：拓扑轮次调度，每个成员只被定位一次（先到先得）。
- **CadQuery**（`cadquery/occ_impl/solver.py`，随 venv 安装于
  `C:\Users\ylt\cadquery-env\Lib\site-packages\`）是**全局非线性最小二乘**
  （CasADi `Opti` + IPOPT，`solver.py:661-731`）：所有约束的代价函数求和进同一
  目标，一次性对全体成员的位姿增量做优化。**冲突约束不报错，而是按最小二乘折中**。

### 1.2 mini_lathe 的冲突约束实例（`C:\git\CADQ\mini_lathe\assemb.py:56-68`）

```
bp@faces@>Z[-2] ↔ mb@faces@<Z   Plane     （贴合，正常）
bp@faces@<X     ↔ mb@faces@<X   Axis      （侧面轴向对齐）
...
```

CadQuery 中 `Axis` 约束**缺省参数 val=None → val=π，代价是 `sumsqr(d1+d2)`，
即两轴反平行**（`solver.py:378, 390-393`）。`<X` 面的外法向都是 (-1,0,0)，
反平行要求其中一个面法向翻成 +X——与 Plane 约束要求的姿态矛盾。CadQuery 的
全局求解器把这对冲突约束做最小二乘折中；faijs 的 chain 求解器则由「哪条约束先
处理到」决定胜负（`solverAdapter.ts:362` 后到的直接跳过）。两者结果必然不同。

---

## 2. 双方求解器现状（源码级）

### 2.1 faijs chain 求解器（保留为风格 A）

位置：`packages/core/src/vendored/brepjs/kernel/solverAdapter.ts`，
入口 `solveConstraints(nodes, constraints): SolverResult`（:307）。
调用链：`cad.assembly({constraints})`（`packages/core/src/api/compound.ts:188`）
→ `AssemblyBehavior.solve()` → `solveTransforms`（compound.ts:108）
→ `solveAssemblyAndKinematics`（`packages/core/src/api/assembly/solve.ts:132`）
→ `solveConstraints`。

关键行为（逐条源码依据）：

| # | 行为 | 位置 |
|---|------|------|
| A1 | 顺序解析：拓扑轮次，`entityA`=参考、`entityB`=依赖，参考已放置才解 | solverAdapter.ts:351-372 |
| A2 | **每成员只定位一次**，后到的 mate 视为冗余直接跳过 | :362 |
| A3 | plane-plane 贴合只平移、**不旋转依赖件**（rotation 恒 IDENTITY） | :102-106 |
| A4 | concentric 用 `quatFromTo` 把依赖轴转到**平行**参考轴 | :114-120 |
| A5 | angle 只给旋转，**位置清零** | :127-136 |
| A6 | 锚定 = 从未被定位的链根 + 显式 `fixed` | :324-328 |
| A7 | 不收敛/entity 类型不匹配 → `unsupported` 明细 + 抛错（不静默） | :375-383；solve.ts:93-98 |

优点：零迭代、确定性强、O(n) 快。局限：不支持同成员多约束叠加（A2）、
部分位姿硬编码（A3/A4/A5）、无冲突折中语义。

### 2.2 CadQuery 全局求解器（风格 B 的语义基准）

位置：`cadquery/occ_impl/solver.py`（731 行）+ `cadquery/assembly.py:450-523`。

关键机制（逐条源码依据）：

| # | 机制 | 位置 |
|---|------|------|
| B1 | 全局 NLP：`opti.minimize(Σ cost + 1e-16 * Σ penalty)`，IPOPT 求解 | solver.py:671-721 |
| B2 | 变量：每实体 ΔT∈R³ + ΔR∈R³（**模长参数化**，非直接四元数）；`Quaternion(R)` 把 R 映为 (s,u) 再做旋转 | :596-601, :309-328 |
| B3 | 初值：ΔT=0，ΔR=(1e-2,1e-2,1e-2)；penalty 把解锚在**初始位姿附近** | :619-620, :674-675 |
| B4 | 锁定：`Fixed` 成员；否则第一条二元约束的 objects[0]；否则实体 0 | assembly.py:459-490 |
| B5 | 缩放：`scale = 装配包围盒对角线长度`，点类代价除以 scale | assembly.py:512；solver.py:561-570, 695 |
| B6 | 代价族：`point/axis/point_in_plane/point_on_line/fixed_*`；`DIR_SCALING=1e2` | :331-559, :96 |
| B7 | `Axis` 缺省 **val=π（反平行，d1+d2）**；val=0 平行（d1-d2）；否则 dot−cos(val) | :378-397 |
| B8 | `Plane` 是复合约束 = `Axis(normalA,normalB; π)` + `Point(centerA,centerB; 0)`，即**面贴合 = 法向反平行 + 中心重合** | :82-86, :266-270 |
| B9 | marker 提取：Face→`normalAt()`/`Center()`；圆边→`normal()`；直线边→`tangentAt()` | :193-242 |
| B10 | 收敛：IPOPT `tol=1e-14`、`acceptable_obj_change_tol=1e-12`、MAXITER 由 IPOPT 默认 | :704-720 |

**本质区别**：CadQuery 是「精修」求解器——零件按建模时的绝对坐标入装，
`solve()` 从初始位姿出发求小增量 Δ(T,R)；faijs chain 是「绝对安放」求解器——
依赖件从原点出发被 mate 摆到位。mini_lathe 的零件全部按绝对坐标建模，
因此 CadQuery 解只做轻微修正，faijs 则重新安放，叠加 2.1 的语义差异后位姿差 6–19mm。

---

## 3. 目标与非目标

### 目标

1. **保留两种求解器风格，可显式选择**：
   - 风格 `chain`：现有解析链式（§2.1），faijs 原生语义，默认值，向后零兼容风险；
   - 风格 `global`：CadQuery 兼容全局最小二乘（§2.2 语义的 JS 复刻）。
2. `global` 风格在 mini_lathe 装配上的位姿与 Python 参考收敛到公差内
   （平移 ≤1e-3 mm 量级、旋转 ≤1e-4 rad 量级；最终公差以 P0 实测定标）。
3. 两种风格共用现有 normalize → lower → solve 管线与诊断输出
   （`dof/converged/unsupported` + 非收敛抛错，绝不静默）。
4. `joints/kinematics` 合并路径（solve.ts:132-172）对两种风格透明。

### 非目标

- 不引入 CasADi/IPOPT 或任何原生依赖——`global` 用纯 TS 数值实现；
- 不改 `chain` 风格的任何现有行为与测试；
- 不做约束图奇异性检测/冗余约束诊断（列为后续）；
- 不动 vendored `brepjs` 的 `solveConstraints`（chain 风格继续原地复用，
  `global` 是 api 层新增模块，不进 vendored）。

---

## 4. 方案设计

### 4.1 API 与选择机制

```ts
// packages/core/src/api/compound.ts
export interface AssemblyParams extends GroupParams {
  // ...现有字段...
  /** 求解风格：'chain'（默认，解析链式）| 'global'（CadQuery 兼容全局最小二乘） */
  solver?: 'chain' | 'global'
}

// AssemblyBehavior 增加透传字段
export interface AssemblyBehavior {
  // ...
  solver?: 'chain' | 'global'
}

// packages/core/src/api/assembly/solve.ts —— 入口加 opts，旧签名不动
export function solveAssemblyAndKinematics(
  members, memberNames, constraints, joints = [], drive?, opts?: SolveOptions
)
export interface SolveOptions {
  /** 默认 'chain' */
  solver?: 'chain' | 'global'
}
```

- 脚本侧：`cad.assembly({ members, constraints, solver: 'global' })`；
- 库侧：`cq-compat/src/assembly.ts` 的 `buildAssembly`（`behavior.solve` 路径）
  **默认 `global`**（cq-compat 的定位就是 CadQuery 兼容），并允许调用方覆盖；
- faijs 原生 `cad.assembly` 不写 `solver` 时行为与今天完全一致（`chain`）。

**透传落点（源码实测，2026-09-08 复核）**：`packages/core/src/api/compound.ts` 里
**有两处**调用求解器，都必须带上 `solver`，否则同一装配会出现两种风格混用：

| 位置 | 现状 |
|---|---|
| `compound.ts:210` | `solve: () => solveTransforms(members, behavior)` —— behavior 已进闭包，加字段即可读到 |
| `compound.ts:212` | 直接调 `solveAssemblyAndKinematics(members, behavior.memberNames, behavior.constraints, ...)` |

即 `solveTransforms`（`compound.ts:108`）需要新增 `solver` 形参并透传给
`solveAssemblyAndKinematics` 的第 6 个 `opts` 参数。

### 4.2 模块布局

```
packages/core/src/api/assembly/
├── solve.ts                 # 现有入口；按 opts.solver 分派
├── solvers/
│   ├── types.ts             # SolveOptions、CostSpec、SolverPose 扩展
│   ├── global-solver.ts     # 风格 B 核心：变量化 + 代价函数 + LM 迭代
│   └── global-solver.test.ts
├── solve.test.ts            # chain 回归（不动）
└── ...
```

### 4.3 风格 B 核心设计（global-solver.ts）

#### 输入

复用现有降级产物：`lowerStructuralConstraint`（`packages/core/src/api/assembly/lower.ts`）
输出的 `SolverConstraint`（entityA/entityB 的 `{type: plane|axis|point, origin, normal/direction}`）。

**裁定 1 — 初值不是"成员 Shape 的世界变换"**（原表述不可实现，已更正）：
`solve.ts:71-77` 里 `members` 只被塞进 `memberMap` 供 TopoRef 解析，**不参与位姿**；
faijs 的 `Shape` 也不携带 placement。因此 `global` 的初值恒为
`T0 = 0, R0 = 0`——**成员按建模坐标入装**（与 CQ 的 `locs = [self.objects[n].loc]`、
通常亦为 identity 完全一致，见 `assembly.py:492`）。结论仍是「精修语义」，
但实现上不需要也无从"读取世界变换"，这一点必须写进 `global-solver.ts` 顶部注释。

**裁定 2 — 降级产物两侧坐标系不对称，必须先统一**（原方案未区分，实现必踩坑）：
`lower.ts:21` 注释明确：**ref 侧（entityA）的 origin 是"世界系"，
dep 侧（entityB）的 origin 是"本地系"**。chain 依赖这个不对称（dep 从原点出发），
但 `global` 对每个成员都要施加 `(T0+ΔT, R0+ΔR)`，两侧必须同域。
实现要求：先把 entityA 的 marker 逆变换回其所属成员的本地系，统一后再套变换——
否则 A 侧会被变换两次。

#### 变量化（对齐 B2/B3）

- 每个自由成员 6 变量：`ΔT = [tx,ty,tz]`，`ΔR = [a,b,c]`；
- 旋转用 CQ 的模长参数化（solver.py:309-316, 643-659，公式原样移植）：
  `m = a²+b²+c²`，四元数 `(2a/(m+1), 2b/(m+1), 2c/(m+1), (1−m)/(m+1))`；
  作用向量 `Rotate(v,R) = 2⟨u,v⟩u + (s²−⟨u,u⟩)v + 2s(u×v)`，其中 `(s,u)=Quaternion(R)`；
- `ΔR` 初值 `(1e-2, 1e-2, 1e-2)`、`ΔT` 初值 `0`（B3）；
- 锁定成员（B4 策略，见 §4.4）不设变量，位姿冻结为初值。

#### 代价函数（对齐 B6-B8）

把降级后的 `SolverConstraint` 映射为 CQ 语义的代价和（映射表是本方案的语义裁定）：

| faijs 约束（降级后） | entity 对 | global 代价组合 |
|---|---|---|
| `coincident` | plane-plane | `axis_cost(nA,nB, val=π)` + `point_cost(cA,cB, 0)`（= CQ `Plane` 复合，B8） |
| `coincident` | point-point | `point_cost(0)` |
| `coincident` | plane-point / point-plane | `point_in_plane_cost(0)` |
| `coincident` | axis-axis | `axis_cost(0)` + `point_on_line_cost(0)`（= CQ 语义的同心：轴平行 + 点在线上） |
| `coincident` | axis-point / point-axis | `point_on_line_cost(0)` |
| `concentric` | axis-axis | 同上 `axis_cost(0)` + `point_on_line_cost(0)` |
| `distance` | point-point | `point_cost(val)`（solver.py:356-359 的 `(Σr²−(val/scale)²)²` 形式） |
| `distance` | 其余对 | 按 `point_in_plane`/`point_on_line` 的带 val 形式（solver.py:434-435, 470-474） |
| `angle` | plane-plane | `axis_cost(val=angleRad)`（B7 第三分支 `dot−cos(val)`） |
| `fixed` | — | 锁定变量（B4），不产生代价 |

实现注意：

- `axis_cost` 的 val=0/π 分支与非 0 分支公式不同（B7），必须三分支原样实现；
- 点类代价除以 `scale`，`scale = 装配包围盒对角线长`（B5）；方向类不缩放；
- 代价函数输入的 marker（法向/中心/方向）**随成员位姿实时变换**
  （对应 CQ 的 `Transform(m, T0+T, R0+R)`，solver.py:326-328）——
  faijs 侧即用 `ΔT/ΔR` 变换 lower 产物的 origin/normal/direction；
  **两侧 marker 必须先按「裁定 2」统一到本地系**，再施加变换。

#### 数值求解（替代 IPOPT 的无依赖实现）

- **Levenberg-Marquardt**：法方程 `(JᵀJ + λI)δ = −Jᵀr`，数值雅可比（中心差分）。

**裁定 3 — 残差向量直接取 CQ 代价的「内层量」，不是对代价开方**（原式已更正）。
CQ 的每个 cost 本身就是若干内层量的平方和，LM 需要的是平方前的量：

| CQ 代价（solver.py） | 内层量 → 残差分量 | 维数 |
|---|---|---|
| `point_cost(val=0)` = `sumsqr(dummy)`，dummy=(m1′−m2′)/scale | `dummy` | 3 |
| `point_cost(val≠0)` = `(sumsqr(dummy) − (val/scale)²)²` | `[sumsqr(dummy) − (val/scale)²]` | 1 |
| `axis_cost(0)` = `sumsqr(d1−d2)` | `d1−d2` | 3 |
| `axis_cost(π)` = `sumsqr(d1+d2)` | `d1+d2` | 3 |
| `axis_cost(其他)` = `(dot(d1,d2) − cos(val))²` | `[dot(d1,d2) − cos(val)]` | 1 |
| `point_in_plane_cost` / `point_on_line_cost` | 同上规则：按 solver.py:400-497 原文取平方前的量 | 1 或 3 |

> 原写"各约束代价的平方根分支"是错的：对 `point_cost(val≠0)` 会得到
> `|sumsqr(dummy) − (val/scale)²|`，在 `sumsqr(dummy) == (val/scale)²` 处不可微，
> 数值雅可比在该点必抖。

- **差分步长分两档**：`ΔT` 用 `1e-7·scale`（有量纲），`ΔR` 用 `1e-7` **绝对值**
  （模长参数化是**无量纲**的，初值量级 1e-2，再乘 scale 会失真）；

**裁定 4 — 线性求解不复用 vendored `solveLinear`**（原方案不可行，已更正）。
实测 `packages/core/src/vendored/brepjs/operations/ikFns.ts:136` 的
`solveLinear(A, b, n)` 是 **模块私有、无 `export`**——"import 复用且不改 vendored"
自相矛盾（要 import 就必须先给它加 export，即改 vendored）。
裁定：在 `api/assembly/solvers/` 下**自实现** `solveLinearSystem`，
规模极小（≤30 阶对称正定），优先 Cholesky（比 Gauss-Jordan 更稳且快），
退化时回落 Gauss-Jordan 带部分主元。vendored 只读约定保持不变。
- 终止：`|Δobj| < 1e-12·max(1,|obj|)`（对齐 B10 的 acceptable_obj_change_tol）
  或 `‖δ‖∞ < 1e-10` 或 `iter ≥ 2000`（对齐 MAXITER）；
- λ 自适应：成功步 λ/=3，失败步 λ*=2（标准 LM），初值 λ=1e-3；
- **确定性**：固定初值 + 确定性迭代 → 同输入必同输出（验收项 §6.4）；
- 收敛后仍把最终残差按约束逐条回填诊断：`unsupported` 保留给类型不支持，
  新增 `residuals: Record<constraintIndex, number>`，超阈值（如 >1e-6·scale）
  的约束写入 `warnings`（不静默，也不硬失败——CQ 语义允许折中，
  但 faijs 约定「绝不静默」，折中必须可见）。

#### 输出

`Map<member, SolverPose>` → 现有 `poseToAssemblyTransform`（pose.ts）管线不变；
恒等位姿过滤、`AssemblyTransform` 输出格式、joints 合并逻辑全部复用。

**裁定 5 — `global` 路径的 pivot 必须是 `[0,0,0]`**（原方案未定义，沿用会算错）。
`solve.ts:106` 调 `poseToAssemblyTransform(pose, pivot, index)`，chain 路径的
pivot 取 `depOrigins`（dep 实体本地 origin，`solve.ts:88`）；
而 CQ 的旋转是 `Rotate(v,R) + T`——**绕世界原点先转后平移**，无 pivot 概念。
`global` 若沿用 depOrigin 作 pivot，旋转中心与 CQ 不同，位姿必然对不上。
实现要求：`global` 分支固定 `pivot = [0,0,0]`，且该差异写入函数注释。

### 4.4 锚定策略（风格差异的显式裁定）

| | chain | global |
|---|---|---|
| 锚定 | 链根（从未被定位）+ `fixed`（A6） | CQ 策略（B4），见下方完整四条 |
| 初值 | 无（依赖件从原点安放） | `T0=0, R0=0`，成员按建模坐标入装（裁定 1） |

`global` 采用 CQ 策略以保证对拍一致；`chain` 不动。两表在方案落地时写入
`global-solver.ts` 顶部注释。

**裁定 6 — B4 原文比方案原描述多两条**（`assembly.py:455-490` 实测，已补全）：

1. 遍历约束时，锁定条件不只 `Fixed`：**`name == self.name`（装配自身名）也算锁定**
   （`assembly.py:465-467`）；
2. 无锁定时，不是直接取"第一条二元约束的 objects[0]"——要先收集
   `unary_objects`（一元约束的 objects[0]），再在 `binary_objects` 里取
   **第一个不在 unary 里的**（`assembly.py:477-486`）；
3. 仍无 → 锁实体 0（`assembly.py:488-489`）；
4. 锁定成员的 `T/R` 是 `opti.set_value((0,0,0))` 冻结，不是"设初值"
   （`solver.py:617-618`）——与自由成员的 `set_initial` 是两套 API。

漏掉第 1、2 条会在"有 Fixed 一元约束 / 装配名参与约束"的用例上错锁，
从而整装配位姿偏离参考。

### 4.5 与 cq-compat / mini_lathe 的接线

- `packages/cq-compat/src/assembly.ts`：`getSlot(c).behavior.solve` 已通
  （上轮修复），只需在构造 AssemblyBehavior 时补 `solver: 'global'`；
- mini_lathe 装配导出走 cq-compat → 自动切 `global`；
- **影响声明**：切换后 slide_top/slide_mid 的装配位姿会变化（这正是目的），
  `packages/mini_lathe/scripts/verify-all.ts` 的结构性断言需同步核对。

**行号与现状更正（2026-09-08 复核）**：原写「:112, :119」不准确。实测——

| 位置 | 现状 |
|---|---|
| `verify-all.ts:107` | `assert(false, 'slide_top 应恰 1 个 leaf')` —— 结构性回归由这里守 |
| `verify-all.ts:114-116` | legacy 工件不存在时 **skip 并提示**（上轮已改），不再是 ENOENT 崩溃 |
| `verify-all.ts:122` | `assert(!cmp1.equivalent, ...)` —— 「必须 DIFFERENT」的实际位置 |

因此「legacy 快照必须在 P3 重录」**不是硬需求**：legacy 缺失即跳过，
结构性回归由 leaf 数断言（:107）覆盖。P3 只需确认切 `global` 后 :107 仍成立，
  以及 SLIDE_TOP_EXPECTED 体积/zmax 是否需要因位姿变化而更新。

### 4.6 `global` 下的诊断语义（原方案未定义，必须补齐）

`AssemblySolveResult` 的 `converged` / `dof` / `unsupported` 是 API 契约字段，
且 `solve.ts:93-98` 在 `!converged` 时**直接抛错**。chain 用"解析失败"判定，
`global` 是数值求解、且 CQ 语义下**冲突约束折中属于正常解**——两者语义必须显式裁定：

| 字段 | `global` 下的定义 |
|---|---|
| `converged` | LM 迭代终止即 `true`（无论残差大小）。**不因残差大而置 false**，否则 CQ 语义下的折中解会被 `solve.ts:94` 抛错 |
| `dof` | 恒 `0`。数值求解不做 DOF 分析（§3 非目标）；保留字段以避免调用方拿到 `undefined` |
| `unsupported` | 仅保留给「约束类型无法映射为代价」的情形（与 chain 同义） |
| `residuals` | 新增：逐约束最终残差，供诊断 |
| `warnings` | 残差超阈值（>1e-6·scale）的约束逐条写入——折中必须可见 |

即：`global` 的失败模式是 **warnings 而非抛错**，与 faijs「绝不静默」约定通过
warnings 满足；**唯一抛错路径**是约束类型不支持。此表需同步进
`docs/api-contract.md` 装配条目（并入 P3 的文档更新任务）。

---

## 5. 测试与验收

### 5.1 单元（global-solver.test.ts）

1. **代价函数数值对拍**：每个 cost 分支（point/axis 三分支/point_in_plane/
   point_on_line）与 Python 参考值对拍——用 venv 跑 `solver.py` 的对应函数
   （`ca.DM` 输入可直接以 numpy 复算同式），固定 marker/位姿用例 ≥8 组；
2. **模长参数化往返**：随机 R → Rotate 公式与四元数旋转一致（误差 <1e-12）；
3. **锚定**：fixed 成员位姿不变；无 fixed 时 B4 回退次序正确；
4. **退化**：平行轴（anyPerpendicular 场景）、重合点、单成员装配；
5. **确定性**：同输入连跑 5 次位逐位一致；
6. **残差构造**（裁定 3 的回归锁）：对每个 cost 分支断言残差与 CQ 内层量逐位一致，
   并专门覆盖 `point_cost(val≠0)` 在 `sumsqr(dummy) ≈ (val/scale)²` 的邻域——
   断言残差**符号连续、无翻转**（若误用开方，这里必炸）；
7. **pivot**（裁定 5 的回归锁）：同一约束分别在 chain / global 下求解，
   断言 global 的旋转中心是原点（等价于 `Rotate(v,R)+T`），不复用 depOrigin；
8. **锚定四条**（裁定 6）：含 `name == self.name` 与 unary 排除的两个用例。

### 5.2 语义对拍（扩展 parity harness）

- `packages/cq-compat/tests/ref-harness/` 新增装配导出模式：
  Python 侧按用例构造 `cq.Assembly` + `constrain` + `solve()`，
  导出每成员 `Location`（`toTuple()`）为 JSON；
- JS 侧同约束构造跑 `global`，比对每成员平移/旋转；
- 用例：plane-plane 贴合、axis 反平行（val 缺省）、axis 平行（val=0）、
  angle 带值、distance、复合冲突对（mini_lathe 侧面 Axis × Plane）、
  fixed + 链式三件套。

### 5.3 端到端（mini_lathe）

> **前置未解项（阻断级）**：「每成员位姿差」要求两侧成员能一一配对，而现状不能。
> `packages/cq-compat/src/assembly-compare.ts:85` 默认 `matchNames: true`，
> 且 :30-31 的注释自陈：CQ 侧 PRODUCT 名是 `"SOLID"`、faijs 侧是 `"shape_x"`，
> 名字不在我们控制下 → 逐零件比对的结果是 `not found in B`（原 parity 方案 §2.2.1 已记录）。
> faijs 侧的命名能力其实已具备（`buildAssembly(name, members[{name}])`，`assembly.ts:97`；
> `union` 也已走 `fuseShapes` 不再是 compound，`workplane.ts:1366`），
> 缺的是**比对侧的配对策略**。P0b 必须先解决它，否则 §5.3 无法验收。
> 候选：① ref 侧按拓朴序/质心就近配对；② 导出时显式写 XCAF 标签并让 ref 侧读同一命名；
> ③ `matchNames: false` + 只比整体几何（放弃逐成员位姿）。**需拍板**。

- `global` 风格装配导出 vs `export-cadquery-ref.py` 的参考装配 STEP：
  每成员位姿差进公差（P0 定标），体积/质心比对沿用 compare 管线；
- `chain` 风格回归：`solve.test.ts`、`kinematics.test.ts`、
  `preview.test.ts`、cq-compat 现有 16 测试全绿，输出与今日完全一致。

### 5.4 性能

mini_lathe：6 成员（1 锁定 → 5×6=30 变量）、9 约束 → 残差维 ~15。

**原写「预计 <10ms」偏乐观，改为实测口径**（粗算：每迭代 30 变量×2 中心差分 =
60 次残差评估，每次遍历 9 约束做 marker 旋转；再组装 60×15 雅可比并解 30×30 法方程
≈ 2.7e4 flops。按 2000 迭代上限是 1e7 flops 量级，<10ms 悬，<100ms 可达）。

验收标准：P1 结束时**实测** mini_lathe 一次求解耗时并写入基线 JSON；
`verify-all.ts` 全流程不因 `global` 求解引入可感知卡顿（<100ms）。
**不把估算当验收**。

---

## 6. 阶段任务分解

**排期约束（与 phase2 的先后）**：本方案的 P0 定标必须排在
`docs/plans/2026-09-08-cq-compat-parity-phase2.md` 的**阶段 G（mini_lathe slide_top
零件级 2.50% 缺口定位）之后**。原因：装配比对的整体体积/质心里同时含「零件几何误差」
和「装配位姿误差」，slide_top 零件级未收敛时，P0 定出来的公差里混着零件几何误差，不可信。
两条线都改 cq-compat 与 `verify-all.ts` 基线，**串行推进，不要并行**。

| 阶段 | 内容 | 产出 |
|---|---|---|
| **P0 基线定标** | 跑通 Python 参考装配位姿导出（ref-harness 扩展）；记录 mini_lathe 两侧当前位姿差数值（6–19mm 的精确定标）；确定最终公差 | `ref-harness/run-ref-assembly.py` + 基线 JSON |
| **P0b 成员配对**（新增，阻断级） | 解决 §5.3 前置：确定 ref ↔ cand 的零件配对策略（`matchNames` / XCAF 标签 / 序+质心就近），并落到 `assembly-compare.ts` | 配对策略裁定 + 比对器改造 |
| **P1 核心求解器** | `solvers/global-solver.ts`：变量化、代价族、LM、锚定 B4、诊断 residuals/warnings；单元测试 §5.1 | 模块 + 测试全绿 |
| **P2 接线** | `AssemblyParams.solver` 全链路透传（compound.ts → solve.ts → dispatch）；cq-compat 默认 `global`；语义对拍测试 §5.2 | API 生效，对拍用例通过 |
| **P3 端到端与回归** | mini_lathe 装配切 global 重导出；verify-all.ts 基线/断言同步更新；chain 回归确认；更新 `docs/ops-api-inventory*.md` 装配条目 | 验收清单全绿 |

---

## 7. 风险与开放问题

1. **反平行语义的波及面**：CQ `Axis` 缺省反平行（B7）意味着 mini_lathe 的
   侧面 Axis 约束在 `global` 下会产生与 `chain` 不同的旋转分量——这是语义对齐
   的必然结果而非 bug，但会导致 mini_lathe 输出工件变化，P3 必须重录基线。
2. **IPOPT vs LM 解的一致性**：凸性良好的小型装配两者应收敛到同一点；
   冲突约束的折中解不保证逐位一致，验收以 P0 定标的公差为准，不追求位级相等。
3. **初值依赖**（已澄清，不再是开放项）：实测 `solve.ts:71-77` 中 `members`
   不参与位姿、faijs `Shape` 亦无 placement，故 `global` 初值恒为 `T0=R0=0`，
   即**成员按建模坐标入装**，与 CQ（`assembly.py:492` 的 `locs`）一致。见裁定 1。
4. **命名**：`solver: 'chain' | 'global'` 为建议命名；如需更贴 CQ 语境，
   备选 `'analytic' | 'cq-nlp'`——因 cq-compat 会把它作为默认值写进 API 面，
   **建议在 P2 之前定稿**（不阻塞 P1）。
5. **冗余/冲突约束诊断**：本方案只做 residuals 透明化（warnings），
   冲突检测与 DOF 分析（类似 CQ `_solve_result` 的统计）留待后续单独立项。
6. **成员配对未定**（阻断）：见 §5.3 前置与 P0b。这是本方案目前唯一
   「不解决就无法验收」的项，且它**不在 phase2 的未完成清单里**——
   两条线的真空地带，需显式指派归属。
7. **`global` 与 `chain` 的失败模式不同**：chain 靠 `converged=false` 抛错，
   global 靠 warnings（§4.6）。若后续有调用方依赖"装配求解失败会抛错"，
   在 `global` 下行为会变。需同步进 `docs/api-contract.md`。
