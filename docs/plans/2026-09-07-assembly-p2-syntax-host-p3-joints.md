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
| `solveFaceMate` | ⏳ **临时保留，P2-f5 删除** | `api/compound.ts:140` 导出、签名不变，3d_editor 预览依赖（R8 第一步）。**它是旧装配算法，不是长期资产**——删除任务见 §2.8 |
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
| `operations/jointFns.ts` | `Joint`/`JointAxis`/`JointDOF`/`JointPose` 类型；工厂 `revoluteJoint`(`:189`)/`prismaticJoint`(`:206`)/`cylindricalJoint`(`:222`)/`planarJoint`(`:240`)/`sphericalJoint`(`:278`)；`setJointValues(joint, values[])`(`:296`)/`setJointValue(joint, value)`(`:306`)；`jointTransform(joint, value)`(`:340`)；`addJoint(assembly, joint)`(`:367`)；`forwardKinematics(assembly, jointValues?) → Map<string, JointPose>`(`:406`)；`mechanismDOF(assembly)`(`:461`) | `Joint` 纯数据；**`JointPose = { position: Vec3; rotation: [w,x,y,z] }`（`jointFns.ts:73-76`，字段名是 `position` 不是 `translation`）** 纯数据 |
| `operations/ikFns.ts` | `inverseKinematics(assembly, endEffector, target: IKTarget, options?) → IKResult{values, converged, iterations, error}`；`jointTrajectory(...) → TrajectorySample[]` | 纯数值计算；**输入只需要 AssemblyNode 的名字/joints 拓扑，不需要 shape** |
| `operations/dhFns.ts` | `jointsFromDH(rows: DHRow[], options?)` | 纯数据 |
| `operations/assemblyFns.ts` | `createAssemblyNode(name, options?)`、`addChild`、`walkAssembly` | **`AssemblyNodeOptions.shape` 是可选的**（`assemblyFns.ts:33-45`）——`createAssemblyNode(name)` 产出零句柄节点 |

**P3 关键判定：`forwardKinematics` / `inverseKinematics` / `mechanismDOF` / `jointTrajectory` 只消费节点的 name/translate/rotate/joints 拓扑与 joints 数值，从不触碰 `shape` 句柄。** 因此 faijs 可以从纯数据 `JointSpec[]` 构造无 shape 的 AssemblyNode 树直接调用——**vendored 依旧零修改**。

> ⚠️ **但 `joints` 是挂在节点上的**：这四个函数都用 `walkAssembly` 遍历树收集 `node.joints`（`jointFns.ts:411-416`、`:385-390`、`:404-408`），所以每个 joint 必须经 `addJoint` 挂到树上；而位姿传播是按 `joint.parent`/`joint.child` 的**名字图**做的，与树的父子边无关。建树步骤见 §3.2（这一步写错会得到全 identity 位姿）。

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

**落点（已核实，勿按 defineOp 惯例找入口）**：`assembly` 是 `api/compound.ts` 里的**普通导出函数**（经 `api/api-namespace.ts:25,55` 注册进 `cad` 命名空间），**不是 `defineOp`/`compatOp` 声明的 op**，因此没有"params 校验惯例"可复用。校验写在新建的 `packages/core/src/api/assembly/validate.ts`，由 `assembly(params)` 在函数体开头调用（`keep()` 之前）。

**`api/assert.ts` 现有助手只有 7 个**（`assertNumber` / `assertPositiveNumber` / `assertNonNegativeNumber` / `assertVec3` / `assertNonZeroVec3` / `assertNumberOrVec3` / `assertOneOf`，见 `assert.ts:15-94`）——**没有对象/数组结构校验助手**，V1/V2/V4/V5 需要的"对象形态互斥""数组逐项校验"必须新写（建议加在 `validate.ts` 内部，不污染通用 assert）。

**不改 parser、不恢复 args-schema。**

校验规则（逐条可判，报错文案必须含：字段路径 + 期望形态 + 实际收到值）：

| # | 规则 | 失败行为 |
|---|---|---|
| V1 | `constraints` 每项 `type` ∈ `{mate, align, coincident, concentric, distance, angle, parallel, perpendicular, fixed, face_mate}` | 抛错（沿用 `normalize.ts` 未知类型路径，文案列出合法类型全集） |
| V2 | `mate`/`align`/`coincident`/`concentric`/`parallel`/`perpendicular` 必须有 `a`、`b` 两个 `EntityRef` | 抛错 |
| V3 | `distance`/`angle` 必须有**有限数** `value`；**不设区间**（`angle` 允许 ±360 以外的值，与 brepjs `solveAngle` 行为对齐） | 抛错 |
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

**样本脚本（直接抄进测试，不引用 09-06 文档）**：

```js
let part0 = cad.box(60, 40, 10, { centered: true })
let part1 = cad.box(30, 30, 20, { centered: true })
let part2 = cad.cylinder(6, 60, { centered: true })
let part3 = cad.cylinder(15, 10, { centered: true })

let asm1 = cad.assembly({
  name: '主轴组件',
  members: [part0, part1, part2, part3],
  constraints: [
    { type: 'fixed', part: 'part0' },
    { type: 'mate',
      a: { part: 'part0', face: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] } },
      b: { part: 'part1', face: { surfaceType: 'plane', center: [0, 0, -10], normal: [0, 0, -1] } } },
    { type: 'align',
      a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
      b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, 1] } } },
    { type: 'coincident',
      a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
      b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, -1] } } },
    { type: 'concentric',
      a: { part: 'part1', edge: { axis: { origin: [0, 0, 10], direction: [0, 0, 1] } } },
      b: { part: 'part2', edge: { axis: { origin: [0, 0, 0], direction: [0, 0, 1] } } } },
    { type: 'distance', value: 12,
      a: { part: 'part1', face: { center: [15, 0, 10], normal: [1, 0, 0] } },
      b: { part: 'part3', face: { center: [0, 0, -5], normal: [0, 0, -1] } } },
    { type: 'angle', value: 30,
      a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
      b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, -1] } } },
    { type: 'parallel',
      a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
      b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, -1] } } },
    { type: 'perpendicular',
      a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
      b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, -1] } } },
    { type: 'mate',
      a: { part: 'part0', face: { topoRef: { kind: 'face', origin: 'part0', role: 'box:top',
                                             hint: { kind: 'face', surfaceType: 'plane' } } } },
      b: { part: 'part2', face: { topoRef: { kind: 'face', origin: 'part2', role: 'cylinder:bottom',
                                             hint: { kind: 'face' } } } } },
    { type: 'face_mate',
      fixedPartName: 'part0', movingPartName: 'part3',
      fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
      movingFace: { surfaceType: 'plane', center: [0, 0, -5], normal: [0, 0, -1] } },
  ],
})
asm1.solve()
```

**断言**：`.fai.js 文本 → parse → codegen → 再 parse`，两次 parse 产出的 `constraints` 参数**结构深度相等**（`toEqual`）。覆盖：9 种新类型 + `face_mate` 遗留形态 + `EntityRef` 四形态（`face` 快照 / `face{topoRef}` / `edge{axis}` / `point` / `faceIndex` 至少各一例）+ TopoRef 字面量 + 裸变量 `members`。

`asm1.solve()` 与 `asm1.do_assemble()` 两种调用形态都要各写一个样本（同一 constraints 结构，只换末行）。

### 2.3 P2-f3：预览纯函数入口（faijs 仓库，R8 第二步的前半）

**动机**：3d_editor 预览目前直接调 `solveFaceMate(p1, n1, p2, n2)`——只支持 mate。P2 宿主要预览任意约束类型，需要一个**与执行同源**的轻量入口。

**设计**：新建 `packages/core/src/api/assembly/preview.ts`。

> ⚠️ **实现者必读（原稿的一处不可实现之处）**：现有 `lower.ts:71` 的 `lowerStructuralConstraint(c: StructuralConstraint, env)` **只接受 EntityRef + 解析环境**，几何是它内部从 TopoRef/快照现场解析出来的——**没有任何接受 `SolverEntity` 的降级入口**，所以"内部复用 `lowerStructuralConstraint`"这句话照抄是实现不出来的。P2-f3 **必须同时**在 `lower.ts` 新增一个纯实体入参的降级函数，两条路径共用同一套编码规则。

**第一步：在 `lower.ts` 新增 `lowerEntities`（与 `lowerStructuralConstraint` 同文件、同规则）**

```ts
/**
 * 纯实体降级：两侧 SolverEntity 已知（预览路径 / 宿主已持有几何）。
 * 与 lowerStructuralConstraint 共用 axisFromFace 的编码规则，不另写数学。
 */
export function lowerEntities(
  type: 'mate' | 'align' | 'coincident' | 'concentric' | 'distance' | 'angle',
  a: { node: string; entity: SolverEntity },
  b: { node: string; entity: SolverEntity },
  value?: number,
): LoweredConstraint
```

**第二步：`preview.ts` 的输入约定（二选一必居其一，本方案选定如下）**

- **输入一律是"未编码"的实体**：面 → `{type:'plane', origin:center, normal}`，圆柱/圆锥面与边 → `{type:'axis', origin, direction}`，点 → `{type:'point', origin}`；
- **`mate`/`align` 的 flip 由 `solvePreview` 内部负责**（`mate`：dep 侧法向取反；`align`：不取反），宿主**不需要**知道自己该不该 flip；
- 因此 `mate` 预览内部走 `axisFromFace({center: plane.origin, normal: plane.normal}, flip)` 这条与 `lower.ts` 完全相同的编码路径（把 `plane` 实体还原成 `{center, normal}` 再编码），随后与执行路径共用 `concentric` + `solveConstraints`。

```ts
import type { SolverConstraint, SolverEntity } from '../../vendored/brepjs/kernel/solverAdapter'
import type { AssemblyTransform } from '../../runtime-state'
import { solveConstraints } from '../../vendored/brepjs/kernel/solverAdapter'
import { lowerEntities } from './lower'
import { poseToAssemblyTransform } from './pose'

/**
 * 单约束预览：给定两条实体的几何（SolverEntity，纯数据），
 * 走与 solveAssembly 完全相同的 lower → solveConstraints 链路，
 * 返回 dependent 侧成员的位姿（AssemblyTransform，index 固定 -1，pivot = dep 实体 origin）。
 *
 * 与执行的同源性保证：内部复用 lowerEntities 与 solveConstraints，不另写数学。
 * 仅支持"恰好定位一个 dependent"的单条约束。
 * @throws Error on `fixed`（无位移语义，预览无意义）或实体类型不匹配。
 */
export function solvePreview(
  type: 'mate' | 'align' | 'coincident' | 'concentric' | 'distance' | 'angle',
  refEntity: SolverEntity,
  depEntity: SolverEntity,
  value?: number,          // distance/angle 用
): AssemblyTransform {
  const { constraint, depOrigin } = lowerEntities(
    type,
    { node: '__ref', entity: refEntity },
    { node: '__dep', entity: depEntity },
    value,
  )
  const r = solveConstraints(['__ref', '__dep'], [constraint as SolverConstraint])
  if (!r.converged) {
    throw new Error(`[assembly:preview] constraint did not converge; unsupported: ${r.unsupported.join(', ') || '(no detail)'}`)
  }
  const pose = r.transforms.get('__dep')
  if (!pose) throw new Error('[assembly:preview] dependent was not positioned')
  return poseToAssemblyTransform(pose, depOrigin ?? [0, 0, 0], -1)
}
```

配套 `entityFromGeometry` 辅助（导出，供宿主用）：

```ts
/** 宿主拾取数据 → SolverEntity（预览时几何就在手上，不经过 TopoRef 解析）。 */
export function entityFromGeometry(g:
  | { kind: 'plane'; center: AssemblyVec3; normal: AssemblyVec3 }
  | { kind: 'axis'; origin: AssemblyVec3; direction: AssemblyVec3 }
  | { kind: 'point'; origin: AssemblyVec3 },
): SolverEntity
```

**导出链（三跳，缺一不可）**：

1. `api/assembly/index.ts` 加 `export * from './preview'`；
2. **`api/index.ts` 加 `export * from './assembly'`** —— 该文件目前只从 `./compound` 导出（`api/index.ts:27-35`），不做这一步 `solvePreview` 到不了门面。注意 `EntityRef`/`FaceRef`/`AssemblyVec3` 等类型已有**显式**导出（`:31-35`），与星号导出重名时显式优先、不报错，但必须跑 `lang/op-set-consistency.test.ts` 与 typecheck 验证；
3. `packages/core/src/browser.ts` 末尾已有 `export * from './api'` → `src/browser.ts` 再 `export * from '@faicad/faijs-core/browser'`，故 `@faicad/faijs/browser` 自动可见，**无需改动**。

**测试**（`packages/core/src/api/assembly/preview.test.ts`）：

| # | 用例 | 断言 |
|---|---|---|
| PV1 | `mate` 的 `solvePreview` vs **golden 基准** | §3.7.2（09-06 方案）G1–G4 四组输入逐分量相等（1e-9）。**基准是 §2.8 冻结的 golden 常量，不再调用 `solveFaceMate`**（后者在 P2-f5 被删除，测试不得依赖它） |
| PV2 | concentric/distance/angle 各 1 例 | 对照 `solveAssembly` 单约束结果逐分量相等 |
| PV3 | `fixed` 类型 / axis-axis 不匹配的组合 | **一律抛明确错误**（不是"返回不变换"）——对齐「绝不静默」红线；错误信息含 `unsupported` 明细 |

### 2.4 P2-f4：metadata-extractor 识别装配语句（faijs 仓库）

`lang/metadata-extractor.ts` 增加对 `cad.assembly` / `asmN.do_assemble` / `asmN.solve` 语句的提取：语句摘要（statement-summary）标记 `isAssembly: true`，提取 `{name, memberCount, constraintTypes: string[]}`。**不提取约束对象全文**（宿主已有 args 通道，`model-store.ts:973` 继续用）。

> ⚠️ **与宿主现有通道的关系（必须一次说清，否则会双写冲突）**：3d_editor 的 `model-store.ts:973` **今天已经**从 `structuralStmtArgs(stmt).constraints` 自行抓 `constraints` 并打 `isAssembly`。P2-f4 落定后的权威口径是：
> - **`metadata-extractor` 产出的 `isAssembly` / `constraintTypes` 是权威**（语句摘要级，供面板显示）；
> - **约束全文仍然只走 args 通道**（`model-store.ts:973` 现状保留，不迁）；
> - P2-e1 ④ 改造时把 `model-store.ts:973` 的 `isAssembly` 改为**读取 metadata 的字段**，不得再自行推导；`constraints` 仍从 args 取。**禁止两处各判一次。**

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

- **预览切换（R8 第二步，P2 强制项，是 §2.8 删除的前置条件）**：`assemble-store.ts` 的 `import { solveFaceMate } from '@faicad/faijs/browser'`（`:17`）改为导入 `solvePreview` / `entityFromGeometry`；预览调用点（`:565` 一带，`previewAssemble`）改为：拾取面 → `{center, normal}` 或圆柱面 `{axis}` → `entityFromGeometry` → `solvePreview(type, ref, dep, value)`。**预览与执行同源**的注释与保证保持：两者都走 lower + solveConstraints。
- **必须一并清理的旧引用**：`assemble-store.ts` 里所有 `solveFaceMate` 的注释与调用（`:204`、`:226`、`:283`、`:304`、`:337`、`:547`、`:565`、`:597`，共 8 处；`confirmAssemble` 的导出在 `:208`）。**全部清完后 `grep -r solveFaceMate ../3d_editor/src` 必须零命中**——这是 §2.8 能删掉 faijs 侧遗留实现的前提。
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
- [ ] **`api/index.ts` 已加 `export * from './assembly'`**，`solvePreview` 可从 `@faicad/faijs/browser` 导入（写一个 import 断言测试防回归）
- [ ] **P2-f5（§2.8）全部勾掉**：golden 已冻结、旧算法与自有四元数已删、全仓 grep 零命中
- [ ] typecheck / lint 绿；`npm run doc-sync` 绿（`docs/api-contract.md` §12 增补 solvePreview 与校验规则、**去掉 solveFaceMate 表述**；`docs/ops-api-inventory.md` 经 `npm run gen-ops-api-inventory` 重新生成）
- [ ] **版本号已 bump**（AGENTS.md：打包发布前必须更新版本号）→ `npm run pack` 产出新 tgz 后宿主才升级

3d_editor 仓库（独立 git 仓库，单独提交）：

- [ ] 约束类型选择器可用，8 种类型各能走通「拾取 → 预览 → 确认」
- [ ] 预览结果与重放结果一致（同源断言测试）
- [ ] 存量场景（face_mate）回归通过
- [ ] assemble-store.test.ts 全绿
- [ ] `grep -r solveFaceMate src` **零命中**（§2.5 ② 的 8 处清理到位）

### 2.7 P2 明确不做

- 顶点拾取（D-P2-3 建议：point 实体用坐标输入）
- 嵌套子装配（09-06 方案 D5 已定 P1 只做平表，P2 不变）
- `add_constraint` 从 no-op 变真实现（09-06 方案 §5.5 保持 no-op，不折腾）
- URDF / DH 导入导出（P3 之外的独立议题，见 09-06 方案 R9）
- **`applyTransform` 不删**：它在 `mesh/rigid-transform.ts`，是**引擎侧刚体变换应用**（mesh 顶点烘焙 / BREP 变换），既不是装配算法也不是四元数实现，`module-executor` 与 `direct-executor` 都依赖它

### 2.8 P2-f5：删除 faijs 旧装配算法与自有四元数实现（**强制项，P2 收尾必做**）

> **需求来源（用户原话）**：「我需要保证在迁移到 brepjs 的装配算法后，原来 faijs 写的老的装配算法，以及自己的四元数实现都要删除。」
>
> 09-06 方案 P1 第 7 条原先把它写成"P2 后可选的长期收敛点"——**本方案将其改为强制项**。P2 结束时，faijs 里必须只剩 brepjs 一条装配求解链路。

#### ① 前置条件（三条全满足才准删）

| # | 前置 | 说明 |
|---|---|---|
| a | **T3/T4 基准 golden 化** | 旧实现一旦删除，就再没有"旧 vs 新"可比。必须先把 G1–G4 的期望值冻结成常量 |
| b | **3d_editor 预览已切 `solvePreview`**（§2.5 ②） | 宿主还在 `import { solveFaceMate }` 时删除 = 宿主构建直接断 |
| c | **宿主依赖已升到新 tgz 且版本号已 bump** | 3d_editor 消费的是 `npm run pack` 产物，不是源码 |

**a 的做法（一次性，产出即冻结，不再改动）**：

1. 在 `packages/core/src/api/assembly/golden-mate.ts`（新文件）写入 G1–G4 四组输入的期望结果；
2. 期望值**在删除前**用现有 `solveFaceMate` 跑一次打印固化（临时脚本，跑完即弃，不入库）；
3. 文件头注释必须写明：*「这组数值是 brepjs 迁移前 faijs 旧实现在 2026-09-07 的产出，旧实现删除后它们就是 `mate` 语义的唯一回归基准——改动它们等于改动存量装配行为」*；
4. **golden 只比对 `rotationMatrix` + `pivot` + `translation`**（逐分量 1e-9）；四元数按**同旋转等价类**判定 `|dot(q, q_golden)| ≈ 1`（G3 的 dot=−1 分支有符号双解，逐分量比会随机红）；
5. `solve.test.ts` 的 T3/T4（`:19` 的 `import { solveFaceMate, type FaceMateTransform }`、`:63/:120/:136` 的 baseline 调用）与 `preview.test.ts` 的 PV1 一并改为读 golden。

#### ② 删除清单（faijs 仓库，逐文件逐行）

| 文件 | 删除内容 | 备注 |
|---|---|---|
| `api/compound.ts` | `:60-84` 向量数学私有块（`vec3Normalize` / `vec3Sub` / `vec3Cross` / `vec3Dot`） | 经核实**仅被下面两项调用**，无其它引用 |
| `api/compound.ts` | `:86-106` `quaternionFromUnitVectors` | faijs 自有四元数实现 |
| `api/compound.ts` | `:108-121` `quaternionToMatrix3` | 同上 |
| `api/compound.ts` | `:124-129` `FaceMateTransform` 接口 | 旧求解产物类型 |
| `api/compound.ts` | `:131-158` `solveFaceMate` | 旧装配算法本体 |
| `api/compound.ts` | `:9` 文件头注释中「`solveFaceMate` 保留为等价性基准」 | 改写为「求解全链路走 `api/assembly`，旧实现已删除」 |
| `api/index.ts` | `:28` 的 `solveFaceMate` 导出 | **`applyTransform` 保留**（同行的另一个导出） |
| `src/browser.ts` | `:8` 注释里提到的 `solveFaceMate` | 只改注释 |
| `brep/brep-ops.ts` | `:162` 注释「变换源是 solveFaceMate 的四元数」 | 改述为「变换源是 `api/assembly`」 |
| `cad-runtime/runtime.ts` | `:66` 注释「实时 solveFaceMate 求解」 | 同上 |
| `mesh/rigid-transform.ts` | `:9` 注释 `library (solveFaceMate)` | 同上（**函数本身保留**） |
| `api/assembly/pose.ts` | `:41` 注释「与 `compound.quaternionToMatrix3` 同式」 | 改为「faijs 侧唯一实现」 |
| `api/assembly/solve.test.ts` | `:19/:59/:63/:84/:101/:120/:136` 的 `solveFaceMate` 依赖 | 按 ①-a 改 golden |
| `../3d_editor/src/stores/tools/assemble-store.ts` | `:17` import、`:565` 调用、`:204/:226/:283/:304/:337/:547/:597` 注释 | 见 §2.5 ② |

#### ③ 明确保留（禁止误删）

- `applyTransform`（`mesh/rigid-transform.ts`）—— 引擎侧刚体变换，非装配算法；
- `api/assembly/pose.ts` 的 `fromBrepjsQuat` / `toBrepjsQuat` / `quaternionToMatrix3` —— 新链路的转换层；
- 其它文件的 `THREE.Quaternion` 命中（`brep-ops` / `fai_drill` / `joinery-brep` / `DrillHoleCore` / `engrave`）—— three.js 的四元数，与本实现无关。

#### ④ 验收

- [ ] `grep -rn "solveFaceMate\|quaternionFromUnitVectors" <faijs>/src <faijs>/packages/*/src ../3d_editor/src` **零命中**（注释也算命中）
- [ ] `grep -rn "FaceMateTransform" <faijs>/packages/core/src` 零命中
- [ ] `api/assembly/pose.ts` 的 `quaternionToMatrix3` 仍在且被 `pose.test.ts` 覆盖
- [ ] T3/T4/PV1 对 golden 仍逐分量 1e-9 绿；`assembly-replay.test.ts` 存量 `face_mate` 逐顶点一致仍绿
- [ ] `npm run typecheck` / `lint` 绿；3d_editor 侧 `tsc` 与 `assemble-store.test.ts` 绿
- [ ] `docs/api-contract.md` §12 去掉 `solveFaceMate` 相关表述（含 `.zh.md` + `i18n.yaml`）；`npm run gen-ops-api-inventory` 重新生成
- [ ] 归档 plans（`docs/plans/2026-08/`）**不得修改**（AGENTS.md 红线），其中的历史提及保持原样

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
  /**
   * 多 DOF 运动副（cylindrical 2 / planar 3 / spherical 3）的逐 DOF 范围，
   * **长度必须与 type 的 DOF 数一致，顺序 = brepjs `Joint.dofs` 的组合顺序**：
   *   cylindrical → [rotation, translation]
   *   planar      → [u, v, rotation]
   *   spherical   → [x, y, z]
   * P3 首期只实现 revolute/prismatic（见 §3.2 范围裁决），此字段随多 DOF 类型一起启用。
   */
  dofs?: Array<{ min: number; max: number; value: number }>
  /** planar 专用：面内 u 参考方向（brepjs 会投影到平面并归一化）。 */
  uDirection?: AssemblyVec3
  /** 静态连杆偏置（childWorld = parentWorld ∘ jointTransform ∘ offset），可选。 */
  offset?: { position?: AssemblyVec3; rotation?: AssemblyVec3 /* faijs [x,y,z,w] */ }
}
```

> **字段名对齐**：`offset` 的两个键必须与 vendored `JointPose`（`jointFns.ts:73-76`）一致 —— **`position`**，不是 `translation`；`rotation` 在 `.fai.js` 里对外用 faijs `[x,y,z,w]`，调 `buildJoint` 时经 `toBrepjsQuat` 换成 `[w,x,y,z]`。

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
  → buildKinematicTree(memberNames, joints): AssemblyNode   // 见下方「建树三步」
  → 校验：parent/child 必须在 members 里；同一 child 不得被两个 joint 驱动
    （brepjs forwardKinematics 对重复 child 静默跳过——faijs 侧必须在求解前抛错，绝不静默）
```

**范围裁决（D-P3-4，务必按此执行）：P3 首期只实现 `revolute` / `prismatic` 两种单 DOF 运动副。**

- 理由：`cylindrical`(2 DOF) / `planar`(3) / `spherical`(3) 的 vendored 工厂要 **per-DOF** 选项（`jointFns.ts:88-135`：`CylindricalOptions{rotation, translation}` / `PlanarOptions{u, v, rotation, uDirection}` / `SphericalOptions{x, y, z}`），而标量 `min/max/value` 表达不了；`JointSpec.dofs` 已按此预留。
- `JointSpec.type` 保留 5 种（存量脚本能读），但 `buildJoint` 遇到三种多 DOF 类型时**抛明确错误**（`[assembly] joint type 'cylindrical' is not supported yet; per-DOF ranges pending`），**绝不静默降级成单 DOF**。
- 多 DOF 的完整映射规格已写在上面 `JointSpec.dofs` 的注释里，后续启用时无需再设计。

**建树三步（原稿漏了第 3 步，漏了 FK 会返回全 identity）**：

```ts
// ① 合成根（forwardKinematics 只接受单个 AssemblyNode；多成员必须有唯一根）
let root = createAssemblyNode('__asm_root')            // 不带 shape（零句柄）
// ② 所有成员挂成子节点——只为让 walkAssembly 覆盖到全部名字
//    （未被 joint 驱动的成员靠这一步拿到 identity 位姿；⚠️ addChild 返回新节点，必须重新赋值）
for (const m of memberNames) root = addChild(root, createAssemblyNode(m))
// ③ 关键：每个 joint 必须经 addJoint 挂到树上
//    （FK 用 walkAssembly 收集 node.joints；位姿按 joint.parent/child 的名字图传播，与树边无关）
for (const j of joints) root = addJoint(root, buildJoint(j))
```

> ⚠️ `'__asm_root'` 也会出现在 `forwardKinematics` 返回的 `Map` 里，转 `AssemblyTransform[]` 时**按 part 名过滤掉**（只保留 `memberNames` 里的键）。

`pose.ts` 扩展：`jointPoseToAssemblyTransform(pose: JointPose, index)`——**`JointPose = { position: Vec3; rotation: [w,x,y,z] }`（字段名是 `position`）** → faijs `AssemblyTransform`（`fromBrepjsQuat` 换序；`pivot = [0,0,0]`，`translation = pose.position`，因为 brepjs FK 的位姿本来就是绕原点模型，与约束求解的 pivot 换算同式）。

`solve.ts` 扩展（或新 `kinematics.ts`）：

```
solveKinematics(memberNames, joints, drive):
  1. 校验（空名 R7、parent/child ∈ members、child 唯一驱动、drive 键 ∈ joints 的 child 集）
  2. buildKinematicTree → forwardKinematics(tree, drive)
  3. Map<string, JointPose> → per-member AssemblyTransform[]
  4. 与约束求解的合并语义（**在库侧一次合并，禁止引擎侧两次登记**）：
     - 先跑约束求解得到 `Map<成员名, AssemblyTransform>`（per-member 终态）；
     - 再跑 `solveKinematics` 得到 `Map<成员名, AssemblyTransform>`；
     - 以**成员名**为键，用 joints 结果**覆盖**同名成员的约束解，得到唯一一张表；
     - 最后按成员下标转成 `AssemblyTransform[]`，由 `assembly` 的行为方法**一次性** `setPendingAssemblyTransforms`；
     - 诊断信息不混用：joints 不参与 `solveConstraints` 的 `converged` 统计，覆盖发生时记一条 warning（D-P3-1）
```

**IK / 轨迹暴露（纯查询函数）**：

| `.fai.js` / 库面 | 签名 | 内部 |
|---|---|---|
| `cad.jointTrajectory({ joints, from, to, steps })` | → `TrajectorySample[]`（`t` ∈ [0,1]、`values`、`poses`；产出 `steps+1` 个采样） | `JointSpec[]` → buildKinematicTree → vendored `jointTrajectory(assembly, from, to, steps)`（`ikFns.ts:401`）。`from`/`to` 是 `Record<child 名, number \| number[]>`，**没有 `endEffector` 参数** |
| `cad.inverseKinematics({ joints, endEffector, target: {position, rotation?}, options? })` | → `{values, converged, iterations, error}` | buildKinematicTree → vendored `inverseKinematics(assembly, endEffector, target, options)`（`ikFns.ts:326`）；`endEffector` = **child 成员名**；**`target.rotation` 对外用 faijs `[x,y,z,w]`，内部 `toBrepjsQuat` 换序** |
| `cad.mechanismDOF({ joints })` | → `number` | buildKinematicTree → vendored `mechanismDOF`（`jointFns.ts:461`） |

三者都是**无副作用纯函数**（输入纯数据、输出纯数据），不挂在 assembly receiver 上。

> ⚠️ **新增 `cad.*` 函数的固定动作（原稿未写，漏了会被守卫拦下）** —— 三源一致守卫在 `packages/core/src/lang/op-set-consistency.test.ts`：
> 1. 写 op 实现（`api/assembly/joints.ts` 或新文件）；
> 2. 加进 `api/api-namespace.ts` 的 `createApiNamespace()` 键集；
> 3. **重跑符号表生成**：`npx tsx packages/core/scripts/gen-symbol-table.ts`（产物 `lang/symbol-table.generated.ts` **禁手改**）；
> 4. 确认 `api/index.ts` 的导出面覆盖新键；
> 5. 跑 `npx vitest run src/lang/op-set-consistency.test.ts`（core 包内）；
> 6. `npm run gen-ops-api-inventory` 重新生成 inventory。
>
> 并把 `api/surface/arg-spec.ts` 里 `forwardKinematics`（`:1653`）与 `mechanismDOF`（`:1656`）两条 skip 的 reason 更新为实际去向（`inverseKinematics`/`jointTrajectory` 若被 arg-spec 登记，同样更新）。

### 3.3 宿主消费（`ExecutionResult.kinematics`——**不新增 `asm1.kinematics()` 方法**）

> ⚠️ **原稿此处自相矛盾，本节给出唯一口径**：09-06 方案 §5.5 列过 `asm1.kinematics()`，`api/surface/arg-spec.ts:1653` 的 skip reason 也写了「改由 `asm.kinematics()` 暴露」，但 `.fai.js` 是**声明式重放模型**——新增一个"有返回值的方法"会破坏 R0 语句形态（与 §3.1 删除 `asm1.drive()` 是同一个理由）。
> **最终口径：不新增 `asm1.kinematics()` 方法；位姿走 `ExecutionResult` 字段。实施时同步把 `arg-spec.ts:1653` 的 reason 改成「改由 `ExecutionResult.kinematics` + `cad.mechanismDOF` 暴露」。**

- `asm1.solve()` 语句（R0 无赋值）执行后，若该 assembly 有 `joints`，引擎把 per-member 位姿写入 `ExecutionResult`（挂 `ExecutionResult.kinematics: Record<partName, {position, rotation}>`，`rotation` 为 faijs `[x,y,z,w]`）——宿主动画/导出从 `ExecutionResult` 读取，**不新增返回值消费语义**（保持 R0 语句形态不变，与 `do_assemble` 现状一致）。
- **两个执行器都要写**（`module-executor` 与 `direct-executor`），由 J12 锁双链路一致。
- 3d_editor 侧 P3 只做**只读消费**：装配面板显示 DOF 数（`mechanismDOF`）+ 用滑杆改 `drive` 值（改语句参数 → 重放）。完整动画时间线不在 P3 范围。

### 3.4 P3 测试清单

| # | 文件 | 用例 | 锁定 |
|---|---|---|---|
| J1 | `api/assembly/joints.test.ts` | `buildJoint` **revolute/prismatic 各 1 例**：`dofs.length === 1`、axis 透传、`value` clamp 到 `[min,max]` | 工厂映射（D-P3-4 首期范围） |
| J1b | 同上 | **cylindrical/planar/spherical 各 1 例：`buildJoint` 抛明确错误**（不是静默降级） | 多 DOF 未启用的显式失败 |
| J2 | 同上 | offset 四元数换序往返（`toBrepjsQuat(fromBrepjsQuat(q)) === q`）；**offset 字段用 `position`** | §4.3(a) 同源 |
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

- [ ] J1–J12（含 J1b）全绿；既有装配测试回归全绿
- [ ] `cad.assembly` 支持 `joints`/`drive` 参数且 roundtrip 测试覆盖（沿用 P2-f2 的 codegen 测试文件加样例）
- [ ] arg-spec 五条 skip 的 reason 全部更新为实际去向（**含 `arg-spec.ts:1653` 的 `asm.kinematics()` 改为 `ExecutionResult.kinematics`**）
- [ ] 新增 `cad.*` 查询函数已过三源同步（§3.2 的 6 步），`lang/op-set-consistency.test.ts` 绿
- [ ] `docs/ops-api-inventory.md` §6.1 + `docs/api-contract.md` §12 增补运动副契约（JointSpec 表、drive 覆盖语义、kinematics 进 ExecutionResult）
- [ ] vendored 目录 diff 为零（`git diff packages/core/src/vendored` 必须为空）
- [ ] **P2-f5（§2.8）已完成**：旧装配算法与自有四元数已删除、grep 零命中（P3 开工前 faijs 侧必须只剩一条求解链路）
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
8. **3d_editor 仓库**：P2-e1 的改动在独立仓库 `../3d_editor`（React 19 + TS + Vite），单独提交；它通过 `@faicad/faijs/browser` 消费 faijs，需先在 faijs 侧完成 P2-f1/f2/f3、**bump 版本号**后 `npm run pack` 出新 tgz，再升级宿主依赖。
9. **新增 `cad.*` 函数必过三源同步**：写 op → `api-namespace` → `npx tsx packages/core/scripts/gen-symbol-table.ts` → `api/index.ts` 导出 → `lang/op-set-consistency.test.ts` → `npm run gen-ops-api-inventory`（§3.2 有 6 步清单）。
10. **单一求解链路铁律（用户明确要求）**：迁移到 brepjs 装配算法后，faijs 旧的装配算法（`solveFaceMate`）与自有四元数实现（`quaternionFromUnitVectors` / `quaternionToMatrix3` / 私有向量助手）**必须删除**，不允许新旧并存。删除任务 = **§2.8 P2-f5**，前置是「T3/T4 基准 golden 化」+「3d_editor 预览已切 `solvePreview`」。`applyTransform` 与 `api/assembly/pose.ts` 的转换函数**保留**。

---

## 5. 实施顺序与依赖

```
P2-f1 校验 ─┐
P2-f2 roundtrip ─┼→（互相独立，可并行）
P2-f3 preview ─┤            ← 必须含 lowerEntities + api/index.ts 星号导出（§2.3）
P2-f4 metadata ─┘
        │
        ▼  （faijs 侧全部落地 + bump 版本号 + npm run pack 后）
P2-e1 3d_editor 宿主适配（②③④⑤ 依赖 f3 的 solvePreview 导出）
        │    └─ ② 的预览切换是 P2-f5 的硬前置
        ▼
P2-f5 删除遗留实现（§2.8，强制）
        │    ├─ 前置 a：T3/T4 基准 golden 化（先做，与 f1–f4 并行可做）
        │    ├─ 前置 b：P2-e1 预览切换已合并
        │    └─ 前置 c：宿主已升到新 tgz
        ▼
P3.1 joints.ts（buildJoint/buildKinematicTree/校验）→ P3.2 solveKinematics
        → P3.3 查询函数注册（jointTrajectory/inverseKinematics/mechanismDOF，过三源同步）
        → P3.4 宿主只读消费（可选，独立提交）
```

> **P2-f5 的 ①-a（golden 化）不依赖任何 P2 其它任务，可以最先做**——它只是把旧实现的输出固化下来，越早做越安全（旧实现还在，可随时复现比对）。

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
