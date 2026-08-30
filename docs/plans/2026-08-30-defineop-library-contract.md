# faijs 第三方库双路径契约与 defineOp 开发面（实施文档）

- 日期：2026-08-30
- 状态：方案（未实施）
- 上位文档：`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（语言定位唯一权威）
- 关联文档：`docs/plans/2026-08-29-engine-library-contract.md`（引擎/库契约 K1–K6 与库契约三面）、`docs/plans/2026-08-29-engine-library-contract-implementation.md`（P0–P8 实施）、`docs/api-contract.zh.md`（当前接口契约）、`docs/plans/2026-08-28-keep-syntax-design.md`（keep 与终端判定）
- 本文档是引擎/库契约的**第二轮修订**：以"每个 op 必须支持 mesh、BREP 可选"为基石，用 `defineOp` 取代"每函数手写 `dispatchPath` + `brepImpl` 标记"的开发形态，并给出函数四分类概念模型与要修改的文件清单。

## 1. 需求基线（用户原话，逐字）

### 1.1 本轮需求原话

> "我要求的每一个op必需支持mesh，可选支持brep"

> "也就是，当我执行cad.box的时候，必需根据mode自动选择引擎和实现"

> "如何规定契约，如何让第三方库的编写者少犯错？请先给一个方案出来讨论，不需要写文档"

> "但是之前强调brep链的执行过程中，是静态判断的，需要提前知道一个op是否支持brep。现在的新方案支持这一点吗？"

> "dual(mesh, brep?)这个方案存在升级问题。未来有可能出现只支持brep但是不需要支持mesh的情况，请用一个更好的申明语法"

> "好的。用defineOp，那还是有一个核心问题，库作者需要为哪些函数定义这个defineOp？"

> "一句话总结：defineOp 的适用范围 = 函数签名返回 SolidShape 的所有函数，很好，这一点确定下来了。"

> "能否不要inputs参数？"

> "几何输入个数（dispatchPath 判定用）, 那新方案是否破坏了兼容性？"

> "双输出函数（split）的 defineOp 形态，为何新方案不支持？"

> "好的，采用方案C。"

> "然后把整个讨论出的完整方案写成一份技术实施文档，包括接口契约和要修改的文件。"

### 1.2 已有约束原话（2026-08-29 轮，继续有效）

> "库函数签名 = 源码里写的样子。禁止隐式注入。这是正确的。"

> "op就是函数，这是长期的方向。未来的第三方库，它就是写代码，实现function。不需要知道什么op这种概念。"

> "faijs是通用语言，并不是一个什么op相关的语言。"

### 1.3 已拍板决策（讨论结论）

| # | 决策 | 选项 |
|---|---|---|
| D-1 | 概念模型：**函数四分类**（几何/结构/查询/动作），取消"op"实体，保留为文档通俗称呼 | 用户选定 |
| D-2 | 运行时字段 `failedAt.op` / 事件 `detail.op` **改名 `callee`**（破坏性，宿主同步） | 用户选定 |
| D-3 | mode→选引擎/实现的自动分派放在 **SDK 包装器**（`defineOp` 内部调 `dispatchPath`），引擎零改动 | 用户选定 |
| D-4 | 装配期校验**严格**：声明即强制，`registerLib` 时校验 | 用户选定 |
| D-5 | brep 实现函数经 `getBackends()` **作者自取** kernel（现状，可单测） | 用户选定 |
| D-6 | stdlib **全量迁移**到 `defineOp` 形态，`brepImpl` 标记退役 | 用户选定 |
| D-7 | `defineOp` 命名；`inputs` 字段**取消**（几何输入自动收集）；多产物用可选 `outputs` 字段（**方案 C**） | 用户选定 |

## 2. 现状诊断（第二轮修订的动因）

| # | 问题 | 证据 |
|---|---|---|
| 1 | **"op"从未被定义**：同一讨论里指"函数名字符串"（`failedAt.op` = `source.callee`）、"文档分类"（创建类 op）、"产出几何的函数"、"概念不该存在的东西"（用户原话） | `module-executor.ts` 事件 `op: source.callee`；`api-contract.zh.md` §10.1 |
| 2 | **"mesh 必选"只是 stdlib 实践，不是契约**：文档 §8.2 只有链级表述（"mesh 是必经之路"），无 op 级条款；引擎无任何机制保证 | `api-contract.zh.md` §8.2 |
| 3 | **mech-lib fixture 违反 mesh 必选**：BREP 版 mock 与 brepjs-gear 均为 BREP-only，mesh 模式下直接 throw | `mock-mech-brep.ts:33` |
| 4 | **`brepImpl` 是 truthy 标记，与实现分离**：`const brepImpl = true` 可能标注错；能力声明退化为布尔 | `drill.ts:29` |
| 5 | **分派规则集中但调用分散**：规则在 `backend-dispatch.ts`，但每个库函数手写 `if (path === 'brep')` 分支；第三方库可完全不调 | `primitives.ts:99-103` 等 18 处 |
| 6 | **无强制**：mesh 实现是否存在不校验；`contractVersion` 可选，未导出的库不校验 | `runtime-state.ts:82-88` |

## 3. 概念模型：函数四分类（D-1）

faijs 没有"op"实体，只有**函数**。引擎按**运行时输出形态**（执行后检查值，非类型、非声明、非名字）分四类：

```
语句执行后 outputs 的运行时值
  ├─ isShape(v) === true
  │     ├─ isCompoundLike(v) → 结构函数（几何由成员承载）
  │     └─ 否则             → 几何函数（D 面契约适用）
  ├─ 非几何值              → 查询函数（C3：默认不消费输入）
  └─ 无输出（outputs: []）   → 动作函数（成员方法：add_constraint / do_assemble）
```

| 类别 | 运行时判定 | D 面契约 | stdlib 实例 |
|---|---|---|---|
| 几何函数 | `isShape===true` 且非 compound | **适用**（D1–D6） | box、drill、union、transform、knurl、sdf |
| 结构函数 | `isCompoundLike===true` | 不适用（几何由成员承载） | group、assembly |
| 查询函数 | 输出非几何值 | 不适用（C3 不消费输入） | faceCenter、faceNormal、bboxCenter、bboxMin、bboxMax |
| 动作函数 | 无输出 | 不适用 | add_constraint、do_assemble |

要点：

- 判定只用 `isShape` / `isCompoundLike` 两个既有运行时检查，引擎零函数知识（K5）不变——无名字表、无类别分支、不区分内置与第三方。
- `SolidShape`（`kind:'solid'`）与 `CompoundShape`（`kind:'compound'`）是**两个可区分的 TS 类型**——"要不要 defineOp"凭函数签名返回类型即可判定，不需要作者理解任何"op"概念。
- **"op"保留为文档通俗称呼**（如"创建类函数"），不参与任何契约与运行时字段。

## 4. 接口契约（D 面：双路径实现契约）

### 4.1 D 面条款（几何函数专用）

| # | 条款 | 内容 |
|---|---|---|
| **D1** | mesh 必选 | 每个**几何函数**（运行时产出 solid Shape）必须声明至少一个实现；**mesh 是默认路径** |
| **D1b** | brep-only 例外 | 允许只有 brep 实现的几何函数——此类函数在 `mode='mesh'`、或 auto 下输入断链时，调用前静态抛 `MeshUnsupportedError`（不兜底、不静默） |
| **D2** | mode 决定路径 | `mesh` → 无条件 mesh（无 mesh 实现则抛 `MeshUnsupportedError`）；`brep` → 无 brep 实现 / 输入断链 / 缺能力则抛 `BrepUnsupportedError`；`auto` → 静态优先 brep、mesh 兜底。判定发生在实现执行前，禁止运行时回退（红线） |
| **D3** | 产物必须经构造器 | solid 产物必须出自 SDK 构造器（`solid`/`fromBrep`/`fromHandle`），`isShape` 是引擎认账唯一依据 |
| **D4** | brep 产物必须带槽 | 走 brep 路径的产物必须登记 BREP 槽（`hasBrep===true`），否则引擎记账断裂（`part-brep-lost`） |
| **D5** | 能力声明随函数 | brep 实现若依赖 `evolution` 等能力，随 `defineOp` 的 `capabilities` 声明；缺能力 → auto 静态降级 mesh、brep 明确报错（不伪造） |
| **D6** | 签名不变 | `.faijs` 调用形态 = 源码形态（K1）；`defineOp` 不改变导出函数签名；结构/查询/动作函数不适用 D 面 |

模式 × 实现组合的行为矩阵（D1b/D2 的完整语义）：

| 实现组合 | `mode='mesh'` | `mode='brep'` | `mode='auto'` |
|---|---|---|---|
| mesh + brep | mesh | brep | 输入全在链 → brep，否则 mesh |
| mesh-only | mesh | `E_BREP_UNSUPPORTED` | mesh |
| brep-only | `E_MESH_UNSUPPORTED` | brep | 输入全在链 → brep，否则 `E_MESH_UNSUPPORTED` |

### 4.2 `defineOp` API（`@faicad/faijs/sdk` 新增）

```ts
export type MeshImpl<A extends unknown[]> = (...args: A) => MeshData | Shape
export type BrepImpl<A extends unknown[]> = (...args: A) => BrepHandle | { solid: BrepHandle; faceEvolution?: Map<number, number[]> }

export function defineOp<A extends unknown[]>(
  impls:
    | { mesh: MeshImpl<A>; brep?: BrepImpl<A> }      // 双路径 或 mesh-only
    | { brep: BrepImpl<A> },                          // brep-only（D1b）
  opts?: {
    capabilities?: BrepCapabilityName[]               // D5
    outputs?: string[]                                // 多产物命名键（方案 C，如 split）
  },
): ((...args: A) => Shape | Record<string, Shape>) & { __faijs?: DualOpMeta }
```

语义要点：

- **实现组合是命名数据**（`{ mesh?, brep? }`），不是位置参数——mesh-only / brep-only / 双路径全部自然表达，未来新增实现形态零破坏。
- **"至少一个实现"三重强制**：TS 类型（union）→ 构造期校验（`typeof mesh/brep`）→ 装配期校验（`assertLibConforms`，D-4 严格模式）。
- **几何输入自动收集**（D-7）：包装器内 `args.filter(isShape)`——`isShape` 是 O(1) 身份查询，只认构造器产物；裸 mesh 数据、params 普通对象、内嵌 Shape 的成员对象均不算几何输入。`inputs` 字段**取消**。
- **多产物**（方案 C）：`outputs: ['front', 'back']` 声明命名产物，包装器按键逐值包装（键类型由路径约定：brep 键 → handle、mesh 键 → MeshData）。单产物函数不写 `outputs`。
- **适用边界**（D-6）：`defineOp` 的适用范围 = **函数签名返回 `SolidShape` 的所有函数**（用户拍板原话）。结构函数（`compound()` + `keep()`）、查询函数、动作函数一律不写。

作者最终形态（对比现状 drill.ts 约 90 行样板）：

```ts
// 双路径（最常见）
export const drill = defineOp({
  mesh: (input, params) => drillMesh(input, params),
  brep: (input, params) => drillBrep(input, params),
  capabilities: ['evolution'],          // D5
})
// mesh-only（现状 knurl / sdf）
export const knurl = defineOp({
  mesh: (input, params) => knurlMesh(input, params),
})
// brep-only（未来精确曲面 / 倒角类，D1b）
export const fillet = defineOp({
  brep: (input, params) => filletBrep(input, params),
})
// 多产物（split，方案 C）
export const split = defineOp({
  mesh: (input, params) => splitMesh(input, params),   // 返回 { front: MeshData, back: MeshData }
  brep: (input, params) => splitBrep(input, params),   // 返回 { front: BrepHandle, back: BrepHandle }
  outputs: ['front', 'back'],
})
```

### 4.3 包装器内部行为（作者不可见）

```ts
return (...args) => {
  const inputs = args.filter(isShape)                 // 几何输入自动收集（执行前）
  const path = dispatchPath(inputs, impls, requiredCapability)   // 引擎同一套静态规则
  if (path === 'brep') {
    const r = brep!(...args)
    return outputs
      ? wrapKeys(r, outputs, 'brep')                  // 逐键 fromHandle / fromBrep
      : ('faceEvolution' in r ? fromBrep(meshHandle(r.solid), r) : fromHandle(r))
  }
  const m = mesh(...args)
  return outputs
    ? wrapKeys(m, outputs, 'mesh')                    // 逐键 solid / 透传
    : (isShape(m) ? m : solid(m))
}
```

### 4.4 `dispatchPath` 修订（双向化，`backend-dispatch.ts`）

签名从"只问能不能走 brep"变为"同时知道 mesh/brep 存在性"：

```ts
export function dispatchPath(
  inputs: Shape[],
  impls: { mesh?: unknown; brep?: unknown },
  requiredCapability?: BrepCapabilityName,
): 'brep' | 'mesh'   // 不匹配时抛错误，无回退
```

判定逻辑：

| mode | 条件 | 结果 |
|---|---|---|
| `mesh` | 无 `impls.mesh` | 抛 `MeshUnsupportedError`（`E_MESH_UNSUPPORTED`） |
| `mesh` | 有 mesh | `'mesh'` |
| `brep` | 无 brep / 输入断链 / 缺能力 | 抛 `BrepUnsupportedError`（`E_BREP_UNSUPPORTED`，现状逻辑不变） |
| `brep` | 全满足 | `'brep'` |
| `auto` | 有 brep 且输入全在链、能力齐 | `'brep'` |
| `auto` | 无 brep 或输入断链或缺能力，但有 mesh | `'mesh'` |
| `auto` | 无 mesh（brep-only 且输入断链） | 抛 `MeshUnsupportedError` |

错误类型：新增 `MeshUnsupportedError` 与 `BrepUnsupportedError` 对称——都带 `currentStmt`、都进 `failedAt`、都静态判定（实现执行前、无 try-catch、失败不回退）。

### 4.5 四道防线（"mesh 必选"从约定变机制）

| 层 | 机制 | 位置 |
|---|---|---|
| ① 编译期 | TS union 类型：mesh/brep 至少一个 | `defineOp` 类型签名 |
| ② 构造期 | `typeof` 校验，非法即 throw | `defineOp` 内部 |
| ③ 装配期 | `assertLibConforms(lib)` 被 `registerLib` 调用（严格模式，D-4）：凡带 `__faijs`（`kind:'dual-op'`）必须 mesh 是函数、brep 是函数或 undefined、capabilities 合法；导出 dual-op 的库 `contractVersion` 必须匹配 | SDK + `runtime.ts` |
| ④ 执行期 | 包装器内 `dispatchPath` 按 mode 强制（mesh 模式永不进 brep 分支） | `defineOp` 包装器 |

边界（如实声明）：①–④ 只约束经过 `defineOp()` 声明的函数；完全绕过 SDK 手写的函数，引擎无信息拦截（K5 禁止按名字猜），靠模板与文档引导。

### 4.6 版本协商与兼容性

- **`CONTRACT_VERSION` 1 → 2**：`dispatchPath` 签名变化（`brepImpl` → `impls`）是 SDK 内部破坏性变更；`assertContractVersion` 拒绝旧版库，不静默降级。
- **`dispatchPath` 移出 SDK 公开面**：库作者不再直接调用它（`defineOp` 内部自动调），回归引擎内部 API——签名变化不构成对外破坏。第三方唯一 SDK 面 = `defineOp` + 构造器 + `keep`/`keepHidden` + `getBackends` + `CONTRACT_VERSION`。
- **兼容性矩阵**（去掉 `inputs` 的破坏面）：`.faijs` 语言层零破坏（K1 调用形态不变）；`StatementIR` / statementKey / 终端判定 / `ExecutionResult` 零破坏（`inputs` 是库内部实现细节，不进任何 IR 与结果字段）；stdlib 迁移行为不变（parity 验证）；仅"已发布第三方库直接调旧 `dispatchPath` 签名"被拒——现状无真实发布者（mech-lib 为仓库内 fixture），实际影响为零。
- **语义收严（文档化）**：几何输入从"手写 `[input]` 子集"变为"args 中所有 Shape"——params 内嵌 Shape 引用（如 `drill(part0, { guide: cad.box(...) })`）也会计入断链判定。stdlib 现有用法无此形态，迁移后行为不变。

### 4.7 术语清理

| 位置 | 现状 → 改为 | 性质 |
|---|---|---|
| `ExecutionResult.failedAt.op` | `op` → `callee` | 破坏性，宿主（3d_editor）同步 |
| `EventSink` `detail.op` | `op` → `callee` | 破坏性 |
| stdlib JSDoc `@group 创建` 等 | "操作" → "函数"（重跑 `gen-ops-api-inventory.ts`） | 生成物 |
| `api-contract` / AGENTS.md / 注释 | "op" → "函数"；描述性分类保留为纯文档分类 | 文档 |

## 5. 库作者开发面（少犯错的抓手）

### 5.1 判定流程（作者写函数时凭签名可判）

```
问自己：这个函数产出什么？
├─ 独立几何实体（SolidShape）      → defineOp（即使只有一条路径也建议声明）
├─ 容器（CompoundShape，成员承载） → 不声明；compound() + keep()
├─ 非几何值（number/vec3/对象）    → 不声明（查询/数据函数）
└─ 无输出（动作函数）              → 不声明
```

### 5.2 一页纸规则（写进文档与模板）

1. 产出 `SolidShape` 的函数 → `defineOp({ mesh, brep?, capabilities?, outputs? })`；其余函数一律不写。
2. mesh 实现必写（D1）；brep 可选（D1b 允许 brep-only）。
3. 实现函数返回**裸值**：mesh 路径返回 `MeshData`，brep 路径返回 `BrepHandle`（或 `{solid, faceEvolution}`）——构造器包装由 defineOp 自动做，作者不碰 `solid`/`fromBrep`/`fromHandle`。
4. 需要 kernel 时 `getBackends().kernel.brep` 自取（D-5）；brep 模式下 kernel 保证可用，mesh 模式不可用。
5. 需要保留语义时在实现函数体内调 `keep()` / `keepHidden()`（import 得到，非注入）。
6. 库模块导出 `contractVersion = CONTRACT_VERSION`（导出 dual-op 的库必须匹配，严格校验）。
7. 需要面演化（拓扑命名）的 brep 实现返回 `{ solid, faceEvolution }`。

### 5.3 测试辅助（SDK 导出，vitest helper）

`expectDualOpParity(op, args)` 自动断言：auto 下 mesh/brep 两路径几何一致（contentKey 比对）、`mode='brep'` 时无 brep 的 op 抛 `BrepUnsupportedError`、`mode='mesh'` 时无 mesh 的 op 抛 `MeshUnsupportedError`、产物 `isShape===true`、brep 产物 `hasBrep===true`。一个函数覆盖 D1–D4 的回归。

## 6. 要修改的文件清单

### 6.1 引擎 core（`packages/core/src/`）

| 文件 | 改动 |
|---|---|
| `sdk.ts` | 新增导出：`defineOp`、`assertLibConforms`、`MeshUnsupportedError`、`DualOpMeta`、`MeshImpl`/`BrepImpl` 类型、`expectDualOpParity`（测试辅助）；**`dispatchPath` 移出公开面** |
| `cad-runtime/backend-dispatch.ts` | `dispatchPath` 双向化：第二参 `brepImpl` → `impls: { mesh?, brep? }`；`mode='mesh'` 无 mesh 实现抛 `MeshUnsupportedError`；auto 下 brep-only 输入断链抛错 |
| `runtime-state.ts` | 新增 `MeshUnsupportedError`（与 `BrepUnsupportedError` 对称）；`CONTRACT_VERSION` 1 → 2 |
| `cad-runtime/runtime.ts` | `registerLib` 调 `assertLibConforms`（严格校验）；`failedAt.op` → `failedAt.callee` |
| `cad-runtime/ports.ts` | `EventSink` `detail.op` → `detail.callee` |
| `cad-runtime/module-executor.ts` | `emitBrepLost` 的 `op: source.callee` → `callee: source.callee` |
| 新增单测 | `defineOp` 四道防线测试（类型/构造/装配/执行）、`dispatchPath` 双向矩阵测试、`MeshUnsupportedError` 归属测试、`sdk.test.ts` 零 heavy 依赖守卫更新 |

### 6.2 stdlib（`packages/stdlib/src/`，D-6 全量迁移）

| 文件 | 迁移动作 |
|---|---|
| `primitives.ts`（box/sphere/cylinder/cone/wedge） | 迁 `defineOp`；删 `primitiveBrep` 手写分支 |
| `transform.ts`（translate/rotate/scale） | 迁 `defineOp` |
| `drill.ts` / `extrude.ts` / `engrave.ts` / `copy.ts` | 迁 `defineOp`；`brepImpl` 标记退役 |
| `boolean.ts`（union/subtract/intersect） | 迁 `defineOp`（`capabilities: ['evolution']`） |
| `split.ts` | 迁 `defineOp` + `outputs: ['front', 'back']`（方案 C） |
| `knurl.ts` / `sdf.ts` | 迁 `defineOp({ mesh })`（mesh-only 合法形态） |
| `text.ts` / `screw.ts` / `svgExtrude.ts` | 迁 `defineOp`（text 历史兼容签名专项核对） |
| `load.ts` | **不迁**（路径由数据格式 `isCadFormat` 决定，非 mode；自研判定保留） |
| `geom.ts`（查询） | **不迁**（查询函数） |
| `compound.ts`（group/assembly） | **不迁**（结构函数，`compound()` + `keep()`） |
| `internal-stdlib.ts` | 不变（命名空间装配无感知） |

迁移验收：stdlib 全量测试 + parity 无回归 + `brepImpl` / 手写 `dispatchPath(` 调用点零残留。

### 6.3 mech-lib（`packages/mech-lib/src/`，mesh-first 重写）

| 文件 | 改动 |
|---|---|
| `mock-mech-brep.ts` | 用 `defineOp` 重写：mesh 实现（复用 mock-mech-mesh 的立方体网格）+ brep 实现（`fromHandle` 登记）——mesh 模式产 mesh box、auto/brep 产 BREP box |
| `mock-mech-mesh.ts` | 保持 mesh-only（已是合法形态）；`makeBall` 空占位补齐或删除 |
| `brepjs-gear.ts` | 补 mesh 兜底：参数化齿轮网格生成器（评估）或文档标注"BREP 增强库，mesh 路径为退化实现"；`contractVersion` 与 CONTRACT_VERSION=2 对齐 |
| 新增测试 | mesh 模式用例（不再崩溃）、parity 断言（`expectDualOpParity`） |

### 6.4 文档与宿主

| 位置 | 改动 |
|---|---|
| `docs/api-contract.md` / `.zh.md` | 增补 D 面条款（§4.1）、`defineOp` 开发面（§10.3 重写）、函数四分类（§8）、术语替换 |
| stdlib JSDoc `@group` 文案 | "操作" → "函数"；重跑 `scripts/gen-ops-api-inventory.ts`（生成 `docs/ops-api-inventory.md`） |
| `AGENTS.md` / 其它注释 | "op" → "函数"（描述性分类保留） |
| 宿主（3d_editor，跨仓库） | `failedAt.op` → `failedAt.callee`、事件 `detail.op` → `detail.callee` 消费同步 |

## 7. 落地分期

纪律：每期独立验证通过再进下一期；单测先行；不跑全量 CI 找 bug；CI 只作为最终验收。

| 期 | 内容 | 验证 |
|---|---|---|
| **P1** | SDK：`defineOp` + `assertLibConforms` + `MeshUnsupportedError` + 类型导出 + `expectDualOpParity`；`dispatchPath` 双向化；`CONTRACT_VERSION` 1→2；`dispatchPath` 移出公开面 | SDK 单测（四道防线 ①②③④ + 双向矩阵）+ `sdk.test.ts` 零 heavy 依赖守卫 |
| **P2** | stdlib 全量迁移（§6.2 表）；`brepImpl` 标记与手写 `dispatchPath(` 调用点退役 | stdlib 全量测试 + parity 无回归；`grep` 断言零残留 |
| **P3** | mech-lib mesh-first 重写（§6.3）；新增 mesh 模式用例 | mech-lib 测试全绿；mesh 模式不再崩溃；parity 断言 |
| **P4** | 术语清理（`failedAt.op`→`callee`、事件、JSDoc、文档）；宿主（3d_editor）跨仓库同步 | 跨仓库联调；doc-sync |

依赖：P1 → P2 → P3；P4 独立（破坏性，可与宿主并行）。

## 8. 风险与开放问题

| # | 问题 | 处置 |
|---|---|---|
| **R1** | `text` 有历史兼容签名（`cad.text(part0, {…})` 带输入参数、输入被忽略）——迁移 `defineOp` 时需专项核对，不与机械迁移混做 | P2 专项验证 |
| **R2** | `capabilities` 数组语义：建议"任一缺失 → auto 降级 mesh / brep 报错"（与单能力现状一致） | P1 实施时定稿 |
| **R3** | P4 破坏性变更（`op`→`callee`）与"版本号只升 patch"规则冲突 | 建议 P4 独立发布或跟随下一个 minor，由用户裁定 |
| **R4** | 未声明函数的边界：绕过 `defineOp` 手写的函数，引擎无信息拦截（K5） | 声明式强制的如实边界；靠模板与文档引导 |
| **R5** | `brepjs-gear` 的 mesh 兜底成本：参数化齿轮网格生成器（真实实现）vs 标注退化实现 | P3 评估后定 |
| **R6** | 对象产物（`outputs`）逐值包装的类型判定依赖路径约定——混合类型值（同一键在不同路径下类型不同）不支持 | 契约约定：同一产物键在 mesh/brep 路径下类型一致 |

## 9. 验收标准（测试提纲）

**概念与契约（P1）**
- `defineOp({ mesh })` / `defineOp({ brep })` / `defineOp({ mesh, brep })` 三种形态均可构造；`defineOp({})` 编译期（TS）与运行期（throw）双重拒绝。
- `dispatchPath` 双向矩阵逐格断言（§4.4 表）：含 `E_MESH_UNSUPPORTED` / `E_BREP_UNSUPPORTED` 归属（`failedAt.callee` 正确）。
- mesh-only 函数在 `mode='brep'` 抛 `BrepUnsupportedError`；brep-only 函数在 `mode='mesh'` 抛 `MeshUnsupportedError`；双路径在 auto 下静态优先 brep、断链走 mesh。

**自动收集与多产物（P1/P2）**
- 几何输入自动收集：`(input, params)`、`(...shapes)`、`(params)` 三种形态 `args.filter(isShape)` 结果正确；params 内嵌 Shape、裸 mesh 数据不误抓。
- `split`（`outputs: ['front','back']`）：brep 路径两产物均 `hasBrep===true`；`.faijs` 解构 `const { front: p1, back: p2 } = cad.split(...)` 往返正常。

**迁移回归（P2）**
- stdlib 全量测试通过；mesh/brep parity 无回归；`brepImpl`、手写 `dispatchPath(` 零残留（`grep` 断言）。
- `load` / `geom` / `compound` 行为不变（不迁）。

**第三方示范（P3）**
- mech-lib 三种形态（双路径 / mesh-only / brep-only 或退化标注）跑通；mesh 模式不再崩溃；`expectDualOpParity` 全绿。
- 跨库混合：`cad.union(mech 产物, cad.box(...))` 在 auto 下走 brep（c3 场景回归）。

**术语与宿主（P4）**
- `ExecutionResult.failedAt.callee` 与事件 `detail.callee` 生效；`failedAt.op` 零残留。
- 3d_editor 消费面同步后联调通过；doc-sync 全绿。


