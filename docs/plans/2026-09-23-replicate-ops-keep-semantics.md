# 复制类 op 的 keep 语义 + 角色表统一方案

状态：方案（待实施）

日期：2026-09-23

## 0. 用户原始需求（原文）

> linearPattern 这类的阵列操作，以及 mirror，它们都是复制的语义，应该不消费输入的 shape，类似 copy。请写这方面的单元测试来保证这一点。然后要修改代码来实现它。
>
> 让复制类的 op 全部保证是 keep 语义。

本方案基于重构方案 `docs/plans/2026-09-23-brep-engine-switchability-rework.md` 描述的"重构后状态"撰写，但**不依赖其尚未落地的 `capabilities` 管道**——keep 语义与引擎切换正交，可独立实施。

**本次一并处理两件事（用户拍板）：**

1. **keep 语义**：9 个复制类 op 全部不消费输入（与 `copy` 一致）。
2. **角色表统一**：`linearPattern` 已有 `replica[k]` 角色表，但其余 4 个多副本 pattern（`circularPattern` / `gridPattern` / `rectangularPattern` / `mirrorJoin`）`naming` 同为 `replicate` 却没有角色表——这是"先做的做了、后做的没做"的生成债。本次把它们也提拔成手写 `defineOp` + 角色表，与 `linearPattern` 同待遇。

---

## 1. 为什么复用既有的 `keep(input)` 惯用法，不新增声明位

消费与否由 op 函数体内的 `keep(input)` 调用决定（见 `copy.ts`、`fai_split.ts` 同源模式）。本方案不引入任何新声明位（如 `preservesInput`），理由如下。

### 1.1 运行时与 UI 共用同一条存活判定路径

`runtime.ts` 中 UI 与运行时统一经 `computeLiveShapes` 入口，构造 `KeepView` 时其 `functionBody` 读取 **DirectExecutor 执行期登记的 KeepRegistry**（`direct-executor.ts` 的 `registerKeepByLine` / `setKeepSink`）。`live-shapes.ts` 的 `lineConsumes` 据此短路：若某语句行登记了 `keep(v)`，则该语句不消费 v。

`copy.ts` 在体内调 `keep(input)` 即落在这条执行期登记上，UI 与运行时共用同一份 keep，**不存在"运行时生效、UI 没生效"的缺口**。（`keepViewFromMetadata` 那个 `functionBody` 恒为 undefined 的视图只在单测里用，非真实路径。）

⇒ 在 op 体内调 `keep(input)` 一次，运行时与 UI 同时生效。

### 1.2 `naming.kind` 与消费判定正交

`naming.kind` 是拓扑/面血缘语义，不应被重载成"消费判定"。消费判定已有现成正确机制：`keep(input)` 调用。复制类 op 与 `copy` 用完全相同的机制即可，无需新增独立位。

---

## 2. 现状（全部以当前代码为准）

### 2.1 keep 缺口（9 个复制类 op）

| op | 定义位置 | 实现形态 | 当前是否 keep 输入 | 修复方式 |
|---|---|---|---|---|
| `copy` | `api/copy.ts:73` | 手写 `defineOp` | ✅ 体内 `keep(input)`（mesh+brep） | 已是正确基准，不动 |
| `linearPattern` | `api/pattern.ts:119` | 手写 `defineOp`（覆盖生成版） | ❌ | 加 `keep(input)` + 抽角色表 helper |
| `circularPattern` | `generated/operations.ts:212` | 生成 `compatOp` | ❌ | 提拔手写 + keep + 角色表 |
| `gridPattern` | `generated/operations.ts:222` | 生成 `compatOp` | ❌ | 提拔手写 + keep + 角色表 |
| `rectangularPattern` | `generated/operations.ts:282` | 生成 `compatOp` | ❌ | 提拔手写 + keep + 角色表 |
| `mirrorJoin` | `generated/operations.ts:272` | 生成 `compatOp` | ❌ | 提拔手写 + keep + 角色表 |
| `mirror` | `generated/topology.ts:285` | 生成 `compatOp` | ❌ | 手写 override + keep（单副本，无数组角色表；`naming: kernel`，非 identity） |
| `clone` | `generated/topology.ts:295` | 生成 `compatOp` | ❌ | 手写 override + keep（单副本） |
| `transformCopy` | `generated/topology.ts:315` | 生成 `compatOp` | ❌ | 手写 override + keep（单副本） |

共 **9 个**复制类 op，仅 `copy` 1 个正确，其余 8 个执行后输入被移出 `result.terminals`（已由 `api/consume-input.test.ts` 验证失败信息：`expected [ 's1' ] to include 's0'`）。

> 生成文件 `api/generated/*` **禁手改**（由 `scripts/gen-l3-surface.ts` 从 `api/surface/arg-spec.ts` 生成）。7 个生成 op 不能就地改，只能走"手写 override 覆盖"——与现有 `api/pattern.ts`(linearPattern)、`api/fai_split.ts`(split)、`api/boolean.ts`(cut) 同一先例。

### 2.2 角色表缺口（4 个多副本 pattern）

| op | `naming.kind` | 当前角色表 | 应有 |
|---|---|---|---|
| `linearPattern` | `replicate` k:0 | ✅ `replica[k]/<inner>`（`pattern.ts:70-97` 质心聚类） | —（已正确） |
| `circularPattern` | `replicate` k:0 | ❌ 无 | 应补 `replica[k]/<inner>` |
| `gridPattern` | `replicate` k:0 | ❌ 无 | 应补 `replica[ix_iy]/<inner>` |
| `rectangularPattern` | `replicate` k:0 | ❌ 无 | 应补 `replica[ix_iy]/<inner>` |
| `mirrorJoin` | `replicate` k:2 | ❌ 无 | 应补 `replica[0]/replica[1]/<inner>` |

`linearPattern` 被提拔成手写**仅因为**它先做了 `replica[k]` 血缘表；其他 4 个同为 `replicate`、产出多份副本，按 Phase 3 L3 抗重放词汇逻辑**同样需要**角色表，只是"后做的没做"——这是生成债，不是原则区别。本次一并补上。

（`mirror` / `clone` / `transformCopy` 是单副本"保留源"语义，与 `copy` 同级，只需 keep、不建数组角色表。注意 `mirror` 的 `naming.kind` 是 `kernel`（newFaces byAdjacency），仅 `clone`/`transformCopy` 为 `identity`。）

---

## 3. 修复方案

### 3.1 核心机制：复用既有 `keep(input)` 惯用法，不加任何新位

所有 8 个待修 op 均在函数体内调 `keep(input)`（手写 op 原地加；生成 op 经 override 加）。角色表处理见 §3.4。

### 3.2 `linearPattern`（手写 op）—— 加 keep + 重构抽 helper

`api/pattern.ts:119` 的 `brep` 函数体调用 `linearPatternBrep` 前加 `keep(input)`，并把现有的质心聚类逻辑抽到公共 helper（§3.4），`linearPatternBrep` 改为调用它。

### 3.3 其余 7 个生成 op —— 手写 override + 接线

按"是否多副本"分两类：

**（A）多副本 4 个 → 提拔成手写 `defineOp`，与 `linearPattern` 同结构**（调内核方法 + `fromBrep` + 调 helper 建角色表 + `keep`）。不委托生成 compatOp（compatOp 不建表，无法复用）。

**（B）单副本 3 个（`mirror`/`clone`/`transformCopy`）→ 薄 override**，brep 体内 `keep` 后委托同名生成 op（保留其 borrow/adopt/capabilities/naming/roleTable 行为）。

新建 `api/replicate.ts` 统一收编 7 个（mirror 此前误建的 `api/mirror.ts` 已删除，其覆盖逻辑并入本文件）。

### 3.4 角色表 helper（Part B 核心）

抽取 `api/internal/replica-role-table.ts`，把 `pattern.ts:42-97` 的质心聚类泛化：每个副本是输入的一个变换 `T_k`，结果面 = ∪ T_k(输入面)。对结果面 `i`，用 `T_k` 的逆变换把其质心反投回输入坐标系，与输入面质心最近匹配 → 得到 `inner` 角色，再挂到 `replica[k]/` 前缀。

```ts
// api/internal/replica-role-table.ts
import type { Shape, Vec3 } from '../../mesh/types'
import type { BrepHandle } from '../../brep/engine/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { RoleTable } from '../../topology/naming/types'
import { brepOf, inputRoleTable, fromBrep } from '../../shape'
import { getFaceHashes } from '../../brep/face-evolution'

export interface ReplicaTransform {
  /** 角色表前缀标签，如 'replica[2]' / 'replica[1_0]' */
  label: string
  /** 把结果面质心反变换回输入坐标系（T_k 的逆） */
  inverse: (c: Vec3) => Vec3
}

export function buildReplicaRoleTable(
  kernel: BrepEngineApi,
  input: Shape,
  resultSolid: BrepHandle,
  replicas: ReplicaTransform[],
  outStmt: string,
): RoleTable {
  const inputTable = inputRoleTable(input) as RoleTable | undefined
  const inputHashes = getFaceHashes(kernel, brepOf(input) as BrepHandle)
  const inputHashToRole = new Map<number, string>()
  if (inputTable) {
    for (const roles of inputTable.values())
      for (const [role, hashes] of roles) for (const h of hashes) inputHashToRole.set(h, role)
  }
  const inputFaces = kernel.getSubShapes(brepOf(input) as BrepHandle, 'face')
  const inputCentroids = inputFaces.map((f) => kernel.getSurfaceCenterOfMass(f))

  const resultHashes = getFaceHashes(kernel, resultSolid)
  const resultFaces = kernel.getSubShapes(resultSolid, 'face')
  const resultCentroids = resultFaces.map((f) => kernel.getSurfaceCenterOfMass(f))

  const roleTable = new Map<string, Map<string, number[]>>()
  const inner = new Map<string, number[]>()
  for (let i = 0; i < resultHashes.length; i++) {
    const c = resultCentroids[i]!
    // 对每个副本求逆变换后的点，匹配最近输入面，取距离最小者
    let bestLabel = replicas[0]!.label
    let bestRole: string | undefined
    let bestDist = Infinity
    for (const r of replicas) {
      const p = r.inverse(c)
      for (let j = 0; j < inputCentroids.length; j++) {
        const ic = inputCentroids[j]!
        const d = (p.x - ic.x) ** 2 + (p.y - ic.y) ** 2 + (p.z - ic.z) ** 2
        if (d < bestDist) {
          bestDist = d
          bestLabel = r.label
          bestRole = inputHashToRole.get(inputHashes[j]!)
        }
      }
    }
    const role = `${bestLabel}/${bestRole ?? 'face'}`
    if (!inner.has(role)) inner.set(role, [])
    inner.get(role)!.push(resultHashes[i]!)
  }
  roleTable.set(outStmt, inner)
  return roleTable
}
```

各多副本 op 只需提供 `replicas` 列表（逆变换 + 标签）：

- **circularPattern**（count 份，绕 axis 均分 fullAngle，缺省 2π）：`inverse = rotateAroundAxis(c, axis, -k*step)`，`label = replica[${k}]`。
- **gridPattern**（countX×countY，方向 dirX/dirY，间距 sx/sy）：`inverse = translate(c, -(ix*sx*dirX + iy*sy*dirY))`，`label = replica[${ix}_${iy}]`。
- **rectangularPattern**（options 编码方向/间距/份数）：结构与 grid 同（vendored 实现是纯 JS 组合 `translate + fuseAll`，内核不声明 `rectangularPattern` 方法——override 直接用内核 `translate` 逐份复制再 `fuseAll`），先解 options 得 dir/spacing/count 再生成 replicas。
- **mirrorJoin**（k:2，原物 + 镜像）：replicas = `[{label:'replica[0]', inverse: identity}, {label:'replica[1]', inverse: reflectAcrossPlane}]`。

> ⚠️ 内核方法签名（`kernel.circularPattern` / `gridPattern` / `mirrorWithHistory` 的入参、返回形态）以**实施时的当前 `BrepEngineApi` 为准**——faijs 一日一大变，落地前需重读 `brep/engine/primitives.ts` 与 `vendored/brepjs/operations/patternFns.ts` 复核。实施前核实（2026-09-23）：`circularPattern(shape, center, axis, angleStep, count)` 返回 `BrepHandle[]`（待 fuse）；`gridPattern(...)` 返回**compound 单句柄**（无需 fuse）；`rectangularPattern` 内核不声明（vendored 纯 JS 组合）；`mirrorWithHistory(shape, point, normal, ...)` 单份镜像。`linearPattern` 已用 `kernel.linearPattern(inputSolid, {x,y,z}, spacing, count)` 验证该形态可直接复用。

### 3.5 接线（不动生成文件）

`api/api-namespace.ts` 的 `createApiNamespace` 已采用「先 `...scriptFaceOps`（含生成版），再 spread 同名手写版覆盖」模式（现有 `cut`/`split`/`linearPattern`）。把 7 个 override 加进 import，在 `linearPattern` 之后继续 spread：

```ts
import { circularPattern, gridPattern, rectangularPattern, mirrorJoin, mirror, clone, transformCopy } from './replicate'
// ...
return {
  // ... 既有导出 ...
  ...scriptFaceOps,
  cut, split, linearPattern,
  // 覆盖生成版：4 个多副本 pattern 提拔手写+角色表；3 个单副本加 keep
  circularPattern, gridPattern, rectangularPattern, mirrorJoin, mirror, clone, transformCopy,
} as unknown as StdlibNamespace
```

---

## 4. 验证方案

1. **keep 覆盖测试**：扩 `api/consume-input.test.ts`，对 9 个复制 op 各断言执行后 `result.terminals` 含输入变量名（`copy` 作正向对照）。改完实现后应全绿。
2. **角色表测试**：新增断言——对 `circularPattern`/`gridPattern`/`rectangularPattern`/`mirrorJoin`，执行后结果 `Shape` 的 `roleTable` 含 `replica[*]` 前缀条目且数量与副本数一致；并与 `linearPattern` 的 `replica[k]/<inner>` 格式对齐（可作为 parity 断言）。
3. **UI 路径随运行时一并生效**：无需单独测试——§1.1 已证明 `keep(input)` 经执行期 KeepRegistry 同时喂给 UI 终端判定；验证手段即"运行时测试通过 + `runtime.ts:951` 的 `functionBody` 接线未被改动"。
4. **受影响集成测试**：跑 pattern / mirror 相关 e2e fixture，确认副本数、角色表（`replica[k]`/splinter）等几何行为不变；`scripts/ci.ps1` 全绿。

---

## 5. 文件级改动清单

| 文件 | 改动 |
|---|---|
| `packages/core/src/api/internal/replica-role-table.ts` | **新建**：泛化角色表 builder（§3.4） |
| `packages/core/src/api/pattern.ts` | `brep` 加 `keep(input)`；`linearPatternBrep` 改用 helper（§3.2） |
| `packages/core/src/api/replicate.ts` | **新建**：4 个多副本 pattern（手写+角色表+keep）+ 3 个单副本（keep 薄 override） |
| `packages/core/src/api/api-namespace.ts` | import 7 个 override，spread 在 `...scriptFaceOps` 之后覆盖生成版 |
| `packages/core/src/api/mirror.ts` | 已删除（2026-09-23；误建文件，其 mirror 覆盖逻辑并入 `replicate.ts`） |
| `packages/core/src/api/consume-input.test.ts` | 扩覆盖到全部 9 个复制 op + 4 个角色表断言 |

**不动**：`api/generated/*`（禁手改，仍由 namespace override 屏蔽）、`vendored/**`、`cad-runtime` 内部判定（C1 keep 机制复用）、`naming.kind` 语义、`defineOp`/`compatOp` 本体（无需任何新字段）。

---

## 6. 与引擎可切换性重构的衔接

- **正交、无冲突**：重构改的是"引擎切换 + 能力前置判定"（capabilities 管道），**不动 keep/消费模型与角色表模型**。本方案只在 op 体内加 `keep(input)` + 调 helper 建表，与重构完全叠加、互不干扰。
- **兼容重构落地后**：重构让生成 `compatOp` 经 `arg-spec → 生成器 → compatOp` 拿到 `capabilities`。手写 override 把生成 op 的 `capabilities` 原样抄回，能力路由行为与原生成 op 一致；重构后这些 override 仍只需保持 `keep(input)` 委托（单副本）或手写（多副本），无需改动。
- **无需为 keep/角色表扩 `arg-spec` 管道**：因为不引入新位，也不改生成器。

---

## 7. 范围与边界

- **排除 transform 家族**：`rotate` / `translate` / `scale` / `rotate_euler` / `applyMatrix` / `locate` 是"变换/移动原物体"语义、消费源，不在复制类范围。
- **mesh 路径**：多副本 pattern 本就 brep-only（auto 模式 mesh 抛 `E_MESH_UNSUPPORTED`）；override 同样 brep-only，与现状一致。单副本的 `mirror`/`clone`/`transformCopy` 是否需补 mesh 实现属另一项工作。
- **角色表本期做**：4 个多副本 pattern 全部补 `replica[*]` 角色表，与 `linearPattern` 同待遇——直接消除"其他 pattern 凭什么不这么处理"的生成债。单副本 3 个只补 keep（与 `copy` 同级，不建数组表）。
