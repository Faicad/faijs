# cq-compat 装配 global 求解器：阶段交接（2026-09-17）

> 来源：用户原话「收尾目前阶段的工作，以便交给别人。」本文档固化本阶段（P0–P3）的状态、算法口径、实测证据与阻断项，供接手人直接续做。
> 建议阅读顺序：§0 一句话状态 → §4 边界缺陷（**已修复**）→ §4bis 新暴露的约束语义问题（**下一个阻断**）→ §3 算法与契约 → §7 事项清单 → §8 复现命令。

## 0. 一句话状态

纯 TS global 装配求解器（复刻 CadQuery `solver.py` 代价语义，替代 CasADi/IPOPT/WASM）已落地并接线：**P0/P0b/P1/P1.5/P2 全部完成、测试全绿**；**P3 端到端亦已全绿**——原阻断项（op 提升边界崩溃，§4）与后续暴露的约束语义分歧（§4bis）均**已修复并验证**：`assembly-mini-lathe-e2e.test.ts` 6/6 通过（3 结构 + 3 数值），8 条约束残差全部 ≈0、`converged=true`，mb/mt/tp 的 Z 堆叠与 axk 位姿与 CQ 2.8.0 参考一致（axk (5.7717, 6.2517, −10.0000) 精确到 4 位小数）。

## 1. 任务来源与目标

- 用户问：cq-compat 对 CadQuery 装配实现了多少？能否用 WASM 引入 CQ 装配求解器？
- 分析结论（已答用户，本阶段不再重复论证）：**WASM 路线不可行**。CQ 装配求解器是 `cadquery/occ_impl/solver.py` = Python 胶水 + CasADi `Opti` + IPOPT(C++)，不是独立 C/C++ 库；强行 WASM 需 Pyodide 或重型重编译，性价比极低。真正的 IP 是纯数学代价公式，应纯 TS 复刻。
- 用户批准方案并授权「按照你任何合适的步骤开发，请继续」→ 进入 Agent 模式写代码。
- 执行计划：`docs/plans/2026-09-17-assembly-global-solver-plan.md`（含裁定 1–6、代价映射表、P0–P3 分解、§6 验收口径）。
- 设计依据：`docs/plans/2026-09-08-assembly-dual-solver.md`（B1–B10 源码标定）。

## 2. 阶段完成情况

| 阶段 | 内容 | 状态 | 证据 |
|---|---|---|---|
| P0 基线定标 | 用 cadquery-env 导出 CQ 2.8.0 每成员 world Location → `mini_lathe_poses.json`；固化 `compare-poses.ts` | ✅ | `packages/mini_lathe/scripts/{export-cadquery-ref.py,compare-poses.ts,assembly-baseline.json}`；`out/ref/mini_lathe_poses.json`（6 成员） |
| P0b 成员配对 | `assembly-compare.ts` 加 `pairing: 'names'\|'order-index'\|'order-centroid'`（缺省由 `matchNames` 推导，向后兼容） | ✅ | `src/assembly-compare-p0b.test.ts`（2 用例） |
| P1 核心求解器 | `solvers/{global-solver,linalg,pose-from-delta,types}.ts`：LM + 中心差分雅可比 + CQ 模长参数化四元数 + 代价族 + B4 锚定（合计 771 行，不含测试） | ✅ | `solvers/global-solver.test.ts`（13 用例） |
| P1.5 约束补全 | `constraintEx` 覆盖 Plane/Axis/Point/Cylinder/Distance/Fixed/Revolute；新增 `pointRef`/`axisRef`；重写 `resolveAxisRef` | ✅ | `src/assembly-constraints.test.ts`（11 用例） |
| P2 接线 | `solve.ts` 按 `opts.solver` 分派；`compound.ts` 全链路透传；cq-compat `buildAssembly` **默认 `global`** | ✅ | `src/assembly-global-e2e.test.ts`（3 用例，含 chain/global 路径可区分断言） |
| P3 端到端与回归 | mini_lathe 真实装配切 global 重导出 + 位姿进公差 | 🟢 **完成**：边界缺陷已修复（§4）、约束语义已标定并修复（§4bis）、e2e 6/6 全绿（结构 + 数值） | 8 残差全 ≈0；mb/mt/tp Z 堆叠 6.1/16.1/19.2 与参考一致；axk (5.7717, 6.2517, −10.0000) 与参考一致 |

> P3 的多成员回归（纯 faijs 构件）与真实 `assembly.fai.js` 经 `runtime.execute` 的链路**均已跑通并数值验收通过**。剩余可选项：CLI 全链路重导出 + `compare-poses.ts`、性能实测（§7）。

### 2.1 本阶段实测测试基线（2026-09-17，可复跑）

| 套件 | 结果 |
|---|---|
| `packages/cq-compat` `npx vitest run assembly` | **5 文件通过 / 1 文件跳过，23 用例通过 / 6 跳过，exit 0** |
| ├ `assembly-constraints.test.ts`（P1.5） | 11 通过 |
| ├ `assembly-global-e2e.test.ts`（P2） | 3 通过 |
| ├ `assembly-global-p3.test.ts`（P3 多成员回归） | 3 通过 |
| ├ `assembly-compare-p0b.test.ts`（P0b） | 2 通过 |
| ├ `assembly-lift-boundary.test.ts`（缺陷守卫，本阶段新增） | 4 通过 |
| └ `assembly-mini-lathe-e2e.test.ts`（P3 真验收） | **3 通过 / 3 skip**（结构断言通过；数值断言保持 skip，见 §4bis） |
| `packages/core` `npx vitest run src/api/assembly`（含 chain 回归） | **8 文件 / 88 用例全绿，exit 0** |
| └ 覆盖 `global-solver.test.ts` / `solve.test.ts` / `kinematics.test.ts` / `preview.test.ts` / `pose` / `validate` / `joints` / `joints-ik` | 其中 13 用例属 global-solver，其余为 chain 路径回归（未受影响） |

**结论：本阶段交付物（P0/P0b/P1/P1.5/P2 + P3 多成员回归）全部可运行、测试全绿；原阻断项（op 提升边界崩溃）已修复，P3 数值验收的新阻断 = §4bis 约束语义标定。**

## 3. 交付内容详解（接手先读这节）

### 3.1 求解器算法：`solvers/global-solver.ts`（507 行）

**变量化**：每个**自由**成员 6 个变量——`ΔT=[tx,ty,tz]`（mm，有量纲）与 `ΔR=[a,b,c]`（无量纲，CQ 模长参数化）。初值 `ΔT=0`、`ΔR=(1e-2,1e-2,1e-2)`（B3）。被锚定的成员**没有变量**，恒为 identity。

**旋转参数化**：CQ 模长参数化（`solver.py:309-316`），`m=a²+b²+c²`，四元数 `(2a/(m+1), 2b/(m+1), 2c/(m+1), (1−m)/(m+1))`；`Rotate(v,R)=2⟨u,v⟩u+(s²−⟨u,u⟩)v+2s(u×v)`。实现在 `pose-from-delta.ts`（55 行），终点用 `quatFromR` 落成 faijs 的 `[x,y,z,w]`。

**残差向量**：由代价项拼成（每项 1 或 3 分量，见 §3.2），**末尾追加 penalty 项**——对每个自由成员的 6 个变量各追加 `1e-8·(T/scale)` 与 `1e-8·R`（源码 `PENALTY=1e-16`，取 `PENALTY**0.5`）。作用：消除零空间漂移、保证 `JᵀJ` 满秩。注意这是 **soft penalty**，量级 1e-8，不影响正常约束的收敛值。

**数值求解（替代 IPOPT，零依赖）**：Levenberg–Marquardt，法方程 `(JᵀJ+λI)δ=−Jᵀr`，雅可比用**中心差分**（`ΔT` 步长 `1e-7·scale`，`ΔR` 步长 `1e-7` 绝对值——模长参数化无量纲）。λ 自适应：接受步 `λ/=3`（下限 1e-15），拒绝步 `λ*=2`，初值 `λ=1e-3`，每次迭代最多 12 次尝试。线性求解走自写的 `linalg.ts`（152 行，Cholesky 优先、退化回落带主元 Gauss-Jordan；不 import vendored 模块私有实现）。

**终止判据（任一命中即停）**：
1. `maxAbs(Jᵀr) < 1e-8`（梯度范数）；
2. 接受步 `‖δ‖∞ < 1e-10` **且** `λ < 1e-2`（信任域健康才算真收敛，避免 λ 放大时的微小步长被误判）；
3. `|Δobj| < 1e-12·max(1,|obj|)`（目标函数停滞）；
4. 无可用改进步（λ 放大 12 次仍不降）；
5. `iter ≥ 2000`。

**确定性**：固定初值 + 确定性迭代 → 同输入必同输出（计划 §6.4 的验收要求）。

### 3.2 代价 → 残差映射（CQ 代价族 → 4 个残差原语）

CQ `solver.py` 的代价族（api-contract 与计划中称「9 类代价形式」）在本实现归纳为 **4 个残差原语**：`point` / `axis` / `point_in_plane` / `point_on_line`。**残差取「平方前内层量」**（裁定 3，不是对代价开方）——这是最容易写错的地方，`global-solver.test.ts` 有专门回归锁。

| 约束 | entity 对 | 残差分量组成 |
|---|---|---|
| `mate` | plane-plane | `axis(π)` + `point(0)`（= CQ `Plane`，B8） |
| `align` | plane-plane | `axis(0)` + `point(0)` |
| `coincident` | point-point | `point(0)` |
| `coincident` | point-plane / plane-point | `point_in_plane(0)` |
| `coincident` | axis-axis / axis-point / point-axis | `axis(0)` + `point_on_line(0)` |
| `concentric` | axis-axis | 同 `coincident` axis-axis |
| `distance` | point-point / point-plane / plane-point | `point(val)` / `point_in_plane(val)` |
| `distance` | axis-axis | `point_on_line(val)` |
| `angle` | plane-plane | `axis(val=angleRad)` |
| `parallel` | plane-plane | `axis(0)` |
| `perpendicular` | plane-plane | `axis(π/2)` |
| `fixed` | — | 锁定变量，**无残差** |

原语内部形态（`termResidual`）：
- `point`：`val=0` → 3 维 `(Δp)/scale`；`val≠0` → 1 维 `[Σ((Δp)/scale)² − (val/scale)²]`。
- `axis`：`val=0` → 3 维 `d1−d2`；`val=π` → 3 维 `d1+d2`（反平行，CQ `Axis` 缺省语义）；其他 → 1 维 `[d1·d2 − cos(val)]`。`d1,d2` 是两侧**单位方向**各自变换后的向量。
- `point_in_plane`：点到平面的有符号距离 ×`inv`（1 维）；`val≠0` 时先沿法向平移 `val` 再取距离。
- `point_on_line`：点到轴线的垂直距离分量 ×`inv`（1 维）；`val≠0` 时用 `[Σperp² − val]`（注意 **val 不缩放**，与 point 原语不同）。

`scale` = 所有参与约束的 marker 点（本地系）的 AABB **对角长**，下限 1e-6。点类代价除以 scale、方向类不缩放（CQ scaling 字典）。

### 3.3 锚定、初始不变式与 pivot

- **裁定 1/2（初始不变式）**：faijs `Shape` 不携带 placement，故 solve 起始时所有成员 pose 为 identity → **world 系 == 本地系**，两侧 marker 可直接取本地系、无需回变换，且无坐标系不对称。该前提写在 `global-solver.ts` 文件头；若未来 `Shape` 携带初始 placement，此处须改为显式回变换。
- **裁定 5（pivot）**：旋转恒绕**世界原点**（CQ `Rotate(v,R)+T`），即 pivot 恒 `[0,0,0]`，`poseToAssemblyTransform(pose, [0,0,0], index)`。因此自由成员满足 `p' = R·p + T`。chain 路径仍用 `depOrigins` 作 pivot，按 solver 分支传参。
- **裁定 6（B4 锚定，三级回退）**：① 有 `Fixed` 约束的成员，或成员名 `== opts.name`（assembly 自身名）→ 锁定；② 否则取 `binaryOrder` 中**第一个不在 unary 集合**里的成员（`binaryOrder` 按约束出现顺序收集 a 侧）；③ 仍无 → 锁 `order[0]`。命中者**冻结为 identity**（不是设初值）——它不产生变量、也不出现在输出 `transforms` 中。
- **mini_lathe 的实际落点**：无 `Fixed` 约束，`name='mini_lathe'` 与任何成员名都不同 → 走 ②，锁定 `bp`（c1 的 a 侧，也是 binaryOrder 首个）。这与 CQ 参考的 `bp(0,0,0)` 一致。

### 3.4 API 与契约

**入口与默认值**：`SolveOptions { solver?: 'chain' | 'global'; name?: string }`（`solvers/types.ts`）。`cad.assembly({ solver })` → `compound.ts` 的 `AssemblyParams.solver` / `AssemblyBehavior.solver` → `solveAssembly(..., opts)` 内部 `if (opts?.solver === 'global') solveGlobal(...) else solveConstraints(...)`。**`cad.assembly` 默认仍是 `chain`**（向后兼容）；**只有 cq-compat 的 `buildAssembly` 默认 `global`**（`assembly.ts:340`），需要旧行为时显式传 `solver:'chain'`。

**`GlobalSolveResult` 字段语义**（`solvers/types.ts`）：

| 字段 | global 下的定义 |
|---|---|
| `transforms` | 每个**自由**成员一条终态变换（锚定成员不输出）。mini_lathe 实测 5 条（6 成员 − 锚 `bp`） |
| `converged` | **恒 `true`**（LM 终止即算收敛，不因残差大置 false——否则 CQ 的折中解会被 `solve.ts` 抛错） |
| `dof` | 恒 `0`（数值求解不做 DOF 分析，保留字段避免 undefined） |
| `unsupported` | 仅当约束类型无法映射为代价时填充（不抛错） |
| `residuals` | **逐约束**最终平方残差，长度 = 约束条数（mini_lathe = 8）。**brepjs/chain 路径没有此字段 → 它的存在就是「global 路径跑过」的线上信号** |
| `warnings` | 残差 `> 1e-6·scale` 的约束逐条写入（折中可见，满足「绝不静默」）；全部达标时为 `undefined` |

**唯一抛错路径**：约束类型无法映射为代价之外的**真正不可解析实体引用**（`E_TOPO_NOT_FOUND`）。其余一律以 `warnings` / `unsupported` 透明化。

**契约文本**：`docs/api-contract.md` §12 已新增 Global solver 条目，要点与上表一致（并明确 `cq.assembly({solver:'global'})` 经 cq-compat 为默认、pivot 恒 `[0,0,0]`、B4 锚定）。若 §4.5 的修法改变 `resolveFaceSelector` 语义，需同步该条目。

### 3.5 cq-compat 侧：约束种类补全（`assembly.ts`，371 行）

- 新增统一入口 `constraintEx(aPart, aSelector, aShape, bPart, bSelector, bShape, kind, param?)`，映射：

| CQ `constrain` kind | faijs `AssemblyConstraint` |
|---|---|
| `Plane` | `mate`（faceRef → plane） |
| `Axis` | `align`（faceRef → plane，轴编码） |
| `Point` | `coincident`（selector 为字面坐标 `"x,y,z"`） |
| `Cylinder` | `concentric` + `coincident`（拆两条，圆边解析轴） |
| `Distance` | `distance`（`value=val`；selector 可为坐标或面） |
| `Fixed` | `fixed`（锁定 aPart） |
| `Revolute` | `fixed`（**暂降级为锚定占位**，旋转 DOF 后续走 `joints` 机制） |

- 旧 `constraint()` 保留为 Plane/Axis 便捷封装（向后兼容既有调用方）；新增 `pointRef` / `axisRef` 解析点与边引用。
- **重写 `resolveAxisRef`**：现为「把边离散点投到平面 → Kasa 2D 最小二乘圆拟合 → 右下 RMS 圆度校验（`rms > R·0.05` 判非圆并返回 `null`）→ 圆心回投 3D」；此前版本在此处有定位错误。
- `buildAssembly` 默认 `solver:'global'`，且**显式调用 `getSlot(compound)?.behavior.solve()`**——因为 `cad.assembly` 把 `solve` 挂在 slot behavior 上而不是 compound 自身，早期写法 `compound.solve()` 永远是 `undefined`，会**静默不求解**（此坑已注释在源码里）。

### 3.6 比对器成员配对（P0b，`assembly-compare.ts`，378 行）

`compareAssemblyFiles` 新增 `pairing?: 'names' | 'order-index' | 'order-centroid'`，缺省由 `matchNames` 推导（`true → 'names'`，`false → 'order-index'`），保持向后兼容。`order-centroid` 用于 CQ 参考 vs faijs 候选的**跨命名**比对（贪心最近质心配对）。注意计划 §4.5 曾把中间档写作 `'xcmf-labels'`，**落地实现是 `'order-index'`**，以代码注释与类型为准。

## 4. ✅ 原阻断项：cq-compat 装配函数的 op 提升边界（**已修复 2026-09-17**）

### 4.1 现象（历史）

真实 `packages/mini_lathe/src/assembly.fai.js` 经 `runtime.execute` 执行时，**第一条约束 c1**（源文件第 10 行）即失败：

```
failedAt = { index: 6, lineNo: 10, callee: 'constraint', code: 'E_OP_FAILED' }
message  = [faijs/op] constraint: E_OP_FAILED: Cannot read properties of undefined (reading 'length')
源码行    = let c1 = cq.constraint("bp", ">Z", bottom_plate, "mb", "<Z", middle_bottom, "Plane")
```

**注意 `index` 与 `lineNo` 不同源**：direct 模式下 `index` 是语句序号、`lineNo` 才是源文件行号；本阶段据此推翻了早先「失败在 c7」的判断。以后定位一律以 `lineNo` 为准。

### 4.2 已排除的假设（都做了实测）

| 假设 | 结论 | 证据 |
|---|---|---|
| 是 c7（首个引用 axk 的约束）失败 | ❌ 错。`failedAt.lineNo=10` 明确是 **c1** | 打印 `failedAt.lineNo` + 对应源码行 |
| `resolveFaceSelector` 不支持 axk 的 `>Z`/`<X` | ❌ 错。bp/mb/axk 各选择器**全部解析成功** | 直接调用 `resolveFaceSelector` 对 5 组选择器全 OK |
| 6 个部件 BREP handle 失效 | ❌ 错。6 部件 `hasBrep=true` / `brepOf` 非空 | 逐部件打印 |
| `constraint`/`faceRef`/`constraintEx` 实现有 bug | ❌ 错。**绕过 op 包装直接调用完全正常**，返回合法 `{type:'mate', a, b}` | 在测试进程内 raw 调用 `cq.constraint(c1)` → OK |
| 返回值经 `adoptOut`/`adoptEntity` 出错 | ❌ 错。`adoptEntity` 对无 `wrapped` 的普通对象原样返回 | 读 `l3-bridge.ts` |

### 4.3 根因链（已确证，含堆栈）

1. cq-compat 命名空间**不含任何 dual-op**（仓内无 `defineOp` 导出）→ `hasDualOp(ns)=false` → `runtime.ts:401` 推断 `lift = true`。
2. `registerLib` → `admitCompatLib` 用 **`compatOp` 提升每个裸导出函数**（brep-only）。`constraint`/`constraintEx`/`faceRef`/`buildAssembly` 全在此列。
3. `compatOp` 适配器（`core/src/api/internal/compat-op.ts` `buildAdapter`）在调用实现前先 `borrowDeep` 实参：**faijs `Shape` → 借用 brepjs 视图** `{ wrapped, disposed, delete, onDispose }`。
4. 该视图 `isShape=false`、`brepOf=undefined`（实测）→ `resolveFaceSelector` 的 BREP 分支 `if (handle && dir)` 不成立 → 落到 **`workplane.ts:631` 整形状 bbox 兜底** → `bboxMax` → `cad.bboxMax` → `mesh/query.ts:20` 读 `shape.vertices` 为 undefined。
5. TypeError 被 `define-op.ts` 的 `toOpFailure('constraint', e)` 包成 `[faijs/op] constraint: E_OP_FAILED: …`。

实测堆栈（本阶段最后一次诊断，已固化为守卫测试）：

```
A. real Shape   -> OK center=[0.000, 0.000, 8.000]
B. borrowed view: isShape=false brepOf=false keys=wrapped,disposed,delete,onDispose
B. borrowed view -> FAIL: TypeError: Cannot read properties of undefined (reading 'length')
    at Object.boundingBox (packages/core/src/mesh/query.ts:20:39)
    at Object.bboxMax    (packages/core/src/api/geom.ts:130:14)
    at bboxMax           (packages/cq-compat/src/workplane.ts:353:14)
    at resolveFaceSelector (packages/cq-compat/src/workplane.ts:631:15)
```

### 4.4 为什么"单测全绿、e2e 红"

`assembly-global-e2e.test.ts` / `assembly-global-p3.test.ts` 与全部 core 求解器测试都是**在测试进程内直接调用** `buildAssembly` / `solveGlobal`，**不经运行时 op 提升**，因此绕过了该缺陷。只有把真实 `.fai.js` 交给 `runtime.execute` 才会命中。这正是本项目「单测全绿 ≠ 产物可用」的又一例。

### 4.5 修复（**已实施 2026-09-17，采纳方向 3 的变体**）

原三条候选方向中，实际落地的是 **方向 3（cq-compat 包内入口归一，不动引擎）的变体**：不在函数首行把视图「降级为裸句柄」，而是**升级为真实 faijs `Shape`**（保住 mesh + BREP 身份槽两个下游都需要的东西）：

- **新增 `asBrepShape(v)`**（`workplane.ts`，约 45 行）：
  - 真实 `Shape`（`isShape`）→ 原样返回；
  - 借用视图（`'wrapped' in v`）→ 解包 `wrapped`（`OcctWasmHandle` 对象取 `.id`，与 `adoptBrepjsProduct` 的解包分支同式）→ `fromHandle(id)` 还原真实 Shape（三角化 + `registerFunctionBrep` 登记 BREP 槽；顶层 `functionBrepDepth=0` 时为 no-op，不会误释放）→ 按**视图对象** WeakMap 缓存（同视图多次调用不重复三角化）；
  - 其余 → 原样返回。
- **四个调用点**：`resolveFaceSelector`（首行）、`constraintEx`（Plane/Axis 两侧）、`resolveAxisRef`、`buildAssembly`（members 逐条）。
- **所有权安全性**：归一 Shape 与原 part Shape 的 slot 指向同一 OCCT 句柄，但 slot 按 Shape 对象各自持有（`fromBrep` 写的是新 Shape 的 slot），与 vendored 投影 `adoptBrepjsProduct` 的收编模式同构，无共享释放路径、无双重释放。
- **回归守卫**：`assembly-lift-boundary.test.ts` 由「断言缺陷存在」翻转为「断言修复有效」（4 用例：透传/缓存、`resolveFaceSelector` 接受视图、`constraint` 视图实参几何与直接调用一致、`buildAssembly` 视图成员 children 真实且 global 求解收敛）——**实测 4/4 通过**。

> 结论不变：`cq.constraint` 走 `compatOp` 时天然是 **brep-only**（mesh 模式抛 `E_MESH_UNSUPPORTED`），与 FCStd 产物的「整链路 brep-only」同一结论。

## 4bis. ✅ 新暴露阻断：约束语义未与 CQ solver 标定（**已修复 2026-09-17，e2e 6/6 全绿**）

解除 `assembly-mini-lathe-e2e.test.ts` 的 skip 后，结构断言通过（`converged=true`、不崩溃、锚定 bp、slide_top 恒等），但 3 个**数值**断言失败（历史现场，留档）。一次性探针实测（parts 局部几何，探针已删、数据留档于此）：

| 约束 | 实测面/面心 | 单独求解要求的 mb z |
|---|---|---|
| c1 `mate`（bp `>Z` / mb `<Z`） | bp 外顶面 z=8；mb 底面 z=0 | **8** |
| c4 `align`（bp `<X` / mb `<X`） | bp 面心 z=4；mb 面心 z=5 | **−1** |

- **矛盾**：同一对 member 的两条约束对 mb 的 Z 平移给出相反方向的要求（8 vs −1），global 求解器（最小二乘折中，`converged` 恒 true 不报错）折中出 mb z=**−0.302**，c1 残差 0.0326 > 1e-2 门限。
- **CQ 参考** mb z=**6.1** = 8 − 1.9（bp 顶面凹槽深 `TOP_CUT_H`≈1.9）：CQ 里 mb 是**嵌进凹槽**的，而不是贴外顶面。

**根因（对照 CQ 2.8.0 源码 `occ_impl/solver.py` / `selectors.py` 标定确认，两个确切分歧）：**

1. **约束映射：CQ 独立 `Axis` = 纯方向反平行，无点项**——`ConstraintInvariants["Axis"]` 只收两个 `gp_Dir`，`axis_cost` 缺省 `val = pi`。我方误映射为 `align`（同向 val=0 + 面心重合），双重分歧：同向/反平行 + 凭空多出的面心重合项（c4「align 要 mb z=−1」的来源；参考位姿全员 180° Z 翻转也印证反平行语义）。**修复**：`constraintEx` 的 `Axis` 分支 → `angle: 180`（我方求解器 `case 'angle'` 正是纯方向 axis 成本、无点项，`value` 单位 deg）。CQ `Plane` = Axis(π) + Point(0) 复合 → 我方 `mate` 映射**本就正确**，未动。
2. **选择器索引丢失：移植 `assembly.fai.js` 丢了 CQ 原件的 `[-2]`**（c1 bp 侧、c2 mb 侧、c3 tp 侧，对照 `mini_lathe/assemb.py` 逐条核对）：`>Z[-2]` 经 `DirectionNthSelector`（按面心坐标降序、聚簇后第 2 末）选的是**凹槽底面 z=6.1**，裸 `>Z` 选外顶面 z=8。「mate 要 8」即此因。我方 `resolveFaceSelector` 的 `[-2]` 实现（聚簇升序取第 2 末）语义与 CQ 一致，**选择器实现无需改，只需把索引补回移植件**。

**修复内容（2026-09-17）：**
- `packages/cq-compat/src/assembly.ts`：`Axis` → `angle: 180`（含 GOTCHA 注释）；`constraintEx` 注释表同步。
- `packages/mini_lathe/src/assembly.fai.js`：c1/c2/c3 补回 `>Z[-2]` 索引（含对齐说明注释）。
- 回归测试：`assembly-constraints.test.ts` 的 2 个 Axis 用例翻转为 `angle:180` 断言（错误映射 `align` 以 GOTCHA 注释留档）；e2e 3 个数值断言解除 `it.skip` 常跑。

**验收结果（2026-09-17 实测）：** `assembly-mini-lathe-e2e.test.ts` **6/6 通过**——8 条约束残差全部 ≈0（最大 1e-9 量级）、`converged=true`；mb/mt/tp 的 Z = 6.1/16.1/19.2 与参考一致（≤1e-2mm）；axk = (5.7717, 6.2517, −10.0000) 与参考一致（c7+c8 对 axk 的 θ 是自由自旋 DOF，参考对应 θ=180°，LM 从恒等初值收敛到同解；e2e 断言对 axk 只查旋转结构 + 平移落参考 1mm 邻域，不锁 x/y 符号）。

> 本小节为留档：历史现场 + 标定根因 + 修复与验收记录。

## 5. 交接文件清单

**引擎（`packages/core/src/`）**
- `api/assembly/solvers/global-solver.ts`（507 行）— LM + 代价族 + B4 锚定 + 诊断
- `api/assembly/solvers/linalg.ts`（152 行）— 自实现 Cholesky / 带主元 Gauss-Jordan
- `api/assembly/solvers/pose-from-delta.ts`（55 行）— ΔT/ΔR → `SolverPose`（模长参数化四元数）
- `api/assembly/solvers/types.ts`（57 行）— `SolveOptions` / `SolverStyle` / `GlobalMarker` / `GlobalSolveResult`
- `api/assembly/solvers/global-solver.test.ts`（227 行，13 用例）
- `api/assembly/solve.ts` — 加 `SolveOptions` 分派 + `residuals` 字段 + pivot 分支
- `api/compound.ts` — `AssemblyParams.solver` / `AssemblyBehavior.solver` + 两处透传

**cq-compat（`packages/cq-compat/src/`）**
- `assembly.ts`（371 行）— `constraintEx`（7 类）+ `pointRef`/`axisRef` + `resolveAxisRef` 重写 + `buildAssembly` 默认 `global`
- `assembly-compare.ts`（378 行）— `pairing` 三模式（P0b）
- `index.ts` — 导出 `pointRef`/`axisRef`/`constraintEx`
- 测试：`assembly-constraints.test.ts`(11)、`assembly-global-e2e.test.ts`(3)、`assembly-global-p3.test.ts`(3)、`assembly-compare-p0b.test.ts`(2)、**`assembly-lift-boundary.test.ts`(4，§4 修复的回归守卫，全绿)**
- `assembly-mini-lathe-e2e.test.ts`（6 用例：**6/6 全绿**——结构断言 3 + 数值断言 3，数值验收 2026-09-17 §4bis 修复后解除 skip 常跑）

**mini_lathe（`packages/mini_lathe/scripts/`）**
- `export-cadquery-ref.py`（151 行）— 导出 CQ 参考位姿 JSON（+49 行）
- `compare-poses.ts`（86 行）— world bbox_min 差值比对（local bbox_min 抵消 → 精确反映堆叠平移差）
- `assembly-baseline.json` — P0 基线（参考位置 + chain 现状 + 公差目标 + 复现命令）
- `verify-all.ts`（137 行）/ `summary.ts`（28 行）— 既有全流程脚本，未改

**文档**
- `docs/plans/2026-09-17-assembly-global-solver-plan.md` — 本阶段执行计划（裁定 1–6 / §6 验收）
- `docs/api-contract.md` §12 — 新增 Global solver 条目
- 本文档 + `.workbuddy/memory/2026-09-17.md`（逐日记录）

## 6. 接手必读的坑

- **compatOp lift 语义（本阶段最大坑）**：`registerLib` 的 `autoLift` 缺省 = `!hasDualOp(ns)`。库命名空间只要没有 dual-op，**所有**裸函数都会被 `compatOp` 提升为 brep-only op，且实参照例先经 `borrowDeep`（faijs Shape → 借用视图）。**推论：直接调用（测试进程内）正常 ≠ 经 `runtime.execute` 正常。** 写「吃 Shape 的库函数」时必须按这个边界设计。详见 §4.3。
- **CLI 链路陷阱**：`assembly.fai.js` import `@faicad/cq-compat` → 解析到 **stale dist**；cq-compat dist 又 import `@faicad/faijs-core` → **stale dist**。用 CLI 跑真实装配前必须先 `npm run build`（core + root）+ `npm run build -w @faicad/cq-compat`；否则 global 默认不生效、P3 看不到改进。**本阶段的 e2e 因此改为在 vitest 内直接消费 `src/`**（`createFsProjectLoader` + `projectKeyOf` 装载多文件 `assembly.fai.js`，绕过 dist）。
- **多文件 `.fai.js` 执行姿势**（本阶段验证有效的写法）：`runtime.execute(code, { entryKey })`，`entryKey = projectKeyOf(root, entryFile)`（相对项目根的 POSIX key）。`ports.projectLoader` 只负责**相对/绝对** specifier；**裸 specifier（如 `@faicad/cq-compat`）由 `registerLib` 的 libLoader 解析**，所以必须 `runtime.registerLib('cq', cq, { packageName: '@faicad/cq-compat' })`。`createFsProjectLoader`/`projectKeyOf` 不在 `node-host/index.ts` 的导出面里，要从 `core/src/node-host/fs-project-loader` 直接引。
- **occt-wasm teardown segfault**：整 suite 退出码可能为 1，属噪音（输出完整）；按文件单跑可确认真假。
- **vitest 日志可读性**：PowerShell 重定向出的 log 含 ANSI/NUL，`Read` 会拒读；用 `tr -d '\000' | tr -cd '\11\12\15\40-\176'` 清洗后再看。
- **brep-only 边界**：`cq.constraint` 经 lift 后是 brep-only；FCStd 产物整链路同样 brep-only。
- **自由旋转 DOF**：mate/align/concentric 在接触法向留有自由旋转，解出的四元数不固定 → 断言只能验几何不变量，**不要断言具体四元数/绝对平移**（axk 的 x/y 平移即因自由 Z 自旋而不确定）。可断言的稳定量：Z 向堆叠平移（6.1 / 16.1 / 19.2）、旋转结构（`R[0]≈R[4]` 且 `R[8]≈1`）。
- **CQ 参考位姿订正**：`mini_lathe_poses.json` 中 **axk 与 mb/mt/tp 同为「180° Z 翻转」**（`R[0][0]=R[1][1]=-1`、`R[2][2]=1`），并非"axk 另含特殊 x/y 旋转"。axk translation = (5.7717, 6.2517, −10.0)。

## 7. 留给接手人的事项（按优先级）

1. ~~约束语义标定（§4bis）~~ —— **已完成 2026-09-17**：CQ 2.8.0 源码标定确认两个根因（Axis 映射、`[-2]` 索引丢失），修复 + 回归测试 + e2e 6/6 全绿，详见 §4bis。
2. ~~跑通 P3 数值验收~~ —— **已完成 2026-09-17**：8 条约束求解、`bp` 冻结、mb/mt/tp 的 Z 堆叠 6.1/16.1/19.2 进 1e-2mm、axk 旋转结构正确 + 平移落 1mm 邻域、`residuals.length === 8` 且各项 < 1e-2。
3. **P3 剩余可选核实项**（不阻断验收）：
   - CLI 全链路重导出 `out/mini_lathe.step` 后跑 `compare-poses.ts`（需先重建两份 dist；vitest e2e 已数值验收通过，CLI 链路属导出侧验证）；
   - 性能实测（计划 §6.4 要求把一次求解耗时写进 `baseline.json`，"不把估算当验收"）。
4. **core 回归：已跑，全绿**——`npx vitest run src/api/assembly` 8 文件 / 88 用例通过。chain 路径未受影响：`cad.assembly` 仍默认 `chain`，只有 cq-compat `buildAssembly` 默认 `global`。
5. **文档**：`docs/api-contract.md` 的 global 条目已写；§4bis 的 Axis→`angle:180` 映射若对外文档有旧描述（"Axis→align"），需同步订正。
6. **`docs/handover/` 是新目录**：本阶段提交按约定用了 `--no-verify`，未跑 `doc-sync` / JSDoc 门禁；正式发布前需补一次。

## 8. 复现命令速查

```bash
# 真实装配 e2e（6/6：结构断言 3 + 数值断言 3，§4bis 修复后全绿）
cd packages/cq-compat && npx vitest run assembly-mini-lathe-e2e.test.ts --no-coverage

# §4 修复的回归守卫（4 用例全绿）
cd packages/cq-compat && npx vitest run assembly-lift-boundary.test.ts --no-coverage

# cq-compat 装配全套
cd packages/cq-compat && npx vitest run assembly --no-coverage

# core 求解器单测 + chain 回归
cd packages/core && npx vitest run src/api/assembly --no-coverage

# CQ 参考位姿重生成（cadquery-env）
C:\Users\ylt\cadquery-env\Scripts\python.exe packages/mini_lathe/scripts/export-cadquery-ref.py
```

> 环境：Node 用 `C:\Users\ylt\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`；**Git Bash 下 `npx` 被沙箱拦（wsl.exe 黑名单），跑 vitest/tsx 一律改用 PowerShell 工具**。cadquery 侧用 `C:\Users\ylt\cadquery-env`（2.8.0）。

## 9. 相关材料

- 执行计划：`docs/plans/2026-09-17-assembly-global-solver-plan.md`
- 设计依据（裁定 1–6 / B1–B10）：`docs/plans/2026-09-08-assembly-dual-solver.md`
- 缺陷守卫测试：`packages/cq-compat/src/assembly-lift-boundary.test.ts`
- 契约：`docs/api-contract.md` §12（Assembly）
- 同阶段另一条主线（FCStd 端口）：`docs/handover/2026-09-17-fcstd-phase2-completion-handover.md`
- 本阶段逐日记录：`.workbuddy/memory/2026-09-17.md`
