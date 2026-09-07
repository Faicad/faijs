# faijs 装配约束：以 brepjs 求解能力取代现有 face_mate 实现

- 日期：2026-09-06
- 状态：**已落地（P0+P1）**；P1 第 6/7 条与 §7 R8 已于 2026-09-07 修订——遗留 `solveFaceMate` 与 faijs 自有四元数实现**必须删除**（不再是"可选收敛点"），删除任务落在 [2026-09-07-assembly-p2-syntax-host-p3-joints.md](./2026-09-07-assembly-p2-syntax-host-p3-joints.md) §2.8 **P2-f5**
- 范围：`packages/core/src/api/`（装配求解）、`packages/core/src/topology/naming/`（hint 扩展）、`packages/core/src/lang/`（语法/schema）、`../3d_editor`（宿主适配）
- 相关契约：`docs/api-contract.md`、`docs/ops-api-inventory.md` §6.1、`docs/syntax-design.md`

---

## 0. 用户原始需求（原文照录）

> 本项目vendor的brepjs库有多个装配约束和求解的功能。而faijs自己只有一个面对面约束。请分析如何让brepjs的约束成为默认的约束，能否代替原有的faijs实现。通过../3d_editor项目，了解目前的装配功能是如何使用的。如何在.fai.js代码中使用完整的brepjs装配能力。.fai.js中的api要如何设计？请写一份md的技术实现方案。

拆解成本方案要回答的五个问题：

| # | 问题 | 结论落点 |
|---|---|---|
| Q1 | brepjs 有哪些装配约束与求解能力 | §2.2 |
| Q2 | 能否代替 faijs 现有 face_mate 实现 | §3（**可替求解内核，不可替约束语义**） |
| Q3 | 3d_editor 目前如何使用装配 | §2.3 |
| Q4 | .fai.js 中如何用完整 brepjs 装配能力 | §5 |
| Q5 | .fai.js 的 API 如何设计 | §5 |

---

## 1. 结论摘要（先给答案）

1. **能替，但只能替"求解内核"，不能替"约束语义"。** brepjs 的 `kernel/solverAdapter.ts` 是**零内核依赖的纯数学解析求解器**，可以整体搬来做 faijs 的装配求解内核，白拿：多约束链式拓扑调度、DOF 统计、`converged` 收敛判定、`unsupported` 诊断。
2. **brepjs 的 `operations/mateFns.ts` 不能直接用。** 它的 `MateEntity` 持有 **OCCT 活句柄**（`Face`/`Edge`），走 `faceFns.faceAxis → getKernel()`；而 `.fai.js` 的语句参数必须 **JSON 可序列化**（写进脚本文本、跨重放指认同一个面）。活句柄进不了脚本 —— 这是根本冲突，实体抽取层必须在 faijs 侧用 TopoRef 重写。
3. **现有 `face_mate` 必须保留为一种约束类型，但求解器不必自写。** 它的语义是「法向反向 + **面中心重合**」，而 brepjs 的 `coincident(plane, plane)` 只做「共面」、保留面内 2 个平移 DOF，直接换会让 3d_editor 现有装配结果漂移、破坏存量 `.fai.js`。但 §3.7 证明了 **`mate` 可精确降级为单条 `concentric` + 轴编码**（旋转、平移、退化分支、剩余 DOF 全部逐项等价），因此链式调度 / DOF / `converged` 可以全部白拿，无需自写复合合成器。
4. **`.fai.js` API 走向：单一 `constraints` 数组 + 统一 `EntityRef` + CAD 习惯的约束名**，内部规范化为 brepjs 的 `SolverConstraint`。详见 §5。
5. **必须先补一个 P0 前置**：`FaceHint` 没有轴信息、`EdgeHint` 没有方向信息，导致 mesh 路径上做不了真·`concentric`（圆柱同轴 / 圆边）。不补这个，约束类型扩到一半会卡死在双链路上。注意 **平面贴合不需要等 P0**（只需 `center + normal`，`FaceHint` 已有）。
6. **「组合多条 brepjs 约束」这条路是死的**：`solveConstraints` 每个节点只定位一次、覆盖而非叠加，且各 `solve*` 只返回部分位姿。任何复合语义必须在单条约束内解完（§3.7.1）。

---

## 2. 现状盘点

### 2.1 faijs 侧：只有 `face_mate`

全部集中在 `packages/core/src/api/compound.ts`：

```ts
export type FaceMateFace = { topoRef: FaceTopoRef } | { surfaceType?, center, normal }

export interface FaceMateConstraint {
  type: 'face_mate'
  fixedPartName: PartName
  movingPartName: PartName
  fixedFace:  FaceMateFace
  movingFace: FaceMateFace
}

export type AssemblyConstraint = FaceMateConstraint   // ← 并集里只有一个成员
```

求解链路（四段，各管一段）：

| 阶段 | 位置 | 职责 |
|---|---|---|
| ① 解析几何 | `api/topo-resolve.ts:resolveFaceGeometry` | TopoRef → `{surfaceType, center, normal}`；BREP 走 `captureFaceHint`，mesh/primitive 走 `slot.faceHints` 快照 |
| ② 求解 | `api/compound.ts:solveTransforms` → `solveFaceMate` | 旋转使 `movingNormal → -fixedNormal`，平移 `translation = fixedCenter - movingCenter` |
| ③ 登记 | `runtime-state.ts:207 AssemblyTransform` + `setPendingAssemblyTransforms` | 库只写结果，不碰 DAG |
| ④ 应用 | `cad-runtime/module-executor.ts:527 applyPendingAssemblyTransforms` | mesh 顶点烘焙（`mesh/rigid-transform.ts:applyTransform`）+ BREP 刚体变换 + `computeDownstream` 下游失效重算 |

**faijs 现有的 6 个硬限制**（这是要被替换掉的东西）：

| # | 限制 | 证据 |
|---|---|---|
| L1 | 只有 1 种约束类型，且语义写死为"面对面贴合" | `AssemblyConstraint = FaceMateConstraint` |
| L2 | **无链式**：每条约束独立按"成员此刻的世界坐标"求解，多约束作用于同一成员时后写覆盖前写 | `solveTransforms` 逐条 `solveFaceMate`，无节点位姿状态 |
| L3 | **无 DOF / 无收敛判定**：不区分欠约束、过约束、不可解 | 求解结果只有 `AssemblyTransform[]`，无 `dof`/`converged` |
| L4 | **无锚定语义**：谁动谁不动由每条约束的 `fixedPartName` 逐条指定，没有"地基"概念 | 无 `fixed` 约束类型 |
| L5 | **只认 center/normal**：拿不到轴，做不了同轴/插入 | `ResolvedFaceGeometry {surfaceType, center, normal}` |
| L6 | **输出是 per-constraint 增量，不是 per-member 终态** | `out.push({index: movingIndex, ...transform})`；引擎逐条原地 `applyTransform` → 两条约束打到同一成员会**叠加两次** |

L6 是现存缺陷，不是设计选择：链式求解后必须改成"每成员一条最终 pose"。

### 2.2 brepjs 侧：五个模块，能力远大于 faijs

| 文件 | 行数 | 能力 |
|---|---|---|
| `vendored/brepjs/operations/assemblyFns.ts` | 130 | `AssemblyNode` 树（name/shape/translate/rotate/children/mates/joints）、`createAssemblyNode`/`addChild`/`findNode`/`walkAssembly` |
| `vendored/brepjs/operations/mateFns.ts` | 199 | 5 种 mate：`coincident` `concentric` `distance` `angle` `fixed`；`addMate` / `solveAssembly` |
| `vendored/brepjs/kernel/solverAdapter.ts` | 384 | **纯数学解析求解器** `solveConstraints(nodes, constraints)` → `{transforms, dof, converged, unsupported}` |
| `vendored/brepjs/operations/jointFns.ts` | 463 | 运动副 `revolute`/`prismatic`/`cylindrical`(2DOF)/`planar`(3DOF)/`spherical`(3DOF)；`forwardKinematics`、`mechanismDOF`、`setJointValue(s)` |
| `vendored/brepjs/operations/ikFns.ts` + `dhFns.ts` | — | `inverseKinematics`、`jointTrajectory`、`jointsFromDH`（DH 参数） |

**solverAdapter 的关键性质（决定可复用性）：**

- **零内核依赖**：整个文件只 `import { quatRotate, quatFromAxisAngle, quatFromTo } from '../utils/quaternion.js'`。对比 `mateFns.ts` 走 `faceFns.faceAxis → getKernel()` —— 前者双链路通用，后者 BREP only。
- **实体模型**：`SolverEntity = { type: 'plane'|'axis'|'point', origin, normal?, direction? }` —— 纯数据。
- **求解算法**：拓扑轮次（`while(progress)`），reference 节点已放置才解 dependent；chain root 与显式 `fixed` 节点锚在原点。**多体链天然可组合**。
- **支持的实体对**（`TRANSLATIONAL_PAIRS`）：`plane-plane`、`plane-point`、`point-plane`、`point-point`、`axis-axis`、`axis-point`、`point-axis`。
- **`concentric` 要求 axis-axis；`angle` 要求 plane-plane**（`REQUIRED_ENTITIES`）。
- **每节点只被定位一次**：`transforms.set(dep.node, solveMate(...))` 后 `placed.add(dep.node)`，后续约束遇到已放置的 dependent 直接 `continue`。**复合约束不能被拆成多条来表达**，这点直接决定了 §5 的 API 形态。
- **`dof` 只统计 unsupported 的自由度**（`UNSUPPORTED_DOF` 表），是诊断量，不是 Grübler 全局自由度。

**当前状态：这五个模块在 faijs 的 API 面上全是 `skip`。** `packages/core/src/api/surface/arg-spec.ts`：

```
name:'addMate',          kind:'skip', reason:'装配约束 DSL（AssemblyNode+kernel 面/边），skip'
name:'solveAssembly',    kind:'skip', reason:'约束求解场景（kernel 句柄），skip'
name:'addJoint',         kind:'skip', reason:'装配场景（AssemblyNode 输入），skip'
name:'forwardKinematics',kind:'skip', reason:'装配运动链场景输入，skip'
name:'mechanismDOF',     kind:'skip', reason:'装配场景输入，skip'
```

即：brepjs 的装配能力**一行都没接进 `cad` 命名空间**。本方案就是在填这个坑。

### 2.3 3d_editor 侧：目前怎么用装配

调用链（`../3d_editor`）：

```
用户选两个面
  → src/engine/topology/capture-topo-ref.ts:faceTopoRefFromRow(scopedId, faceRowIndex)
      从最近一次 ExecutionResult.naming 取 FaceNaming 行 → captureTopoRef(row) → FaceTopoRef
      （已有 edgeTopoRefFromRow，边拾取通道已通；命名缺失返回 null，绝不静默取序号）
  → 预览：src/stores/tools/assemble-store.ts:565
      import { solveFaceMate } from '@faicad/faijs/browser'   ← 直接调 faijs 纯函数做预览
  → 提交：confirmAssemble()
      flush 装配前的 translate/rotate 成独立脚本语句
      → model-store.ts:1748 createAssembly({ memberIds, constraints })
          FaceConstraint{fixedScopedId,...} → faijs FaceMateConstraint{fixedPartName:'part0',...}
          （scopedIdToVarName：scopedId → PartName 字符串）
      → src/engine/features/assembly.ts:buildAssemblyCode + buildDoAssembleCode
          产出两行：
            let asm1 = cad.assembly({ name, members:[part0,part1], constraints:[...] })
            asm1.do_assemble()
      → ScriptEngine.appendAndCommit([...]) 增量执行
          do_assemble 触发 faijs 重放，从 face 数据实时 solveFaceMate 重算并应用
```

**关键事实：**

- **UI 上没有任何约束类型选择器。** `src/engine/components/panels/AssemblyPanel.tsx` 只有「固定面 ✓ / 活动面 ✓」两行状态 + 重置 + 确认。**用户无法选 mate/concentric/distance**。要接 brepjs 的多约束能力，UI 必须先长出类型选择器 + 边/点拾取。
- **预览与执行同源**：3d_editor 直接 `import { solveFaceMate }` 做预览，注释写明「与预览同一算法，结果必然一致」。**替换求解内核时，这个导出的纯函数必须保持同签名或提供等价替代，否则预览/执行会不一致。**
- **约束只存 face 数据，不存 transform**（v8 设计原则）：变换是派生值，重放时实时重算。新方案必须继续遵守。
- **一次装配只处理两个部件**（`if (s.fixedFace && s.movingFace)` 单条），链式能力当前用不上，但多部件装配是显式需求。

### 2.4 `.fai.js` 中拓扑引用的现状语法（面 / 边 / 点）

**先说最关键的事实：`lang/` 层（parser / codegen / args-schema）完全不处理 TopoRef。** 在 `.fai.js` 里，TopoRef 就是一个**普通的对象字面量** —— acorn 把它当普通 JS 表达式解析，执行期作为 `params` 的一部分直接传给库函数。没有专门语法、没有字面量校验、没有 codegen 特殊分支。

> 换言之，**拓扑引用的「语法」就是 TypeScript 类型 `TopoRef` 的字面量写法**，它不是一门 DSL。这一点决定了后面所有 API 设计：加语法糖只能在**库函数入参形态**上做文章，不能指望 parser 支持。

#### 四类引用的字面量结构（`topology/naming/types.ts`）

**① 面 `FaceTopoRef`**

```js
{ kind: 'face', origin: 'part0', role: 'box:top',
  hint: { kind: 'face', surfaceType: 'plane', center: [0,0,10], normal: [0,0,1], area: 400 } }
```

- `origin`：血缘**链根**的 part 变量名（字符串）
- `role`：该起点内的语义名（见下表）
- `hint`：几何兜底，字段全可选，缺省也合法

**② 边 `EdgeTopoRef`** —— 边 = 两邻面之交

```js
{ kind: 'edge',
  faces: [ { origin: 'part0', role: 'box:top' }, { origin: 'part0', role: 'box:front' } ],
  hint: { kind: 'edge', length: 20, midpoint: [0,-10,10] } }
```

`faces` 是 **`RoleQualifier` 数组**（每项自带 `origin`），不是裸 role 串 —— 布尔合流后一条边的两个邻面可能来自不同链根（§3.6）。

**③ 顶点 `VertexTopoRef`** —— 顶点 = ≥3 邻面之交

```js
{ kind: 'vertex',
  faces: [ {origin:'part0', role:'box:top'},
           {origin:'part0', role:'box:front'},
           {origin:'part0', role:'box:right'} ],
  hint: { kind: 'vertex', position: [10,-10,10] } }
```

**④ 生成面 `DerivedFaceTopoRef`** —— 倒角/圆角过渡面

```js
{ kind: 'derived-face', op: 'chamfer',
  between: [ {origin:'part0', role:'box:top'}, {origin:'part0', role:'box:front'} ],
  hint: { kind:'derived-face', normalA:[...], normalB:[...], edgeMidpoint:[...] } }
```

四类**均有解析实现**：`resolve-face.ts` / `resolve-edge.ts` / `resolve-vertex.ts` / `resolve-derived.ts`；解析失败按 `E_TOPO_DELETED` / `E_TOPO_AMBIGUOUS` / `E_TOPO_NOT_FOUND` 三码抛错，**禁止静默取序号硬取**。

#### `role` 的命名规则（`topology/naming/roles.ts`）

| 图元 | 可用 role |
|---|---|
| box | `box:top/bottom/front/back/left/right`（按外法向主轴，`AXIS_THRESHOLD` 判定） |
| cylinder | `cylinder:top/bottom`（端盖，仅平面）+ `cylinder:lateral` |
| cone | `cone:top/bottom` + `cone:lateral` |
| sphere | `sphere:surface` |
| 其它（布尔 / 变换 / 导入网格之后） | **`''` 空串** —— 只能靠 `hint` 几何兜底裁决 |

> ⚠️ **这是手写拓扑引用的最大障碍**：部件一旦经过布尔、倒角或变换，role 退化为空串，作者无法在脚本里指名某个面。因此**拓扑引用实际上只能由宿主 UI 拾取生成**，手写仅在图元直出时可行。

#### 装配里的实际写法

**新形态（§6.2，推荐）**

```js
let asm1 = cad.assembly({
  name: '装配1',
  members: ['part0', 'part1'],
  constraints: [{
    type: 'face_mate',
    fixedPartName:  'part0',
    movingPartName: 'part1',
    fixedFace:  { topoRef: { kind:'face', origin:'part0', role:'box:top',
                             hint:{ kind:'face', surfaceType:'plane' } } },
    movingFace: { topoRef: { kind:'face', origin:'part1', role:'cylinder:bottom',
                             hint:{ kind:'face' } } },
  }],
})
asm1.do_assemble()
```

**旧快照形态（兼容存量）**

```js
fixedFace: { faceId: 'o1.f6', surfaceType: 'plane', center: [0,0,10], normal: [0,0,1] }
```

几何在 UI 拾取时冻结。`faceId` 是快照内地址层，**已随 §6.2 移除、不再写入**（见 `compound.ts` 的 `@note`），存量脚本仍可读。

#### 三处现存不一致（P1 实施前必须先定）

1. **部件引用形式不对称（现状如此，保留）**：3d_editor 实际生成的是 **`members` 裸变量 + `fixedPartName` 字符串**（`script-engine.test.ts:1823` 样本：`members:[part0,part2], fixedPartName:'part0'`；`model-store.ts:1774` 的映射代码同此）。`parser-assembly.test.ts` 里 `members: ['part0','part1']` 字符串数组也能过 —— 因为 parser 对对象字面量参数**不做校验**，测试写法与宿主真实产出脱节。**处置：不对称保留（§5.1 C3），以 3d_editor 形态为唯一权威；parser 测试的字符串写法不作为规范依据。**
2. **`origin` 的取值口径**：`chamfer.ts:237` 示例写 `origin: 'box'`（图元类型名），`compound.ts:297` 写 `origin: 'part0'`（变量名）。按 `RoleQualifier` 的权威定义（*"origin = 该面血缘起点的 part 变量名"*），**正确值是 part 变量名**，`chamfer.ts` 的示例有误，应随本次改动一并修正。
3. **没有语法糖，手写成本极高**：边要写两个 `RoleQualifier`、顶点要写三个。这决定了 §5.2 的 `EntityRef` 必须保留 `faceIndex` 这类「不稳定但手写友好」的调试简写，同时 UI 拾取路径仍走 `topoRef`。

---

## 3. 可替代性判定（Q2）

### 3.1 逐项对照

| 维度 | faijs `face_mate` | brepjs `mateFns` + `solverAdapter` | 判定 |
|---|---|---|---|
| 约束类型数 | 1 | 5（+7 种实体对组合） | brepjs 完胜，**应替** |
| 链式多体 | 无 | 拓扑轮次调度，链根锚原点 | brepjs 完胜，**应替** |
| DOF / 收敛诊断 | 无 | `dof` + `converged` + `unsupported[]` | brepjs 完胜，**应替** |
| 锚定（地基） | 无 | `fixed` 约束 | brepjs 完胜，**应替** |
| 求解数学 | 单条封闭解 | 通用解析解（共面/共线/共点/夹角/定距） | **部分可替**（见 3.2） |
| 实体引用 | TopoRef（可序列化、跨重放稳定） | 内核活句柄（不可序列化） | **faijs 必须保留**，brepjs 不可用 |
| 面中心对齐 | 有（强贴合） | 无（coincident 只共面） | 经 §3.7.2 axis 编码由 `concentric` 承担 |
| 法向反向（flip） | 有 | 无（plane-plane 不旋转） | 经 §3.7.2 dep 侧法向取反由 `concentric` 承担 |
| mesh 链路 | 可用（faceHints 快照） | 不可用（`getKernel()`） | **faijs 必须保留** |
| 变换输出 | `{quaternion, pivot, translation, rotationMatrix}` | `{position, rotation}`（无 pivot） | 需**显式转换契约**（§4.3） |

### 3.2 为什么 `mate` 不能直接映射成 brepjs 的 `coincident`

这是整个方案里最容易踩的语义坑，单列一节。

- brepjs `coincident(plane_ref, plane_dep)` → `solvePlanePair`：**只沿 `ref.normal` 平移使两面共面**，`rotation = IDENTITY`。面内 2 个平移 DOF 保留。这是**正确的 CAD 语义**（共面 ≠ 中心对齐）。
- faijs `face_mate` → `solveFaceMate`：**先旋转**使 `movingNormal = -fixedNormal`（Rodrigues 最短弧），**再平移** `fixedCenter - movingCenter`。中心重合 + 共面。约束 5 个 DOF，**绕贴合面法向的自旋未约束（剩 1 DOF）** —— 见 §3.7.2(c) 的修正说明。

两者解的**不是同一个问题**。若把 `face_mate` 直接改成 `coincident`，3d_editor 里所有已保存的装配在重放后部件会沿面内方向漂移 —— 静默破坏存量数据。

**结论：`mate` 保留为 faijs 的约束类型名；求解按 §3.7.2 降级为单条 `concentric` + 轴编码进 solver（不自写合成器）。`coincident` 作为 brepjs 原语义约束新增。二者并存，由作者显式选择。**

> ⚠️ **遗留 `solveFaceMate` 的处置（2026-09-07 修订）**：P1 阶段它被**临时保留**为 T3/T4 的等价性基准；它以及 faijs 自有四元数实现**不是长期资产**——P2-f5（09-07 方案 §2.8）先把 G1–G4 的期望值冻结成 golden 基准，再整体删除。此处"保留"仅指 P1 阶段。**任何情况下不允许出现"新旧两套装配算法并存"的终态。**

### 3.3 判定答案

> **能代替的是「求解架构」：拓扑调度、链式组合、DOF 统计、收敛判定、不支持诊断 —— 全部用 brepjs 的 `solverAdapter`。**
> **不能直接用的是「实体引用」与「约束的原生形态」：TopoRef 解析、`pivot` 变换模型在 faijs 侧实现后喂给求解器；`mate`（flip+中心对齐）按 §3.7.2 编码为 `concentric` 后进 solver —— faijs 侧只保留映射层，不自写求解。**

工程形态一句话：**brepjs 当发动机，faijs 做变速箱和方向盘。**

---

### 3.4 活句柄问题的根因：brepjs 有两套引用机制，mateFns 用了对 faijs 无效的那一套

`MateEntity` 的类型（`operations/mateFns.ts:23`）：

```ts
export interface MateEntity {
  node: string
  face?: Face       // ← vendored/brepjs/core/shapeTypes.ts:115
  edge?: Edge       // ← vendored/brepjs/core/shapeTypes.ts:105
  point?: Vec3
}
```

`Face` / `Edge` 是 `ShapeHandle & { brand }`，而 `ShapeHandle`（`core/disposal.ts:131`）是：

```ts
export interface ShapeHandle {
  readonly wrapped: KernelShape      // KernelShape = any —— OCCT wasm arena 里的句柄
  [Symbol.dispose](): void
  delete(): void
  readonly disposed: boolean
  onDispose(callback: () => void): void
}
```

**三个致命性质：** ① `wrapped` 指向 wasm 内存，**不可序列化**；② 带 `disposed` 生命周期，**会失效**；③ faijs 每次改参都整链重放、几何重建，**句柄跨重放全部作废**。所以句柄**写不进 `.fai.js`**，而 `.fai.js` 是纯文本脚本、参数必须跨重放指认同一个面。这是根本冲突。

**但 brepjs 自己其实有第二套机制**（`topology/shapeRef/shapeRefTypes.ts`）：

```ts
export interface ShapeRef { origin: string; role: string; hint: GeometricHint }
export interface EdgeRef  { origin: string; faceRoles: readonly [string,string]; hint: EdgeHint }
```

入口文件 `vendored/brepjs/shapeRef.ts` 的文档注释写得很清楚：*"stable, **serializable** face references that survive parametric replay"*。

| | 第一套：活句柄 | 第二套：ShapeRef（纯数据） |
|---|---|---|
| 可序列化 | **否** | **是** |
| 跨重放存活 | **否** | **是** |
| `operations/` 层是否使用 | **全部使用** | **一个都没有** |

根因不是 brepjs 设计失误，而是**执行模型不同**：brepjs 是**命令式库**，用户一步步调 API、句柄一直在手边，不需要跨重放；faijs 是**声明式脚本 + 重放引擎**，必须靠纯数据引用。`mateFns` 按命令式惯例写，对 faijs 就不适用 —— 需要在 faijs 侧补上「引用 → 几何」这一步。

### 3.5 范式参照：chamfer 的两套实现，正好演示了这个差别

**brepjs（`vendored/brepjs/topology/chamferAngleFns.ts:34`）：**

```ts
export function chamferDistAngle(shape: Shape3D, edges: Edge[], distance: number, angleDeg: number) {
  const rawEdges = edges.map((e) => e.wrapped)                       // ← 活句柄直接进内核
  raw = kernel.chamferDistAngle(shape.wrapped, rawEdges, distance, angleDeg)
}
```

调用方必须先自己拿到 `Edge` 对象 —— **引用与执行在同一进程、同一步骤内完成**，中间没有"重放"这回事。

**faijs（`api/chamfer.ts:239`）：**

```ts
export const chamfer = defineOp({
  capabilities: ['directEdit'],
  brep(input: Shape, params: Record<string, unknown>) {
    const edges = params.edges as EdgeTopoRef[]            // ① 纯数据引用，来自 .fai.js
    const ctx = buildEdgeResolutionContext(kernel, input)  // ② 建解析上下文（活面/边候选 + roleTable + 邻接表）
    const handles = edges.map((e) => resolveTopoRef(e, ctx).handle)   // ③ 执行期解析 → 活句柄
    return fromBrep(solidToShape(kernel, kernel.chamfer(solid, handles, width)), {...})  // ④ 立刻用完
  },
})
```

`.fai.js` 里长这样（`api/chamfer.ts:237` 的 `@example`）：

```js
await cad.chamfer(part0, { edges: [{ kind: 'edge',
  faces: [{ origin: 'box', role: 'box:top' }, { origin: 'box', role: 'box:front' }],
  hint: { kind: 'edge' } }], type: 'equal', width: 1 })
```

**三要素范式（装配必须照抄这个）：**

| # | 要素 | chamfer 的落点 | 装配的对应落点 |
|---|---|---|---|
| 1 | **引用可序列化** | `EdgeTopoRef`（纯数据，进脚本） | `EntityRef`（§5.2） |
| 2 | **解析在执行期** | `buildEdgeResolutionContext` + `resolveTopoRef`（带 `score.ts` 评分与 `deleted`/`ambiguous`/`not-found` 三态错误，绝不静默取错） | `api/assembly/entities.ts` 复用同一通道 |
| 3 | **句柄是瞬态** | 解析出来立刻喂 `kernel.chamfer`，不进脚本、不跨语句 | 抽取完几何立即丢弃句柄 |

### 3.6 解决方案：给 mateFns 补上「引用解析」，并整层跳过句柄

**关键洞察：`solverAdapter` 吃的是纯数据 `SolverEntity`，不是句柄。** 所以不需要「解析成句柄再喂 brepjs」—— 可以**完全跳过句柄这一层**，只在抽取几何的瞬间借用一下：

```
brepjs 原链路：MateEntity{face: Face句柄} → extractEntity() → faceAxis(face) → getKernel() → SolverEntity
                                             ↑ 整条链只有这一步需要句柄

faijs 新链路：EntityRef{part, face:{topoRef}}
                → resolveTopoRef(ctx)      ← 复用 chamfer 同一通道
                → 活句柄 → captureGeometry  ← 句柄只在这一次调用内存在
                → 丢弃句柄 → SolverEntity{type:'plane'|'axis'|'point', origin, normal?, direction?}
                → solveConstraints()        ← brepjs 纯数学，全程无句柄
```

`extractEntity` 的等价重写（`api/assembly/entities.ts`）保持与 brepjs 相同的输出契约，只换输入：

| `MateEntity` 输入 | faijs `EntityRef` 输入 | 输出 `SolverEntity` | 几何来源 |
|---|---|---|---|
| `face`（平面） | `{part, face:{topoRef}}` | `{type:'plane', origin:center, normal}` | 现状已有 |
| `face`（圆柱/圆锥） | 同上 | `{type:'axis', origin, direction}` | **需 P0 的 `FaceHint.axis`** |
| `edge`（直边） | `{part, edge:{topoRef}}` | `{type:'axis', origin:起点, direction:切向}` | `curvePointAtParam` / `curveTangent`（`BrepEngineApi` 已有） |
| `edge`（圆边） | 同上 | `{type:'axis', origin:圆心, direction:平面法向}` | ** P0 真缺口** |
| `point` | `{part, point:[x,y,z]}` | `{type:'point', origin}` | 现状已有 |

**为什么不用 brepjs 的 `ShapeRef`/`EdgeRef`，而要 faijs 自己的 TopoRef？**

- brepjs：`EdgeRef = { origin, faceRoles: [string, string], hint }` —— **单个 origin + 两个裸 role 串**
- faijs：`EdgeTopoRef = { faces: [RoleQualifier, RoleQualifier], hint }` —— **每个面各自带 origin**

差异根源见 `topology/naming/types.ts:53` 的注释：*"faijs 扩展：两面可能来自布尔合流后的不同 origin，故用 RoleQualifier（带 origin 的稳定 role）而非 brepjs 的裸 role 串"*。布尔合流后一条边的两个邻面可能来自不同链根，裸 role 串无法区分 —— 这是 faijs 的**必要扩展**，不是重复造轮子。`ShapeRef` 对面（`{origin, role, hint}`）与 faijs `FaceTopoRef` 基本同构，可直接互转。

---

### 3.7 Q：`face_mate` 语义能否「组合」brepjs 多条约束实现？

**答：多条组合走不通（架构级阻断）；但单条 `concentric` 可以精确等价（数学已证，含退化分支）。**

#### 3.7.1 为什么「组合多条」不行

直觉上的方案是两条叠加：

1. `angle(faceA, faceB, 180)` → 法向反向（约束 2 个旋转 DOF）
2. `coincident(point_centreA, point_centreB)` → 面中心重合（约束 3 个平移 DOF）

合起来正好是 `face_mate`。但 `solveConstraints` 有三道阻断：

| 阻断 | 位置 | 代码/事实 |
|---|---|---|
| ① 每个节点只被定位一次 | `solverAdapter.ts:362` | `if (placed.has(dep.node)) continue` —— 第二条约束对同一 dependent 直接跳过 |
| ② 覆盖而非叠加 | `solverAdapter.ts:369` | `transforms.set(dep.node, solveMate(...))` —— 后者覆盖前者，不是 compose |
| ③ 各 `solve*` 只返回「部分位姿」 | `solverAdapter.ts:135` / `:105` | `solveAngle` 硬编码 `position: [0,0,0]`；`solvePlanePair` 硬编码 `rotation: IDENTITY` |

**第 ③ 条是根因。** 所有 `solve*` 共享同一个假设——*"The dependent is at the origin (a node is only solved once, while unplaced)"*。它们各自只解自己那一部分，设计上确实是为互相配合而生的，但 `solveConstraints` **没有提供任何合成或迭代机制**。这不是 bug，而是它"每个节点由一条定位约束确定"的模型。

> **推论：在 solverAdapter 现有架构下，「用 N 条约束共同定位 1 个节点」这条路是死的。任何复合语义都必须在单条约束内解完。**

#### 3.7.2 但不需要组合：单条 `concentric` 精确等价 `face_mate`

关键是把 `face_mate` 换个说法：

> 两个面贴合 ⟺ **moving 面的内法向与 fixed 面的外法向同向，且两面中心重合**

而 `concentric` 的语义正是「两个**有向轴**同向共线」。于是把面编码成轴：

```ts
// faijs 侧映射层：face → SolverEntity
function axisFromFace(face: ResolvedFaceGeometry, flip: boolean): SolverEntity {
  return {
    type: 'axis',
    origin: face.center,
    direction: flip ? negate(face.normal) : face.normal,
  }
}
// face_mate 的编码：
//   entityA(ref) = axisFromFace(fixedFace,  flip: false)   // 外法向
//   entityB(dep) = axisFromFace(movingFace, flip: true)    // 内法向
```

`flip` 不是 hack，而是贴合语义的正解：两个面贴合时，A 的外法向本来就与 B 的内法向重合。

**（a）旋转等价性**

| | from → to |
|---|---|
| faijs `compound.ts:153` | `R  = quaternionFromUnitVectors(n2, -n1)` |
| brepjs `solverAdapter.ts:117` | `R' = quatFromTo(dDep, dRef) = quatFromTo(-n2, n1)` |

`R'` 作用在 `n2` 上：`R'·n2 = -(R'·(-n2)) = -n1` —— 与 `R` 的目标一致。且最短弧四元数由 `(dot, cross)` 唯一确定：

| | faijs | brepjs |
|---|---|---|
| `dot` | `n2·(-n1)` | `(-n2)·n1` |
| `cross`（旋转轴） | `n2 × (-n1)` | `(-n2) × n1` |

两列逐项相等（`-1` 提出后符号抵消），故 **同 dot、同旋转轴 ⇒ `R ≡ R'`**。

退化分支亦对齐：

- `d ≥ 1-1e-9` → identity：两侧一致
- `d ≤ -1+1e-9` → 绕 `normalize(cross(a, ref))` 转 180°，其中 `ref = |a.x| < 0.9 ? [1,0,0] : [0,1,0]`：**两侧同一个判据、同一根轴**
- 非退化分支归一化分母同为 `hypot(1+d, |c|)`，仅输出分量顺序不同（wxyz vs xyzw，见 §4.3）

**（b）平移等价性**

brepjs `solveConcentric` 返回 `position = ref.origin − R·dep.origin`。solverAdapter 对 dependent 的语义是 `p_world = R·p_local + position`，代入得：

```
p_world = R·p + (p1 − R·p2)                              … (1)
```

faijs `solveFaceMate` 返回 `pivot = p2`、`translation = p1 − p2`，引擎按 `p' = R·(p − pivot) + pivot + translation` 烘焙：

```
p' = R·(p − p2) + p2 + (p1 − p2) = R·p − R·p2 + p1       … (2)
```

**(1) ≡ (2)** ✓

反过来说：若要求新链路输出的 `AssemblyTransform` 与旧 `solveFaceMate` 逐分量一致（存量兼容），只需令 `pivot = movingFace.center` —— 代入 §4.3 的换算公式后 `translation` 自动化简为 `p1 − p2`。

**（c）DOF 也一致 —— 并修正前文的一处错误**

两者都只锁定了轴（法向）的方向与原点位置，**绕轴自旋均未约束** ⇒ 均剩 **1 个 DOF**。

> **⚠️ 修正：** 本方案早期草稿称 `face_mate` 为「0 DOF」，**不准确**。`quaternionFromUnitVectors` 是 Rodrigues 最短弧旋转，只负责把 `n2` 转到 `-n1`，绕 `-n1` 的自旋分量为零、完全自由。实测语义是**约束 5 个 DOF、剩 1 个自旋 DOF**（对轴对称件无感，对非对称件表现为自由自旋）。brepjs `concentric` 同样是 1 DOF，故替换**无回归**。

#### 3.7.3 对方案的影响：P1 可以去掉「自有合成器」

原计划 P1 要自写一个复合约束合成器。按 §3.7.2，不需要：

```
原计划：EntityRef → 解析 → faijs 合成器（自写 flip + 中心对齐） → 自写链式调度
现计划：EntityRef → 解析 → axis 编码 → brepjs concentric   → brepjs solveConstraints
                                        ↑ 链式调度 / DOF / converged / unsupported 全部免费
```

`mate` 在 `.fai.js` 里仍是一个独立约束类型名（作者写 `mate`），但**求解时降级为 brepjs `concentric` + 轴编码**，实现落在 faijs 的映射层，**零 vendored 修改**。

`face_mate` 与 `coincident` 并存的结论不变：`coincident(plane, plane)` 是「只共面、保留面内 2 个平移 DOF」，`mate` 是「反向 + 中心重合」，是两种不同语义，仍须并存由作者显式选择。

#### 3.7.4 适用边界

| 情形 | 能否用 axis 编码 | 说明 |
|---|---|---|
| 平面 ↔ 平面贴合 | ✅ | 只需 `center + normal`，**不需要内核 axis**（`FaceHint` 已有）⇒ 不阻塞 P0 |
| 圆柱面 ↔ 圆柱面同轴 | ✅ | 真·轴，需要 `getSurfaceParams` 的 axis（P0 缺口） |
| 圆柱面 ↔ 平面贴合 | ❌ | 不适用本技巧；若需要则新增约束类型 |
| 需要锁定面内自旋（真 0 DOF 贴合） | ❌ | `concentric` 做不到；需新增类型 + 面内参考方向，或后处理 |

**一条易错的约定**：dependent 侧 entity 必须是**本地坐标**，reference 侧由 `transformEntity` 转到世界（`solverAdapter.ts:368`）。这条由 solverAdapter 保证，映射层只需按约定填，不要在 faijs 侧重复做世界变换。

---

## 4. 目标架构

### 4.1 分层

```
.fai.js 文本层
  cad.assembly({ members, constraints, joints? })  +  asm1.solve()
        │
        ▼
L3  api/assembly/normalize.ts   约束规范化 + 向后兼容（face_mate → mate）
        │
        ▼
L3  api/assembly/lower.ts       faijs 类型 → SolverConstraint（全部直译降级）
        │                          mate   → concentric + dep 侧 axis 取反（§3.7.2）
        │                          align  → concentric + 两侧 axis 不取反
        │
        ▼
L3  api/assembly/entities.ts    EntityRef → SolverEntity（TopoRef 解析，BREP/mesh 双链路）
        │                              ▲
        │                              │ 扩展 FaceHint.axis / EdgeHint.axis（P0 前置）
        ▼
L3  api/assembly/solve.ts       委派 → vendored/brepjs/kernel/solverAdapter.js:solveConstraints
        │                     （全部 5 类约束；拓扑调度 / DOF / converged 由 brepjs 提供）
        ▼
    AssemblyTransform（per-member 终态，pivot = dep 实体 origin）→ runtime-state.setPendingAssemblyTransforms
        │
        ▼
引擎  module-executor.applyPendingAssemblyTransforms
      mesh 烘焙 + BREP 刚体变换 + computeDownstream 下游失效   ← 这一段不动
```

**原则：**
- `vendored/` 下**不改文件**（`NOTICE` 声明 "no two-way sync" 的锁定上游快照，改动会造成未来同步成本）。只 `import` 其已导出的 `solveConstraints`。
- 引擎侧（第 ④ 段）**零改动** —— 求解产出仍是 `AssemblyTransform[]`，只是语义从 per-constraint 改为 per-member（L6 修复）。
- 对外 API（`solveFaceMate` / `applyTransform`）**保持导出且签名不变** —— 3d_editor 预览链路依赖它（§2.3）。

### 4.2 求解流程

```
solveAssembly(members, constraints, kernel):
  1. nodes      = memberNames[]                     // 可能含空串，需先断言（风险 R7）
  2. entities   = constraints.flatMap(c => [a,b].map(toSolverEntity))   // TopoRef → 几何
  3. lowered    = constraints.map(lower)            // faijs 类型 → SolverConstraint（全部直译）
        mate      → concentric + dep 侧 axis 编码取反法向   // §3.7.2
        align     → concentric + 两侧 axis 编码不取反
        coincident/concentric/distance/angle/fixed → 直译
  4. solverResult = solveConstraints(nodes, lowered)     // ← brepjs（含链式拓扑调度）
  5.（无自有合成步骤 —— mate/align 已在步骤 3 降级，调度与 compose 全部由 brepjs 完成）
  6. dof       = solverResult.dof
     converged = solverResult.converged
  7. out = Map<memberIndex, Pose> → AssemblyTransform[]（每成员一条，修 L6；pivot = 该约束 dep 实体 origin）
  8. 不收敛 → 抛错，错误信息带 unsupported[] 明细（沿用 E_ASSEMBLY_NOT_CONVERGED 语义）
```

> 步骤 3 的降级是本方案的关键简化：原先规划「自有合成器 + 自写拓扑序 compose」两步，现全部由 brepjs 承担，faijs 只保留 **EntityRef → SolverEntity 的映射层**（含 axis 编码）。代价是 `mate` 的实现细节隐含在编码里，必须在映射层写清注释并配等价性测试（§4.3 验收）。

### 4.3 核心转换契约（必须单元测试锁死）

brepjs 与 faijs 的位姿模型**有两处不一致**，这是集成事故高发区：

**（a）四元数分量顺序**
- brepjs `utils/quaternion.ts`：`[w, x, y, z]`
- faijs `compound.ts:quaternionFromUnitVectors`：`[x, y, z, w]`

```ts
// api/assembly/pose.ts
export const fromBrepjsQuat = (q: QuatWXYZ): FaijsQuat => [q[1], q[2], q[3], q[0]]
export const toBrepjsQuat   = (q: FaijsQuat): QuatWXYZ => [q[3], q[0], q[1], q[2]]
```

**（b）pivot 语义**
- brepjs：`p' = R·p + position`（绕**原点**旋转，无 pivot）
- faijs：`p' = R·(p − pivot) + pivot + translation`

令 `pivot` = dependent 实体的 origin（面中心 / 轴点 / 点坐标），二者等价当且仅当：

```
translation = position − pivot + R·pivot
position    = (pivot − R·pivot) + translation
```

```ts
export function poseToAssemblyTransform(pose: Pose, pivot: Vec3): AssemblyTransform {
  const q = fromBrepjsQuat(pose.rotation)
  const m = quaternionToMatrix3(q)
  const rp = mat3MulVec(m, pivot)
  return {
    index: -1,                                   // 由调用方按成员下标回填
    quaternion: q,
    pivot,
    translation: [pose.position[0] - pivot[0] + rp[0],
                  pose.position[1] - pivot[1] + rp[1],
                  pose.position[2] - pivot[2] + rp[2]],
    rotationMatrix: m,
  }
}
```

**（c）`mate` 的 axis 编码契约（§3.7.2 的落地形式）**

```ts
// api/assembly/lower.ts
/** 面 → 有向轴。flip=true 取内法向（贴合语义：A 的外法向 = B 的内法向）。 */
function axisFromFace(f: ResolvedFaceGeometry, flip: boolean): SolverEntity {
  return {
    type: 'axis',
    origin: f.center,                                   // dep 侧填本地坐标，ref 侧由 brepjs 转世界
    direction: flip ? neg(f.normal) : f.normal,
  }
}

function lowerMate(c: MateConstraint): SolverConstraint {
  return {
    type: 'concentric',                                 // ← 降级：mate 寄生在同心约束上
    entityA: { node: c.fixedPart,  entity: axisFromFace(c.fixedFace,  false) },  // ref
    entityB: { node: c.movingPart, entity: axisFromFace(c.movingFace, true)  },  // dep
  }
}
```

`align`（同向贴合）唯一区别是 `entityB` 的 `flip: false`。

**验收测试（P1 必交，对应 P1 清单 T3/T4）——具体输入数据：**

| 组 | fixedCenter p₁ | fixedNormal n₁ | movingCenter p₂ | movingNormal n₂ | 预期 |
|---|---|---|---|---|---|
| G1 一般 | (0, 0, 10) | (0, 0, 1) | (5, 0, 0) | (1, 0, 0) | 旋转把 +X 转到 −Z；p₂ 落到 p₁ |
| G2 已贴合 | (0, 0, 10) | (0, 0, 1) | (0, 0, 10) | (0, 0, −1) | 旋转 = identity（dot=+1 分支） |
| G3 反平行 | (0, 0, 10) | (0, 0, 1) | (0, 0, 10) | (0, 0, 1) | 旋转 = 绕任意垂直轴 180°（dot=−1 分支） |
| G4 垂直 | (0, 0, 10) | (0, 0, 1) | (0, 0, 10) | (1, 0, 0) | 旋转把 +X 转到 −Z，中心不动 |

对每组：`solveFaceMate(p₁, n₁, p₂, n₂)` 与「新链路 `mate` 约束求解」产出的 `AssemblyTransform` **逐分量相等（1e-9）**。G2/G3/G4 专门覆盖两条路径的退化分支判据漂移（两侧 antiparallel 轴选择规则须一致，见 §3.7.2(a)）。

**注意事项（实现者必读）：**
- `n₁/n₂` 入参**不必预归一化**（`solveFaceMate` 内部 normalize），测试数据里也可混入非单位向量再验一轮。
- 浮点断言用逐分量 `Math.abs(a-b) < 1e-9`，不用 `toEqual`（四元数符号双解：q 与 −q 同旋转，实现里两条路径用的是同一 `quatFromTo` 公式，不应出现符号翻转；若出现，按"同旋转等价类"处理并记录偏差原因）。

---

## 5. `.fai.js` API 设计（Q4 / Q5）

### 5.1 设计约束（先立规矩）

| 约束 | 说明 |
|---|---|
| C1 **可序列化** | 约束参数必须 JSON 安全，能写进 `.fai.js` 文本，能跨重放指认同一面。内核句柄一律禁止。 |
| C2 **向后兼容** | `cad.assembly({name, members, constraints:[{type:'face_mate', ...}]})` + `asm.do_assemble()` 继续零改动工作。 |
| C3 **成员引用一致** | `members` 是裸变量引用（编译为 var-ref），`fixedPartName`/`part` 是 **PartName 字符串**（3d_editor 现状如此，见 `model-store.ts:1774`）。新 API 沿用这套不对称，不折腾。 |
| C4 **a 是参考、b 是从动** | 统一用 `a`/`b`，语义对齐 brepjs 的 `entityA`(ref) / `entityB`(dependent)：**移动 b 去贴合 a**。 |
| C5 **不新增顶层字段优先** | 能从 `constraints` 表达的就不加顶层参数（`grounded` 用 `{type:'fixed'}` 表达，不新增 `grounded:` 字段）。 |
| C6 **派生值不入库** | 变换永远是重放时算出来的，约束对象里不存 transform（v8 原则）。 |

### 5.2 实体引用 `EntityRef`

```ts
type EntityRef =
  | { part: PartName; face:  FaceRef }        // 面
  | { part: PartName; edge:  EdgeRef }        // 边（直边→轴；圆边→轴线）
  | { part: PartName; point: [number,number,number] }   // 点（局部坐标）
  | { part: PartName; faceIndex: number }     // 序号简写（手写友好，不稳定，仅调试）

type FaceRef =
  | { topoRef: FaceTopoRef }                                  // 首选：宿主拾取生成，跨重放稳定
  | { surfaceType?: string; center: Vec3; normal: Vec3 }      // 几何快照：兼容/手写
type EdgeRef =
  | { topoRef: EdgeTopoRef }
  | { axis: { origin: Vec3; direction: Vec3 } }               // 快照
```

`EntityRef → SolverEntity` 的抽取规则（对齐 brepjs `mateFns.extractEntity`）：

| 输入 | 输出 SolverEntity | 备注 |
|---|---|---|
| 平面（圆柱面以外的面） | `{type:'plane', origin:center, normal}` | 现状已有 |
| 圆柱/圆锥/回转面 | `{type:'axis', origin, direction}` | **需 `FaceHint.axis`** |
| 直边 | `{type:'axis', origin:起点, direction:切向}` | **需 `EdgeHint.direction`** |
| 圆边 | `{type:'axis', origin:圆心, direction:平面法向}` | **需 `EdgeHint.center/direction`** |
| point | `{type:'point', origin}` | 现状已有 |

### 5.3 约束类型总表

`.fai.js` 用 **CAD 习惯名**，内部规范化为 brepjs `SolverConstraint.type`：

| `.fai.js` type | 规范化 → solver | 语义 | 实体要求 | 求解来源 |
|---|---|---|---|---|
| `mate` | `concentric` + dep 侧 axis 编码取反法向 | 面对面贴合：法向**反向** + 面中心重合 | plane, plane | brepjs（§3.7.2 降级，**无自有合成器**） |
| `align` | `concentric` + 两侧 axis 编码不取反 | 同向对齐：法向**同向** + 面中心重合 | plane, plane | brepjs（同 §3.7.2，仅 flip=false） |
| `coincident` | `coincident` | 共面/共点/共线（**保留面内 2 DOF**） | 7 种实体对 | brepjs |
| `concentric` | `concentric` | 轴重合（孔轴配合 / 插入） | axis, axis | brepjs |
| `distance` | `distance` | 定距（mm），带 `value` | 7 种实体对 | brepjs |
| `angle` | `angle` | 夹角（deg），带 `value` | plane, plane | brepjs |
| `parallel` | `angle`(0) | 平行（语法糖） | plane, plane | brepjs |
| `perpendicular` | `angle`(90) | 垂直（语法糖） | plane, plane | brepjs |
| `fixed` | `fixed` | 锚定该部件（地基） | 只需 `part` | brepjs |
| `face_mate` | → `mate` | **遗留别名**，规范化时改写；不出现在新代码里 | plane, plane | 同 `mate` |

> 明确**不做**（避免范围膨胀）：`tangent`（相切，需迭代求根，brepjs 也没有）、`symmetric`（对称）、`gear`（齿轮啮合，属 `gear-lib-demo` 职责）、`cam`（凸轮）。

### 5.4 完整示例

```js
// 主轴组件：底板 + 轴承座 + 轴 + 齿轮
let part0 = cad.box(60, 40, 10, { centered: true })    // 底板
let part1 = cad.box(30, 30, 20, { centered: true })    // 轴承座
let part2 = cad.cylinder(6, 60, { centered: true })    // 轴
let part3 = cad.cylinder(15, 10, { centered: true })   // 齿轮

let asm1 = cad.assembly({
  name: '主轴组件',
  members: [part0, part1, part2, part3],
  constraints: [
    // 1. 底板锚死（地基）
    { type: 'fixed', part: 'part0' },

    // 2. 轴承座底面 贴 底板顶面（= 现有 face_mate）
    { type: 'mate',
      a: { part: 'part0', face: { topoRef: { kind: 'face', origin: 'part0', role: 'box:top',
                                             hint: { kind: 'face', surfaceType: 'plane' } } } },
      b: { part: 'part1', face: { topoRef: { kind: 'face', origin: 'part1', role: 'box:bottom',
                                             hint: { kind: 'face', surfaceType: 'plane' } } } } },

    // 3. 轴外圆柱面 与 轴承座孔 同轴（新增能力，faijs 现在做不了）
    //    注意：轴承座的孔是 boolean cut 的产物 —— role 为空串，只能靠 hint 几何兜底（§2.4 role 规则）；
    //    而轴是图元直出，可用语义名 cylinder:lateral（cylinder:side 不存在，勿写）。
    { type: 'concentric',
      a: { part: 'part1', face: { topoRef: { kind: 'face', origin: 'part1', role: '',
                                             hint: { kind: 'face', surfaceType: 'cylinder',
                                                    center: [0, 0, 10], normal: [0, 0, 1] } } } },
      b: { part: 'part2', face: { topoRef: { kind: 'face', origin: 'part2', role: 'cylinder:lateral',
                                             hint: { kind: 'face', surfaceType: 'cylinder' } } } } },

    // 4. 齿轮端面 距 轴承座侧面 12mm
    //    cylinder:bottom 是平面端盖 → surfaceType 是 'plane'（'circle' 是曲线类型，不是面类型，勿写）
    { type: 'distance', value: 12,
      a: { part: 'part1', face: { topoRef: { kind: 'face', origin: 'part1', role: 'box:right',
                                             hint: { kind: 'face', surfaceType: 'plane' } } } },
      b: { part: 'part3', face: { topoRef: { kind: 'face', origin: 'part3', role: 'cylinder:bottom',
                                             hint: { kind: 'face', surfaceType: 'plane' } } } } },
  ],
})
asm1.solve()          // 新增；do_assemble() 保留为完全同义的别名
```

### 5.5 语句与成员方法

| 语句 | 现状 | 新方案 |
|---|---|---|
| `cad.assembly({...})` | 有 | 扩 `constraints` 类型集；`joints?` 在 P3 引入 |
| `asm1.do_assemble()` | 有（触发求解+应用） | **保留**，语义不变 |
| `asm1.solve()` | 无 | **新增**，与 `do_assemble()` 完全同义（命名更符合"求解"语义；`do_assemble` 逐步降级为遗留别名） |
| `asm1.add_constraint({...})` | 有，但**是 no-op**（约束只从 `args.constraints` 读） | **保持 no-op**（不动，避免破坏 codegen 的机械发射；如需真正追加另立议题） |
| `asm1.kinematics()` | 无 | P3：返回各成员世界位姿，供宿主做动画/导出 |

`docs/api-contract.md:121` 已明确 `add_constraint` / `do_assemble` 是 **R0 无赋值**语句，新加 `solve()` 沿用同一形态（`outputs: []`，不消费 receiver）。

### 5.6 运动副（P3，brepjs `jointFns` 映射）

运动副是**参数化位姿**，与约束求解是两套机制（约束=解位姿，运动副=给定位姿）。`jointFns.forwardKinematics` 是纯计算（只依赖 `utils/quaternion`），可直接复用：

```js
let asm1 = cad.assembly({
  name: '摆臂',
  members: [base, arm],
  joints: [
    { type: 'revolute', parent: 'base', child: 'arm',
      axis: { origin: [0, 0, 25], direction: [0, 0, 1] },
      min: 0, max: 120, value: 30 },
  ],
})
asm1.drive({ arm: 45 })        // 或改 value 后重放
let poses = asm1.kinematics()  // Map<partName, {position, rotation}>，供宿主动画
```

`ikFns.inverseKinematics` / `jointTrajectory` 是**无几何副作用的纯数组计算**，适合作为 `cad.*` 查询函数直接暴露（`cad.jointTrajectory(...)` → `TrajectorySample[]`），走 `arg-spec` 的常规注册通道，不必挂在 assembly 下。

---

## 6. 实施分期

### P0 — 前置：hint 扩轴信息（阻塞 P1，必须先做）

**成本已复核（相比初稿大幅下调）：**

- ❌ 初稿判断"`BrepEngineApi` 没有 `getSurfaceAxis`，需要给内核加能力" —— 方法名层面属实（`brep/engine/primitives.ts:112-122` 只有 `surfaceType`/`surfaceNormal`/`pointOnSurface`/`uvBounds`/`getSurfaceCenterOfMass`/`getFaceCylinderData`），**但轴不是算不出来**。
- ✅ 实际：`occt-kernel/topologyExt.ts:314 getSurfaceParams()` **已经算出了** plane/cylinder/cone 的 `{origin, axis, radius}`（对齐 Python `_surface_params`），只是**私有函数**、只服务 STEP 拓扑导出（同文件 `:901` 一处调用）。圆柱轴的算法就在那里：`axis = normalize(S(u,v+1) − S(u,v))`，`origin = P − R·outward_normal`。
- ✅ 所以 P0 面侧 = **导出复用这段计算**，不需要碰 occt wasm、不需要新增内核能力。
- ⚠️ 真正的缺口只剩**圆边**（`getCurveParams` 没有圆心/法向）。

| # | 改动 | 文件 | 成本 |
|---|---|---|---|
| 1 | 抽取 `getSurfaceParams` 的 axis 分支为可复用函数（或新增 `captureFaceAxis(kernel, face)`） | `occt-kernel/topologyExt.ts` | 低（纯重构） |
| 2 | `FaceHint` 加 `axis?: { origin: Vec3; direction: Vec3 }`；`captureFaceHint` 采集 | `topology/naming/types.ts`、`geom-hint.ts` | 低 |
| 3 | `EdgeHint` 加 `axis?: { origin: Vec3; direction: Vec3 }`；直边走 `curvePointAtParam`+`curveTangent`（已有） | `topology/naming/types.ts`、`geom-hint.ts` | 低 |
| 4 | **圆边**：需圆心 + 所在平面法向 → 新增内核能力（唯一真缺口）。建议 API：`getEdgeCircleData(edge): { center: Vec3; normal: Vec3; radius: number } \| null`，命名与判定惯例对齐已有 `getFaceCylinderData`（非圆边返回 `null`，不抛错）；`occt-kernel` 侧实现可参照 `topologyExt.ts` 已有的圆曲线处理（`curveType === 'circle'` 分支已存在，缺的是把圆心/法向暴露出来） | `BrepEngineApi` + `occt-kernel` | 中 |
| 5 | mesh/primitive 侧：宿主 `setTopology` 注入时提炼写入；无 axis → 该实体不可用，抛 `E_TOPO_NOT_FOUND`（不静默降级） | `topology/naming/build-naming.ts` | 低 |

> 附注：brepjs 的 `GeometricHint`（`shapeRef/shapeRefTypes.ts:16`）同样只有 `surfaceType/normal/centroid/area`，**也没有 axis**。所以这是两边共同的新增需求，不是 faijs 单方面欠 brepjs 的技术债 —— 反过来说明 axis 约束在 brepjs 里也是"有 solver 没数据"的状态。

**P0 验收（可执行判定）：**
1. `captureFaceHint` 对 `cad.cylinder(r, h)` 的侧壁面产出的 hint 含 `axis: { origin: [0,0,0], direction: [0,0,1] }`（与图元参数一致，误差 1e-9）。
2. 对同一圆柱的顶面圆边采集 `EdgeHint.axis`：`origin` = 端面圆心、`direction` = `[0,0,±1]`。
3. mesh 路径（无内核）缺 axis 时**抛 `E_TOPO_NOT_FOUND` 而非静默**——写一个显式断言抛错码的测试。
4. `npm run typecheck` 绿；`packages/core` 既有 naming 测试全绿（hint 扩展字段是可选的，不破坏存量）。

### P1 — 装配求解层（核心）

1. 新建 `packages/core/src/api/assembly/`：`normalize.ts` / `entities.ts` / `pose.ts` / `lower.ts` / `solve.ts` / `index.ts`
2. `compound.ts` 的 `solveTransforms` 改为委派新求解层
3. `AssemblyConstraint` 从单类型扩展为并集；`face_mate` 规范化为 `mate`
4. **修复 L6**：输出从 per-constraint 改为 per-member 终态（`Map<memberIndex, Pose>`）
5. 引入 `dof` / `converged` / `unsupported` 到 `AssemblyBehavior.solve()` 的返回（或新增 `solveDetailed()`）
6. **保留 `solveFaceMate` 导出（P1 临时状态）**：签名不变。**实际实现取第 7 条口径——内部保持原数学不动，不转发新求解器**；它与新链路的等价性由 T3/T4 逐分量断言（1e-9）锁死，3d_editor 预览链路 P1 阶段**不改代码**即可继续工作（R8 第一步）。它存在的**唯一理由**是充当 T3/T4 基准 + 给宿主留一个升级窗口，**P2-f5 删除**（见下）。
7. **四元数实现处置 + 遗留算法删除（2026-09-07 修订为强制项）**：faijs 自有的 `quaternionFromUnitVectors` / `quaternionToMatrix3`（`compound.ts:86/:108`，私有未导出）以及 `solveFaceMate` / `FaceMateTransform` / 私有向量助手块（`compound.ts:60-84` 的 `vec3Normalize`/`vec3Sub`/`vec3Cross`/`vec3Dot`，经核实**仅被这两个函数调用**）——**全部在 P2 阶段删除，没有"可选保留"的余地**。新求解路径的旋转计算一律走 brepjs `utils/quaternion.ts`（`[w,x,y,z]`），输出端经 §4.3(a) 的 `fromBrepjsQuat` 重排为 `[x,y,z,w]`；[P2 方案 §2.8 P2-f5](./2026-09-07-assembly-p2-syntax-host-p3-joints.md) 给出逐文件的删除清单、前置条件（T3/T4 基准 golden 化 + 3d_editor 预览切换）与验收口径（全仓 grep 零命中）。
   - **删除前必须确认的无关项**：`applyTransform`（`mesh/rigid-transform.ts`）是引擎侧刚体变换应用，**不是装配算法，保留**；它的 `quaternion` 形参是 **informational**（实际旋转用 `rotationMatrix`，见 `rigid-transform.ts:25` 注释），`module-executor` / `runtime-state.AssemblyTransform` 只做数据透传，均不依赖 faijs 这套四元数。其它文件的 quaternion 命中（`brep-ops` / `fai_drill` / `joinery-brep` / `DrillHoleCore` / `engrave`）全是 **three.js `THREE.Quaternion`**，与本实现无关，不得误删。
   - **`api/assembly/pose.ts` 的 `quaternionToMatrix3` 是新链路的实现**（输入 faijs 顺序 `[x,y,z,w]`），与 `compound.ts` 里待删的同名私有函数**不是同一个东西**——删除时保留前者。

**测试清单（新测试一律与源码同目录，`*.test.ts`）：**

| # | 测试 | 断言 | 锁定 |
|---|---|---|---|
| T1 | 四元数转换往返 | `toBrepjsQuat(fromBrepjsQuat(q)) === q`，含非单位四元数 | §4.3(a) |
| T2 | pivot 换算 | 随机 pose+pivot 下 `applyTransform` 与 brepjs `p'=R·p+position` 逐点相等（1e-9） | §4.3(b) |
| T3 | **mate ≡ solveFaceMate 等价性**（P2-f5 后改为**对比冻结 golden 基准**，见 09-07 §2.8） | 对 §3.7.2 给出的 4 组输入对，两条路径的 `AssemblyTransform` 逐分量相等（1e-9） | §3.7.2，存量兼容锁 |
| T4 | **退化分支**（同 T3，P2-f5 后基准 golden 化） | 三组输入：`n₂ ∥ −n₁`（应 identity）、`n₂ ∥ n₁`（应 180° 翻转）、`n₂ ⊥ n₁`，两条路径四元数逐分量比对 | §3.7.2(a) |
| T5 | 链式三体 | A→B→C 两次 `mate`，C 的世界位姿 = 手算值 | brepjs 拓扑调度 |
| T6 | `concentric`/`distance`/`angle` 各一例 | 对照 brepjs `solveConstraints` 直算 | §5.3 直译路径 |
| T7 | 欠约束 / 环 / 实体类型不匹配 | `converged:false` + `unsupported[]` 明细 | D3 |
| T8 | 成员名为空串 | 求解前抛明确错误（含成员下标） | R7 |
| T9 | mesh 链路冒烟 | faceHints 快照（不含 axis）的 `mate` 约束端到端重放；**同一脚本在 `executorMode='module'` 与 `'direct'` 下结果一致**（R11②；direct 侧仅断言可达与一致，不覆盖 axis 约束） | 双链路 + R11 |
| T10 | 存量 `face_mate` 回归 | 现有装配相关测试全绿 + 新增逐顶点一致性断言 | C2 |

**测试运行纪律（遵守 AGENTS.md，严禁通过跑 CI 找 bug）：**

```
1. 先跑新写的测试:        npm run test -w @faicad/faijs-core
2. 再跑可能受影响的存量:   npm run test -w @faicad/faijs-core -- <改动相关的既有测试文件>
                          npm run test -w @faicad/faijs-tests   （集成/parity）
3. 全绿后才跑一次 CI:      pwsh -NoProfile scripts/ci.ps1
4. CI 后只重跑失败项，不重复跑 CI
```

### P2 — 语法层与宿主适配

1. `lang/`：`args-schema` 加新约束类型的校验；`codegen` 保证 roundtrip；`parser` 无需改（仍是对象字面量参数）
2. `arg-spec.ts`：把 `addMate`/`solveAssembly`/`addJoint`/`forwardKinematics`/`mechanismDOF` 从 `skip` 改为 `skip(有理由：改由 assembly 约束面暴露)` —— **仍不直接暴露**（它们吃 AssemblyNode/句柄，见 §3.1），但更新 reason 说明去向
3. `docs/ops-api-inventory.md` §6.1 + `docs/api-contract.md` 同步（合同变更必须同 PR 更新文档）
4. 3d_editor：
   - `AssemblyPanel` 加**约束类型选择器**（mate/align/coincident/concentric/distance/angle/parallel/perpendicular）
   - 实体拾取从「只面」扩到「面/边/点」（`edgeTopoRefFromRow` 已就绪）
   - `assemble-store` 预览改用新求解入口（与执行同源，保持现状的"同一算法"保证）
   - `model-store.createAssembly` 的 `FaceConstraint` → 新 `AssemblyConstraint` 映射
   - 支持一条装配里的**多条约束**（现状只处理一对面）

### P3 — 运动副与 IK

`joints[]` 语法、`asm1.drive()`、`asm1.kinematics()`、`cad.jointTrajectory()`。

### P4 — 收尾

`npm run doc-sync`、Agent Note（`.agents/notes/implemented/feature/`）、双语配对（若新增非 plans 文档）。

---

## 7. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| R1 | **语义漂移**：`mate`(中心对齐) vs `coincident`(只共面) 混用导致存量装配漂移 | 高 | 二者并存不互相映射；`face_mate` 严格规范化为 `mate`；P1 用逐分量相等的回归测试锁死 |
| R2 | **四元数顺序** `[w,x,y,z]` vs `[x,y,z,w]` 弄反 | 高 | §4.3 单一转换函数 + 往返单测；禁止在别处手写 `q[0]`/`q[3]` |
| R3 | **pivot 语义**（brepjs 绕原点 vs faijs 绕 pivot） | 高 | §4.3 公式 + 单测；`pivot` 一律取 dependent 实体 origin |
| R4 | **mesh 链路缺 axis**，`concentric` 不可用 | 中 | P0 补 hint；缺失时抛 `E_TOPO_NOT_FOUND`（现有约定：绝不静默取错），并在 `unsupported[]` 里点名 |
| R5 | **solver 每节点单次定位**，复合约束（flip+共面+中心）无法拆多条表达 | 中 | `mate`/`align` 降级为单条 `concentric` + 轴编码进 solver（§3.7.2）；**禁止**把复合语义拆成多条 SolverConstraint —— 那条路已被 §3.7.1 证明不可行 |
| R6 | **多约束叠加应用两次**（现存 L6） | 中 | P1 改 per-member 终态；引擎侧改为"先清空该成员变换再应用"或按终态直接 set |
| R7 | **成员名为空串**：`memberNamesOf` 在 `nameOf` 返回 undefined 时给 `''`，而 `solveConstraints` 按名索引 | 中 | P1 在求解前断言成员名非空，非空即抛明确错误 |
| R8 | **3d_editor 预览/执行不同源**：预览调 `solveFaceMate`，执行走新求解器 | 中 | **分三步（2026-09-07 修订，第三步为强制）**：① P1 保留 `solveFaceMate` 导出与签名、内部保持原数学，等价性由 T3/T4 逐分量断言保证 → 预览**不改也能工作**；② P2-e1 把 `assemble-store` 预览切换到 `solvePreview`（与执行同源）；③ **P2-f5 删除 `solveFaceMate` 与 faijs 自有四元数实现**，此前必须先把 G1–G4 期望值冻结为 golden 基准（[09-07 方案 §2.8](./2026-09-07-assembly-p2-syntax-host-p3-joints.md)）。**终态不允许新旧两套装配算法并存** |
| R9 | **范围膨胀**：brepjs 还有 URDF / DH /  gear 等，容易越做越大 | 中 | 本方案只做 mate 层 + 运动副；URDF/DH/IK 列为 P3 之后的独立议题 |
| R10 | **引擎侧 `computeDownstream` 在链式下失效放大**：链式求解一次移动多个成员 → 下游重算面变大 | 低 | 观察；必要时按成员分批失效 |
| R11 | **no-IR direct 执行器对装配语句零测试覆盖**（提交 `6afbb0e`/`9ede3ed`，2026-09-06）：`direct-executor.test.ts` 无 assembly / `do_assemble()` 用例。机制上支持（`emitCall` 的 receiver 分支发射 `await __ctx.asm1.do_assemble()`，嵌套约束对象走 `transformArg` 的 `ObjectExpression` 递归），但无测试背书；且 `metadata-extractor.ts` 不识别装配语句 | 中 | ① direct 模式是 **guarded opt-in**（`executorMode` 缺省 `'module'`），本方案 P1 全部测试跑缺省 module 路径，**不受阻塞**；② P1 补一条用例：同一装配脚本在 `executorMode='module'` 与 `'direct'` 下重放结果逐分量一致（纳入 T9）；③ 宿主若切换 direct 模式，须先补装配用例再切换；④ metadata 层对装配语句的提取缺位**不在本方案范围**，留作独立议题 |

---

## 8. 开放决策点（需确认后再动 P1）

**默认规则：若实施前未获得明确反馈，一律按「建议」列执行，并在 PR 描述中列出所选选项供复核。** 除此之外本文档自包含，可独立执行。

| # | 决策点 | 选项 A | 选项 B | 建议 |
|---|---|---|---|---|
| D1 | 装配是否参与 BREP/mesh 链判定 | 不参与（求解是纯位姿层，不涉及几何生成） | 参与，mesh 模式禁 axis 约束 | **A** —— 装配不产新几何，应用侧现状已双写 mesh+BREP |
| D2 | `solve()` vs `do_assemble()` | 新增 `solve()`，`do_assemble()` 降为别名 | 只用 `do_assemble()` | **A**，但两者**长期并存**，不删除 |
| D3 | 不收敛时行为 | 抛错中止 | 应用已解出的部分 + 告警 | **A**（对齐 brepjs `solveAssembly` 现状与 faijs "绝不静默"约定） |
| D4 | 是否改动 `vendored/solverAdapter.ts` | 不改，只 import 已导出的 `solveConstraints` | 改它并导出内部原语 | **A** —— `NOTICE` 声明锁定上游，改了就没有回头路； faijs 侧写薄封装更稳 |
| D5 | 是否支持嵌套装配（子装配） | P1 只做平表 | P1 就支持树 | **A** —— brepjs 的 `AssemblyNode` 是树，但 faijs 的 compound 是平成员表，先平后树 |

---

## 9. 验收清单

- [ ] 存量 `.fai.js`（含 `face_mate`）重放结果与改动前逐顶点一致（T10）
- [ ] `solveFaceMate` 导出在 P1 阶段保持存在、签名不变；3d_editor 预览链路**不改代码**即可继续工作（等价性由 T3 保证）
- [ ] **（P2 强制，09-07 §2.8 P2-f5）** T3/T4 基准已 golden 化、3d_editor 预览已切 `solvePreview` 后，`solveFaceMate` / `FaceMateTransform` / 自有四元数与私有向量助手**全部删除**；全仓（含 `../3d_editor`）grep `solveFaceMate` 零命中；`applyTransform` 与 `api/assembly/pose.ts` 的 `quaternionToMatrix3` **保留**
- [ ] §4.3 的 G1–G4 四组输入逐分量相等（T3/T4，1e-9）
- [ ] 新增约束类型各有 ≥1 个几何断言测试（不只用 mock）；`parallel`/`perpendicular` 按 `angle` 语法糖合并验证即可（T6）
- [ ] 三体链式装配（A→B→C）测试通过（T5）
- [ ] `converged:false` 时错误信息含 `unsupported[]` 明细（T7）
- [ ] mesh 链路冒烟通过（不含 axis 的约束）（T9）
- [ ] P0 四条验收全部通过（含 mesh 缺 axis 抛 `E_TOPO_NOT_FOUND` 的显式断言）
- [ ] 测试按 P1 的运行纪律执行：先新测试 → 受影响存量 → 全绿后 `pwsh -NoProfile scripts/ci.ps1` **一次通过**；CI 后只重跑失败项
- [ ] `npm run typecheck` / `lint` 绿
- [ ] `docs/ops-api-inventory.md` §6.1 与 `docs/api-contract.md` 同步更新
- [ ] 新增 Agent Note 到 `.agents/notes/implemented/feature/`
