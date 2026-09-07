# faijs 装配约束 P2（语法层与宿主适配）+ P3（运动副与 IK）实施方案

- 日期：2026-09-07
- 状态：**方案（未实施）**
- 范围：`packages/core/src/api/`（校验 + 预览入口 + 运动副）、`packages/core/src/lang/`（roundtrip 测试 + metadata）、`docs/`（契约同步）、`../3d_editor`（宿主适配，仅 P2）
- 前置方案：[2026-09-06-faijs-assembly-constraints-brepjs.md](./2026-09-06-faijs-assembly-constraints-brepjs.md)（P0+P1 **已落地**，本文档以它的产出为基线）
- 相关有效契约：[docs/api-contract.md](../api-contract.md)、[docs/ops-api-inventory.md](../ops-api-inventory.md) §6.1、[docs/syntax-design.md](../syntax-design.md)、[docs/library-dev-guide.md](../library-dev-guide.md)

---

## 0. 用户原始需求（原文照录）

> 写一份新的方案，保存为新的计划文件，细化P2/P3的实施，要求可以无歧义的交给第三方。然后整体提交所有代码和文件

本文档回答前半句；后半句（整体提交）在 P2/P3 实施前已由本次会话完成（含 P0+P1 全部代码、文档、Agent Note 与本方案文件）。

**交接对象**：任何未参与前期讨论的工程师/Agent。本文档自包含——所有现状结论均来自 2026-09-07 对代码的直接核实（文件、行号、导出面均已验证），不依赖会话记忆。实施前的开放决策点见 §6，默认按「建议」列执行。

---

## 1. 现状基线（P1 落地后的事实，2026-09-07 核实）

### 1.1 faijs 侧已有的产出（不要重做）

| 模块 | 状态 | 关键导出 |
|---|---|---|
| `packages/core/src/api/assembly/types.ts` | ✅ 已落地 | `EntityRef`（face/edge/point/faceIndex 四形态）、`FaceRef`、`EdgeRef`、9 种新约束接口（Mate/Align/Coincident/Concentric/Distance/Angle/Parallel/Perpendicular/Fixed）、`StructuralConstraint`、遗留 `FaceMateConstraint`、总并集 `AssemblyConstraint` |
| `api/assembly/normalize.ts` | ✅ | `normalizeConstraint`（face_mate → mate 字段重排；新形态直通；未知类型抛错） |
| `api/assembly/entities.ts` | ✅ | `faceGeometryToSolverEntity`（平面→plane，圆柱/圆锥→axis，缺轴→`E_TOPO_NOT_FOUND`）、`resolveSolverEntity`、`resolveFaceGeometryOfRef` |
| `api/assembly/lower.ts` | ✅ | `axisFromFace(f, flip)`、`lowerStructuralConstraint`（mate/align→concentric+轴编码；parallel/perpendicular→angle 0/90°；其余直译） |
| `api/assembly/pose.ts` | ✅ | `fromBrepjsQuat`/`toBrepjsQuat`、`quaternionToMatrix3`、`poseToAssemblyTransform`、`isIdentityPose`、`entityOrigin` |
| `api/assembly/solve.ts` | ✅ | `solveAssembly(members, memberNames, constraints)` → `AssemblySolveResult`（含 per-member transforms、不收敛抛错带 unsupported 明细、空成员名抛错） |
| `api/compound.ts` | ✅ | assembly op 挂 `do_assemble` / `solve`（同义）/ `add_constraint`（no-op）/ `solveDetailed` |
| 引擎 | ✅ | `cad-runtime/module-executor.ts` 与 `direct-executor.ts`（`applyPendingAssemblyTransforms`）双执行器都应用变换；L6 已修复为 per-member 终态 |
| P0 hint 扩轴 | ✅ | `topology/naming/types.ts` 的 `FaceHint.axis` / `EdgeHint.axis`；`geom-hint.ts` 采集（圆柱面轴、直边、圆边三点定圆） |
| `solveFaceMate` | ✅ 保留 | `api/compound.ts` 导出、签名不变（3d_editor 预览依赖，R8 第一步） |
| `api/surface/arg-spec.ts` | ✅ 已更新 | `addMate`/`solveAssembly`/`addJoint`/`forwardKinematics`/`mechanismDOF` 五条 skip + 去向 reason（**P2 不需要再动 arg-spec 的 skip 项**） |
| 文档 | ✅ | `docs/ops-api-inventory.md` §6.1、`docs/api-contract.md` §12 已同步；Agent Note 已归档 `.agents/notes/implemented/feature/2026-09-06-assembly-constraints-brepjs.md` |

### 1.2 lang 层现状（**修正原方案的一处过时表述**）

原方案 P2 第 1 条写「`lang/args-schema` 加新约束类型的校验」——**该文件已不存在**。核实结论（`packages/core/src/api/assert.ts:5` 注释原文）：

> 阶段 4 起（args-schema/SCHEMAS 已删除），参数校验全部由本模块的 assert 助手

因此 P2 的参数校验落点是 **`api/assert.ts` 的 assert 助手**（库函数入口运行期校验），不是 lang 层。lang 层契约不变：**parser 对对象字面量参数不做校验**（`.fai.js` 里的 TopoRef/约束就是普通对象字面量），codegen 机械发射。详见 [docs/syntax-design.md](../syntax-design.md)。

lang 层其它已核实事实：

- `lang/codegen.ts:104`：VarRefIR → 裸变量名，`members:[part0, part1]` 的变量引用通道已通。
- `lang/parser-assembly.test.ts` 存在：assembly 语句 parse 已有测试覆盖。
- `lang/metadata-extractor.ts`：**不识别 assembly/`do_assemble` 语句**（2026-09-07 grep 零命中）。宿主目前从 `structuralStmtArgs` 的 args 通道自行抓 constraints（`../3d_editor/src/stores/core/model-store.ts:973`）。

### 1.3 vendored brepjs 运动副模块（P3 的发动机，一行不改）

| 文件 | 关键导出 | 可序列化性 |
|---|---|---|
| `operations/jointFns.ts` | `Joint`/`JointAxis`/`JointDOF`/`JointPose` 类型；工厂 `revoluteJoint`/`prismaticJoint`/`cylindricalJoint`/`planarJoint`/`sphericalJoint`；`setJointValue(s)`；`jointTransform(joint, value)`；`addJoint(assembly, joint)`；`forwardKinematics(assembly, jointValues?) → Map<string, JointPose>`；`mechanismDOF(assembly)` | `Joint` 纯数据；`JointPose = { translation, rotation: [w,x,y,z] }` 纯数据 |
| `operations/ikFns.ts` | `inverseKinematics(assembly, endEffector, target: IKTarget, options?) → IKResult{values, converged, iterations, error}`；`jointTrajectory(...) → TrajectorySample[]` | 纯数值计算；**输入只需要 AssemblyNode 的名字/joints 拓扑，不需要 shape** |
| `operations/dhFns.ts` | `jointsFromDH(rows: DHRow[], options?)` | 纯数据 |
| `operations/assemblyFns.ts` | `createAssemblyNode(name, options?)`、`addChild`、`walkAssembly` | **`AssemblyNodeOptions.shape` 是可选的**（`assemblyFns.ts:33-45`）——`createAssemblyNode(name)` 产出零句柄节点 |

**P3 关键判定：`forwardKinematics` / `inverseKinematics` / `mechanismDOF` / `jointTrajectory` 只消费节点的 name/translate/rotate/joints 拓扑与 joints 数值，从不触碰 `shape` 句柄。** 因此 faijs 可以从纯数据 `JointSpec[]` 构造无 shape 的 AssemblyNode 树直接调用——**vendored 依旧零修改**。

### 1.4 3d_editor 侧现状（P2 的主体，../3d_editor 相对 faijs 根目录）

| 文件 | 行数 | 现状 |
|---|---|---|
| `src/engine/components/panels/AssemblyPanel.tsx` | 217 | 只有 fixedFace/movingFace 两面拾取状态 + 预览/确认/重置；**无约束类型选择器**；拖拽面板逻辑占约 80 行 |
| `src/stores/tools/assemble-store.ts` | 597 | `:17` `import { solveFaceMate } from '@faicad/faijs/browser'`；`:565` 附近预览直接调 `solveFaceMate`（与执行同源注释在 `:204`）；`:217` `confirmAssemble` 组装 `FaceConstraint[]`；`:290` 调 `createAssembly({memberIds, constraints})` |
| `src/stores/core/model-store.ts` | — | `:725` `createAssembly(constraints: FaceConstraint[])`；`:973` 从 assembly 语句 args 抓 constraints；`:1771` `FaceConstraint`（scopedId 基）→ `FaceMateConstraint`（partName 基）映射 |
| `src/engine/features/assembly.ts` | 76 | `buildAssemblyCode` + `buildDoAssembleCode`：产出 `cad.assembly({...})` + `asm1.do_assemble()` 两行 |
| `src/engine/topology/capture-topo-ref.ts` | 93 | `faceTopoRefFromRow` + `edgeTopoRefFromRow`（边拾取通道已就绪）；命名缺失返回 null，绝不静默取序号 |
| `src/engine/features/ScriptEngine` | — | `appendAndCommit([...])` 增量执行 |

---

## 2. P2 — 语法层与宿主适配

### 2.1 P2-f1：`assembly()` 约束参数的运行期校验（faijs 仓库）

**落点**：`packages/core/src/api/compound.ts` 的 assembly op 入口（经由 `defineOp`/`compatOp` 的 params 校验惯例）+ `api/assert.ts` 的 assert 助手。**不改 parser、不恢复 args-schema。**

校验规则（逐条可判，报错文案必须含：字段路径 + 期望形态 + 实际收到值）：

| # | 规则 | 失败行为 |
|---|---|---|
| V1 | `constraints` 每项 `type` ∈ `{mate, align, coincident, concentric, distance, angle, parallel, perpendicular, fixed, face_mate}` | 抛错（沿用 `normalize.ts` 未知类型路径，文案列出合法类型全集） |
| V2 | `mate`/`align`/`coincident`/`concentric`/`parallel`/`perpendicular` 必须有 `a`、`b` 两个 `EntityRef` | 抛错 |
| V3 | `distance`/`angle` 必须有有限数 `value`（`angle` 另限 `[-360, 360]` 之外报错？——不，**不设区间**，只要求有限数，与 brepjs 行为对齐） | 抛错 |
| V4 | `EntityRef` 四形态互斥且恰占其一：`face`/`edge`/`point`/`faceIndex`；`faceIndex` 必须为正整数 | 抛错 |
| V5 | `fixed` 只需要 `part`；`part` 必须出现在 `members` 里（所有约束类型统一检查） | 抛错，文案含成员名全集 |
| V6 | `face_mate` 走 normalize 重排后同样过 V2/V5 | 同上 |

**测试**（`packages/core/src/api/assembly/validate.test.ts`，新文件）：

| # | 用例 | 断言 |
|---|---|---|
| VT1 | 未知 type / 缺 a / 缺 b / value 缺失或 NaN / faceIndex=0 | 各自抛错且文案含字段路径 |
| VT2 | 全部 10 种类型各 1 条合法样例通过 | 不抛错 |
| VT3 | `part` 不在 members 里 | 抛错且文案列出 members |
| VT4 | 存量 `face_mate` 脚本（fixture）继续工作 | 回归绿 |

### 2.2 P2-f2：codegen roundtrip 测试（faijs 仓库）

**不改 codegen 实现**（对象字面量参数通用发射已覆盖新类型），只**加测试锁死 roundtrip**：

`packages/core/src/lang/codegen-assembly-constraints.test.ts`（新文件）：

- 对 §5.4（原方案）的完整装配脚本样本：`.fai.js 文本 → parse → codegen → 再 parse`，断言两次 parse 产出的 constraints 参数**结构深度相等**（`toEqual`），覆盖：9 种新类型 + face_mate 遗留形态 + EntityRef 四形态 + TopoRef 字面量 + 裸变量 members。
- `asm1.solve()` 与 `asm1.do_assemble()` 两种调用形态都要出现在样本里。

### 2.3 P2-f3：预览纯函数入口（faijs 仓库，R8 第二步的前半）

**动机**：3d_editor 预览目前直接调 `solveFaceMate(p1, n1, p2, n2)`——只支持 mate。P2 宿主要预览任意约束类型，需要一个**与执行同源**的轻量入口。

**设计**：新建 `packages/core/src/api/assembly/preview.ts`：

```ts
import type { AssemblyConstraint, EntityRef } from './types'
import type { AssemblyVec3 } from './types'
import type { SolverEntity } from '../../vendored/brepjs/kernel/solverAdapter'
import type { AssemblyTransform } from '../../runtime-state'

/**
 * 单约束预览：给定两条实体的几何（SolverEntity，纯数据），
 * 走与 solveAssembly 完全相同的 lower → solveConstraints 链路，
 * 返回 dependent 侧成员的位姿（AssemblyTransform，index 固定 -1，pivot = dep 实体 origin）。
 *
 * 与执行的同源性保证：内部复用 lowerStructuralConstraint 与 solveConstraints，
 * 不另写数学。仅支持"恰好定位一个 dependent"的单条约束（fixed 除外——fixed 无位移）。
 */
export function solvePreview(
  type: AssemblyConstraint['type'],
  refEntity: SolverEntity,
  depEntity: SolverEntity,
  value?: number,          // distance/angle 用
): AssemblyTransform
```

配套 `entityFromGeometry` 辅助：宿主从拾取数据（center/normal/axis）直接构造 `SolverEntity`，**不经过 TopoRef 解析**（预览时几何就在手上，无需查槽位）。

**导出链**：`api/assembly/index.ts` → `api/index.ts` → 根门面 `@faicad/faijs/browser`。

**测试**（`packages/core/src/api/assembly/preview.test.ts`）：

| # | 用例 | 断言 |
|---|---|---|
| PV1 | mate 的 solvePreview vs `solveFaceMate` | §3.7.2（原方案）G1–G4 四组输入逐分量相等（1e-9）——**预览等价锁** |
| PV2 | concentric/distance/angle 各 1 例 | 对照 `solveAssembly` 单约束结果逐分量相等 |
| PV3 | fixed / axis-axis 不匹配的组合 | 抛明确错误或返回不变换（与 solveAssembly 同语义） |

### 2.4 P2-f4：metadata-extractor 识别装配语句（faijs 仓库）

`lang/metadata-extractor.ts` 增加对 `cad.assembly` / `asmN.do_assemble` / `asmN.solve` 语句的提取：语句摘要（statement-summary）标记 `isAssembly: true`，提取 `{name, memberCount, constraintTypes: string[]}`。**不提取约束对象全文**（宿主已有 args 通道，`model-store.ts:973` 继续用）。

测试：`lang/metadata-extractor.test.ts` 加 assembly 用例（3 个：assembly+do_assemble、assembly+solve、含 face_mate 遗留）。

> 说明：这是原方案 R11④ 悬置的独立议题，本方案决定**纳入 P2**（成本低、宿主面板需要语句级摘要）。若实施时发现 statement-summary 结构改动超出摘要范畴，按决策点 D-P2-2 回退为「不做」并在本文档记录。

### 2.5 P2-e1：3d_editor 宿主适配（P2 主体）

按依赖顺序逐文件给出改动（**全部在 `../3d_editor`**）：

#### ① `src/engine/topology/capture-topo-ref.ts`（已就绪，微扩）

- 已有 `faceTopoRefFromRow` / `edgeTopoRefFromRow`。新增 `vertexTopoRefFromRow`（顶点拾取，供 point 型 EntityRef；若 P2 宿主不做顶点拾取可留空——见决策点 D-P2-3，建议**先不做**顶点拾取，点实体用坐标输入框）。

#### ② `src/stores/tools/assemble-store.ts`（核心改动）

新增状态与动作（保持现有 fixedFace/movingFace 结构兼容）：

```ts
// 新增状态
constraintType: 'mate' | 'align' | 'coincident' | 'concentric' | 'distance'
              | 'angle' | 'parallel' | 'perpendicular'   // 默认 'mate'
value: number | null            // distance/angle 的数值输入
extraConstraints: AssemblyConstraint[]   // 本次会话累积的多条约束（确认后清空）
pendingEntityA / pendingEntityB: EntityRef 几何快照
```

- **预览切换**（R8 第二步）：`previewAssemble` 从 `solveFaceMate` 改为 `solvePreview`（P2-f3 导出）。拾取面 → `{center, normal}` 或圆柱面 `{axis}` → `entityFromGeometry` → `solvePreview(type, ref, dep, value)`。**预览与执行同源**的注释与保证保持：两者都走 lower + solveConstraints。
- **多约束累积**：一次装配会话内可连续添加多条约束（fixed + mate + concentric…），`confirmAssemble` 一次性提交。

#### ③ `src/engine/components/panels/AssemblyPanel.tsx`（UI）

- 顶部加**约束类型选择器**（下拉或分段控件，8 种新类型；`fixed` 类型不进入拾取流程，是"只锚定当前成员"的按钮动作）。
- `distance`/`angle` 类型显示数值输入框（mm / deg）。
- 面板状态行从「固定面/活动面」扩展为「参考实体 A / 从动实体 B」，显示已拾取实体类型（面/边/点）与几何摘要。
- 新增「添加约束」按钮（把当前一对拾取实体 + 类型加入 `extraConstraints`）与「已添加 N 条」列表（可逐条删除）。
- i18n：所有新文案走 `useTranslation`，zh/en 两份 key 同步加。

#### ④ `src/stores/core/model-store.ts`

- `FaceConstraint` 类型扩展为可携带新约束形态（或新增并集类型 `AssemblyUIConstraint`），`createAssembly` 的映射（`:1771` 一带）从「FaceConstraint → FaceMateConstraint」扩展为「UI 约束 → faijs `AssemblyConstraint`」：
  - `fixedScopedId` → `{type:'fixed', part}`
  - 现有两面拾取 → `{type, a: {part, face:{topoRef}}, b: {part, face:{topoRef}}}`（TopoRef 由拾取行生成，几何快照仅作 hint）
  - distance/angle 带 `value`
- **多约束**：`createAssembly` 接受数组一次性写入语句参数（结构已支持，`constraints` 本来就是数组；改的是 UI 侧只传一条的现状）。

#### ⑤ `src/engine/features/assembly.ts`

- `buildAssemblyCode` 产出新形态 constraints 的序列化（对象字面量 → 脚本文本）。**注意**：EntityRef 里的 TopoRef 是纯数据对象字面量，直接 `JSON.stringify` 风格缩进打印即可，与 chamfer 边引用的现有打印惯例一致。
- `do_assemble` 行可换成 `solve()`（决策点 D-P2-4，建议：**新脚本产出 `solve()`**，`do_assemble` 留给存量）。

#### ⑥ 存量兼容验收

- 已保存场景（含 `face_mate` 语句）打开 → 重放 → 装配位置与升级前逐顶点一致（faijs normalize 已保证；宿主侧只需回归测试）。
- `../3d_editor` 的 assemble-store 既有测试（`assemble-store.test.ts`）更新后全绿。

### 2.6 P2 测试与验收清单

faijs 仓库：

- [ ] `validate.test.ts`（VT1–VT4）绿
- [ ] `codegen-assembly-constraints.test.ts` roundtrip 绿
- [ ] `preview.test.ts`（PV1–PV3，PV1 必须锁 G1–G4 逐分量 1e-9）绿
- [ ] `metadata-extractor.test.ts` assembly 用例绿
- [ ] 存量装配回归（`assembly-replay.test.ts`、`packages/tests/faijs/assembly/`、`parser-assembly.test.ts`）全绿
- [ ] typecheck / lint 绿；`npm run doc-sync` 绿（`docs/api-contract.md` §12 增补 solvePreview 与校验规则；`docs/ops-api-inventory.md` 重新生成）

3d_editor 仓库（独立 git 仓库，单独提交）：

- [ ] 约束类型选择器可用，8 种类型各能走通「拾取 → 预览 → 确认」
- [ ] 预览结果与重放结果一致（同源断言测试）
- [ ] 存量场景（face_mate）回归通过
- [ ] assemble-store.test.ts 全绿

### 2.7 P2 明确不做

- 顶点拾取（D-P2-3 建议：point 实体用坐标输入）
- 嵌套子装配（原方案 D5 已定 P1 只做平表，P2 不变）
- `add_constraint` 从 no-op 变真实现（原方案 §5.5 保持 no-op，不折腾）
- URDF / DH 导入导出（P3 之外的独立议题，见原方案 R9）

---

## 3. P3 — 运动副与 IK

### 3.1 语法设计（.fai.js 可序列化子集）

**`JointSpec`（faijs 对外类型，进脚本的对象字面量）**——只保留可序列化字段，派生字段（`dofs`）由 vendored 工厂函数构造：

```ts
// packages/core/src/api/assembly/joints.ts（新文件）
export type JointType = 'revolute' | 'prismatic' | 'cylindrical' | 'planar' | 'spherical'

/** 可序列化运动副声明（.fai.js 对象字面量）。 */
export interface JointSpec {
  type: JointType
  /** 参考体（不动）；child 相对它运动。必须是 members 里的名字。 */
  parent: PartName
  /** 从动体。 */
  child: PartName
  /** 主轴：origin 是所有旋转 DOF 的枢轴锚点。 */
  axis: { origin: AssemblyVec3; direction: AssemblyVec3 }
  /** 主 DOF 范围与当前值（revolute/prismatic 单位 mm/deg；由 type 决定）。 */
  min: number
  max: number
  value: number
  /** 静态连杆偏置（childWorld = parentWorld ∘ jointTransform ∘ offset），可选。 */
  offset?: { translation?: AssemblyVec3; rotation?: AssemblyVec3 /* faijs [x,y,z,w] */ }
}
```

**correction vs 原方案 §5.6**：原方案示例写了 `asm1.drive({ arm: 45 })`。**本方案修正：不做 `drive()` 方法**——`.fai.js` 是声明式重放模型，可变方法调用会破坏「脚本即状态」的契约（重放时 `drive` 调用不会重现）。驱动值必须是**语句参数**：

```ts
export interface AssemblyOptions {
  name: string
  members: Shape[]          // 裸变量引用（现状不变）
  constraints?: AssemblyConstraint[]
  /** P3 新增：运动副声明。 */
  joints?: JointSpec[]
  /** P3 新增：驱动值覆盖（键 = child 成员名；值 = 主 DOF 数值或多 DOF 数组）。 */
  drive?: Record<string, number | number[]>
}
```

改 `drive` 值 = 改语句参数 → 重放 → 位姿重算，与 v8「派生值不入库」原则一致（位姿永远是算出来的）。

```js
// .fai.js 完整示例
let base = cad.box(60, 40, 10, { centered: true })
let arm  = cad.box(10, 10, 80, { centered: false })

let asm1 = cad.assembly({
  name: '摆臂',
  members: [base, arm],
  joints: [
    { type: 'revolute', parent: 'part0', child: 'part1',
      axis: { origin: [0, 0, 10], direction: [0, 0, 1] },
      min: 0, max: 120, value: 30 },
  ],
  drive: { part1: 45 },        // 覆盖主 DOF 值（键用成员名）
})
asm1.solve()                    // 同时做约束求解（无 constraints 时为 no-op）与运动学定位
```

**注意**：`drive`/`joints` 的键与 parent/child 用 **PartName 字符串**（与 C3 一致）。

### 3.2 实现链路（faijs 仓库，vendored 零修改）

新建 `packages/core/src/api/assembly/joints.ts`：

```
JointSpec[]（纯数据）
  → buildJoint(spec): brepjs Joint          // 调 vendored 工厂 revoluteJoint(...) 等；
                                            // offset 的四元数经 toBrepjsQuat 换序（faijs [x,y,z,w] → brepjs [w,x,y,z]）
  → buildKinematicTree(memberNames, joints): AssemblyNode
                                            // createAssemblyNode(name) 不带 shape（零句柄）；
                                            // addChild 组装 parent/child 森林；孤立成员为根节点
  → 校验：parent/child 必须在 members 里；同一 child 不得被两个 joint 驱动
    （brepjs forwardKinematics 对重复 child 静默跳过——faijs 侧必须在求解前抛错，绝不静默）
```

`pose.ts` 扩展：`jointPoseToAssemblyTransform(pose: JointPose, index)`——`JointPose{translation, rotation:[w,x,y,z]}` → faijs `AssemblyTransform`（`fromBrepjsQuat` 换序；`pivot = [0,0,0]`，`translation = pose.translation`，因为 brepjs FK 的位姿本来就是绕原点模型，与约束求解的 pivot 换算同式）。

`solve.ts` 扩展（或新 `kinematics.ts`）：

```
solveKinematics(memberNames, joints, drive):
  1. 校验（空名 R7、parent/child ∈ members、child 唯一驱动、drive 键 ∈ joints 的 child 集）
  2. buildKinematicTree → forwardKinematics(tree, drive)
  3. Map<string, JointPose> → per-member AssemblyTransform[]
  4. 与约束求解的合并语义：同一装配里 constraints 与 joints 并存时，
     joints 输出**覆盖**同名成员的约束解（运动副是显式驱动，优先级最高）；
     诊断信息（unsupported）不混用——joints 不参与 solveConstraints 的 converged 统计
```

**IK / 轨迹暴露（纯查询函数，arg-spec 常规注册）**：

| `.fai.js` / 库面 | 签名 | 内部 |
|---|---|---|
| `cad.jointTrajectory({ joints, endEffector?, steps, to?, from? })` | → `TrajectorySample[]`（`t` + `values`） | `JointSpec[]` → buildJoint → vendored `jointTrajectory` |
| `cad.inverseKinematics({ joints, endEffector, target: {position, rotation?}, options? })` | → `{values, converged, iterations, error}` | buildKinematicTree → vendored `inverseKinematics`；**`target.rotation` 对外用 faijs `[x,y,z,w]`，内部 `toBrepjsQuat` 换序** |
| `cad.mechanismDOF({ joints })` | → `number` | buildKinematicTree → vendored `mechanismDOF` |

三者都是**无副作用纯函数**（输入纯数据、输出纯数据），不挂在 assembly receiver 上，走 `defineOp` 常规注册。arg-spec 把 `forwardKinematics`/`mechanismDOF` 两条 skip 的 reason 更新为「已由 cad.mechanismDOF / solve 语句暴露」（`inverseKinematics`/`jointTrajectory` 同理）。

### 3.3 宿主消费（`asm1.kinematics()`）

- `asm1.solve()` 语句（R0 无赋值）执行后，若该 assembly 有 `joints`，引擎把 per-member 位姿写入 `ExecutionResult`（建议挂 `ExecutionResult.kinematics: Record<partName, {position, rotation}>`，rotation 为 faijs `[x,y,z,w]`）——宿主动画/导出从 ExecutionResult 读取，**不新增返回值消费语义**（保持 R0 语句形态不变，与 `do_assemble` 现状一致）。
- 3d_editor 侧 P3 只做**只读消费**：装配面板显示 DOF 数（`mechanismDOF`）+ 用滑杆改 `drive` 值（改语句参数 → 重放）。完整动画时间线不在 P3 范围。

### 3.4 P3 测试清单

| # | 文件 | 用例 | 锁定 |
|---|---|---|---|
| J1 | `api/assembly/joints.test.ts` | `buildJoint` 5 种 type 各 1 例：dofs 数量正确（revolute/prismatic 1、cylindrical 2、planar/spherical 3）、axis 透传、value clamp 到 [min,max] | 工厂映射 |
| J2 | 同上 | offset 四元数换序往返（`toBrepjsQuat(fromBrepjsQuat(q)) === q`） | §4.3(a) 同源 |
| J3 | 同上 | child 被两个 joint 驱动 → 抛错（绝不静默） | faijs 侧校验 |
| J4 | 同上 | parent/child 不在 members → 抛错含成员名全集 | R7 同源 |
| J5 | `kinematics.test.ts` | 单 revolute：drive=0 → child 原位；drive=90 → child 绕轴转 90°，手算位姿逐分量比对 | FK 数学 |
| J6 | 同上 | 两级链（base→arm→gripper）：gripper 位姿 = 两次 compose 手算值 | 链式传递 |
| J7 | 同上 | `drive` 越界值被 clamp 到 [min,max] | brepjs 行为透传 |
| J8 | 同上 | joints 与 constraints 并存：同名成员 joints 优先（覆盖语义 + 一条诊断） | §3.2 合并语义 |
| J9 | `api/*.test.ts` | `cad.inverseKinematics` 平面二连杆到位目标：converged=true 且 FK(解) ≈ target（1e-3） | IK |
| J10 | 同上 | `cad.jointTrajectory` 步数、t∈[0,1]、端点值正确 | 轨迹 |
| J11 | 同上 | `cad.mechanismDOF` 串联两 revolute = 2 | DOF |
| J12 | `packages/tests/faijs/assembly/` | e2e：含 joints+drive 的 `.fai.js` 重放，ExecutionResult.kinematics 与库面直调一致；module 与 direct 双执行器一致（R11② 同源纪律） | 双链路 |

### 3.5 P3 验收清单

- [ ] J1–J12 全绿；既有装配测试回归全绿
- [ ] `cad.assembly` 支持 `joints`/`drive` 参数且 roundtrip 测试覆盖（沿用 P2-f2 的 codegen 测试文件加样例）
- [ ] arg-spec 五条 skip 的 reason 全部更新为实际去向
- [ ] `docs/ops-api-inventory.md` §6.1 + `docs/api-contract.md` §12 增补运动副契约（JointSpec 表、drive 覆盖语义、kinematics 进 ExecutionResult）
- [ ] vendored 目录 diff 为零（`git diff packages/core/src/vendored` 必须为空）
- [ ] Agent Note 归档 `.agents/notes/implemented/feature/`

---

## 4. 交接须知（第三方执行者必读）

1. **仓库与构建**：faijs 是 npm workspaces monorepo（`packages/core` 为引擎）。常用命令见根目录 [AGENTS.md](../../AGENTS.md)（build / test -w / typecheck / lint / doc-sync）。`packages/demo` 经 vite alias 直接消费源码，改 faijs 源码无需 npm pack。
2. **测试纪律（硬性）**：先跑新写的测试 → 再跑受影响存量测试 → 全绿后 `pwsh -NoProfile scripts/ci.ps1` **一次**；CI 后只重跑失败项。**严禁通过跑 CI 找 bug**。stderr 零容忍（CI 强制）。
3. **vendored 铁律**：`packages/core/src/vendored/` 下**禁止修改任何文件**（NOTICE 锁定上游快照）。P2/P3 全部需求都只需要 import 其导出——已核实可行（§1.3）。
4. **绝不静默**：拓扑解析三态错误（`E_TOPO_NOT_FOUND`/`E_TOPO_DELETED`/`E_TOPO_AMBIGUOUS`）、成员名空串、child 重复驱动——全部抛错，禁止降级吞错。
5. **四元数顺序**：faijs 对外 `[x,y,z,w]`，brepjs `[w,x,y,z]`。只允许经 `api/assembly/pose.ts` 的转换函数，禁止在任何其它文件手写分量重排。
6. **文档同步**：契约变更（新 API/新错误/新参数）必须同 PR 更新 `docs/api-contract.md`（含 `.zh.md` 双语配对 + i18n.yaml）并用 `npm run gen-ops-api-inventory` 重新生成 inventory；非平凡变更新增 Agent Note。
7. **环境备注**：Windows 开发环境。已知 WorkBuddy 类工具终端会注入 `NODE_OPTIONS`/`genie-safe-delete` shim，可能拦截构建的 dist 清理（`CODEBUDDY_SAFE_DELETE_ENABLED=0` 可对单命令作用域关闭）；嵌套 pwsh 输出捕获不可靠时，按 ci.ps1 步骤逐条等价执行并以 `${PIPESTATUS[0]}` 检查退出码（管道 `| tail` 会吞退出码——P0+P1 实施时已踩过此坑）。
8. **3d_editor 仓库**：P2-e1 的改动在独立仓库 `../3d_editor`（React 19 + TS + Vite），单独提交；它通过 `@faicad/faijs/browser` 消费 faijs，需先在 faijs 侧完成 P2-f1/f2/f3 并 `npm run pack` 出新 tgz 再升级宿主依赖。

---

## 5. 实施顺序与依赖

```
P2-f1 校验 ─┐
P2-f2 roundtrip ─┼→（互相独立，可并行）
P2-f3 preview ─┤
P2-f4 metadata ─┘
        │
        ▼  （faijs 侧全部落地 + pack 后）
P2-e1 3d_editor 宿主适配（②③④⑤ 依赖 f3 的 solvePreview 导出）
        │
        ▼
P3.1 joints.ts（buildJoint/buildKinematicTree/校验）→ P3.2 solveKinematics
        → P3.3 查询函数注册（jointTrajectory/inverseKinematics/mechanismDOF）
        → P3.4 宿主只读消费（可选，独立提交）
```

工作量量级（供排期参考，非承诺）：P2-f* 各 0.5–1 天；P2-e1 2–3 天；P3 合计 2–3 天。均不含 CI 与文档同步时间。

---

## 6. 决策点（实施前未获反馈一律按「建议」列执行，并在 PR 描述中列出所选选项）

| # | 决策点 | 选项 A | 选项 B | 建议 |
|---|---|---|---|---|
| D-P2-1 | 预览入口形态 | `solvePreview(type, refEntity, depEntity, value?)` 纯几何输入（§2.3） | 复用 `solveAssembly` 整体求解做预览 | **A**——预览只涉及当前一对实体，无需整体求解；且不依赖成员 Shape |
| D-P2-2 | metadata 是否纳入 P2 | 纳入（§2.4，低成本） | 继续悬置 | **A** |
| D-P2-3 | 宿主顶点拾取 | P2 不做，point 实体用坐标输入 | 做 vertexTopoRefFromRow | **A** |
| D-P2-4 | 新脚本的方法名 | 宿主新产出 `asm1.solve()` | 继续产出 `do_assemble()` | **A**（两者已同义，solve 语义更准） |
| D-P3-1 | drive 的合并语义 | joints 输出覆盖同名成员约束解 | 报错禁止并存 | **A**（覆盖 + 诊断一条 warning） |
| D-P3-2 | kinematics 结果通道 | 写入 `ExecutionResult.kinematics`（R0 语句形态不变） | 新增有返回值语句形态 | **A** |
| D-P3-3 | IK/轨迹/DOF 暴露形态 | `cad.*` 纯查询函数（§3.2 表） | 挂在 assembly receiver 方法 | **A**（无副作用，入参全可序列化） |

---

## 7. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| RP1 | 宿主预览切换后与执行不一致（R8 复发） | 高 | `solvePreview` 内部复用 lower + solveConstraints（不另写数学）；PV1 用 G1–G4 锁等价 |
| RP2 | JointSpec ↔ brepjs Joint 映射漏字段（offset 四元数、planar/spherical 多 DOF 的 value 数组） | 中 | J1/J2 逐 type 断言 dofs 数量与 clamp；多 DOF 驱动用 `drive: {child: [v1, v2]}` 数组形态，测试覆盖 |
| RP3 | `forwardKinematics` 对 child 重复驱动静默跳过 → 用户得到错误位姿无提示 | 中 | faijs 侧求解前抛错（J3），绝不透传静默行为 |
| RP4 | 3d_editor 多约束 UI 复杂度失控（拾取→累积→删除→提交的状态机） | 中 | 沿用 assemble-store 现有单约束状态机扩展 `extraConstraints` 数组；每步有 store 级单测 |
| RP5 | codegen 对 drive 的 `Record<string, number \| number[]>` 打印歧义 | 低 | P2-f2 roundtrip 测试样例显式覆盖 drive（P3 时补样例） |
| RP6 | 存量宿主（未升级的 3d_editor 版本）打开含新约束的脚本 | 低 | faijs normalize 对未知 type 抛错（V1）——失败显式化，不静默漂移 |

---

## 8. 总验收口径（P2+P3 合并检查）

- [ ] faijs：`npm run typecheck` / `lint` / `doc-sync` 绿；CI 一次通过（遵守 §4.2 纪律）
- [ ] faijs：P2 §2.6 与 P3 §3.5 清单逐项勾掉
- [ ] faijs：`git diff packages/core/src/vendored` 为空
- [ ] 3d_editor：§2.6 宿主清单逐项勾掉，独立仓库提交
- [ ] 文档：api-contract（双语）/ ops-api-inventory / syntax-design（若语句形态有变）/ Agent Note 齐备
