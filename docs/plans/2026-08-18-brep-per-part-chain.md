# BREP 链架构更新：从「全局单链」改为「逐 Part 跟踪」（Step 1）

- 日期：2026-08-18
- 类型：架构修正（architecture correction）
- 状态：待评审 → 待实现
- **范围（Step 1）**：只做 BREP 逐 part 改造。**装配一律以 3d_editor 现有实现为准**（`cad.assembly` 结构 marker + 独立 `rotate`/`translate` 语句），保证本方案可直接落地。
- **不在本方案范围（Step 2）**：faijs 内部那套尚未执行的链式装配语法（`cad.assemble` + `add_constraint` + `do_assemble`）的定义与实现 → 见 `docs/plans/2026-08-18-assembly-syntax-design.md`。

---

## 0. 用户原始要求（原样保留）
分析两个场景。 
1. 给一个brep模型进行居中分割，然后对其中一个进行滚花。然后对另外一半进行钻孔。验证一个是mesh的，一个是brep的

2. 首先加载一个stl文件（cube-10x5x5.stl），然后创建一个primitive的圆柱体，然后居中钻孔。然后让stl模型正方体顶面与这个圆柱体顶面做面对面重合的装配。验证装配内的两个模型，一个是mesh的，一个是brep的（圆柱体）。

mesh也可以导出step，只不过是三角化的step，不是精确几何。当导出step的时候，按照各零件的类型准确导出，分开处理。


> brep是跟踪模型part的，根本不是什么全局唯一的东西。

> 案例1目前的实现明显错误。split的两个part，一个走mesh，一个走brep。全部走mesh是错误的。

../3d_editor 项目必须同步修复，且应该是本项目提供准确的brep状态，不应该在3d_editor项目里又重复维护一份。

---

## 1. 问题诊断（Root Cause）

### 1.1 当前模型

`replay()` 在 `BrepChainState` 上维护一个**全局布尔** `brepActive`：

- `src/brep/brep-chain.ts:88` — `brepActive: boolean`
- `src/ops/types.ts:54` — `canUseBrep(ctx)` 的闸门是 `ctx.brepChain?.brepActive && ctx.brepChain.kernel`
- `src/cad-runtime/runtime.ts:234` — 循环里遇到 `MESH_ONLY_OPS`（`knurl`/`sdf`）即 `handleBrepBreak()` → `breakBrepChain()` 把**全局** `brepActive = false`
- `src/ops/load.ts:48` — 非 CAD 源（STL/3MF）同样调 `breakBrepChain()` 翻转全局标志

### 1.2 真正的 BREP 状态已经在「逐 part」粒度上存在

`solidCache: Map<stmtId, ShapeHandle>`（`brep-chain.ts:86`）本就是**逐 part** 的 BREP 实体表：

- `primitives` / `split` / `drill` / `boolean` / … 的 BREP 路径执行后，把该 part 的 OCCT 实体句柄写入 `solidCache[stmt.id]`（split 还会写 `solidCache[outputs[0]]`、`solidCache[outputs[1]]`，见 `split.ts:246-250`）。
- mesh-only op（`knurl`/`sdf`）**从不写** `solidCache`。
- 非 CAD 源 `load` 也**从不写** `solidCache`。

也就是说：**一个 part 是否仍是 BREP，完全由 `solidCache` 里是否有它的句柄决定**。全局 `brepActive` 是多余的、且有害的——它把「某一条语句碰到了 mesh-only op」这一个局部事件，错误地放大成对后续所有 part 的全局判决。

### 1.3 Case 1 为何「全部走 mesh」（bug 复现）

```
part0_v0 = cad.cylinder(...)                       // front/back 还没出现
const { part1_v0, part2_v0 } = cad.split(part0_v0) // split BREP：solidCache[part1_v0], [part2_v0] 都写入
part3_v0 = cad.knurl(part1_v0)                     // S_knurl
part4_v0 = cad.drill(part2_v0)                     // S_drill
```

逐句执行：

1. `cylinder` → `solidCache[part0_v0]` 写入，全局 `brepActive = true`。
2. `split` → BREP 路径，`solidCache[part1_v0]`、`solidCache[part2_v0]` 都写入（两个半块各自持有精确实体），全局 `brepActive` 仍为 `true`。
3. `knurl` → 命中 `runtime.ts:234` 的全局判定，`breakBrepChain` 把**全局** `brepActive` 置 `false`。`knurl` 本身走 mesh（正确）。
4. `drill` → `canUseBrep(ctx)` 现在读全局 `brepActive === false` → 返回 `false` → 走 mesh 路径。

**结果**：`part2_v0` 那个明明在 `solidCache` 里还存着精确实体的半块，被 `knurl` 这一个**同级兄弟**操作「连坐」降级成 mesh。这与用户要求相悖——用户要求 `part1_v0`(front) 走 mesh（knurl）、`part2_v0`(back) 走 brep（drill），二者互不影响。

### 1.4 Case 2 为何「没问题」（确认不改动）

```
part0_v0 = cad.load({ key: 'a.step' })   // CAD 源 → solidCache[part0_v0] 写入
part1_v0 = cad.load({ key: 'b.stl' })    // 非 CAD 源 → 不写 solidCache
part2_v0 = cad.intersect(part0_v0, part1_v0)
```

`boolean` 已有「逐输入」静态判定（`boolean.ts:38-44`：`stmt.inputs.every(id => solidCache.has(id))`）。`part1_v0` 无 solid → 整体走 mesh CSG，产出**单一 mesh 零件（无 solid）**。其路由逻辑（精确 BREP 布尔要求两侧都是实体，拿网格和实体做精确交无意义）**正确，本次不改动**；导出时该 mesh 结果走三角化 STEP（见 §4），并非「无法导出 STEP」。本次只修正「全局 `brepActive` 导致的连坐」。

---

## 2. 目标架构（Target Architecture）

**BREP 状态跟随每个 part，由 `solidCache` 的存在性唯一决定；删除全局 `brepActive` 作为分派闸门。**

- 「链」概念从「全局唯一单链」改为「每个 part 的 BREP 血缘（lineage）」。
- 一个 part 失去 BREP 状态，**当且仅当**：
  - 它被 `knurl`/`sdf`（mesh-only op）产生，或
  - 它的上游输入中**至少有一个**没有 BREP 实体（即该 part 的血缘里混入了 mesh）。
- 兄弟 part 之间**互不污染**：split 产出的两个半块各自独立继承上游的 BREP 状态；对其中一个做 knurl，**只**让那个半块失去 BREP，另一个半块仍可继续走 BREP 精确操作。

### 2.1 新数据模型

```ts
// src/brep/brep-chain.ts
export interface BrepChainState {
  /** 逐 part 的 BREP 实体句柄表。存在即该 part 仍为 BREP；缺失即该 part 已降级为 mesh。 */
  solidCache: Map<string, ShapeHandle>
  /** OCCT 内核实例（mesh 模式为 null —— 等价于「无 BREP 能力」）。 */
  kernel: OcctKernel | null
  partTransform?: { position: [number, number, number]; scale?: [number, number, number] }
  faceEvolutionCache?: Map<string, Map<number, number[]>>
  // 注：移除 brepActive / breakReason（全局单链概念已废弃）
}
```

### 2.2 新的分派闸门（核心改动）

```ts
// src/ops/types.ts
export function canUseBrep(ctx: OpContext): boolean {
  if (ctx.mode === 'mesh') return false
  const bc = ctx.brepChain
  if (!bc?.kernel) return false
  // 每个输入 part 都必须持有存活的 BREP 实体，才走 BREP 路径（逐 part 判定）
  return ctx.stmt.inputs.every((id) => bc.solidCache.has(id))
}
```

> 设计要点：
> - 空 `inputs`（如 `box`/`cylinder`）→ `.every` 返回 `true` → 默认走 BREP（与现状一致）。
> - `mode === 'mesh'` 或 `kernel === null`（mesh 模式） → 一律 false。
> - 不再有「全局开了又关」的标志；OP 是否 BREP 只取决于**它自己的输入**是否有实体。

### 2.3 断链语义变更

| 旧语义（全局） | 新语义（逐 part） |
|---|---|
| 任一语句命中 `MESH_ONLY_OPS` → 全局 `brepActive=false` | `knurl`/`sdf` **永远走 mesh**，且**不翻转任何全局状态**；其输出 part 不写 `solidCache` → 自动失去 BREP |
| 非 CAD 源 `load` → 全局 `breakBrepChain` | 非 CAD 源 `load` 只**不写** `solidCache`（该 part 本身就是 mesh）；不触碰其他 part |
| `brep` 模式：全局断链即报错 | `brep` 模式：任一句 `!canUseBrep(ctx)`（含 mesh-only op 或引用了无 solid 的 part）→ `E_BREP_UNSUPPORTED` 报错 |

`runtime.ts:234` 的全局 pre-check 改为：仅当 `mode === 'brep'` 且命中 `MESH_ONLY_OPS`（或直接 `!canUseBrep`）时，提前返回 `failedAt`；`auto`/`mesh` 模式下 mesh-only op 直接交给 `dispatchStatement` 走 mesh 分支，**不再调用 `breakBrepChain`**。

`brep-chain.ts` 中的 `breakBrepChain`、`lastSolidOfChain` 删除（见 §6 清理清单）。

---

## 3. 分派逻辑改动（逐文件契约）

所有 BREP-native op 已统一用 `canUseBrep(ctx)` 做二选一，**改用新 `canUseBrep` 后自动获得逐 part 正确性**，无需改各 op 内部 BREP 路径。仅以下文件需主动改动：

### 3.1 `src/ops/types.ts`
- 重写 `canUseBrep`（见 §2.2）。
- 更新 `OpContext.brepChain` 注释：`brepChain` 始终传入；BREP 是否可用由「输入是否各有 solid」决定，不再有 `brepActive`。

### 3.2 `src/cad-runtime/runtime.ts`
- 删除 `runtime.ts:234-246` 的全局 mesh-only pre-break 逻辑。改为：
  ```ts
  // mesh-only op：永远走 mesh；auto/mesh 不报错，brep 模式报 E_BREP_UNSUPPORTED
  if (MESH_ONLY_OPS.has(stmt.op)) {
    if (this.mode === 'brep') {
      return { outputs: outputCache, brepChain, terminals: [], infos,
        failedAt: { index: i, op: stmt.op, message: `E_BREP_UNSUPPORTED: op "${stmt.op}" has no BREP implementation` } }
    }
    // auto/mesh：继续 dispatch，op 内部路由到 mesh（不再 break 全局链）
  } else if (this.mode === 'brep' && !canUseBrep({ stmt, brepChain, mode: this.mode })) {
    // brep 模式：任一引用了无 solid 输入的 BREP op 也必须报错（逐 part 强制）
    return { outputs: outputCache, brepChain, terminals: [], infos,
      failedAt: { index: i, op: stmt.op, message: `E_BREP_UNSUPPORTED: input of "${stmt.op}" is not BREP` } }
  }
  ```
- 删除 `handleBrepBreak()` 方法（或保留骨架、改为按 part 发 `part-brep-lost` 事件，见 §5）。
- 终端 BREP solid 提取（原 `runtime.ts:269-276`）改为**逐终端**：
  ```ts
  const brepSolids = new Map<string, { solid: ShapeHandle; kernel: OcctKernel }>()
  for (const t of (script.terminalShapes ?? [])) {
    const s = brepChain.solidCache.get(t.id)
    if (s && brepChain.kernel) brepSolids.set(t.id, { solid: s, kernel: brepChain.kernel })
  }
  ```
- `createEmptyBrepChain()`（`runtime.ts:685`）移除 `brepActive: false`（字段已删）。

### 3.3 `src/brep/brep-chain.ts`
- `BrepChainState` 删除 `brepActive`、`breakReason`。
- 删除 `breakBrepChain`、`lastSolidOfChain`。
- `createBrepChainState` / `initBrepChainState` 移除 `brepActive: true`。
- `releaseBrepChainState`、`isCadFormat`、`BREP_NATIVE_OPS`、`MESH_ONLY_OPS` 保持不变。

### 3.4 `src/ops/load.ts`
- 删除 `load.ts:48` 的 `breakBrepChain(brepChain, stmt.id, stmt.op)` 调用。非 CAD 源只走 `cad.load(buffer, format)` 且不写 `solidCache`（本就如此），**不触碰全局状态**。
- 保留 `if (!canUseBrep(ctx) || !brepChain?.kernel)` 的 mesh 分支入口（新 `canUseBrep` 对非 CAD/CAD 的路由依然正确）。

### 3.5 `src/ops/dispatcher.ts`
- `resolveArg`（`dispatcher.ts:49`）的 GeomRef 解析：把 `brepChain?.brepActive ? (id) => brepChain.solidCache.get(id) : undefined` 改为只要 `brepChain?.kernel` 存在就传入 `(id) => brepChain.solidCache.get(id)`（按具体 part id 查各自的实体，不再受全局标志限制）。

### 3.6 mesh-only op（防御性，可选但推荐）
- `src/ops/knurl.ts`、`src/ops/sdf.ts`：在 mesh 分支开头显式 `brepChain?.solidCache.delete(stmt.id)`，明确「本 part 失去 BREP」（输出是新 id，正常情况下不会残留，但显性删除更稳健、语义更清楚）。

### 3.7 `src/ops/transform.ts` —— **本次修复必须同时改，否则 3d_editor 装配会出错（P0）**

**问题（已核实代码）**：BREP 路径**丢掉了 `pivot`**，与 mesh 路径行为不一致。

```ts
// src/ops/transform.ts:54（BREP 路径）—— 缺 pivot
resultSolid = rotateBrep(brepChain.kernel, upstreamSolid, args.anglesDeg as Vec3)

// src/ops/transform.ts:79（mesh 路径）—— 有 pivot
return cad.rotate(shape, args.anglesDeg as Vec3, args.pivot as Vec3 | undefined)
```

而 `rotateBrep` **本身早已支持 `pivot`**（`src/brep/brep-ops.ts:81-98`，第 85 行签名 `pivot?: Vec3`，93-96 行做 `T(p)·R·T(-p)`）——只是调用方没传。

**为什么它是 Step 1 的阻塞项**：3d_editor 的装配把变换烘焙成 `cad.rotate(moving, { anglesDeg, pivot })`（`assemble-store.ts` 的 `confirmAssemble` 用**活动面中心**作 pivot，见 §7.6.0）。

- 修复前（旧全局链）：STL 一加载就全局断链 → 该 `rotate` 走 mesh 路径 → **pivot 生效**，装配位置正确。
- 修复后（逐 part）：`drilled_v0` 持有 solid → 同一条 `rotate` 改走 BREP 路径 → **pivot 被静默丢弃** → 绕原点旋转，**活动件飞到错误位置**。

即：本次 BREP 逐 part 修复会把这个潜伏 bug 从「不可达」变成「必然触发」，属于**由本次改动引入的回归**，必须一并修掉。

**改法（一行）**：

```ts
resultSolid = rotateBrep(brepChain.kernel, upstreamSolid, args.anglesDeg as Vec3, args.pivot as Vec3 | undefined)
```

**回归测点**：同一 `rotate(anglesDeg, pivot)` 分别在 BREP 与 mesh 路径执行，包围盒/顶点应一致（parity 测试，见 §7.6.6）。

---

## 4. 终端 BREP 实体 / 导出层变更

`ExecutionResult.brepSolid?: { solid, kernel }`（单值）改为逐终端：

```ts
// src/cad-runtime/runtime.ts
export interface ExecutionResult {
  // ...
  /** 逐终端的 BREP 实体（仅持有 solid 的终端出现在此表）。 */
  brepSolids?: Map<string, { solid: ShapeHandle; kernel: OcctKernel }>
}
```

**重要纠正：mesh 也可以导出 STEP——只是「三角化（faceted）STEP」，不是精确 BREP 实体。**

- 仓库已有现成能力：
  - 三角化 STEP：`occtKernel.ts:420 meshesToStep(positions, indices, tolerance)`（每个三角面 `buildTriFace` → `sewAndSolidify` → `exportStep`）及其高层封装 `highLevelApi.ts:111 exportStep(shape, options)`（吃 `{ positions, indices }`）。
  - 精确 STEP：`brep/export/step.ts:19 exportStepFromSolid(solid, kernel)`（底层 `kernel.exportStep(solid)`，输出 `ADVANCED_FACE`）。
- **当前 CLI 的 `writeOutput`（`cli.ts:178-190`）写死了「没有 `brepSolid` 就报错」**（`'No BREP solid available (chain was broken)...'`），把 mesh 的三角化 STEP 能力白白丢掉——这是导出层 bug，必须修正。

**导出层（`src/node-host/cli.ts` 的 `writeOutput`）改为「按零件类型分别处理」**：

- 遍历每个终端 part：
  - 若 `brepSolids` 含该 part（即 `solidCache.has(id)`）→ **精确 STEP**：`exportStepFromSolid(solid, kernel)`。
  - 否则（纯 mesh part）→ **三角化 STEP**：`exportStep({ positions, indices })`（底层 `meshesToStep`）。
- `.stl`：每个终端取其 mesh `Shape`（无论是否 BREP），正常导出。
- 多终端：
  - 单输出路径（如 `out.step`）→ 把各终端按各自类型导出的 STEP 内容合并写入同一文件（每个零件以独立 solid 实体出现，类型不同但都是合法 STEP）。
  - 输出路径是目录 / 显式多文件 → 每个终端单独一个 `.step`（文件名带 part 名），类型各自精确或三角化。
- **不再有无意义的「No BREP solid available」整段失败**：任何 part 都能导出 STEP，区别只在「精确 vs 三角化」。

> `runtime.ts:522` 的 `getTerminalGeometry` 当前读 `this.brepSolidCache`（实例级缓存，replay 期间并未被 ops 写入）。迁移时将其改指向 `ExecutionResult.brepSolids`。**`brepSolidCache` / `setBrepSolid` / `getBrepSolid` / `deleteBrepSolid` 这些实例 API 必须保留（不要废弃）**——它们按 scopedId 逐 part 存储，3d_editor 的 `ScriptEngine._brepSolidCache` 直接依赖（见 §11）；逐 part 设计天然契合，正好复用，无需新增类型。

---

## 5. 事件（EventSink）语义变更

旧：`'brep-chain-broken'`（全局，partName 为空）。

新：建议改为**逐 part**事件，由实际执行的 mesh-only op 触发，携带具体 part id：

```ts
this.ports.events.emit('part-brep-lost', {
  partId: stmt.id,
  op,                 // 'knurl' | 'sdf'
  reason: 'mesh-only op output',
})
```

下游（UI toast / 拓扑标记）据此局部更新该 part 的 BREP 徽标，而非全局置灰。

---

## 6. 清理清单（Breaking Changes）

需要同步修改的引用点（来自全仓 grep）：

| 位置 | 改动 |
|---|---|
| `src/ops/types.ts:54-56` | 重写 `canUseBrep` |
| `src/cad-runtime/runtime.ts:234-305, 269-276, 685-692` | 删除全局 pre-break；改逐终端 solid；`createEmptyBrepChain` 去字段 |
| `src/brep/brep-chain.ts:84-112, 167-184` | 删 `brepActive`/`breakReason`/`breakBrepChain`/`lastSolidOfChain` |
| `src/ops/load.ts:17,48` | 去 `breakBrepChain` 导入与调用 |
| `src/ops/dispatcher.ts:49` | GeomRef 解析按 kernel 存在即可 |
| `src/ops/knurl.ts` / `src/ops/sdf.ts` | 防御性 `solidCache.delete(stmt.id)` |
| `src/index.ts:48-49`、`src/browser.ts:231-232`、`src/brep/index.ts:27-29`、`src/mesh/index.ts:117-118` | 导出列表移除 `breakBrepChain` / `lastSolidOfChain` |
| `src/cad-runtime/runtime.ts` `getTerminalGeometry` / `brepSolidCache` | 改指向 `brepSolids`，评估废弃实例级缓存 |

**测试迁移**（约 8 个文件断言 `brepActive` / `breakBrepChain` / `lastSolidOfChain`，需改写）：
- `src/brep/brep-ops-features.test.ts`（brepActive / breakBrepChain 断言多处）
- `src/brep/brep-chain.test.ts`（`breakBrepChain` / `lastSolidOfChain` 整段 describe）
- `src/cad-runtime/runtime.test.ts`（brepActive 断言、`no mesh retry` 描述）
- `src/ops/ops.test.ts`（brepActive / `lastSolidOfChain` 整段）
- `src/ops/split.test.ts`、`src/ops/load.test.ts`、`src/ops/drill.test.ts`、`src/ops/extrude.test.ts`、`src/ops/svgExtrude.test.ts`（brepActive 断言）
- `src/test-helpers.ts:19,62`（构造/读取 `brepActive` → 改为读取 `solidCache` 存在性）
- `src/ops/knurl.test.ts` / `src/ops/sdf.test.ts`（保留 `MESH_ONLY_OPS` 断言，去掉断链语义描述）

> 迁移原则：**`result.brepChain.brepActive === true` 这类断言，改为「相关 part 的 `solidCache.has(id) === true」**；`brepActive === false` 改为「该 part 的 `solidCache.has(id) === false`」。语义从「全局链状态」转为「逐 part 状态」。

---

## 7. 测试用例：Case 1（split → knurl one half → drill other half）+ Case 2（load STL + cylinder + drill + 装配）

### 7.1 Fixture（`.faijs`）

```js
const part0_v0 = cad.cylinder({ radius: 10, height: 40 })
const { part1_v0, part2_v0 } = await cad.split(part0_v0, {
  cutMode: 'plane', normal: [0, 0, 1], offset: 0,
})
const part3_v0 = await cad.knurl(part1_v0, { faceNormal: [0, 0, 1] })   // front 半块 → mesh only
const part4_v0 = await cad.drill(part2_v0, {                            // back 半块 → 仍应走 BREP
  diameter: 4, depth: 20, position: [0, 0, 10], faceNormal: [0, 0, 1],
})
return [part3_v0, part4_v0]
```

> 解析约定（`src/lang/parser.ts:419-422`）：split 的 `stmt.id` = 第一个输出变量名（`part1_v0`），`stmt.outputs = ['part1_v0', 'part2_v0']`。故 `split` BREP 路径会把 `solidCache['part1_v0']`（front）与 `solidCache['part2_v0']`（back）都写入。

### 7.2 断言（auto 模式，OCCT 已 init）

```ts
// 修复前的错误行为（必须不再出现）：
//   solidCache.has('part4_v0') === false   ← 被 knurl 连坐降级，drill 走了 mesh
// 修复后的正确行为：
expect(solidCache.has('part0_v0')).toBe(true)   // cylinder BREP
expect(solidCache.has('part1_v0')).toBe(true)   // split front 精确实体（pre-knurl，仍 BREP 可表示）
expect(solidCache.has('part2_v0')).toBe(true)   // split back 精确实体
expect(solidCache.has('part3_v0')).toBe(false)  // knurl 结果 → mesh only ✅
expect(solidCache.has('part4_v0')).toBe(true)   // drill 结果 → 仍为 BREP ✅（核心修复点）
// part4_v0 的 solid 是 OCCT 句柄（drill BREP 执行，而非 mesh CSG）
expect(typeof solidCache.get('part4_v0')).toBe('object')  // ShapeHandle
```

### 7.3 导出断言

- `brepSolids` 应包含 `part4_v0`（精确 BREP），**不应**包含 `part3_v0`（knurl 结果为 mesh，无 solid）。
- STEP 导出（按零件类型分别处理）：
  - `part4_v0` → `exportStepFromSolid`（精确 `ADVANCED_FACE`）；
  - `part3_v0` 是 mesh → `exportStep`/`meshesToStep`（**三角化 STEP**，不是失败）。
  - 两块均可导出 STEP，区别在精确 vs 三角化。
- STL 导出：`part3_v0`、`part4_v0` 均成功（取各自 mesh `Shape`）。

### 7.4 反向顺序对照（证明「顺序无关」，逐 part 独立）

交换 knurl / drill 顺序（先 drill 后 knurl）：断言结果**完全相同**（drill 的 `part4_v0` 始终 BREP，因为 `part2_v0` 的 solid 从不被 `knurl` 触碰）。这证明修复后 BREP 精确操作不再被同级 mesh-only 操作「连坐」。

### 7.5 测试落地形式

- 在 `test/faijs/` 新增 fixture `split-knurl-drill.faijs`（§7.1 内容）。
- 在 `src/ops/`（或 `test/faijs/` 对应 `.test.ts`）新增 `it('Case1: split → knurl(front) → drill(back): front mesh, back retains BREP')`，`beforeAll(() => initOcctWasm())` 初始化内核，`replay` 后断言 §7.2。
- 该用例**同时充当本次架构更新的回归测试**：任何把全局 `brepActive` 误带回来的改法都会导致 `solidCache.has('part4_v0') === false`，被该用例拦下。

### 7.6 测试用例：Case 2（load STL + cylinder + drill + 装配，验证混合 BREP/mesh 共存）

> **本节的装配写法一律以 3d_editor 的真实产出为准（代码级核对，2026-08-18）。** 本计划（Step 1）只改 BREP 逐 part，**不动装配的设计与实现**；faijs 内部另有一套尚未执行的链式装配语法（`cad.assemble` + `add_constraint` + `do_assemble`），属 **Step 2**，见 `docs/plans/2026-08-18-assembly-syntax-design.md`。

#### 7.6.0 装配在 3d_editor 里实际生成什么语句（落地依据）

3d_editor 的装配**不产生** `do_assemble()` 这类求解语句，而是产出**两类语句**：

**① 一条 `cad.assembly(...)` 结构 marker（仅元数据，零几何影响）**

```js
cad.assembly({
  name: '装配1',
  members: ['cube_v0', 'drilled_v0'],
  constraints: [{
    fixedScopedId: 'cube_v0', movingScopedId: 'drilled_v0',
    fixedFace:  { faceId: <cube 顶面 id>, surfaceType: 'plane' },
    movingFace: { faceId: <cyl 顶面 id>,  surfaceType: 'plane' },
  }],
})
```

代码依据：`3d_editor/src/renderer/stores/model-store.ts:1574-1590` 构造 `assemblyMarkerStmt`——`id: 'grp_<scopedId>'`、`op:'assembly'`、`args:{name, members, constraints}`、`isMarker:true`、`feature:{kind:'assembly'}`、`groupScopedId`；约束里的 scopedId 已映射为脚本变量名。codegen 输出形态由 `group-assembly-codegen.test.ts:74-97` 锁定。

**② 真实变换 = 独立的 `rotate` / `translate` 几何语句（faijs 真正执行的部分）**

```js
cad.rotate(drilled_v0,    { anglesDeg: [...], pivot: [...] })   // 绕「活动面中心」旋转，使法线反向对齐
cad.translate(drilled_v0, { offset: [...] })                    // 平移使两面中心重合
```

代码依据：`3d_editor/src/renderer/stores/assemble-store.ts:276-286`（`confirmAssemble`）在宿主侧求解出 `anglesDeg` / `pivotArr` / `offset` 后，调 `ScriptEngine.recordTransform(movingScopedId, 'rotate'|'translate', args)` 把变换写入脚本 DAG。这是 3d_editor 架构注释里的**「红线 5：所有几何变更走脚本语句」**——装配变换不在 marker 里，而在 `rotate`/`translate` 里。

**这意味着（Step 1 的关键落点）**：

- 装配的 `constraints` 只是**记录意图的元数据**；几何位置由 `rotate`/`translate` 两条 **BREP-native** 语句决定。
- 所以装配后活动件走 BREP 还是 mesh，**完全由本次 `canUseBrep` 逐 part 改造决定**——这正是本用例要验证的，也让 Case 2 可以真正落地（无需依赖任何未实现的装配求解）。
- **并因此暴露 §3.7 的 `pivot` bug**：`rotate` 带 `pivot`，而 `transform.ts:54` 的 BREP 路径丢掉了它 → 修复 BREP 逐 part 后该语句改走 BREP，会绕原点转。**§3.7 必须与本次改动同批修复**。

> 求解发生在**宿主侧**（`assemble-store.ts`），结果被烘焙成脚本语句；faijs 只负责重放这两条变换。faijs 内部那套 `cad.assemble`+`add_constraint`+`do_assemble` 链虽被 parser 识别（`parser.ts:84-85` 同时认 `'assembly'` 裸调用与该链），但 replay 对所有 `isMarker` 语句 `continue` 跳过（`runtime.ts:216/371/437/580/618`），且 `executeDoAssemble` 全 `src` 无调用方 → **该链目前是 no-op，属 Step 2 范围，本计划不涉及**。

#### 7.6.1 设计意图（与 Case 1 互补）

Case 1 验证的是「`MESH_ONLY_OPS`（`knurl`/`sdf`）触发的全局断链」被修复；本 Case 2 验证**另一处全局断链触发点**——`load.ts:48` 在加载非 CAD 源（STL）时调用 `breakBrepChain` 翻转全局 `brepActive`。

按用户描述的语句顺序：

1. `cad.load('cube-10x5x5.stl')` —— 非 CAD 源，旧设计在 `load.ts:48` 直接 `breakBrepChain` **全局**断链。
2. `cad.cylinder(...)` —— BREP-native，但**旧设计里因第 1 步已断链，`canUseBrep` 读全局 `brepActive === false` → 被迫走 mesh**。
3. `cad.drill(cyl_v0, ...)` —— 上游 `cyl_v0` 在旧设计里已是 mesh → 也走 mesh。
4. `cad.assembly({...})` —— **结构 marker**，replay `continue` 跳过，对几何与 BREP 状态均无影响。
5. `cad.rotate(drilled_v0, {anglesDeg, pivot})` + `cad.translate(drilled_v0, {offset})` —— **BREP-native 变换**：旧设计里因全局断链走 mesh；新设计下 `drilled_v0` 持有 solid → **走 BREP 精确变换**（并需 §3.7 的 pivot 修复才正确）。

→ **旧设计 bug**：本应「立方体是 mesh、圆柱体（含钻孔+装配变换）是 BREP」的装配，在旧全局链下**整段被 STL 加载连坐成 mesh**。新设计下，STL 加载只让 `cube_v0` 自身无 solid，不影响 `cyl_v0`/`drilled_v0`/装配变换结果的 BREP 血缘。

#### 7.6.2 Fixture（`.faijs`，按 3d_editor 真实产出书写）

```js
const cube_v0    = cad.load({ key: 'cube-10x5x5.stl' })         // S0：非 CAD 源 → 仅 mesh，solidCache 无 cube_v0
const cyl_v0     = cad.cylinder({ radius: 5, height: 20 })       // S1：BREP-native → 应走 BREP
const drilled_v0 = await cad.drill(cyl_v0, {                     // S2：上游 cyl_v0 持有 solid → 应走 BREP 精确孔
  diameter: 6, depth: 20, holeType: 'simple',
  position: [0, 0, 10], faceNormal: [0, 0, 1],
})

// S3：装配结构 marker（isMarker，replay 跳过；仅记录成员与面约束意图）
cad.assembly({
  name: 'CubeOnCylinder',
  members: ['cube_v0', 'drilled_v0'],
  constraints: [{
    fixedScopedId: 'cube_v0', movingScopedId: 'drilled_v0',
    fixedFace:  { faceId: 'cube_top',  surfaceType: 'plane' },
    movingFace: { faceId: 'cyl_top',   surfaceType: 'plane' },
  }],
})

// S4/S5：装配的真实变换 —— 宿主求解后烘焙成的 BREP-native 语句
const rot_v0   = cad.rotate(drilled_v0, { anglesDeg: [180, 0, 0], pivot: [0, 0, 20] })  // 顶面法线反向
const mated_v0 = cad.translate(rot_v0, { offset: [0, 0, 5] })                            // 两面中心重合
return [cube_v0, mated_v0]
```

> 资产：`test/fixtures/cube-10x5x5.stl`（仓库已存在）。`drill` 参数键以 `docs/api-contract.md` / `src/mesh/api.d.ts` 的真实契约为准。
> `anglesDeg`/`pivot`/`offset` 的具体数值在测试里可用固定值（本用例验证的是**路径与 BREP 状态**，不是求解精度）；`faceId` 只作为 marker 元数据，本用例不解析它（解析属 Step 2）。

#### 7.6.3 断言（auto 模式，OCCT 已 init）

> BREP 状态由各 part 自己的语句决定；`cad.assembly` marker 被跳过，不参与判定。

```ts
// 修复前的错误行为（必须不再出现）：
//   solidCache.has('cyl_v0') === false      ← 被 STL 加载的全局断链连坐，cylinder 走了 mesh
//   solidCache.has('drilled_v0') === false  ← drill 因上游无 solid 也走 mesh
//   solidCache.has('mated_v0') === false    ← 装配变换也被连坐成 mesh
// 修复后的正确行为：
expect(solidCache.has('cube_v0')).toBe(false)    // STL 加载 → 仍是 mesh（无 solid）✅
expect(solidCache.has('cyl_v0')).toBe(true)      // cylinder → 仍为 BREP ✅（核心修复点：STL 不再连坐）
expect(solidCache.has('drilled_v0')).toBe(true)  // drill 结果 → 仍为 BREP ✅（上游 cyl 自带 solid）
expect(solidCache.has('rot_v0')).toBe(true)      // 装配 rotate → BREP 精确变换 ✅
expect(solidCache.has('mated_v0')).toBe(true)    // 装配 translate → BREP 精确变换 ✅

// 装配结构信息（从 script.statements 取；注意是 op==='assembly' 裸调用，且无 script.features 字段）
const asmStmt = script.statements.find((s) => s.op === 'assembly')
expect(asmStmt?.isMarker).toBe(true)
expect(asmStmt?.args.members).toEqual(['cube_v0', 'drilled_v0'])

// 装配内：一个 mesh、一个 BREP —— 用「成员当前终端 id」判定
const memberTerminals = { cube_v0: 'cube_v0', drilled_v0: 'mated_v0' }   // 装配变换后活动件的终端 id
expect(solidCache.has(memberTerminals.cube_v0)).toBe(false)   // mesh 成员 ✅
expect(solidCache.has(memberTerminals.drilled_v0)).toBe(true) // BREP 成员 ✅

// §3.7 pivot 回归：BREP 路径必须与 mesh 路径一致（不得绕原点旋转）
// 同一 rotate(anglesDeg, pivot) 在 brep / mesh 两模式下包围盒应一致（容差内）
```

#### 7.6.4 导出断言

- `brepSolids` 应包含 `mated_v0`（装配后活动件终端，精确 BREP），**不应**包含 `cube_v0`（STL 加载，无 solid）。
- STEP 导出（按零件类型分别处理）：
  - `cube_v0` 是 mesh → 走 `exportStep`/`meshesToStep` 导出**三角化 STEP**；
  - `mated_v0`（及中间的 `cyl_v0`/`drilled_v0`/`rot_v0`）是 BREP → 走 `exportStepFromSolid` 导出**精确 STEP**。
  - 两个终端均可导出 STEP，类型各自精确/三角化（合并进同一 `.step` 或按 part 名分别导出，见 §4）。
- STL 导出：`cube_v0`、`mated_v0` 均成功（取各自 mesh `Shape`）。

#### 7.6.5 与 Case 1 的对照（覆盖两个不同断链触发点）

| 类别 | Case 1 | Case 2（本用例） |
|---|---|---|
| 断链触发点 | `MESH_ONLY_OPS`（`knurl`/`sdf`）全局断链 | `load` 非 CAD 源全局断链（`load.ts:48`） |
| 兄弟 part 互不污染 | ✅（split 两半：knurl 一半、drill 另一半） | ✅（mesh cube 与 brep cylinder 共存于同一脚本） |
| 装配语句参与形态 | — | `cad.assembly` marker 被跳过（零影响）+ `rotate`/`translate` 为真实 BREP-native 语句，**受本次逐 part 修复直接影响** |
| 额外暴露的 bug | — | §3.7 `transform.ts:54` BREP 路径丢 `pivot`（3d_editor 装配 `rotate` 必带 pivot） |

两者共同作为本次架构更新的回归锚点：**任何把全局 `brepActive` 误带回来的改法，都会导致 `solidCache.has('part4_v0') === false`（Case 1）或 `solidCache.has('cyl_v0')/has('mated_v0') === false`（Case 2），被用例拦下。**

#### 7.6.6 测试落地形式

- 复用资产 `test/fixtures/cube-10x5x5.stl`（已存在）。
- 在 `test/faijs/` 新增 fixture `load-stl-cylinder-drill-assembly.faijs`（§7.6.2 内容，**按 3d_editor 真实产出书写**）。
- 新增 `it('Case2: load STL + cylinder + drill + assembly transforms — cube stays mesh, cylinder chain stays BREP')`，`beforeAll(() => initOcctWasm())`，`replay` 后断言 §7.6.3。
- **新增 pivot parity 测试**（对应 §3.7）：`rotate(shape, {anglesDeg, pivot})` 在 BREP 路径与 mesh 路径的结果包围盒一致（容差内）。该测试**在修复前必须失败**，用于证明 §3.7 确实修掉了。
- 本用例的回归价值：① STL 加载不再连坐后续 BREP 零件；② 装配变换（`rotate`/`translate`）在活动件仍是 BREP 时走精确路径且 `pivot` 正确。**装配的面约束求解不在本用例范围**（属 Step 2）。

---

## 8. 风险与回滚

- **风险**：全仓约 8 个测试文件大量断言 `brepActive`，迁移需逐条改写；漏改会导致 CI 红。
  - 缓解：按 §6 清单机械替换，并以 Case1 用例为回归锚点。
- **风险**：`brep` 模式语义变严格（任一无法 BREP 的 op 即报错，旧版只在第一个 mesh-only op 处报错）。
  - 缓解：这是更正确的强制，且 `brep` 模式本就要求全程精确；在文档/CLI 错误信息里说明。
- **风险**：`getTerminalGeometry` / `brepSolidCache` 实例级缓存可能与新 `brepSolids` 不一致。
  - 缓解：导出层统一改读 `ExecutionResult.brepSolids`；废弃 `brepSolidCache` 相关 API（需评估宿主是否另有调用）。
- **回滚**：本次为纯增量重构，无数据格式变更；若出问题，git 回退 `BrepChainState` 字段与相关调用即可（不触及 `solidCache` 写入语义）。

---

## 9. 实施步骤（建议顺序）

1. `src/brep/brep-chain.ts`：删 `brepActive`/`breakReason`/`breakBrepChain`/`lastSolidOfChain`，更新接口与 `createBrepChainState`/`initBrepChainState`。
2. `src/ops/types.ts`：重写 `canUseBrep`（逐输入判定）。
3. `src/ops/dispatcher.ts`：GeomRef 解析去掉全局 `brepActive` 门控。
4. `src/ops/load.ts`：去 `breakBrepChain` 调用（此步直接决定 Case 2（§7.6）是否成立：STL 加载不再连坐后续 BREP 零件）。
5. `src/ops/knurl.ts` / `src/ops/sdf.ts`：防御性 `solidCache.delete`。
5b. **`src/ops/transform.ts:54`：BREP 路径补传 `pivot`（§3.7，P0）**——本次改动会让 3d_editor 装配产出的 `rotate(anglesDeg, pivot)` 从 mesh 路径切到 BREP 路径，不修则活动件绕原点旋转。先写 parity 测试（应失败）再修。
6. `src/cad-runtime/runtime.ts`：删全局 pre-break；改逐终端 `brepSolids`；`createEmptyBrepChain` 去字段；`getTerminalGeometry` 改读 `brepSolids`。
7. `src/index.ts` / `src/browser.ts` / `src/brep/index.ts` / `src/mesh/index.ts`：清理导出。
8. 导出层 `src/node-host/cli.ts`：重写为「按零件类型分别处理」——有 solid 的终端走 `exportStepFromSolid`（精确 STEP），无 solid 的终端走 `exportStep`/`meshesToStep`（三角化 STEP）；取消「无 `brepSolid` 即报错」的死路。
9. 事件：新增 `part-brep-lost`，移除 `brep-chain-broken` 全局语义。
10. 测试：按 §6 迁移既有断言；新增 §7 Case1 fixture + 用例、§7.6 Case2 fixture + 用例、§7.6.6 pivot parity 用例。
11. `npm run typecheck` + `npm test`（重点跑 Case1 / Case2 与新 parity 用例）。
12. `npm run pack` → 3d_editor `npm install` → 按 §11 迁移宿主侧消费点。

> **Step 2（装配语法）不在本方案内**：待本方案落地并回归通过后，再按 `docs/plans/2026-08-18-assembly-syntax-design.md` 实现 `cad.assemble`/`add_constraint`/`do_assemble` 的执行，并让 3d_editor 从「宿主求解 + 烘焙 rotate/translate」退化为「写约束、读结果」。

---

## 10. 一句话总结

**BREP 状态本就藏在 `solidCache`（逐 part 实体表）里；本次（Step 1）只删掉那个把局部 mesh-only / 非 CAD 源事件放大成全局判决的 `brepActive` 标志**，并以 Case1（§7）与 Case2（§7.6）为双回归锚点——`split` 的两个半块各自独立决定走 BREP 还是 mesh，且 `load` 一个 STL 不再连坐后续 BREP 零件（如圆柱体+钻孔+装配变换），装配后两个模型仍可一个是 mesh、一个是 BREP。

**装配一律按 3d_editor 现有实现落地**：`cad.assembly({name, members, constraints})` 是被 replay 跳过的结构 marker，真实位置由独立的 `rotate`/`translate` BREP-native 语句决定——因此本次改造会让这两条语句改走 BREP 精确路径，**必须同批修掉 §3.7 的 `transform.ts:54` 丢 `pivot`** bug（`rotateBrep` 本就支持 pivot，只是没传）。

**导出层同步修正**：mesh 零件同样可导出 STEP（三角化），按零件类型分别走 `exportStepFromSolid`（精确）或 `exportStep`/`meshesToStep`（三角化），不再「无 brepSolid 即报错」。Case（BREP+mesh 求交）的「逐输入」路由逻辑保持不变、本次不改动。

---

## 11. 跨项目影响：3d_editor 需同步调整

`3d_editor` 通过 `package.json` 的 `@faicad/faijs: file:../faijs/faicad-faijs-0.1.0.tgz` 消费 faijs，且大量直接依赖 faijs 的 BREP 链 API（`BrepChainState`、`initBrepChainState`/`releaseBrepChainState`、`cadExecuteStatement`/`dispatchStatement`、以及 `runtime.brepSolidCache`/`setBrepSolid`）。本次 faijs 改动会波及以下位置，**必须在 faijs 改完 `npm run pack` 重打 tarball、3d_editor `npm install` 后同步修改**（与 AGENTS.md 的 demo 同款约束：改 faijs 源码后必须 pack 再 install，否则跑的是旧产物）。

### 11.1 `src/renderer/engine/script-engine/ScriptEngine.ts`（P2 `replayPart` 收尾，~1396–1427）

**现状（旧全局语义）**
```ts
const brepChain = result.brepChain
if (brepChain && brepChain.brepActive && result.brepSolid) {   // ← 旧全局 brepActive + 单值 brepSolid
  const { solid: finalSolid, kernel } = result.brepSolid
  runtime.setBrepSolid(scopedId, finalSolid, kernel)           // 只 set 一个终端
  releaseBrepChainState(brepChain, new Set([lastStmt.id]))
  await this._rebuildBrepTopology(scopedId)
} else if (brepChain) {
  runtime.deleteBrepSolid(scopedId)                           // 链断 → 全删
  releaseBrepChainState(brepChain)
}
```

**改动**
- 删掉 `brepChain.brepActive` 闸门（字段将不存在）。
- 改读 `result.brepSolids`（逐终端 map：`terminalStmtId → { solid, kernel }`，见 §4）。遍历它，对每个条目经 `useScriptStore.terminalToScopedId` 映射到 scopedId，调用 `runtime.setBrepSolid(scopedId, solid, kernel)`。
- 终端中**无** `brepSolids` 条目的（mesh 零件）→ `runtime.deleteBrepSolid(scopedId)`。
- `runtime.setBrepSolid` / `brepSolidCache` / `getBrepSolid` / `deleteBrepSolid` **保留使用**（faijs 端已决定不废弃，见 §4 注）——它们按 scopedId 逐 part 存，天然契合逐 part 设计。
- `_rebuildBrepTopology(scopedId)` 仅对该 BREP 终端调用；mesh 终端不重建真拓扑。

### 11.2 `src/renderer/engine/script-engine/replay-validator.ts`（~91–156）

**现状**：`ReplayOutput` 接口含 `brepActive?: boolean` 与 `breakReason?: { stmtId; op }`；`replayScript` 返回 `brepActive: brepChain?.brepActive, breakReason: brepChain?.breakReason`。
**改动**：删除这两个字段（全局断链概念已废弃）。`brepChain` 对象本身可继续返回供调用方按 `solidCache` 逐 part 判定。若该文件是待迁移到 `CadRuntime.replay()` 的旧路径（注释已标注），至少移除对 `brepActive`/`breakReason` 的读写，避免引用已删除字段。

### 11.3 `src/renderer/engine/exporters/index.ts`（STEP 导出，~685–823）

**现状（与 faijs cli.ts 旧 bug 同源）**：`exportMeshesToStepBrepAware` 与 `exportFileToStep`/`tryExportBrepStep` 用 `ScriptEngine._brepSolidCache` 做「全有或全无」判断（`allHaveSolids` 标志）：只要该 fileId 下**任一** part 无 solid，整个文件就 fallback 到 faceted，**连 BREP 零件也被拖累**。

**改动（对齐 faijs §4「按零件类型分别处理」）**：
- 删除 `allHaveSolids` 全有或全无逻辑。
- 改为**逐 part 判定**：遍历每个 mesh，按其 `userData.scopedId` 查 `_brepSolidCache`——
  - 命中（有 solid）→ `exportBrepSolidToStep(kernel, solid)`（精确 `ADVANCED_FACE`）；
  - 未命中（mesh 零件）→ `meshesToStep(meshes, ...)`（三角化 STEP）。
- 多 part 合并进同一 `.step`：各自以独立 solid 实体出现（精确 + 三角化混排是合法 STEP），不再因「同文件有 mesh」而把 BREP 零件也降级。
- 删除 toast 里的 "BREP chain broken or no solid — falling back to faceted STEP" 误导文案；改为按 part 分别记 info。
- 注：3d_editor 的 `meshesToStep`（三处实现）底层仍用 `reconstructSolidFromMesh` / faijs `meshesToStep`，mesh→STEP 三角化能力本就在，仅导出层路由需改成逐 part。

### 11.4 `src/renderer/components/common/HotkeyManager.tsx`（~23–48）

**现状**：监听全局 `brep-chain-broken` 事件，toast「应用『X』使 BREP 链断裂…此后无法导出原生 STEP」。
**改动**：
- 监听 faijs 新事件 `part-brep-lost`（逐 part，携带 `partId`/`op`，见 §5）。
- toast 文案改为「该零件已转为 mesh（导出为三角化 STEP）；其余 BREP 零件仍可导精确 STEP」——不再说"整条链断裂 / 无法导出原生 STEP"。
- 若 faijs 保留 `brep-chain-broken` 作为兼容别名则监听名可不变，但**语义必须逐 part**（不能再说全局断链）。

### 11.5 `src/renderer/stores/topology-store.ts`（~26–36 注释）

`getStepRuntime(fileId)` 按 fileId 返回 BREP 零件的真拓扑；mesh 零件用假拓扑——这套**逻辑无需改**。仅更新「BREP 断链」注释措辞：逐 part 后不再有"全局断链保留最后拓扑"，改为"每个零件按自身 BREP 状态决定真/假拓扑来源（topologySources 已按 fileId 记录）"。Split 场景（front BREP + back mesh）天然正确：front 无真拓扑用假拓扑，back 有真拓扑，互不污染。

### 11.6 测试迁移（3d_editor 侧）

- **`src/renderer/engine/script-engine/script-engine.test.ts`**：大量断言需改写——
  - `expect(brepChain.brepActive).toBe(true)`（~1226、1300）→ 删除（字段不存在）。
  - `_brepSolidCache` 断言（~57、983、1044、1069、1092…）→ 保留，但语义从"全局链"转为"逐 part：`ScriptEngine._brepSolidCache.has(scopedId)` 存在性"。
  - `brep-chain-broken` 事件测试（~1143–1174）→ 改测 `part-brep-lost` 事件（携带具体 partId）。
  - `catch.*breakBrepChain` / `not.toMatch(/breakBrepChain/)`（~1326）→ faijs 移除 `breakBrepChain` 后，相关源码与测试断言同步删除。
- **`src/renderer/engine/__tests__/contract-entry.test.ts`**（~179–192）：断言 faijs 导出 `lastSolidOfChain`、`breakBrepChain`、`BrepChainState`、`initBrepChainState`、`releaseBrepChainState`、`executeStatement`、`resolveGeomRef`。faijs 移除 `lastSolidOfChain`/`breakBrepChain` 后，**此处删除这两项断言**（保留 `BrepChainState`/`initBrepChainState`/`releaseBrepChainState`）。另需核对 `executeStatement`/`resolveGeomRef` 是否为 3d_editor 实际依赖的旧名（replay-validator 已用 `dispatchStatement`）——若是过时别名且 faijs 同步清理，则一并去除。
- **`src/renderer/components/__tests__/ExportDialog.test.tsx`**：mock `meshesToStep` 仍有效（faijs 保留该导出），无需改。

### 11.7 跨项目回归用例（建议新增）

复用 3d_editor 现有 BREP cache 测试骨架（`script-engine.test.ts` §8），针对 Case 1 / Case 2 补充 UI 层断言：
- replay 后 `ScriptEngine._brepSolidCache` 中 `part4_v0`（Case 1）/`drilled_v0`、`cyl_v0`（Case 2）存在，`part3_v0`（Case 1）/`cube_v0`（Case 2）不存在；
- 导出 `.step` 时，BREP 零件走 `exportBrepSolidToStep`（精确）、mesh 零件走 `meshesToStep`（三角化），二者均成功、不再"全有或全无"降级。
- 该用例充当 3d_editor 侧回归锚点：任何把全局 `brepActive` 误带回来的改法（faijs 或 3d_editor 侧）都会被拦下。

### 11.8 执行顺序约束

1. faijs 先按 §9 改完 → `cd ../faijs && npm run pack`（重打 `faicad-faijs-0.1.0.tgz`）。
2. 3d_editor `npm install`（拉新 tarball），再按 §11.1–11.7 同步改动。
3. 3d_editor 跑 `npm test`（重点 script-engine / exporters / contract-entry 相关用例）。
4. **严禁**在 faijs 未 pack、3d_editor 未 reinstall 的情况下改 3d_editor 源码——否则类型仍指向旧 `brepActive`/`brepSolid` 字段，编译报错且无法验证。
