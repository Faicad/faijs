# faijs 装配求解器扩展开发计划（扩展现有求解器，不重造）

> 日期：2026-10-10
> 范围仓库：`@faicad/faijs` monorepo（`packages/core/src/api/assembly/`）
> 关联计划：`faijs-cadquery/docs/plans/2026-10-10-cadquery-next-phase-plan.md`（N3 节，cq-compat 兼容层，本计划不覆盖）

---

## 0. 范围与边界（铁律）

1. **本计划只改 faijs 的装配求解 / 编排 machinery**（`packages/core/src/api/assembly/` 下的 `solvers/`、`types.ts`、`normalize.ts`、`validate.ts`、`lower.ts`、`solve.ts`、`entities.ts`）。
2. **绝不在 `faijs-cadquery` 写任何求解器 / 装配内核代码。** `faijs-cadquery` 只做 cq-compat 兼容层（5 参 `constrain` DSL、镜像、manifest、回归）。其 N3 节已重写成「扩展现有求解器 + 补兼容层」，其中 P1/P2/P5-compat 属 cq-compat，**不触碰求解算法**。
3. **前提纠正（带代码证据）：faijs 已自带纯 TS 求解器，不存在「无求解器需自研」的前提。** `packages/core/src/api/assembly/solvers/global-solver.ts`：
   - 顶部注释（行 1–19）明示：复刻 CQ `occ_impl/solver.py` 语义、LM 替代 IPOPT、**零原生/WASM 依赖**。
   - 已实现 `point_in_plane`（行 139–146）、`point_on_line`（行 147–155）代价项；`pushCoincident`（行 435–454）已支持 `point↔plane`→`point_in_plane`（行 440–441）、`point↔axis`→`point_on_line`（行 447–448）。
   - ⇒ **P1（`PointInPlane` 2 条）/ P2（`PointOnLine` 3 条）纯属 cq-compat 适配，无需改 faijs 内核**——cq-compat 把 CQ 的 `PointInPlane`/`PointOnLine` 翻译成 `coincident(point, plane)`/`coincident(point, axis)` 即可命中现有代价项。

---

## 1. 现状盘点（带路径 / 行号，fact-check 过）

| 模块 | 位置 | 现状 | 缺口 |
|---|---|---|---|
| 全局求解器 | `solvers/global-solver.ts` | `point_in_plane`/`point_on_line` 已实现；`fixed`（行 208–214）只把整成员锁死为 identity | 无「子实体锚定到世界字面坐标/轴」的 world-anchored unary 约束；约束 switch（行 232–274）缺 `fixedPoint`/`fixedAxis`/`fixedRotation` |
| 约束类型 | `types.ts` | `StructuralConstraint` 联合（行 116–125）含 9 类；`FixedConstraint`（行 110–113）仅 `{type, part}` | 缺上述三类型接口 |
| 运行期校验 | `validate.ts` | `ASSEMBLY_CONSTRAINT_TYPES`（行 30–33）白名单；`checkOne`（行 91–137）对 `fixed` 有 V5 特殊分支 | 三类型未进白名单（`validate` 会先拦），且需新增 V 分支 |
| 规范化 | `normalize.ts` | `normalizeConstraint`（行 20–36）白名单（行 28–34） | 三类型需进直通白名单（否则 fail-fast 抛错） |
| 降级 | `lower.ts` | `lowerStructuralConstraint`（行 139–174）无三类型分支 | 需决定映射 brepjs 等效还是明确 unsupported |
| 编排入口 | `solve.ts` | `solveAssembly`（行 61–124）/`solveGlobal` 均为**扁平** `members/memberNames/constraints` | 嵌套子装配的「树 flatten + 再组合」缺失 |
| 树原语 | `solvers/assembly-tree.ts` | 已有 `AssemblyNode{children}`（行 26–36）、`walkAssembly`（行 140–149）、`findNode`（行 124–131）、`collectShapes`（行 169–175） | 仅数据结构，无递归求解 / 变换复合 |
| 单测模板 | `test/api/assembly/solvers/global-solver.test.ts` | 快照实体引用 + 解析期望位姿对拍（`faceRef/pointRef/axisRef` 行 24–32、`applyTransform` 行 37–45、`solveOne` 行 57–61） | 无三类型 / 嵌套用例 |

调用链（确认）：`compound.ts` 的 `assembly(params)` → `validateConstraints`（`validate.ts`）→ `normalizeConstraint`（`normalize.ts`）→ `lowerStructuralConstraint`（`lower.ts`）→ `solveAssembly`/`solveGlobal`（`solve.ts`）。**五处必须全链路一致放行**。

---

## 2. 14 条 `op:assembly-solve` 用例聚类 × 归属仓库

| 集群 | 条数 | 用例 | 归属 | faijs 是否需改 |
|---|---|---|---|---|
| P1 `PointInPlane` | 2 | `test_PointInPlane_constraint__*`、`test_PointInPlane_3_parts__*` | cq-compat（`faijs-cadquery`） | 否（复用 `coincident(point, plane)`） |
| P2 `PointOnLine` | 3 | `test_point_on_line__*` | cq-compat | 否（复用 `coincident(point, axis)`） |
| **P3 `FixedPoint`/`FixedAxis`/`FixedRotation`** | **3** | `test_unary_constraints__*` | **faijs 内核（本计划）** | **是** |
| **P4 嵌套子装配** | **5** | `test_constrain__nested_assy`、`subassy1/2`、`test_constrain_with_tags__nested_assy`、`test_expression_grammar__nested_assy` | **faijs 编排（本计划）** | **是** |
| P5 表达式语法 / 子实体寻址 | 1 | `test_expression_grammar__nested_assy`（与 P4 重叠） | 混合（faijs `entities.ts` 健壮性 + cq-compat 选择器翻译） | 部分（faijs 侧） |

> B 类实时计数（faijs-cadquery manifest）：`op:assembly-solve` 14 + `op:faceOn` 1 = B 余 15。本计划解锁 faijs 内核侧 3（P3）+ 编排侧 5（P4）+ 部分 1（P5），合计 faijs 侧最多 9 条；余下 P1/P2（5 条）由 cq-compat 直接命中现有求解器解锁。

---

## 3. P3 — 世界锚定 unary 约束（faijs 内核，3 条）

### 3.1 语义（源自 CQ `occ_impl/solver.py` / `assembly.py`）

- `FixedPoint(part, world)`：把 `part` 的某个子实体（顶点 / 面中心 / 原点）钉到**世界字面坐标** `(x,y,z)`。仅约束该点，不锁定整件朝向 / 平移其余自由度。
- `FixedAxis(part, worldDir)`：把 `part` 的某个轴（边 / 面法向）钉到**世界字面方向** `(x,y,z)`。
- `FixedRotation(part[, quat])`：锁定 `part` 的**朝向**（允许平移，不允许旋转）。

> CQ 语义关键：`FixedPoint`/`FixedAxis` ≠ 整件 `Fixed`。它们是 unary，但只钉子实体到世界，成员其余 DOF（尤其旋转）仍自由——故**不得**把该成员整体塞进 `lockedSet`（行 277–292 的 B4 锚定逻辑）。

### 3.2 类型层（`types.ts`）

新增三个接口并并入 `StructuralConstraint`（行 116–125）与 `AssemblyConstraint`（行 149）联合：

```ts
export interface FixedPointConstraint {
  type: 'fixedPoint'
  a: EntityRef            // 待钉定的成员子实体（{part, point} / {part, face} / {part, edge}）
  world: AssemblyVec3     // 世界字面坐标
}
export interface FixedAxisConstraint {
  type: 'fixedAxis'
  a: EntityRef            // 待钉定的成员轴（{part, edge} / {part, face}）
  worldDir: AssemblyVec3  // 世界字面方向（无需单位化，求解器内 vnormalize）
}
export interface FixedRotationConstraint {
  type: 'fixedRotation'
  part: PartName          // 仅锁朝向，平移自由
}
```

### 3.3 校验层（`validate.ts`）

- `ASSEMBLY_CONSTRAINT_TYPES`（行 30–33）加 `'fixedPoint' | 'fixedAxis' | 'fixedRotation'`。
- `checkOne`（行 91–137）：新增分支——
  - `fixedPoint`/`fixedAxis`：需 `a`（EntityRef，走 `checkEntityRef` 的 V4/V5）+ `world`/`worldDir`（类比 V3：有限数 vec3）。
  - `fixedRotation`：只需 `part`（类比 V5 的 `fixed` 分支，行 112–122）。

### 3.4 规范化（`normalize.ts`）

把三类型加入 `normalizeConstraint` 直通白名单（行 28–34），或重构为「`StructuralConstraint` 联合成员全部直通」消除枚举遗漏风险。

### 3.5 求解器核心（`global-solver.ts`）—— 本计划最大代码量

**机制（最小侵入，复用现有 `point`/`axis` 代价项，裁定 1：world == local）：**

- 引入「世界哨兵」：代价项 `ib = -1` 表示世界系；`stateOf(-1)` 返回 identity（T=R=0，仿行 315）；`markerPoint`/`markerDir` 对世界 marker 不施加任何变换（marker 本身已存字面坐标，`resolveMarker` 的 `point`/`axis` 分支直接返回 `m.p`/`m.dir`）。
- `fixedPoint`：`a` 解析为 point marker `mA`；构建 `mb = {type:'point', p: world}`、`ib = -1`；压入 `point` 代价（`val:0, scaleFlag:true`，仿行 437）。残差 = 成员点世界坐标 − `world`。
- `fixedAxis`：`a` 解析为 axis marker `mA`；`mb = {type:'axis', origin:[0,0,0], dir: normalize(worldDir)}`、`ib = -1`；压入 `axis` 代价（`val:0, scaleFlag:false`，仿行 443）。残差 = 成员轴方向 − `worldDir`。
- `fixedRotation`：压入 3 条 `axis` 代价，把成员的本地 X/Y/Z 轴分别钉到世界 X/Y/Z（`mb = {type:'axis', dir: worldAxis, origin:[0,0,0]}, ib = -1`），平移保持自由。
- **B4 锚定修正（行 277–292）**：三类型均入 `unarySet`（仿行 210）但不入 `lockedSet`——只靠代价项约束，不冻结整件。`binaryOrder`（行 221）只收 binary 约束的 part，B4 的 `if (!unarySet.has(b))`（行 280）天然跳过纯 world-anchored 成员；仍需验证「全 unary 场景」的 `order[0]` 兜底（行 289–292）不误锁——测试用例均有 binary 约束可避免，作为实现时必查项。
- **`scalePts` 覆盖（行 229–230）**：world-anchored 分支同样要把成员 marker 点 push 进 `scalePts`，保证 `computeScale`（行 479–491）覆盖这些点。

### 3.6 chain-solver 路径（次要，标注为后续）

- `lower.ts` 对三类型：优先映射为 brepjs 等效（`lowerEntities` 同编码规则，复用 `axisFromFace`）；若 brepjs 不支持则在该路径明确 `unsupported`（不静默）。CQ 兼容主路径是 `solver:'global'`，故 chain 映射可后置，但 `validate` 放行后不得让 chain 路径崩。

### 3.7 测试（`test/api/assembly/solvers/global-solver.test.ts`）

新增 `describe('global-solver: fixedPoint / fixedAxis / fixedRotation')`：
- `fixedPoint`：钉 A 原点到 world `[0,0,-3]` → `applyTransform(t, A.origin) ≈ [0,0,-3]`；A 其余朝向自由（断言旋转近 identity 或仅验证点约束）。
- `fixedAxis`：钉 A 某面法向到 world `[0,1,1]` 方向 → `applyDir(t, A.normal) ≈ normalize([0,1,1])`。
- `fixedRotation`：A 旋转被锁（`applyDir` 恒世界轴），平移自由（A 中心可动）。
- 复用现有 `faceRef/pointRef/axisRef`（行 24–32）+ `applyTransform/applyDir`（行 37–55）+ `expectVecNear`（行 66–69）。

### 3.8 验收

- `packages/core` vitest（`global-solver.test.ts`）+ `typecheck` + `lint` 全绿。
- 发布新版 `@faicad/faijs`（lockstep）——**cq-compat 必须等此发布后才能消费新约束类型**。

---

## 4. P4 — 嵌套子装配（faijs 编排，5 条）

### 4.1 语义

成员本身可以是子 `Assembly`，`solve()` 递归下钻；CQ `Assembly.solve()` 把每个对象的 `loc` 累积合成世界变换。

### 4.2 设计（flatten + 全局求解 + 再组合，对齐 CQ 全局语义）

- 新增 `solve-tree.ts`（或扩展 `solve.ts`）：`solveAssemblyTree(root: AssemblyNode, opts): Record<nodeName, AssemblyTransform>`。
  1. **flatten**：`walkAssembly`（行 140–149）收集叶 shape + **qualified member name**（如 `subassy.part`），构建扁平 `members/memberNames`；约束名引用用 qualified name（可跨层引用）。
  2. **solve**：调 `solveGlobal`（或 base `solveAssembly`）。
  3. **recompose**：自顶向下将每层局部 solve 变换与父变换复合（`parentTransform ∘ childLocalTransform`），得到每个叶节点的世界变换。
- `compound.ts` 的 `assembly(params)` 需接受嵌套 children（当前扁平），把 child `AssemblyNode` 透传进树。

### 4.3 测试

新增 `test/api/assembly/solve-tree.test.ts`：两层嵌套（root + subassy(subpartA, subpartB)），约束跨层，断言各叶世界位姿与 CQ 预期一致（快照实体）。

### 4.4 验收

- vitest + `typecheck` + `lint`；发布。

---

## 5. P5 — 表达式语法 / 子实体寻址（混合，1 条）

- **faijs 侧（本计划）**：`entities.ts` 的 `resolveSolverEntity`/`resolveFaceGeometryOfRef` 需稳健支持从子实体引用（`topoRef` / `faceIndex` / `point`）定位，并确保嵌套成员 qualified name 下的实体解析正确。
- **cq-compat 侧（faijs-cadquery 计划）**：把 CQ 表达式选择器（`b2@faces@>Z`）翻译成 faijs `EntityRef`。本计划**只负责 faijs 解析器健壮性**，不负责 CQ 语法翻译。
- 测试：`global-solver.test.ts` 或 `entities.test.ts` 加子实体寻址用例（含 qualified name 跨层）。

---

## 6. 执行顺序与提交纪律

- **顺序**：P3（faijs 内核）→ 发布 `@faicad/faijs` → P4（faijs 编排）→ 发布 → 之后 `faijs-cadquery` 计划的 P1/P2/P5-compat 才能消费新约束类型 / 嵌套能力。
- **每集群独立 commit**（英文 conventional，如 `feat(assembly): add world-anchored fixedPoint/fixedAxis/fixedRotation constraints`）。
- **门禁（faijs monorepo 走 lefthook）**：`verify-export-jsdoc` / `eslint(staged)` / `whitespace` / `line-ending` / `verify-translation-pairing` / `check-lockstep` / `check-ghost-deps` 全过；**禁 `--no-verify`、禁 `Co-Authored-By`、禁 `git stash`**；显式 `git add <path>`（禁 `git add -A`）；`package.json` scripts 为准，无范围蔓延。
- **捕获优先**：P3/P4/P5 每项先冻结 CQ 真值（终态位姿矩阵）再实现，逐位对拍。

---

## 7. 风险与捕获优先

- **五处一致性**：新增约束类型触动 `types`/`validate`/`normalize`/`lower`/`solver`，须保证「`validate` 放行 → `normalize` 直通 → `lower`/`solver` 处理」全链路一致，否则 `normalize` fail-fast 抛错或 `lower` 缺分支静默 unsupported。
- **B4 误锁**：world-anchored unary 不得触发整件锁定（§3.5 已述），实现时必查 `order[0]` 兜底分支。
- **嵌套变换复合**：recompose 的 `parent ∘ child` 顺序与 pivot（`[0,0,0]`，裁定 5）须与 CQ 逐位一致。

## 8. 与 faijs-cadquery 计划的接口

faijs 侧发布后，cq-compat 在 `src/assembly/assembly.ts` 暴露 5 参 `constrain(partA, subA, partB, subB, kind, param)`：

| CQ 约束 | cq-compat 翻译 | 依赖 |
|---|---|---|
| `PointInPlane` | `coincident(point, plane)` | 现有求解器（P1，纯 cq-compat） |
| `PointOnLine` | `coincident(point, axis)` | 现有求解器（P2，纯 cq-compat） |
| `FixedPoint`/`FixedAxis`/`FixedRotation` | 透传新约束类型 | **本计划 §3 发布** |
| 嵌套子装配 | 嵌套 `AssemblyNode` 构造 | **本计划 §4 发布** |
| 表达式语法 | CQ 表达式 → faijs `EntityRef` | 本计划 §5 + cq-compat |

**cq-compat 不写任何求解算法**，只做 DSL 翻译 + 镜像 + manifest + 回归。
