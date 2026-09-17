# cq-compat 装配 global 求解器：阶段交接（2026-09-17）

> 来源：用户原话「收尾目前阶段的工作，以便交给别人。」本文档按该要求固化本阶段状态、证据与阻断项，供接手人直接续做。

## 0. 一句话状态

纯 TS global 装配求解器（复刻 CadQuery `solver.py` 代价语义，替代 CasADi/IPOPT/WASM）已落地并接线，P0/P0b/P1/P1.5/P2 全部完成、测试全绿；**P3 真实 mini_lathe 端到端被一个 op 提升边界缺陷阻断**——缺陷已定位到 `resolveFaceSelector` 的兜底分支，**未修复**。

## 1. 任务来源与目标

- 用户问：cq-compat 对 CadQuery 装配实现了多少？能否用 WASM 引入 CQ 装配求解器？
- 分析结论（已答用户）：**WASM 不可行**。CQ 装配求解器是 `cadquery/occ_impl/solver.py` = Python 胶水 + CasADi `Opti` + IPOPT(C++)，非独立 C/C++ 库；强行 WASM 需 Pyodide 或重型构建，性价比极低。真正 IP 是纯数学代价公式，应纯 TS 复刻。
- 用户批准方案并授权「按照你任何合适的步骤开发，请继续」→ 进入 Agent 模式写代码。
- 执行计划：`docs/plans/2026-09-17-assembly-global-solver-plan.md`（含裁定 1–6、代价映射表、P0–P3 分解）。
- 设计依据：`docs/plans/2026-09-08-assembly-dual-solver.md`（B1–B10 源码标定）。

## 2. 阶段完成情况

| 阶段 | 内容 | 状态 | 证据 |
|---|---|---|---|
| P0 基线定标 | 用 cadquery-env 导出 CQ 2.8.0 每成员 world Location → `mini_lathe_poses.json`；固化 `compare-poses.ts` | ✅ | `packages/mini_lathe/scripts/{export-cadquery-ref.py,compare-poses.ts,assembly-baseline.json}`；`out/ref/mini_lathe_poses.json`（6 成员） |
| P0b 成员配对 | `assembly-compare.ts` 加 `pairing: 'names'\|'order-index'\|'order-centroid'`（默认由 `matchNames` 推导，向后兼容） | ✅ | `src/assembly-compare-p0b.test.ts`（2 用例，顺序/命名无关） |
| P1 核心求解器 | `solvers/{global-solver,linalg,pose-from-delta,types}.ts`：LM + 中心差分雅可比 + CQ 模长参数化四元数 + 9 类代价 + B4 锚定 | ✅ | `solvers/global-solver.test.ts`（13 用例） |
| P1.5 约束补全 | `constraintEx` 覆盖 Plane/Axis/Point/Cylinder/Distance/Fixed/Revolute；新增 `pointRef`/`axisRef`；修 `resolveAxisRef` 两处致命 bug | ✅ | `src/assembly-constraints.test.ts`（11 用例） |
| P2 接线 | `solve.ts` 按 `opts.solver` 分派；`compound.ts` 全链路透传；cq-compat `buildAssembly` **默认 `global`** | ✅ | `src/assembly-global-e2e.test.ts`（3 用例，含 chain/global 路径可区分断言） |
| P3 端到端与回归 | mini_lathe 真实装配切 global 重导出 + 位姿进公差 | ⛔ **阻断** | 见 §3；多成员回归 `src/assembly-global-p3.test.ts`（3 用例）已绿 |

> P3 的**多成员回归**部分（纯 faijs 构件、不经运行时 op 提升）已完成并全绿；被阻断的只是**真实 `assembly.fai.js` 经 `runtime.execute` 跑通**这条链路。

### 2.1 本阶段测试状态（2026-09-17 实测）

| 套件 | 结果 |
|---|---|
| `packages/cq-compat` `npx vitest run assembly` | **5 文件通过 / 1 文件跳过，23 用例通过 / 6 跳过，exit 0** |
| ├ `assembly-constraints.test.ts`（P1.5） | 11 通过 |
| ├ `assembly-global-e2e.test.ts`（P2） | 3 通过 |
| ├ `assembly-global-p3.test.ts`（P3 多成员回归） | 3 通过 |
| ├ `assembly-compare-p0b.test.ts`（P0b） | 2 通过 |
| ├ `assembly-lift-boundary.test.ts`（缺陷守卫，本阶段新增） | 4 通过 |
| └ `assembly-mini-lathe-e2e.test.ts`（P3 真验收） | **6 跳过（`describe.skip`，见 §3）** |
| `packages/core` `npx vitest run src/api/assembly`（含 chain 回归） | **8 文件 / 88 用例全绿，exit 0** |
| └ 覆盖 `global-solver.test.ts` / `solve.test.ts` / `kinematics.test.ts` / `preview.test.ts` / `pose` / `validate` / `joints` / `joints-ik` | 13 用例属 global-solver；其余为 chain 路径回归 |

**结论：本阶段交付物（P0/P0b/P1/P1.5/P2 + P3 多成员回归）全部可运行、测试全绿；唯一未完成项 = 真实 `assembly.fai.js` 的运行时端到端（§3 阻断）。**

## 3. ⛔ 唯一阻断项：cq-compat 装配函数的 op 提升边界

### 3.1 现象

真实 `packages/mini_lathe/src/assembly.fai.js` 经 `runtime.execute` 执行时，**第一条约束 c1**（源文件第 10 行）即失败：

```
failedAt = { index: 6, lineNo: 10, callee: 'constraint', code: 'E_OP_FAILED' }
message  = [faijs/op] constraint: E_OP_FAILED: Cannot read properties of undefined (reading 'length')
源码行    = let c1 = cq.constraint("bp", ">Z", bottom_plate, "mb", "<Z", middle_bottom, "Plane")
```

### 3.2 已排除的假设（都做了实测）

| 假设 | 结论 | 证据 |
|---|---|---|
| 是 c7（首个引用 axk 的约束）失败 | ❌ 错。`failedAt.lineNo=10` 明确是 **c1** | 打印 `failedAt.lineNo` + 对应源码行 |
| `resolveFaceSelector` 不支持 axk 的 `>Z`/`<X` | ❌ 错。bp/mb/axk 各选择器**全部解析成功** | 直接调用 `resolveFaceSelector` 对 4 组选择器全 OK |
| 6 个部件 BREP handle 失效 | ❌ 错。6 部件 `hasBrep=true` / `brepOf` 非空 | 逐部件打印 |
| `constraint`/`faceRef`/`constraintEx` 实现有 bug | ❌ 错。**绕过 op 包装直接调用完全正常**，返回合法 `{type:'mate', a, b}` | 在测试进程内 raw 调用 `cq.constraint(c1)` → OK |
| 返回值经 `adoptOut`/`adoptEntity` 出错 | ❌ 错。`adoptEntity` 对无 `wrapped` 的普通对象原样返回 | 读 `l3-bridge.ts:140` |

### 3.3 根因链（已确证，含堆栈）

1. cq-compat 命名空间**不含任何 dual-op**（仓内无 `defineOp` 导出）→ `hasDualOp(ns)=false` → `runtime.ts:401` 推断 `lift = true`。
2. `registerLib` → `admitCompatLib` 用 **`compatOp` 提升每个裸导出函数**（brep-only，B4）。`constraint`/`constraintEx`/`faceRef`/`buildAssembly` 全在此列。
3. `compatOp` 适配器（`core/src/api/internal/compat-op.ts` `buildAdapter`，第 159 行）在调用实现前先 `borrowDeep` 实参：**faijs `Shape` → 借用 brepjs 视图** `{ wrapped, disposed, delete, onDispose }`。
4. 该视图 `isShape=false`、`brepOf=undefined`（实测）→ `resolveFaceSelector` 的 BREP 分支 `if (handle && dir)` 不成立 → 落到 **`workplane.ts:631` 整形状 bbox 兜底** → `bboxMax` → `cad.bboxMax` → `mesh/query.ts:20` 读 `shape.vertices` 为 undefined。
5. TypeError 被 `define-op.ts:199 toOpFailure('constraint', e)` 包成 `[faijs/op] constraint: E_OP_FAILED: …`。

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

### 3.4 为什么"单测全绿、e2e 红"

`assembly-global-e2e.test.ts` / `assembly-global-p3.test.ts` 与全部 core 求解器测试都是**在测试进程内直接调用** `buildAssembly` / `solveGlobal`，**不经运行时 op 提升**，因此绕过了该缺陷。只有把真实 `.fai.js` 交给 `runtime.execute` 才会命中。这正是本项目「单测全绿 ≠ 产物可用」的又一例。

### 3.5 修复方向（未实施，供接手人选择）

1. **在 `resolveFaceSelector` 接受借用句柄（最小改动）**：`const handle = brepOf(shape)` 之后补一条「结构识别」分支——若 `shape` 不是 faijs Shape 但持有 occt 句柄（`isOcctWasmHandle(shape)` 或 `shape.wrapped`），直接用它做 face 枚举。同时 `bboxMax/bboxMin` 兜底也需能处理借用视图，否则仍会崩。
2. **让装配辅助函数不再走 compatOp 提升（结构性）**：把 `constraint`/`constraintEx`/`faceRef`/`buildAssembly` 声明为真正的 faijs op（`defineOp({ brep })`）→ 但它们一旦挂 `DUAL_OP_META`，`hasDualOp(cqNs)` 变 true → **整个 cq-compat 命名空间的 lift 会被关掉**，其余按 brepjs 形状写的函数会坏。需配合按函数粒度的 lift 覆盖（引擎当前无此能力，要加）。
3. **在 `assembly.ts` 入口做入参归一**：函数首行把「借用视图」还原/转成可用句柄（读 `.wrapped` 取回 occt 句柄），下游全部改吃句柄而非 faijs Shape。改动面在 cq-compat 包内、不动引擎，**推荐优先评估**。

> 三条路都要一并决定：`cq.constraint` 走 `compatOp` 时天然是 **brep-only**（mesh 模式抛 `E_MESH_UNSUPPORTED`），这与 FCStd 产物的「整链路 brep-only」是同一结论。

## 4. 交接文件清单

**引擎（`packages/core/src/`）**
- `api/assembly/solvers/global-solver.ts`（18818B）— LM + 代价族 + B4 锚定 + 诊断
- `api/assembly/solvers/linalg.ts`（4854B）— 自实现 Cholesky / 带主元 Gauss-Jordan（不 import vendored）
- `api/assembly/solvers/pose-from-delta.ts`（1919B）— ΔT/ΔR → SolverPose（模长参数化四元数）
- `api/assembly/solvers/types.ts`（2482B）— `SolveOptions` / `SolverStyle` / 诊断类型
- `api/assembly/solvers/global-solver.test.ts`（8763B，13 用例）
- `api/assembly/solve.ts` — 加 `SolveOptions` 分派 + `residuals` 字段
- `api/compound.ts` — `AssemblyParams.solver` / `AssemblyBehavior.solver` + 两处透传

**cq-compat（`packages/cq-compat/src/`）**
- `assembly.ts` — `constraintEx`（7 类）+ `pointRef`/`axisRef` + `resolveAxisRef` 修复 + `buildAssembly` 默认 `global`
- `assembly-compare.ts` — `pairing` 三模式（P0b）
- `index.ts` — 导出 `pointRef`/`axisRef`/`constraintEx`
- `assembly-constraints.test.ts`（11）、`assembly-global-e2e.test.ts`（3）、`assembly-global-p3.test.ts`（3）、`assembly-compare-p0b.test.ts`（2）、**`assembly-lift-boundary.test.ts`（4，缺陷守卫）**
- `assembly-mini-lathe-e2e.test.ts`（6 用例，**当前 `describe.skip`**，断言完整保留）

**mini_lathe（`packages/mini_lathe/scripts/`）**
- `export-cadquery-ref.py` — 导出 CQ 参考位姿 JSON（+49 行）
- `compare-poses.ts` — world bbox_min 差值比对（local bbox_min 抵消 → 精确反映堆叠平移差）
- `assembly-baseline.json` — P0 基线（参考位置 + chain 现状 + 公差目标 + 复现命令）

**文档**
- `docs/api-contract.md` §12 — 新增 Global solver 条目（converged 恒 true / residuals 逐约束 / warnings 替代抛错 / B4 锚定 / pivot 恒 `[0,0,0]`）

## 5. 接手必读的坑

- **compatOp lift 语义**：`registerLib` 的 `autoLift` 缺省 = `!hasDualOp(ns)`。库命名空间只要没有 dual-op，**所有**裸函数都会被 `compatOp` 提升为 brep-only op，且实参照例先经 `borrowDeep`（faijs Shape → 借用视图）。写「吃 Shape 的库函数」时必须按这个边界设计。见 §3.3。
- **CLI 链路陷阱**：`assembly.fai.js` import `@faicad/cq-compat` → 解析到 **stale dist**；cq-compat dist 又 import `@faicad/faijs-core` → **stale dist**。用 CLI 跑真实装配前必须先 `npm run build`（core + root）+ `npm run build -w @faicad/cq-compat`；否则 global 默认不生效、P3 看不到改进。**本阶段的 e2e 因此改为在 vitest 内直接消费 `src/`**（用 `createFsProjectLoader` + `projectKeyOf` 装载多文件 `assembly.fai.js`，绕过 dist）。
- **occt-wasm teardown segfault**：整 suite 退出码可能为 1，属噪音（输出完整）；按文件单跑可确认真假。
- **brep-only 边界**：`cq.constraint` 经 lift 后是 brep-only；FCStd 产物整链路同样 brep-only。
- **自由旋转 DOF**：mate/align/concentric 在接触法向留有自由旋转，解出的四元数不固定 → 断言只能验几何不变量，**不要断言具体四元数/绝对平移**（axk 的 x/y 平移即因自由 Z 自旋而不确定）。
- **CQ 参考位姿订正**：`mini_lathe_poses.json` 中 **axk 与 mb/mt/tp 同为「180° Z 翻转」**（`R[0][0]=R[1][1]=-1`、`R[2][2]=1`），并非"axk 另含特殊 x/y 旋转"。axk translation=(5.7717, 6.2517, −10.0)。

## 6. 留给接手人的事项（按优先级）

1. **修 §3.5 的 op 提升边界**（阻断 P3）。修完删掉 `assembly-mini-lathe-e2e.test.ts` 的 `.skip`；`assembly-lift-boundary.test.ts` 的守卫断言会转红，届时翻转它们（这就是"修好了"的信号）。
2. **跑通 P3 验收**：`assembly-mini-lathe-e2e.test.ts` 6 用例全绿 = 8 条约束求解、bp 冻结、mb/mt/tp 的 Z 堆叠进 1e-2mm、axk 旋转结构 + 平移落 1mm 邻域。
3. **P3 未能核实的两条**（因阻断而未执行）：
   - CLI 全链路重导出 `out/mini_lathe.step` 后跑 `compare-poses.ts`（需先重建两份 dist）；
   - 性能实测（计划 §6.4 要求把一次求解耗时写进 `baseline.json`，且"不把估算当验收"）。
4. **core 回归：已跑，全绿**——`npx vitest run src/api/assembly` 8 文件 / 88 用例通过（含 `solve.test.ts` / `kinematics.test.ts` / `preview.test.ts`）。chain 路径未受影响：`cad.assembly` 仍默认 `chain`，只有 cq-compat `buildAssembly` 默认 `global`。
5. **文档**：`docs/api-contract.md` 的 global 条目已写；若 §3.5 的修法改变 `resolveFaceSelector` 语义，需同步。

## 7. 复现命令速查

```bash
# 真实装配 e2e（当前 skip；修好后去掉 .skip）
cd packages/cq-compat && npx vitest run assembly-mini-lathe-e2e.test.ts --no-coverage

# 缺陷守卫（借用视图崩溃 / runtime.execute 下 c1 失败）
cd packages/cq-compat && npx vitest run assembly-lift-boundary.test.ts --no-coverage

# cq-compat 装配全套
cd packages/cq-compat && npx vitest run assembly --no-coverage

# core 求解器单测
cd packages/core && npx vitest run src/api/assembly/solvers --no-coverage

# CQ 参考位姿重生成
C:\Users\ylt\cadquery-env\Scripts\python.exe packages/mini_lathe/scripts/export-cadquery-ref.py
```

> 环境：Node 用 `C:\Users\ylt\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`；Git Bash 下 `npx` 被沙箱拦，跑 vitest/tsx 一律改用 PowerShell。

## 8. 相关材料

- 执行计划：`docs/plans/2026-09-17-assembly-global-solver-plan.md`
- 设计依据（裁定 1–6 / B1–B10）：`docs/plans/2026-09-08-assembly-dual-solver.md`
- 缺陷守卫测试：`packages/cq-compat/src/assembly-lift-boundary.test.ts`
- 契约：`docs/api-contract.md` §12（Assembly）
- 本阶段逐日记录：`.workbuddy/memory/2026-09-17.md`
