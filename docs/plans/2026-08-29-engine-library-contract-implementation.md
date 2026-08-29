# 实施手册：取消 exec 注入，重建引擎 ↔ 库契约

- 日期：2026-08-29
- 设计文档：`docs/plans/2026-08-29-engine-library-contract.md`（**先读它**，本手册是它的落地步骤）
- 状态：**待实施**（本手册写完后才开始改代码）
- 适用对象：按本手册逐步执行的编码 agent。手册假定执行者**不了解本项目**，所有路径、行号、改前改后代码均已给出。

---

## 0. 怎么使用这份文档（执行者必读）

### 0.1 铁律（违反即返工）

| # | 铁律 |
|---|---|
| **R1** | **严格按 P0 → P1 → … → P7 顺序执行。每期完成后必须通过该期的验证，才能进入下一期。** 不要跳期、不要合并两期一起改 |
| **R2** | 每期开始时先跑一次 `npm run typecheck` 记录基线；每期结束时再跑，必须无新增错误 |
| **R3** | **禁止为了让测试通过而修改测试断言**。测试失败 = 你的改动有问题，或者改动破坏了既有语义（后者要停下来报告） |
| **R4** | 不改动 `test/` 与 `demo/` 下的文件，除非该期明确要求 |
| **R5** | 不跑全量测试、不跑 CI（`scripts/ci.ps1`）。只跑该期指定的测试文件 |
| **R6** | 每期结束必须执行该期的 grep 断言（用给出的命令），逐条确认 |
| **R7** | 遇到手册没覆盖的情况，**停下来报告**，不要自己发明方案 |

### 0.2 每期的结构

每一期都包含五个部分，按顺序做：

```
① 目标（一句话 + 完成判据）
② 文件清单（表格：文件 / 动作 / 说明）
③ 操作步骤（编号，每步：打开文件 → 定位 → 改成 → 为什么）
④ 验证（命令 + 期望结果）
⑤ 完成判据 checklist（全部勾选才能进入下一期）
```

### 0.3 常用命令

```bash
cd C:/my/Faicad/faijs

npm run typecheck                      # 类型检查（只覆盖 src/）
npm run lint                           # eslint src
npx vitest run <文件路径>               # 跑单个测试文件
npx vitest run src/cad-runtime/keep.test.ts
```

> Windows 下用 Git Bash。项目路径含中文/空格时用引号包裹。

---

## 1. 前置：确认当前代码状态（**有些活已经干完了**）

开始之前先确认——`docs/plans/2026-08-28-keep-syntax-design.md` 的 P1–P5 **大部分已经实施**，本手册**不重复做**。

### 1.1 已完成（跳过，不要动）

| 项 | 证据 | 状态 |
|---|---|---|
| 符号表退化为"键存在性检查" | `src/lang/symbol-table.ts` 注释明写 "keep-syntax P1 之后它只承载一个职责"；`symbol-table.generated.ts` 全是 `"box": {}` 空对象 | ✅ 已完成 |
| `exec.keep` / `exec.keepHidden` 实现 | `src/cad-runtime/exec-context.ts:242-263` | ✅ 已完成 |
| `internalKeep` 记账 + 缓存命中保留上一轮 | `src/cad-runtime/module-executor.ts:77,141-142,194-197` | ✅ 已完成 |
| `shapeToName` 反查登记 | `exec-context.ts:141`；`module-executor.ts:275`；`runtime.ts:543-548` | ✅ 已完成 |
| `onKeep` 回调链 | `exec-context.ts:128,150`；`runtime.ts:538` | ✅ 已完成 |
| terminal-dag 的 C0/C1/C3/C5 判定 | `src/cad-runtime/terminal-dag.ts:52-100` | ✅ 已完成 |
| keep 调用点语法 + 编译期剥离 + statementKey 排除 | `src/lang/keep.ts`；`compile.ts:164`；`module-executor.ts:301` | ✅ 已完成 |
| `DagRuntimeView` + `computeLeafTerminals` | `terminal-dag.ts:38-42,105-160` | ✅ 已完成 |

> **结论**：keep 的**语义与机制完全不动**。本手册只做两件事：①取消 `exec` 末参注入 ②把 `exec.keep(...)` 的调用入口从 `exec.属性` 改成 `import` 的函数。

### 1.2 待实施（本手册范围）

| 期 | 内容 | 风险 |
|---|---|---|
| **P0** | 新增 `src/runtime-state.ts`（全局状态锚点：Backends + 当前语句 + Shape 身份表） | 低 |
| **P1** | Shape 构造器扩展（`fromBrep` / `hasBrep` / `brepOf`），改造为从锚点读身份表 | 低 |
| **P2** | stdlib 18 个文件去 exec（**面积最大**） | 高 |
| **P3** | `keep()` 改 import 入口；删除 `deriveMemberNames` | 中 |
| **P4** | 双链路分派收归引擎；错误/事件归属由引擎补充 | 中 |
| **P5** | compile + module-executor 去 exec；删除 `exec-context.ts` | 中 |
| **P6** | 装配重做（求解 ≠ 传播）——**语义变化，专项验证** | 高 |
| **P7** | 第三方库通道（`ModuleResolver` + 单例去重 + 版本校验） | 中 |

### 1.3 必须知道的现有文件

| 文件 | 作用 | 行数 |
|---|---|---|
| `src/cad-runtime/exec-context.ts` | `ExecContext` 接口 + `ExecContextImpl`（**本方案要删除**） | 269 |
| `src/cad-runtime/compile.ts`（实为 `src/lang/compile.ts`） | IR → 零 import ESM 文本，4 处发射 `, exec` | 257 |
| `src/cad-runtime/module-executor.ts` | 持久 ctx + 增量调度 + `internalKeep` | 326 |
| `src/cad-runtime/runtime.ts` | `CadRuntime`，`createExecContext` 装配 exec（`:513-550`） | 1136 |
| `src/cad-runtime/internal-stdlib.ts` | 把 stdlib 装配为 `cad` 命名空间 | 44 |
| `src/cad-runtime/terminal-dag.ts` | DAG 终端判定（**基本不动**） | 179 |
| `src/stdlib/shape.ts` | Shape 构造器 + 身份槽 WeakMap（`created` / `slots` 是模块级） | 109 |
| `src/stdlib/**` | 18 个库文件，全部签名 `(…args, exec)` | —— |
| `src/stdlib/internal/resolve-path.ts` | 双链路静态判定（**要删除，逻辑移到引擎**） | 49 |

---

## 2. 全局约定（所有期通用）

### 2.1 分层与依赖方向（**关键，防止写出循环依赖**）

```
L0    src/lang/          parser / codegen / types / keep     （零依赖）
L0+   src/runtime-state.ts  ← 本方案新增，零依赖状态锚点
L1    src/stdlib/        几何实现
L2    src/cad-runtime/   编排（CadRuntime / ModuleExecutor / compile）
```

**依赖方向必须是单向的**：

```
stdlib  ──import──>  runtime-state   ✅（L1 → L0+）
cad-runtime ──import──> runtime-state ✅（L2 → L0+）
cad-runtime ──import──> stdlib        ✅（L2 → L1，已有）
stdlib  ──import──> cad-runtime       ❌ 禁止（会形成循环！）
```

> ⚠️ **最容易犯的错**：把 `Backends` 或 `keep()` 定义在 `cad-runtime/` 下，然后让 stdlib 去 import 它。
> `cad-runtime/internal-stdlib.ts` 已经 import 了 stdlib，再加 stdlib → cad-runtime 就是循环。
> **所以这两个东西必须放在 `src/runtime-state.ts`（零依赖层）。**

### 2.2 命名约定

| 概念 | 命名 | 位置 |
|---|---|---|
| 全局运行时状态 | `FaijsRuntimeState` | `src/runtime-state.ts` |
| 后端配置 | `configureBackends(ports)` / `getBackends()` | `src/runtime-state.ts` |
| 当前语句 | `setCurrentStmt(stmt)` / `getCurrentStmt()` | `src/runtime-state.ts` |
| 保留声明 | `keep(...shapes)` / `keepHidden(...shapes)` | `src/runtime-state.ts` |
| Shape 构造器 | `solid` / `fromBrep` / `compound` | `src/stdlib/shape.ts` |
| BREP 查询 | `hasBrep(shape)` / `brepOf(shape)` | `src/stdlib/shape.ts` |
| 双实现打包 | `dual(meshImpl, brepImpl?)` | `src/runtime-state.ts`（P4b 用） |

### 2.3 不要动的东西（零回归面）

以下**不得修改**（除非该期明确要求）：

- `ScriptIR` / `StatementIR` 的字段结构（`src/lang/types.ts`）
- `parseScript` 的解析行为
- `codegen` 的往返行为（`parse → codegen → parse` 必须逐位相等）
- `ExecutionResult` 的字段集合
- `HostPorts` 接口（`src/cad-runtime/ports.ts`）
- `derivePartName`（`src/lang/allocate-id.ts`）
- `src/lang/keep.ts`（除注释更新外）
- `terminal-dag.ts` 的判定逻辑

### 2.4 每期开始前的基线检查

```bash
npm run typecheck 2>&1 | tail -5
npx vitest run src/cad-runtime/keep.test.ts 2>&1 | tail -8
```

第二条必须 **passed**。如果基线就是红的，先报告，不要开始改。

---

## 3. P0：新增 `src/runtime-state.ts`（全局状态锚点）

### 3.1 目标

新增一个**零依赖**的模块，承载三样东西：①后端配置（Backends）②当前执行语句 ③Shape 身份表。
它是 stdlib 与 cad-runtime 之间**唯一**的共享状态，且分层上位于两者之下，不会形成循环依赖。

**完成判据**：`src/runtime-state.ts` 存在、零 `import`（除 `import type`）、通过 typecheck 与新增的单测。

### 3.2 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/runtime-state.ts` | **新增** | 状态锚点（本期的全部内容） |
| `src/runtime-state.test.ts` | **新增** | 单元测试 |
| `src/index.ts` | 修改 | 导出 `configureBackends` / `getBackends` / `keep` / `keepHidden` |

### 3.3 操作步骤

#### 步骤 1：创建 `src/runtime-state.ts`

新建文件，写入**完整内容**（不要删减注释，注释是契约的一部分）：

```ts
/**
 * runtime-state — 全局运行时状态锚点（零依赖层）
 *
 * 设计文档：docs/plans/2026-08-29-engine-library-contract.md §6 / §7 / §8
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P0
 *
 * 本模块位于 L0+（零运行时依赖），是 stdlib（L1）与 cad-runtime（L2）之间
 * 唯一的共享状态。**放在这一层是为了避免循环依赖**：stdlib 不能 import
 * cad-runtime（cad-runtime/internal-stdlib.ts 已经 import 了 stdlib）。
 *
 * 承载三类状态：
 * 1. Backends —— 宿主注入的环境资源（内核 / 端口 / 模式 / 标准库命名空间）
 * 2. 当前执行语句 —— keep() 归属用（引擎在语句 fn 之前设置）
 * 3. Shape 身份表 —— 构造器登记（isShape 依据）与 Shape→PartName 反查
 *
 * ⚠️ 依赖方向红线：本文件不得 import 任何 src/ 下的模块（只可 import type）。
 */

import type { StatementIR } from './lang/types'
import type { PartName } from './identity'
import { asPartName } from './identity'

// ── 后端配置（宿主注入的环境资源）──

/**
 * 执行模式（与 src/cad-runtime/ports.ts 的 ExecutionMode 保持一致）。
 * 此处重复定义是为了保持本模块零依赖；由守卫测试保证两者一致。
 */
export type RuntimeExecutionMode = 'auto' | 'brep' | 'mesh'

/** 宿主注入的环境资源。字段类型用宽松结构，避免本模块依赖具体实现。 */
export interface Backends {
  /** 契约版本（装配期校验，不兼容即抛错） */
  readonly contractVersion: number
  /** 执行配置（可变对象，宿主可在运行期切换） */
  readonly config: {
    mode: RuntimeExecutionMode
    partTransform?: { position: [number, number, number]; scale?: [number, number, number] }
  }
  /** 几何后端。occt 异步初始化 → 用 getter。 */
  readonly kernel: {
    readonly occt: unknown | null
    readonly csg: unknown | undefined
    readonly sdf: unknown | undefined
  }
  /** 宿主端口（透传 HostPorts） */
  readonly fonts: unknown
  readonly texture: unknown
  readonly assets: unknown
  readonly events: unknown
  /** faijs 自带标准库命名空间（引擎不区分它与第三方库——都是库函数） */
  readonly cad: Record<string, unknown>
}

/** 契约版本。破坏性变更 +1。加载第三方库时校验，不兼容即抛错。 */
export const CONTRACT_VERSION = 1

// ── 状态容器 ──

export interface FaijsRuntimeState {
  readonly stateVersion: number
  /** 后端配置（configureBackends 写入） */
  backends: Backends | undefined
  /** 当前执行语句（引擎在语句 fn 之前设置） */
  currentStmt: StatementIR | undefined
  /** Shape 构造器登记（isShape 的唯一依据） */
  readonly created: WeakSet<object>
  /** Shape 身份槽 */
  readonly slots: WeakMap<object, ShapeSlot>
  /** Shape → PartName 反查（keep 与 dependentsOf 用） */
  readonly shapeToName: WeakMap<object, PartName>
  /** 被声明原地修改的 Shape（装配用；P6 之前保留，P6 后删除） */
  readonly touchedShapes: Set<object>
}

/** Shape 身份槽（OCCT 句柄 + 面演化 + 装配行为）。 */
export interface ShapeSlot {
  solid?: unknown
  faceEvolution?: Map<number, number[]>
  behavior?: unknown
}

const STATE_VERSION = 1
const KEY = '__FAICAD_FAIJS_RUNTIME__'

/**
 * 获取全局状态（单例）。
 *
 * 挂在 globalThis 上是为了让"两份 faijs 代码"（宿主 bundle 一份、第三方库
 * 打进一份）共享同一份状态——两份 WeakSet 会导致 Shape 身份不通（几何孤岛）。
 * 构建期去重（external）是主手段，这里是兜底。
 */
export function getRuntimeState(): FaijsRuntimeState {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[KEY] as FaijsRuntimeState | undefined
  if (existing) {
    if (existing.stateVersion !== STATE_VERSION) {
      throw new Error(
        `[faijs] runtime state version mismatch: loaded=${existing.stateVersion}, expected=${STATE_VERSION}`,
      )
    }
    return existing
  }
  const created: FaijsRuntimeState = {
    stateVersion: STATE_VERSION,
    backends: undefined,
    currentStmt: undefined,
    created: new WeakSet<object>(),
    slots: new WeakMap<object, ShapeSlot>(),
    shapeToName: new WeakMap<object, PartName>(),
    touchedShapes: new Set<object>(),
  }
  g[KEY] = created
  return created
}

// ── 后端配置读写 ──

/** 宿主在启动时调用一次，注入环境资源。 */
export function configureBackends(backends: Backends): void {
  getRuntimeState().backends = backends
}

/**
 * 读取后端配置。库函数通过它获取内核与宿主端口。
 *
 * 未配置时抛错——不要返回默认值兜底（配置是宿主的责任，缺失必须暴露）。
 */
export function getBackends(): Backends {
  const b = getRuntimeState().backends
  if (!b) {
    throw new Error('[faijs] backends not configured: call configureBackends() before executing')
  }
  return b
}

// ── 当前执行语句（引擎内部状态）──

/** 引擎在语句 fn 之前调用（替换现状的 exec.currentStmt = source）。 */
export function setCurrentStmt(stmt: StatementIR | undefined): void {
  getRuntimeState().currentStmt = stmt
}

/** 读取当前执行语句。库函数不应调用它（F1）。 */
export function getCurrentStmt(): StatementIR | undefined {
  return getRuntimeState().currentStmt
}

// ── Shape 身份表 ──

/** Shape → 变量名反查（keep 与 dependentsOf 依赖）。 */
export function nameOf(shape: object): PartName | undefined {
  return getRuntimeState().shapeToName.get(shape)
}

/** 登记 Shape → 变量名映射。 */
export function setName(shape: object, name: PartName): void {
  getRuntimeState().shapeToName.set(shape, name)
}

// ── keep 声明（库函数体调用）──

/**
 * 登记回调类型。由 ModuleExecutor 在装配时注入（保持 runtime-state 零依赖）。
 */
export type KeepSink = (stmtId: string, names: PartName[], hidden: boolean) => void

let keepSink: KeepSink | undefined

/** 引擎装配 keep 的落地目标（ModuleExecutor.registerKeep）。 */
export function setKeepSink(sink: KeepSink | undefined): void {
  keepSink = sink
}

/**
 * 函数体 keep 声明：声明保留这些 Shape 对应的变量（可见）。
 *
 * 库作者在库函数体内调用：
 * ```ts
 * import { keep } from '@faicad/faijs'
 * export function group(params) {
 *   keep(...params.members)
 *   return compound(params.members)
 * }
 * ```
 *
 * 归属到"当前正在执行的语句"（引擎在 fn 之前 setCurrentStmt）。
 * 未登记在 shapeToName 的对象（库内部的自定义对象）被忽略——这是刻意的静默。
 */
export function keep(...shapes: unknown[]): void {
  registerKeep(shapes, false)
}

/** 函数体 keep 声明：保留但 canvas 不渲染（布尔系函数的源）。 */
export function keepHidden(...shapes: unknown[]): void {
  registerKeep(shapes, true)
}

function registerKeep(shapes: unknown[], hidden: boolean): void {
  const stmt = getRuntimeState().currentStmt
  if (!stmt || !keepSink) return
  const names: PartName[] = []
  for (const s of shapes) {
    if (s === null || typeof s !== 'object') continue
    const n = nameOf(s)
    if (n !== undefined) names.push(n)
  }
  if (names.length === 0) return
  keepSink(String(stmt.id), names, hidden)
}
```

> ⚠️ **注意**：`Backends.kernel.occt` 等字段类型写成 `unknown`，是为了保持本模块零依赖（不 import `occt-wasm`）。
> 库函数使用时要自己断言类型（见 P2 步骤）。这是刻意取舍，不要"优化"成具体类型。

#### 步骤 2：创建 `src/runtime-state.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRuntimeState, configureBackends, getBackends, setCurrentStmt, getCurrentStmt,
  keep, keepHidden, setKeepSink, nameOf, setName, CONTRACT_VERSION,
  type Backends,
} from './runtime-state'
import { asPartName, type StmtId } from './identity'
import type { StatementIR } from './lang/types'

function fakeBackends(): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto' },
    kernel: { occt: { tag: 'fake-occt' }, csg: undefined, sdf: undefined },
    fonts: undefined, texture: undefined, assets: undefined, events: undefined,
    cad: {},
  }
}

function stmt(id: string): StatementIR {
  return { id: id as StmtId, callee: 'box', args: {}, inputs: [], outputs: [] }
}

describe('runtime-state', () => {
  beforeEach(() => {
    setCurrentStmt(undefined)
    setKeepSink(undefined)
  })

  it('getRuntimeState 是单例且 stateVersion 稳定', () => {
    expect(getRuntimeState()).toBe(getRuntimeState())
    expect(getRuntimeState().stateVersion).toBe(1)
  })

  it('未配置 backends 时 getBackends 抛错（不静默兜底）', () => {
    const st = getRuntimeState()
    const saved = st.backends
    st.backends = undefined
    expect(() => getBackends()).toThrow(/backends not configured/)
    st.backends = saved
  })

  it('configureBackends 后 getBackends 返回同一引用（可变引用可运行期切换）', () => {
    const b = fakeBackends()
    configureBackends(b)
    expect(getBackends()).toBe(b)
    b.config.mode = 'mesh'                    // config 是可变对象
    expect(getBackends().config.mode).toBe('mesh')
  })

  it('keep/keepHidden 归属当前语句，且经 shapeToName 反查', () => {
    const calls: Array<{ id: string; names: string[]; hidden: boolean }> = []
    setKeepSink((id, names, hidden) => calls.push({ id, names: names.map(String), hidden }))

    const a = { positions: new Float32Array(), indices: new Uint32Array() }
    const b = { positions: new Float32Array(), indices: new Uint32Array() }
    setName(a, asPartName('part0'))
    setName(b, asPartName('part1'))

    setCurrentStmt(stmt('s3'))
    keep(a)
    keepHidden(b)

    expect(calls).toEqual([
      { id: 's3', names: ['part0'], hidden: false },
      { id: 's3', names: ['part1'], hidden: true },
    ])
  })

  it('无当前语句时 keep 静默丢弃（不抛错）', () => {
    const calls: unknown[] = []
    setKeepSink((...a) => calls.push(a))
    setCurrentStmt(undefined)
    expect(() => keep({})).not.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('未登记在 shapeToName 的对象被忽略', () => {
    const calls: unknown[] = []
    setKeepSink((...a) => calls.push(a))
    setCurrentStmt(stmt('s1'))
    keep({ notRegistered: true })
    expect(calls).toHaveLength(0)
    expect(nameOf({ notRegistered: true })).toBeUndefined()
  })
})
```

#### 步骤 3：在 `src/index.ts` 增加导出

在 `src/index.ts` 中找一个合适位置（建议放在 `// ── L0 文本层` 之前），插入：

```ts
// ── 运行时状态锚点（零依赖层；引擎与库共享）
export {
  configureBackends, getBackends, setCurrentStmt, getCurrentStmt,
  keep, keepHidden, getRuntimeState, nameOf, setName, setKeepSink,
  CONTRACT_VERSION,
} from './runtime-state'
export type {
  Backends, FaijsRuntimeState, ShapeSlot, KeepSink, RuntimeExecutionMode,
} from './runtime-state'
```

### 3.4 验证

```bash
npm run typecheck
npx vitest run src/runtime-state.test.ts
npm run lint
```

期望：typecheck 无新增错误；测试 **passed**（6 个 it）；lint 无错。

### 3.5 完成判据

- [ ] `src/runtime-state.ts` 已创建，且**除 `import type` 外无任何 import**
- [ ] `src/runtime-state.test.ts` 6 个用例全部通过
- [ ] `npm run typecheck` 无新增错误
- [ ] `src/index.ts` 已导出 `configureBackends` / `getBackends` / `keep` / `keepHidden`
- [ ] **尚未有任何地方调用这些新 API**（P0 只是铺路，现有行为必须完全不变）

> P0 结束时，项目行为应当**逐位不变**。如果任何既有测试挂了，说明你动到了别处，回退重做。

---

## 4. P1：Shape 构造器扩展（从锚点读身份表）

### 4.1 目标

把 `src/stdlib/shape.ts` 的模块级 `WeakSet`/`WeakMap` 改为读 P0 的全局锚点，并新增 `fromBrep` / `hasBrep` / `brepOf` 三个函数，让库函数**不再手动 `exec.setSolid`**。

**完成判据**：`shape.ts` 从锚点读状态；新增三函数可用；既有 `isShape` 语义不变。

### 4.2 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/stdlib/shape.ts` | 修改 | 身份表改读锚点；新增 `fromBrep` / `hasBrep` / `brepOf` |
| `src/stdlib/shape.test.ts` | **新增** | 构造器与 BREP 槽单测 |

### 4.3 操作步骤

#### 步骤 1：改写 `src/stdlib/shape.ts`

完整替换文件内容（保留原有的 `SolidShape` / `CompoundShape` / `isCompoundLike` 语义）：

```ts
/**
 * stdlib shape — 类型化构造器 + 身份槽
 *
 * 设计文档：docs/plans/2026-08-29-engine-library-contract.md §7
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P1
 *
 * 变更要点：
 * - 身份表（created / slots / shapeToName）改读全局锚点 runtime-state，
 *   使"两份 faijs 代码"共享同一份状态（解决 Shape 身份孤岛）。
 * - 新增 fromBrep(mesh, holder)：BREP 产物一次登记句柄与面演化，
 *   库函数不再手动 setSolid / setFaceEvolution（P2 落地）。
 * - 新增 hasBrep / brepOf：引擎侧判定"某 Shape 是否在 BREP 链上"。
 */

import type { Shape } from '../mesh/types'
import { getRuntimeState, type ShapeSlot } from '../runtime-state'

// ── Shape 构造器 ──

export type ShapeKind = 'solid' | 'shape2d' | 'curve' | 'compound'

export interface SolidShape extends Shape {
  kind: 'solid'
}

export interface CompoundShape {
  kind: 'compound'
  children: Shape[]
}

export type StdShape = SolidShape | CompoundShape

/** 实体 Shape 构造器：mesh 产物必须经此创建。 */
export function solid(mesh: Shape): SolidShape {
  const s: SolidShape = { ...mesh, kind: 'solid' }
  getRuntimeState().created.add(s)
  return s
}

/**
 * BREP 产物构造器：同时登记 mesh 与 OCCT 句柄（+ 可选面演化）。
 *
 * 库函数用它替代 `solid(mesh)` + `exec.setSolid(shape, handle)` 两步行：
 * ```ts
 * return fromBrep(solidToShape(kernel, resultSolid), {
 *   solid: resultSolid,
 *   faceEvolution: identityEvolution(kernel, resultSolid),
 * })
 * ```
 */
export function fromBrep(mesh: Shape, holder: BrepHolder): SolidShape {
  const s = solid(mesh)
  const state = getRuntimeState()
  const slot = state.slots.get(s) ?? {}
  slot.solid = holder.solid
  if (holder.faceEvolution) slot.faceEvolution = holder.faceEvolution
  state.slots.set(s, slot)
  return s
}

/** BREP 句柄 + 面演化（对应 OCCT 的 ShapeHandle）。类型为 unknown 以保持零依赖。 */
export interface BrepHolder {
  solid: unknown
  faceEvolution?: Map<number, number[]>
}

/** compound Shape 构造器：结构（层级）而非新几何。 */
export function compound(children: Shape[]): CompoundShape {
  const c: CompoundShape = { kind: 'compound', children }
  getRuntimeState().created.add(c)
  return c
}

/** 是否为构造器产物（终端判定与 compound 检测的依据）。 */
export function isShape(v: unknown): v is Shape {
  return !!v && typeof v === 'object' && getRuntimeState().created.has(v)
}

export function isCompound(v: unknown): v is CompoundShape {
  return isShape(v) && (v as { kind?: string }).kind === 'compound'
}

/**
 * 结构判定：是否为 compound 形态（keep-syntax §5.3 D5，对任意库函数零要求）。
 * 引擎内部的终端/消费判定用结构判定；SDK 公开的 isShape/isCompound 保持 WeakSet 严格。
 */
export function isCompoundLike(v: unknown): v is CompoundShape {
  return !!v && typeof v === 'object'
    && (v as { kind?: string }).kind === 'compound'
    && Array.isArray((v as { children?: unknown }).children)
}

// ── 身份槽 ──

export type { ShapeSlot }

/** 读取 Shape 的身份槽（无则 undefined）。 */
export function getSlot(shape: object): ShapeSlot | undefined {
  return getRuntimeState().slots.get(shape)
}

/** 读取或创建 Shape 的身份槽。 */
export function ensureSlot(shape: object): ShapeSlot {
  const state = getRuntimeState()
  let slot = state.slots.get(shape)
  if (!slot) {
    slot = {}
    state.slots.set(shape, slot)
  }
  return slot
}

/** 该 Shape 是否在 BREP 链上（有 OCCT 句柄）。引擎分派与 UI 查询用。 */
export function hasBrep(shape: Shape): boolean {
  return getRuntimeState().slots.get(shape)?.solid !== undefined
}

/** 读取该 Shape 的 OCCT 句柄（无则 undefined）。库函数用前必须判空。 */
export function brepOf(shape: Shape): unknown | undefined {
  return getRuntimeState().slots.get(shape)?.solid
}
```

> ⚠️ **不要删除 `ensureSlot` / `getSlot`**：`cad-runtime/runtime.ts:277` 与 `compound.ts:18` 仍在用。

#### 步骤 2：新增 `src/stdlib/shape.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { solid, compound, fromBrep, isShape, isCompound, isCompoundLike, hasBrep, brepOf, getSlot } from './shape'

const mesh = () => ({ positions: new Float32Array([0, 0, 0]), indices: new Uint32Array([0]) })

describe('shape constructors', () => {
  it('solid 产物被 isShape 识别', () => {
    const s = solid(mesh())
    expect(isShape(s)).toBe(true)
    expect(s.kind).toBe('solid')
  })

  it('compound 产物被 isCompound / isCompoundLike 识别', () => {
    const c = compound([solid(mesh())])
    expect(isCompound(c)).toBe(true)
    expect(isCompoundLike(c)).toBe(true)
    expect(c.children).toHaveLength(1)
  })

  it('未注册对象不是 Shape', () => {
    expect(isShape({ positions: new Float32Array(), indices: new Uint32Array() })).toBe(false)
    expect(isShape({})).toBe(false)
    expect(isShape(null)).toBe(false)
  })

  it('isCompoundLike 对未注册的裸对象也成立（结构判定）', () => {
    expect(isCompoundLike({ kind: 'compound', children: [] })).toBe(true)
    expect(isCompound({ kind: 'compound', children: [] })).toBe(false)   // 严格口径
  })
})

describe('brep slot', () => {
  it('fromBrep 一次登记 mesh + 句柄 + 面演化', () => {
    const handle = { tag: 'occt-handle' }
    const evo = new Map<number, number[]>([[0, [0, 1]]])
    const s = fromBrep(mesh(), { solid: handle, faceEvolution: evo })

    expect(isShape(s)).toBe(true)
    expect(hasBrep(s)).toBe(true)
    expect(brepOf(s)).toBe(handle)
    expect(getSlot(s)?.faceEvolution).toBe(evo)
  })

  it('mesh 产物不在 BREP 链上', () => {
    const s = solid(mesh())
    expect(hasBrep(s)).toBe(false)
    expect(brepOf(s)).toBeUndefined()
  })

  it('fromBrep 不带 faceEvolution 时不写入槽', () => {
    const s = fromBrep(mesh(), { solid: { tag: 'h' } })
    expect(getSlot(s)?.faceEvolution).toBeUndefined()
  })
})
```

### 4.4 验证

```bash
npm run typecheck
npx vitest run src/stdlib/shape.test.ts
npx vitest run src/cad-runtime/runtime.test.ts
```

期望：全部 passed。`runtime.test.ts` 是关键回归——它验证身份表改读锚点后既有流程不变。

### 4.5 完成判据

- [ ] `src/stdlib/shape.ts` 不再有模块级 `new WeakSet` / `new WeakMap`（grep 断言见下）
- [ ] 新增 `fromBrep` / `hasBrep` / `brepOf` 并导出
- [ ] `shape.test.ts` 全部通过
- [ ] `runtime.test.ts` 无回归
- [ ] 既有行为不变（`isShape` / `isCompound` / `isCompoundLike` 语义同前）

```bash
# grep 断言：shape.ts 中不应再有模块级身份表
grep -n "new WeakSet\|new WeakMap" src/stdlib/shape.ts
# 期望：无输出
```

> **进入 P2 之前必须停一下**：P2 是本方案面积最大的一期，涉及 18 个文件。开始前先确认 P0/P1 的 typecheck 与测试全绿。

---

## 5. P2：stdlib 去 exec（面积最大，逐文件改）

### 5.1 目标

把 18 个 stdlib 文件的函数签名从 `(…args, exec)` 改成 `(…args)`，函数体从 `exec.xxx` 改成从 `runtime-state` import 的 API。

**完成判据**：`src/stdlib/**` 中 `exec` 作为参数名零残留；所有既有测试通过；编译产物**暂不改动**（P5 才改 compile）。

> ⚠️ **P2 期间编译产物仍在发射 `, exec`**，所以库函数实际收到的最后一个参数还是 `ExecContextImpl`——只是**新签名忽略它**。这是刻意的中间状态：
> 因为 JS 函数调用多传一个实参不会报错，所以 `(…args)` 的签名能正常接收 `(…args, exec)` 的调用。
> **这一步能跑通，正是整个改造可以分期进行的关键。**

### 5.2 改造模式（按 exec 用法分 5 类）

先用这张表定位每个文件属于哪类，再套对应的模式：

| 类 | exec 用法 | 涉及文件 | 改造方式 |
|---|---|---|---|
| **A** | `exec.kernels.occt` / `exec.getSolid` / `exec.setSolid` | primitives, copy, drill, extrude, engrave, split, transform, screw, svgExtrude, text, boolean, geom | `getBackends().kernel.occt` / `brepOf()` / `fromBrep()` |
| **B** | `exec.assets` | asset, load | `getBackends().assets` |
| **C** | `exec.mode` / `exec.events.emit` / `exec.currentStmt` | knurl, sdf | `getBackends().config.mode` / `getBackends().events` / `getCurrentStmt()`（**P4 会删**） |
| **D** | `exec.keep` / `exec.keepHidden` | copy, boolean, compound | `keep()` / `keepHidden()`（import） |
| **E** | `exec.dependentsOf` / `exec.touch` | compound | **P6 才改**，P2 暂时保留（`getCurrentStmt` 同理） |

### 5.3 步骤 1：改造 `resolve-path.ts`（去掉 exec 参数）

**文件**：`src/stdlib/internal/resolve-path.ts`

把 `resolvePath(exec, inputs, brepImpl)` 改为 `resolvePath(inputs, brepImpl)`（exec 从锚点读）。

改前（`:30-49`）：

```ts
export function resolvePath(
  exec: ExecContext,
  inputs: Shape[],
  brepImpl: unknown | undefined,
): 'brep' | 'mesh' {
  if (exec.mode === 'mesh') return 'mesh'
  const currentStmt = (exec as ExecContextImpl).currentStmt

  if (exec.mode === 'brep') {
    if (!brepImpl) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: op has no BREP implementation', currentStmt)
    }
    if (!inputs.every((s) => exec.getSolid(s))) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: input is not BREP', currentStmt)
    }
    return 'brep'
  }

  if (brepImpl && inputs.every((s) => exec.getSolid(s))) return 'brep'
  return 'mesh'
}
```

改后（完整文件）：

```ts
/**
 * stdlib resolvePath — BREP/mesh 路径静态判定（红线保持）
 *
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * BREP 链是否可用，由静态规则在执行前判定，禁止运行时 try-catch 回退。
 * brep 模式下的不支持错误在**调用前**抛出。
 *
 * ⚠️ 本文件在 P4 会被删除，逻辑移到 cad-runtime/backend-dispatch.ts。
 *    P2 阶段只是把 exec 参数改为从 runtime-state 读取，语义逐位不变。
 */

import { getBackends, getCurrentStmt } from '../../runtime-state'
import { BrepUnsupportedError } from '../../cad-runtime/exec-context'
import { brepOf } from '../shape'
import type { Shape } from '../../mesh/types'

export function resolvePath(inputs: Shape[], brepImpl: unknown | undefined): 'brep' | 'mesh' {
  const { config } = getBackends()

  if (config.mode === 'mesh') return 'mesh'
  const currentStmt = getCurrentStmt()

  if (config.mode === 'brep') {
    if (!brepImpl) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: function has no BREP implementation', currentStmt)
    }
    if (!inputs.every((s) => brepOf(s) !== undefined)) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: input is not BREP', currentStmt)
    }
    return 'brep'
  }

  if (brepImpl && inputs.every((s) => brepOf(s) !== undefined)) return 'brep'
  return 'mesh'
}
```

> 注意：`BrepUnsupportedError` 仍从 `exec-context` 导入（P5 才会把它移走）。P2 阶段保持最小改动。

### 5.4 步骤 2：完整范例 —— `copy.ts`（A + D 类）

**这是所有 A 类文件的模板，照着改其余 11 个。**

改前（`src/stdlib/copy.ts` 全文 64 行）关键片段：

```ts
import type { ExecContext } from '../cad-runtime/exec-context'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'

const brepImpl = true

function copyBrep(input: Shape, exec: ExecContext): Shape {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/copy] no OCCT kernel')
  const inputSolid = exec.getSolid(input)
  if (!inputSolid) throw new Error('[stdlib/copy] input is not BREP')

  const copiedSolid = kernel.copy(inputSolid)

  const shape = solid(solidToShape(kernel, copiedSolid))
  exec.setSolid(shape, copiedSolid)
  exec.setFaceEvolution(shape, identityEvolution(kernel, copiedSolid))
  return shape
}

export function copy(input: Shape, exec: ExecContext): Shape {
  if (!input) throw new Error('[stdlib/copy] no input geometry')
  exec.keep(input)
  const path = resolvePath(exec, [input], brepImpl)
  if (path === 'brep') return copyBrep(input, exec)
  return solid({
    positions: new Float32Array(input.positions),
    indices: new Uint32Array(input.indices),
  })
}
```

改后：

```ts
import { getBackends, keep } from '../runtime-state'
import { solid, fromBrep, brepOf } from './shape'
import { resolvePath } from './internal/resolve-path'
import type { OcctKernel } from 'occt-wasm'

const brepImpl = true

function copyBrep(input: Shape): Shape {
  const kernel = getBackends().kernel.occt as OcctKernel | null
  if (!kernel) throw new Error('[stdlib/copy] no OCCT kernel')
  const inputSolid = brepOf(input) as import('occt-wasm').ShapeHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/copy] input is not BREP')

  const copiedSolid = kernel.copy(inputSolid)

  return fromBrep(solidToShape(kernel, copiedSolid), {
    solid: copiedSolid,
    faceEvolution: identityEvolution(kernel, copiedSolid),
  })
}

export function copy(input: Shape): Shape {
  if (!input) throw new Error('[stdlib/copy] no input geometry')
  keep(input)
  const path = resolvePath([input], brepImpl)
  if (path === 'brep') return copyBrep(input)
  return solid({
    positions: new Float32Array(input.positions),
    indices: new Uint32Array(input.indices),
  })
}
```

**逐条对照（改什么、为什么）**：

| 改前 | 改后 | 为什么 |
|---|---|---|
| `import type { ExecContext }` | 删除 | 不再有 exec 参数 |
| —— | `import { getBackends, keep } from '../runtime-state'` | 后端与 keep 从锚点层取 |
| `import { solid } from './shape'` | `import { solid, fromBrep, brepOf } from './shape'` | 用新构造器 |
| `exec.kernels.occt` | `getBackends().kernel.occt as OcctKernel \| null` | 锚点是 `unknown`，需断言（P0 刻意设计） |
| `exec.getSolid(input)` | `brepOf(input)` | 同一件事，入口换了 |
| `solid(mesh)` + `exec.setSolid(...)` + `exec.setFaceEvolution(...)` | `fromBrep(mesh, { solid, faceEvolution })` | 一次登记，库零记账 |
| `exec.keep(input)` | `keep(input)` | 库显式 import 调用 |
| `resolvePath(exec, [input], brepImpl)` | `resolvePath([input], brepImpl)` | exec 参数去掉 |
| `function copyBrep(input, exec)` | `function copyBrep(input)` | 内部函数同理 |

### 5.5 步骤 3：完整范例 —— `geom.ts`（修掉"签名无形"）

`geom.ts` 现在用 `(...rest)` + `rest.pop()` 取 exec，类型系统完全失效。改成有形签名。

改前（`:73-108`）：

```ts
export function faceCenter(...rest: unknown[]): Vec3 {
  const exec = rest.pop() as ExecContext
  const of = rest[0] as Shape
  const anchor = rest[1] as Vec3 | undefined
  const ordinal = rest[2] as number | undefined
  return geomQuery('faceCenter', of, anchor, ordinal, exec)
}
```

改后：

```ts
export function faceCenter(of: Shape, anchor?: Vec3, ordinal?: number): Vec3 {
  return geomQuery('faceCenter', of, anchor, ordinal)
}

export function faceNormal(of: Shape, anchor?: Vec3, ordinal?: number): Vec3 {
  return geomQuery('faceNormal', of, anchor, ordinal)
}

export function bboxCenter(of: Shape): Vec3 {
  return cad.bboxCenter(of)
}

export function bboxMin(of: Shape): Vec3 {
  return cad.boundingBox(of).min
}

export function bboxMax(of: Shape): Vec3 {
  return cad.boundingBox(of).max
}
```

`geomQuery` 内部（`:22-70`）同步改：

```ts
function geomQuery(
  feature: 'faceCenter' | 'faceNormal',
  of: Shape,
  anchor: Vec3 | undefined,
  faceOrdinal: number | undefined,
): Vec3 {
  if (faceOrdinal !== undefined) {
    const solid = brepOf(of)
    const kernel = getBackends().kernel.occt as OcctKernel | null
    if (solid && kernel) {
      try {
        const faces = kernel.getSubShapes(solid as ShapeHandle, 'face')
        // …（其余逻辑逐字不变）
      } catch { /* 降级到 anchor，保持不变 */ }
    }
  }
  // …（兜底路径逐字不变）
}
```

> ⚠️ `geomQuery` 函数体**除了前两行取 solid/kernel 外，其余逐字不动**。catch 降级逻辑是既有行为，不要"顺手优化"。

### 5.6 步骤 4：逐文件改造清单

按此表改造剩余文件。**模式完全同 copy.ts**，只是函数体细节不同。

| 文件 | exec 使用点（行号） | 改造动作 |
|---|---|---|
| `primitives.ts` | `:58` `exec.kernels.occt`；`:63` `exec.setSolid` | `getBackends().kernel.occt`；`primitiveBrep` 末尾改 `fromBrep(...)`（**注意**：`primitiveBrep` 无 faceEvolution，只传 `solid`）；5 个导出函数签名删 exec |
| `drill.ts` | `:133` `:135` `:161`；`:143` `:169` 向下转型取 `partTransform` | 同 A 类；`partTransform` 改 `getBackends().config.partTransform`（**这是消除向下转型的关键**，见下） |
| `extrude.ts` | `:30` `:32` `:45` | 同 A 类 |
| `engrave.ts` | `:96` `:98` `:166` | 同 A 类 |
| `split.ts` | `:58` `:60` `:179` `:180` | 同 A 类（**两处 setSolid**：front / back 各一个） |
| `transform.ts` | `:49` `:51` `:64` `:66` | 同 A 类（有 faceEvolution） |
| `screw.ts` | `:25` `:86` | 同 A 类 |
| `svgExtrude.ts` | `:35` `:44` | 同 A 类 |
| `text.ts` | `:42` `:76` | 同 A 类 |
| `boolean.ts` | `:36` `:39` `:68` `:69`；`:97` `exec.keepHidden` | 同 A 类 + `keepHidden(...inputs)` |
| `geom.ts` | `:31` `:32` | 见 §5.5（签名有形化） |
| `asset.ts` | `:14` `:15` `:17` `exec.assets` | `getBackends().assets`；签名删 exec |
| `load.ts` | `:31` `:32` `:38` `:40` `:42` `exec.assets` | `getBackends().assets` |
| `knurl.ts` | `:27` `exec.mode`；`:28` `exec.events.emit`；`:29` `exec.currentStmt` | `getBackends().config.mode` / `getBackends().events` / `getCurrentStmt()`（**P4 会删除整段 emit**） |
| `sdf.ts` | `:27` `:28` `:29` | 同 knurl.ts |
| `compound.ts` | `:202` `:227` `:233`（A 类）；`:263` `exec.currentStmt`（E 类） | A 类照改；**`:237` `dependentsOf`、`:242/246` `touch`、`:263` currentStmt 留到 P6** |
| `copy.ts` | 见 §5.4 | 已完成（作为模板） |

**`drill.ts` 的向下转型（重点，这是 F1 的核心病灶）**：

改前（`:143`）：
```ts
const partTransform = (exec as ExecContextImpl).brepChain.partTransform
```

改后：
```ts
const partTransform = getBackends().config.partTransform
```

> 两处都要改（`:143` BREP 路径、`:169` mesh 路径）。
> 改完后 `drill.ts` 不应再有 `as ExecContextImpl`。

**`compound.ts` 的 P2 临时状态**（E 类留到 P6）：

P2 阶段 `dependentsOf` / `touch` / `currentStmt` 无法直接替换（它们依赖 `ScriptIR` 与 `outputCache`，属于引擎内部）。处理方式：

```ts
// P2 临时保留：直接 import ExecContextImpl 的类型并接收 exec 参数
// ⚠️ 这是刻意的临时状态，P6 会整体重写（求解 ≠ 传播）
import type { ExecContext } from '../cad-runtime/exec-context'

export function assembly(params: AssemblyParams, exec: ExecContext): CompoundShape {
```

即：**P2 不动 compound.ts 的 assembly / group / solveAssembly**，留到 P6 整体重写。这样避免改两遍。

### 5.7 步骤 5：更新 `stdlib/index.ts` 的注释

`src/stdlib/index.ts` 头部注释里写了"末参 exec 形态"，改为：

```
 * 导出全部官方库函数、Shape 构造器。
 * 库函数签名 = .faijs 源码里的调用形态（无隐式参数）；
 * 后端资源经 getBackends() 获取，保留声明经 keep() 表达。
```

导出列表**不变**（导出的还是那 18 个函数，只是签名少了 exec 参数）。

### 5.8 验证

```bash
npm run typecheck
npx vitest run src/cad-runtime/runtime.test.ts
npx vitest run src/cad-runtime/keep.test.ts
npx vitest run src/cad-runtime/execute-code.test.ts
npx vitest run src/lang/compile.test.ts
```

**关键回归点**：`runtime.test.ts` 覆盖 BREP/mesh 双链路与 STEP 导出，是本期的核心验证。

### 5.9 完成判据

```bash
# 断言 1：除 compound.ts（P6 处理）外，stdlib 不再 import exec-context
grep -rn "exec-context" src/stdlib/*.ts
# 期望：只有 compound.ts 命中（P6 处理），其余无

# 断言 2：除 compound.ts 外，函数签名中无 exec 参数
grep -rn "exec: ExecContext\|, exec)" src/stdlib/*.ts
# 期望：只有 compound.ts 命中

# 断言 3：无向下转型
grep -rn "as ExecContextImpl" src/stdlib/*.ts
# 期望：无输出

# 断言 4：setSolid 记账样板清零（compound.ts 除外，P6 处理）
grep -rn "exec.setSolid\|exec.setFaceEvolution" src/stdlib/*.ts
# 期望：只有 compound.ts 命中
```

- [ ] 4 条 grep 断言全部符合预期
- [ ] typecheck 无新增错误
- [ ] `runtime.test.ts` / `keep.test.ts` / `execute-code.test.ts` / `compile.test.ts` 全部通过
- [ ] `compound.ts` 保持 P2 前状态（未改动，等 P6）

> **如果某个测试挂了**：先确认是"签名改错了"还是"语义变了"。
> 语义变化的典型信号：`hasBrep` 判定与 `getSolid` 不一致——检查 `fromBrep` 是否漏传了 `solid`（P1 的槽登记路径）。

---

## 6. P3：keep 入口改接（引擎侧装配）

### 6.1 目标

把 `keep()` 的落地目标从"`ExecContextImpl.onKeep` 回调"改为"`runtime-state` 的 `setKeepSink`"，并把 `exec.currentStmt = source` 改成 `setCurrentStmt(source)`。

**语义逐位不变**——`keep.test.ts` 的全部用例必须原样通过。这一期只是把"挂在 exec 上的机制"改挂到锚点层，为 P5 删除 exec 铺路。

### 6.2 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/cad-runtime/module-executor.ts` | 修改 | 用 `setCurrentStmt` 替代 `exec.currentStmt` |
| `src/cad-runtime/runtime.ts` | 修改 | 装配 `setKeepSink`；不再传 `onKeep` |
| `src/runtime-state.ts` | 不改 | P0 已完成 |

### 6.3 操作步骤

#### 步骤 1：`module-executor.ts`

定位 `executeIds`（`:129-153`），改这一行：

```ts
// 改前（:140）
exec.currentStmt = source

// 改后
setCurrentStmt(source)
```

在文件顶部 import 区（`:14-23`）新增：

```ts
import { setCurrentStmt, setName } from '../runtime-state'
```

同时把 `afterStatement`（`:267-287`）里的 `exec.shapeToName.set(v, asPartName(w))` 改为：

```ts
// 改前（:275）
exec.shapeToName.set(v, asPartName(w))

// 改后
setName(v, asPartName(w))
```

> ⚠️ 注意：`exec.shapeToName` 与 `runtime-state` 的 `shapeToName` 在 P3 期间是**两个不同的 WeakMap**！
> `ExecContext.shapeToName` 仍被 `exec.registerKeep` 使用，而新的 `keep()` 用 runtime-state 的。
> 这会导致 P3 期间 **keep 失效**（库调 `keep()` → 写 runtime-state → 但 terminal-dag 读的是 `internalKeep`，实际仍通 registerKeep... ）

> 🛑 **停！这里有个必须理清的顺序问题**，见 §6.4。

#### 步骤 2：`runtime.ts` 装配 keepSink

定位 `createExecContext`（`:513-550`），把 `onKeep` 参数改为装配全局 sink：

```ts
// 改前（:536-538）
// keep-syntax §2.2：函数体 exec.keep/keepHidden → ModuleExecutor.internalKeep
// （按语句持久；语句重执行前清空本条，缓存命中保留上轮记录）
onKeep: (stmtId, names, hidden) => this.executor.registerKeep(stmtId, names, hidden),

// 改后（放在 new ExecContextImpl({...}) 之前）
setKeepSink((stmtId, names, hidden) =>
  this.executor.registerKeep(stmtId as StmtId, names, hidden),
)
```

并在 `runtime.ts` 顶部 import 区新增：

```ts
import { setKeepSink, setCurrentStmt, setName, configureBackends } from '../runtime-state'
```

### 6.4 ⚠️ P3 的正确顺序（必须严格遵守，否则会掉进双 WeakMap 陷阱）

P2 之后，库函数调的是 runtime-state 的 `keep()`，它读 runtime-state 的 `shapeToName`。
但 `runtime.ts:543-548` 预填的是 `exec.shapeToName`（ExecContext 的那个），`module-executor.ts:275` 写入的也是 `exec.shapeToName`。

**如果只改一半，两个 WeakMap 不一致，`keep()` 会查不到名字而静默丢弃**（`registerKeep` 里 `names.length === 0` 就 return，不报错——这是最危险的失败模式）。

**所以 P3 必须一次性完成这三处切换**：

| # | 位置 | 改前 | 改后 |
|---|---|---|---|
| 1 | `module-executor.ts:275` | `exec.shapeToName.set(...)` | `setName(...)` |
| 2 | `module-executor.ts:140` | `exec.currentStmt = source` | `setCurrentStmt(source)` |
| 3 | `runtime.ts:543-548` | `exec.shapeToName.set(...)` | `setName(...)` |

三处改完后，`ExecContextImpl.shapeToName` 与 `ExecContextImpl.currentStmt` 将**不再被写入**。
此时 `exec.keep()` 就失效了——这没关系，因为 P2 后已经没有任何库函数调用 `exec.keep()`。

> 验证这一点：`grep -rn "exec.keep\|exec.keepHidden" src/stdlib/` 应无输出（compound.ts 除外，它 P6 处理）。

### 6.5 验证

```bash
npm run typecheck
npx vitest run src/cad-runtime/keep.test.ts
```

`keep.test.ts` 是本期的**唯一权威验证**，它覆盖了 keep 的全部回归锚点：

| 用例 | 覆盖 |
|---|---|
| `union(a,b)` → a、b 终端且 hidden | C1 函数体 keepHidden |
| `group({members})` → 成员终端且可见 | C1 函数体 keep |
| `copy(a)` → a 终端可见 | C1 函数体 keep |
| `drill(c,{keep:['c']})` → c 终端 | C0 调用点覆盖 |
| `{keepHidden:true}` → hidden | 调用点 hidden |
| `mech.measure(a)` → a 不消费 | C3 运行时判据 |
| 缓存命中时保留结论一致 | internalKeep 持久 |

**全部必须 passed**。任何一个挂了，按 §12 排错表定位。

### 6.6 完成判据

- [ ] `keep.test.ts` 全部通过（7 类锚点）
- [ ] `grep -rn "exec.shapeToName" src/cad-runtime/` 无输出
- [ ] `grep -rn "exec.currentStmt =" src/cad-runtime/` 无输出
- [ ] `grep -rn "exec.keep" src/stdlib/` 无输出（compound.ts 除外）
- [ ] typecheck 无新增错误

---

## 7. P4：分派与事件归属收归引擎

### 7.1 目标

① `resolvePath` 从 `stdlib/internal/` 移到 `cad-runtime/backend-dispatch.ts`（语义不变）；
② `knurl` / `sdf` 的 `part-brep-lost` 事件改为**引擎统一发**（F1：库不再读 `currentStmt`）。

**完成判据**：`part-brep-lost` 事件行为不变；`knurl.ts` / `sdf.ts` 中零 `events.emit` 与 `currentStmt`。

### 7.2 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/cad-runtime/backend-dispatch.ts` | **新增** | 分派函数（从 resolve-path.ts 迁来） |
| `src/stdlib/internal/resolve-path.ts` | **删除** | 逻辑已迁走 |
| `src/stdlib/knurl.ts` | 修改 | 删除 emit 段 |
| `src/stdlib/sdf.ts` | 修改 | 删除 emit 段 |
| `src/cad-runtime/module-executor.ts` | 修改 | 执行后判定并发事件 |
| `src/cad-runtime/runtime.ts` | 修改 | 提供 events sink |

### 7.3 操作步骤

#### 步骤 1：新建 `src/cad-runtime/backend-dispatch.ts`

```ts
/**
 * backend-dispatch — BREP/mesh 路径静态判定（引擎侧）
 *
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P4
 *
 * 红线（AGENTS.md）：BREP 链是否可用，由静态规则在执行前判定，
 * **禁止运行时 try-catch 回退**。BREP 路径抛异常 = 设计缺陷或 bug，必须直接报错暴露。
 *
 * 本文件从 src/stdlib/internal/resolve-path.ts 迁移而来：判定是引擎的职责，
 * 不该由每个库函数各自调用。
 */

import { getBackends, getCurrentStmt } from '../runtime-state'
import { hasBrep } from '../stdlib/shape'
import type { Shape } from '../mesh/types'

/** BREP 强制模式下不支持的错误。 */
export class BrepUnsupportedError extends Error {
  readonly stmt?: unknown
  constructor(message: string, stmt?: unknown) {
    super(message)
    this.name = 'BrepUnsupportedError'
    this.stmt = stmt
  }
}

/**
 * 判定本次调用走 BREP 还是 mesh。
 *
 * 规则（与迁移前逐字一致）：
 * 1. mode='mesh' → mesh
 * 2. mode='brep' → 无 brepImpl 则抛错；有 brepImpl 但输入不全在链也抛错
 * 3. mode='auto' → 有 brepImpl 且全部输入在链 → brep；否则 mesh
 */
export function dispatchPath(
  inputs: Shape[],
  brepImpl: unknown | undefined,
): 'brep' | 'mesh' {
  const { config } = getBackends()

  if (config.mode === 'mesh') return 'mesh'
  const currentStmt = getCurrentStmt()

  if (config.mode === 'brep') {
    if (!brepImpl) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: function has no BREP implementation', currentStmt)
    }
    if (!inputs.every(hasBrep)) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: input is not BREP', currentStmt)
    }
    return 'brep'
  }

  if (brepImpl && inputs.every(hasBrep)) return 'brep'
  return 'mesh'
}
```

#### 步骤 2：删除 `resolve-path.ts`，更新所有调用点

```bash
rm src/stdlib/internal/resolve-path.ts
```

然后**逐个替换**（每个用到 resolvePath 的文件）：

```ts
// 改前
import { resolvePath } from './internal/resolve-path'
const path = resolvePath([input], brepImpl)

// 改后
import { dispatchPath } from '../cad-runtime/backend-dispatch'
const path = dispatchPath([input], brepImpl)
```

涉及文件（12 个）：primitives, copy, drill, extrude, engrave, split, transform, screw, svgExtrude, text, boolean, load。

> ⚠️ **这会造成 stdlib → cad-runtime 的依赖方向**（§2.1 红线）。
> 但 `backend-dispatch.ts` 只依赖 `runtime-state`、`stdlib/shape`、`mesh/types`——**它不依赖 cad-runtime 的任何其他文件**，所以不会形成真正的循环（cad-runtime/internal-stdlib → stdlib → cad-runtime/backend-dispatch，而 backend-dispatch 不 import internal-stdlib）。
> **这是可接受的局部例外**，注释里必须写明理由。

在 `backend-dispatch.ts` 头部注释补一句：

```
 * ⚠️ 分层例外：本文件位于 cad-runtime/ 但被 stdlib/ import。
 * 这是安全的——它只依赖 runtime-state / stdlib/shape / mesh/types，
 * 不依赖 cad-runtime 的任何其他模块，因此不构成循环。
 * P4b（可选）把函数拆成 brep/mesh 双实现后，此依赖会自然消失。
```

#### 步骤 3：删除 knurl / sdf 的事件发射

`knurl.ts:27-31` 改前：

```ts
if (exec.mode === 'auto') {
  exec.events.emit('part-brep-lost', {
    partName: asPartName(exec.currentStmt?.outputs[0] ?? ''),
    op: 'knurl',
    reason: '...',
  })
}
```

**整段删除**。`sdf.ts:27-31` 同理。

#### 步骤 4：引擎统一发事件

在 `module-executor.ts` 的 `afterStatement`（`:267-287`）末尾追加判定：

```ts
// 引擎统一发 part-brep-lost（F1：库不再读 currentStmt / 不再 emit）
// 语义：上游在 BREP 链上，但本语句产物不在链上 → BREP 链在此断开
this.emitBrepLost(compiled.id, source)
```

新增私有方法（放在 `ModuleExecutor` 类内）：

```ts
/**
 * 判定并发 part-brep-lost 事件。
 *
 * 判据：语句有几何输入且**全部**输入都在 BREP 链上，但输出**不在**链上
 * → BREP 链在此断开（mesh-only 函数或 fallthrough）。
 */
private emitBrepLost(id: StmtId, source: StatementIR | undefined): void {
  if (!source || source.inputs.length === 0) return
  const sink = getBackends().events as EventSink | undefined
  if (!sink) return

  const inputsOnChain = source.inputs
    .map((n) => this.ctx[String(n)])
    .filter((v): v is Shape => !!v && typeof v === 'object')
  if (inputsOnChain.length === 0) return
  if (!inputsOnChain.every(hasBrep)) return          // 上游本就不在链上 → 非断开

  const out = this.ctx[this.metaById.get(id)?.writes[0] ?? '']
  if (out && typeof out === 'object' && hasBrep(out as Shape)) return   // 输出仍在链上

  sink.emit('part-brep-lost', {
    partName: asPartName(String(source.outputs[0] ?? '')),
    op: source.callee,
    reason: `${source.callee} has no BREP implementation`,
  })
}
```

需要 import：`getBackends`、`hasBrep`、`EventSink`（类型）、`asPartName`。

### 7.4 验证

```bash
npm run typecheck
npx vitest run src/cad-runtime/runtime.test.ts
npx vitest run src/cad-runtime/keep.test.ts
```

在 `runtime.test.ts` 中补一个用例（**新增测试**）：

```ts
it('part-brep-lost 由引擎发出（knurl 后）', async () => {
  const events: Array<{ partName: string; op: string }> = []
  const rt = createRuntime({ ..., events: { emit: (_, d) => events.push(d) } })
  await rt.executeCode(`
    let part0 = cad.box({ size: 20 })
    let part1 = cad.knurl(part0, { depth: 0.5 })
  `)
  expect(events.some((e) => e.op === 'knurl')).toBe(true)
})
```

### 7.5 完成判据

- [ ] `src/cad-runtime/backend-dispatch.ts` 已创建，`resolve-path.ts` 已删除
- [ ] `grep -rn "resolvePath" src/` 无输出
- [ ] `grep -rn "events.emit\|currentStmt" src/stdlib/` 无输出
- [ ] 新增的 `part-brep-lost` 用例通过
- [ ] `runtime.test.ts` / `keep.test.ts` 无回归

### 7.6 P4b（可选，可推迟）

设计文档 §7.3 提到的"能力是函数自带的接口契约、分派统一由引擎做"，完整形态是把每个双链路**函数**拆成 `xMesh` / `xBrep` 两个实现，能力声明挂在**函数定义处**。

**本手册将 P4b 列为可推迟项**：P4a 已达成"判定逻辑归引擎"的实质目标（库不再实现判定，只调用）。P4b 主要是消除 §7.3 步骤 2 的分层例外，价值次之、风险更高（12 个文件结构改动）。

> ⚠️ **用户裁定（红线，旧稿错误已删除）**：引擎**绝不依赖函数名**。旧稿在此写过一张 `Record<string, boolean>` 的"能力声明表"（`BREP_CAPABLE: { box: true, … }`）——那是引擎**反向依赖 op/函数名字**，绝对不允许存在，本版已删除。能力声明是**接口契约**：函数在**定义处**把自己的能力作为数据挂到函数对象上，引擎只读函数对象上的数据（K5：函数信息只能是均匀数据），**不查任何名字表**。**不存在"内置函数"这一类别**：faijs 自带标准库与第三方库的函数同为库函数，引擎一视同仁。

若执行 P4b，每个双链路函数在**定义处**声明能力（库侧代码，纯数据，无任何名字匹配）：

```ts
// src/stdlib/primitives.ts（库侧：能力 = 函数对象上的数据）
import { dual } from '../runtime-state'    // 纯打包工具：零几何知识、零名字匹配

/**
 * dual(meshImpl, brepImpl?)
 * 打包两条实现并挂能力数据；brepImpl 缺省 = mesh-only。
 * 返回的仍是一个普通函数——引擎对它一无所知，只会在调用时读 fn.brepImpl。
 */
export const box = dual(boxMesh, boxBrep)      // 双链路：mesh + brep
export const sphere = dual(sphereMesh, sphereBrep)
export const cylinder = dual(cylinderMesh, cylinderBrep)
export const knurl = dual(knurlMesh)           // 只实现 mesh
export const sdf = dual(sdfMesh)               // 只实现 mesh
```

引擎侧分派（P4 的 `dispatchPath`）读 `fn.brepImpl !== undefined`，**不存在任何按名字查的表**；`dual()` 不认识 `box`/`knurl`，引擎同样不认识。

---

## 8. P5：compile + module-executor 去 exec（**本方案的核心目标达成**）

### 8.1 目标

编译产物从 `async (ctx, cad, exec) => {}` 变成 `async (ctx, ns) => {}`，**删除全部 `, exec` 发射**。
同时删除 `src/cad-runtime/exec-context.ts`（269 行）。

**完成判据**：编译产物逐字断言无 `exec`；`ExecContext` 在 `src/` 下零残留。

### 8.2 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/lang/compile.ts` | 修改 | 4 处发射点去 `, exec`；fn 签名改 `(ctx, ns)` |
| `src/cad-runtime/module-executor.ts` | 修改 | `fn(ctx, cad, exec)` → `fn(ctx, ns)` |
| `src/cad-runtime/runtime.ts` | 修改 | 删除 `createExecContext`；改为 `configureBackends` |
| `src/cad-runtime/exec-context.ts` | **删除** | 整个文件 |
| `src/cad-runtime/internal-stdlib.ts` | 修改 | 装配 namespaces |
| `src/lang/compile.test.ts` | 修改 | 更新逐字断言 |

### 8.3 操作步骤

#### 步骤 1：`compile.ts` —— 四个发射点

`buildStatementFnBody`（`:158-197`），逐处改：

```ts
// ① 解构赋值（:178）
// 改前
`      const { ${keys} } = await cad.${stmt.callee}(${callArgs}, exec)`
// 改后
`      const { ${keys} } = await ns.cad.${stmt.callee}(${callArgs})`

// ② 成员调用（:187）
// 改前
return `      await ctx.${stmt.receiver}.${stmt.callee}(${mArgs}exec)`
// 改后
return `      await ctx.${stmt.receiver}.${stmt.callee}(${mArgs})`

// ③ 无赋值调用（:192）
// 改前
return `      await cad.${stmt.callee}(${callArgs}, exec)`
// 改后
return `      await ns.cad.${stmt.callee}(${callArgs})`

// ④ 普通赋值（:196）
// 改前
return `      ctx.${stmt.outputs[0]} = await cad.${stmt.callee}(${callArgs}, exec)`
// 改后
return `      ctx.${stmt.outputs[0]} = await ns.cad.${stmt.callee}(${callArgs})`
```

`translateCallRef`（`:81-85`，嵌套调用）：

```ts
// 改前
return `await cad.${callee}(${inner}, exec)`
// 改后
return `await ns.cad.${callee}(${inner})`
```

`compileToModule` 的 fn 签名（`:250`）：

```ts
// 改前
bodyLines.push(`    fn: async (ctx, cad, exec) => {`)
// 改后
bodyLines.push(`    fn: async (ctx, ns) => {`)
```

> ⚠️ P5 只处理 `cad` 命名空间（其它库的 `ns.<binding>` 留给 P7）。
> 所以发射时统一写 `ns.cad.<callee>`，P7 再按 `stmt.namespace` 分派。

#### 步骤 2：`module-executor.ts`

`CompiledStatement` 接口（`:28-32`）：

```ts
// 改前
fn: (ctx: Record<string, unknown>, cad: StdlibNamespace, exec: ExecContextImpl) => Promise<void>
// 改后
fn: (ctx: Record<string, unknown>, ns: Namespaces) => Promise<void>
```

新增类型：

```ts
/** 已装配的命名空间集合（标准库 `cad` + 宿主注册的库）。 */
export interface Namespaces {
  readonly cad: StdlibNamespace
  readonly [binding: string]: StdlibNamespace
}
```

`executeIds` 的调用点（`:146`）：

```ts
// 改前
await compiled.fn(this.ctx, this.cad, exec)
// 改后
await compiled.fn(this.ctx, this.namespaces)
```

构造函数与字段（`:65-96`）：

```ts
// 改前
private readonly cad: StdlibNamespace
constructor(cad: StdlibNamespace, options?: ModuleExecutorOptions) {
  this.cad = cad
  // …

// 改后
private readonly namespaces: Namespaces
constructor(namespaces: Namespaces, options?: ModuleExecutorOptions) {
  this.namespaces = namespaces
  // …
```

`executeAll` / `executeIds` / `executeFrom` 的 `exec: ExecContextImpl` 参数**保留**（P5 只删 exec 向库函数的传递，不删执行上下文的其他用途：`beforeStatement`、`getSolid` 顶替释放、`setSolid` 同步等）。

> ⚠️ `ModuleExecutorOptions` 里的 `getSolid` / `setSolid` / `releaseHandle` 等回调**保留不动**——它们是 ModuleExecutor ↔ CadRuntime 之间的内部契约，与"库函数拿不拿 exec"无关。

#### 步骤 3：`internal-stdlib.ts` —— 装配 namespaces

```ts
/** 装配命名空间集合（标准库 cad + 宿主注册的库）。 */
export function createNamespaces(
  libs?: Record<string, StdlibNamespace>,
): Namespaces {
  return { ...(libs ?? {}), cad: createInternalStdlib() }
}
```

`createInternalStdlib()` 的导出列表**不变**。

> 注意 `cad` 放在展开之后——防止第三方库用 `cad` 作为绑定名覆盖标准库命名空间。

#### 步骤 4：`runtime.ts` —— 删除 `createExecContext`，改为 `configureBackends`

删除 `createExecContext`（`:513-550`）整个方法。在 `CadRuntime` 构造或首次执行前装配 backends：

```ts
configureBackends({
  contractVersion: CONTRACT_VERSION,
  config: { mode: this.mode, partTransform: /* 从 brepChain 取 */ },
  kernel: {
    get occt() { return brepChain.kernel },      // getter：异步就绪后可读到
    get csg() { return ports.csg },
    get sdf() { return ports.sdf },
  },
  fonts: ports.fonts,
  texture: ports.texture,
  assets: ports.assets,
  events: ports.events,
  cad: createInternalStdlib(),
})
setKeepSink((stmtId, names, hidden) =>
  this.executor.registerKeep(stmtId as StmtId, names, hidden),
)
```

> ⚠️ `config` 与 `kernel` 必须是**可变对象 + getter**（P0 已设计）：
> `this.mode` 和 `brepChain.kernel` 会在运行期变化，闭包读的是引用而非快照。

`collectResult`（`:606+`）中用到 `exec` 字段的地方，改用 CadRuntime 自己的字段或 runtime-state 的 API：

| 改前 | 改后 |
|---|---|
| `exec.outputCache` | CadRuntime 内持有 `outputCache`（把 `createExecContext` 里的构造逻辑移出来） |
| `exec.brepChain` | 直接用 `brepChain`（方法参数已有） |
| `exec.touchedShapes` | `getRuntimeState().touchedShapes`（P6 后删除） |
| `exec.shapeToName.get(shape)` | `nameOf(shape)` |

#### 步骤 5：删除 `exec-context.ts`

```bash
rm src/cad-runtime/exec-context.ts
```

同步删除所有 import（主要在 `runtime.ts:40`、`module-executor.ts:23`、各 stdlib 文件）。

> `BrepUnsupportedError` 已迁到 `backend-dispatch.ts`（P4），所以删除是安全的。
> 若还有残留引用，typecheck 会报出来——**逐个修，不要用 `any` 掩盖**。

#### 步骤 6：更新 `compile.test.ts` 的逐字断言

`src/lang/compile.test.ts` 里有编译产物的逐字断言，全部更新：

```ts
// 改前
expect(code).toContain(`ctx.part0 = await cad.box({ size: 20 }, exec)`)
// 改后
expect(code).toContain(`ctx.part0 = await ns.cad.box({ size: 20 })`)
```

### 8.4 验证

```bash
npm run typecheck
npx vitest run src/lang/compile.test.ts
npx vitest run src/cad-runtime/runtime.test.ts
npx vitest run src/cad-runtime/keep.test.ts
npx vitest run src/cad-runtime/execute-code.test.ts
npx vitest run src/cad-runtime/terminal-dag.test.ts
```

> 一个测试文件一个测试文件地跑，**不要一次喂多个**，不要跑全量。

### 8.5 完成判据（**本方案的核心目标**）

```bash
# 断言 1：编译产物无 exec
grep -rn ", exec" src/lang/compile.ts     # 期望：无输出

# 断言 2：ExecContext 零残留
grep -rn "ExecContext" src/               # 期望：无输出

# 断言 3：exec-context.ts 已删除
ls src/cad-runtime/exec-context.ts        # 期望：No such file

# 断言 4：编译产物 fn 签名（最直接的端到端确认）
npx tsx -e "
import { parseScript } from './src/lang/parser'
import { compileToModule } from './src/lang/compile'
const r = parseScript('let part0 = cad.box({ size: 20 })')
console.log(compileToModule(r.script).code)
"
```

断言 4 的期望输出：

```
export const statements = [
  { id: 's1', deps: [],
    fn: async (ctx, ns) => {
      ctx.part0 = await ns.cad.box({ size: 20 })
    } },
]
```

**必须同时满足**：①含 `fn: async (ctx, ns) => {` ②含 `await ns.cad.box({ size: 20 })` ③**不含** `, exec`。

- [ ] 4 条断言全部符合
- [ ] 5 个测试文件分批全部通过
- [ ] `npm run lint` 无错

> 🎯 **到此，本方案的核心目标达成**：库函数签名 = 源码里写的样子，无隐式注入。
> 后续 P6/P7 是独立增量，可以暂停交付。

---

## 9. P6：装配重做（求解 ≠ 传播）—— **语义变化，专项验证**

### 9.1 目标

`do_assemble` 从"原地改写整条下游链"改为"库只求解，引擎让下游失效并重算"。
同时删除 `deriveMemberNames`（读 IR）、`dependentsOf`、`touch`。

**完成判据**：装配 + 下游 drill + STEP 导出测试通过；`do_assemble` 幂等。

> ⚠️ 这一期**有真实语义变化**，必须与 P2–P5 的机械改造分开做、单独验证。
> 两个预期变化：①`do_assemble` 变幂等（原来执行两次会叠加变换）②下游 BREP 句柄与 mesh 同步（原来只改 mesh，导致 solid 与 mesh 失配）。

### 9.2 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/stdlib/compound.ts` | **重写** | 求解与传播分离 |
| `src/cad-runtime/module-executor.ts` | 修改 | 装配后标记下游 stale |
| `src/cad-runtime/runtime.ts` | 修改 | 删除 `touchedShapes` 用法，改由引擎算 changed |
| `src/runtime-state.ts` | 修改 | 删除 `touchedShapes` |

### 9.3 操作步骤

#### 步骤 1：重写 `compound.ts`

**核心原则**：库只做求解，产出**新 Shape**，不原地改写、不传播。

```ts
import { keep } from '../runtime-state'
import { compound as makeCompound, ensureSlot, nameOfShapes } from './shape'

export function group(params: GroupParams): CompoundShape {
  const members = (params.members as Shape[] | undefined) ?? []
  keep(...members)                       // ← 成员名由此反查，替代 deriveMemberNames
  const c = makeCompound(members)
  ensureSlot(c).behavior = {
    memberNames: nameOfShapes(members),
    constraints: [],
    solve: () => [],
  }
  return c
}

export function assembly(params: AssemblyParams): CompoundShape {
  const members = (params.members as Shape[] | undefined) ?? []
  const constraints = (params.constraints as AssemblyConstraint[] | undefined) ?? []
  keep(...members)

  const c = makeCompound(members)
  const behavior: AssemblyBehavior = {
    name: params.name as string | undefined,
    memberNames: nameOfShapes(members),
    constraints,
    /** 只求解：返回"成员下标 → 变换"的列表。不改写入参、不传播。 */
    solve: () => solveTransforms(members, behavior),
  }
  ensureSlot(c).behavior = behavior
  return c
}

/** 纯求解：给定位姿 → 变换列表。不修改任何输入，可重复调用。 */
function solveTransforms(members: Shape[], behavior: AssemblyBehavior) {
  // 复用现有 solveFaceMate（compound.ts:136-153）的纯计算部分
}
```

`do_assemble` 保持挂载（编译产物 `ctx.asm1.do_assemble()`），但**方法体只求解**：

```ts
(c as CompoundShape & { do_assemble?: () => void }).do_assemble = () => {
  // 只求解；下游由引擎按 DAG 失效重算（F2：库不查询/修改 DAG）
  const transforms = behavior.solve()
  if (transforms.length > 0) setPendingAssemblyTransforms(c, transforms)
}
```

> `nameOfShapes` 是 P1 里 `nameOf` 的批量版，若 P1 未加则在 P6 补上：
> ```ts
> export function nameOfShapes(shapes: Shape[]): string[] {
>   return shapes.map((s) => String(nameOf(s) ?? ''))
> }
> ```

#### 步骤 2：引擎侧应用变换 + 失效下游

在 `runtime-state.ts` 增加：

```ts
export interface AssemblyTransform { index: number; /* … */ }
let pendingTransforms: WeakMap<object, AssemblyTransform[]> | undefined

export function setPendingAssemblyTransforms(c: object, ts: AssemblyTransform[]): void { /* … */ }
export function takePendingAssemblyTransforms(c: object): AssemblyTransform[] { /* 取走并清空 */ }
```

在 `module-executor.ts` 的 `afterStatement` 中：

```ts
// 装配语句执行后：取待应用变换 → 应用到成员 → 标记下游 stale → 重算
const pending = takePendingAssemblyTransforms(compoundValue)
if (pending.length > 0) {
  applyToMembers(children, pending)                  // 引擎改 ctx 中的成员 Shape
  const stale = this.computeDownstream(memberNames)  // 引擎用 DAG 算（替代 exec.dependentsOf）
  await this.executeFrom(stale, exec)
}
```

`computeDownstream` 用 ModuleExecutor 已有的 `metaById` / `deps` 图——**不需要新的图算法**，`executeFrom`（`:159-175`）本就按 deps 拓扑重放。

#### 步骤 3：删除 `touchedShapes`

`ExecutionResult.changed` 改由 `afterStatement` 比对旧值推导（引擎侧）：

```ts
// afterStatement 中，写 ctx 之前记录旧值，写后比对
const before = this.ctx[w]
// … 执行 …
if (before !== this.ctx[w]) changedNames.add(asPartName(w))
```

### 9.4 验证（**专项，一次一个 spec**）

```bash
npx vitest run <装配相关测试文件>
```

新增用例（4 个）：

```ts
it('do_assemble 幂等：执行两次 = 执行一次', async () => { /* … */ })
it('装配后下游 drill 的 mesh 与 BREP 句柄同步', async () => { /* … */ })
it('装配 + STEP 导出', async () => { /* … */ })
it('ExecutionResult.compounds 仍产出成员名（替代 deriveMemberNames）', async () => { /* … */ })
```

### 9.5 完成判据

- [ ] `compound.ts` 中零 `Object.assign` 原地改写、零 `dependentsOf`、零 `touch`、零 `currentStmt`
- [ ] `deriveMemberNames` 已删除
- [ ] `do_assemble` 幂等用例通过
- [ ] 装配 + 下游 + STEP 测试通过
- [ ] `ExecutionResult.compounds` 仍正确（3d_editor 建树依赖它）
- [ ] `grep -rn "touchedShapes" src/` 无输出

---

## 10. P7：第三方库通道

### 10.1 目标

让普通 npm 包（如 `mech-lib`）能被 `.faijs` import 并调用。

**完成判据**：`import * as mech from 'mech-lib'` + `mech.makeHeadstock(...)` 端到端跑通。

### 10.2 前置依赖

P7 依赖 parser 支持顶层 `import` 与命名空间调用，属于 `docs/plans/2026-08-29-faijs-normal-js-subset.md` 的 P2/P3。**先做那边，再做 P7。**

### 10.3 操作步骤

#### 步骤 1：宿主装配 namespaces

```ts
const mod = await import(/* @vite-ignore */ resolvedUrl)
if (mod.contractVersion !== CONTRACT_VERSION) throw new Error('版本不匹配')
runtime.registerLib('mech', mod)
```

`CadRuntime.registerLib(binding, ns)`：

```ts
registerLib(binding: string, ns: StdlibNamespace): void {
  this.libs[binding] = ns
  this.executor.setNamespaces(createNamespaces(this.libs))
}
```

#### 步骤 2：compile 按 namespace 发射

```ts
// namespace === 'cad' 或 undefined → ns.cad；否则 → ns.<binding>
const nsExpr = `ns.${stmt.namespace ?? 'cad'}`
return `      ctx.${out} = await ${nsExpr}.${stmt.callee}(${callArgs})`
```

#### 步骤 3：statementKey 加包名前缀（**必须做**）

`module-executor.ts` 的 `computeKey`（`:294-307`）：

```ts
// 改前
const parts = [source.callee]
// 改后
const parts = [`${source.namespace ?? 'cad'}.${source.callee}`]
```

> ⚠️ **不改会静默产错几何**：`cad.chamfer` 与 `mech-lib.chamfer` 的 key 碰撞，
> 导致改了第三方库的参数却不重算。这是既有修正 C2。

#### 步骤 4：单例去重与版本校验

- 预构建 bundle 时 `external: ['@faicad/faijs']`（roadmap §5.2）
- CDN 用 `?external=@faicad/faijs`
- 兜底：P0 的 `getRuntimeState()` 全局锚点保证两份 faijs 共享状态
- 加载时校验 `CONTRACT_VERSION`，不兼容即抛错（**不静默降级**）

### 10.4 验证

用本地 mock 模块模拟 `mech-lib`（**不依赖真实 npm 包**），可用 `data:` URL / Blob URL 构造临时模块。

### 10.5 完成判据

- [ ] `statementKey` 含包名前缀（回归锚点：`cad.chamfer` ≠ `mech-lib.chamfer`）
- [ ] 标准库与第三方库函数产物可混合 `union`（同为库函数）
- [ ] 两份 faijs 加载 → Shape 身份互通
- [ ] 版本不匹配 → 抛错

---

## 11. 验证命令速查

| 期 | 必跑测试（逐个跑） | grep 断言（期望无输出） |
|---|---|---|
| P0 | `src/runtime-state.test.ts` | —— |
| P1 | `src/stdlib/shape.test.ts`、`src/cad-runtime/runtime.test.ts` | `grep -n "new WeakSet\|new WeakMap" src/stdlib/shape.ts` |
| P2 | `runtime.test.ts`、`keep.test.ts`、`execute-code.test.ts`、`compile.test.ts` | `grep -rn "as ExecContextImpl" src/stdlib/` |
| P3 | `keep.test.ts` | `grep -rn "exec.shapeToName\|exec.currentStmt =" src/cad-runtime/` |
| P4 | `runtime.test.ts`、`keep.test.ts` | `grep -rn "resolvePath" src/`；`grep -rn "currentStmt" src/stdlib/` |
| P5 | `compile.test.ts`、`runtime.test.ts`、`keep.test.ts`、`execute-code.test.ts`、`terminal-dag.test.ts` | `grep -rn "ExecContext" src/` |
| P6 | 装配相关测试 | `grep -rn "touchedShapes\|deriveMemberNames\|dependentsOf" src/` |
| P7 | `test/faijs/third-party.test.ts` | —— |

每期都要跑：`npm run typecheck` 与 `npm run lint`。

---

## 12. 排错指南

| 症状 | 最可能的原因 | 排查 |
|---|---|---|
| **`keep` 不生效但不报错** | 双 WeakMap 陷阱：`shapeToName` 只改了一处 | 检查 P3 §6.4 的三处是否**全部**改完；`nameOf(shape)` 返回 undefined 即中招 |
| `getBackends()` 抛 "backends not configured" | `configureBackends` 未调用或时机太晚 | 必须在 `CadRuntime` 构造时调用，不能等到 `execute` |
| BREP 产物被判为 mesh（`hasBrep` false） | `fromBrep` 漏传 `solid`，或仍用 `solid()` | 检查 P2 每个 BREP 分支 |
| `mode='brep'` 下报 "input is not BREP" | 上游没走 BREP 路径 | **整条链**每个函数都要改成 `fromBrep` 登记 |
| typecheck 报循环依赖 | 把 `Backends`/`keep` 放到了 `cad-runtime/` 下 | 必须放 `src/runtime-state.ts`（§2.1 依赖方向红线） |
| 编译产物仍有 `, exec` | `compile.ts` 4 个发射点漏改 | `grep -rn ", exec" src/lang/compile.ts` |
| `part-brep-lost` 不再触发 | P4 步骤 4 判定条件写错 | 检查"输入全在链 && 输出不在链" |
| 装配行为变化导致测试挂 | P6 语义变化（**预期内**） | 对照 §9.1 的两个变化点；**不要改测试断言掩盖** |
| OCCT 句柄泄漏 | `fromBrep` 后引擎未接管释放 | 检查 `module-executor.ts:137-151` 顶替释放仍生效 |

**通用诊断**（看编译产物最快）：

```bash
npx tsx -e "
import { parseScript } from './src/lang/parser'
import { compileToModule } from './src/lang/compile'
const r = parseScript('let part0 = cad.box({ size: 20 })')
console.log(compileToModule(r.script).code)
"
```

---

## 13. 全部完成后的总检查

```bash
# 1. 核心目标：无隐式注入
grep -rn ", exec" src/lang/compile.ts              # 无输出
grep -rn "ExecContext" src/                         # 无输出

# 2. 无向下转型（F1）
grep -rn "as ExecContextImpl" src/                  # 无输出

# 3. 库不读引擎内部（F1）
grep -rn "currentStmt" src/stdlib/                  # 无输出
grep -rn "dependentsOf\|\.touch(" src/stdlib/       # 无输出

# 4. 库零记账（契约面 B）
grep -rn "setSolid\|setFaceEvolution" src/stdlib/   # 无输出

# 5. 库不 emit 事件（F1）
grep -rn "events.emit" src/stdlib/                  # 无输出

# 6. 废弃方案零残留
grep -rn "install(deps)\|OpManifest\|OpDeclaration" src/   # 无输出
```

| 目标 | 验证方式 |
|---|---|
| 库函数签名 = 源码形态 | `compileToModule` 产物逐字比对（§8.5 断言 4） |
| 库零隐式依赖 | stdlib 只 import `runtime-state` 与 `./shape` |
| 第三方库 = 普通 npm 包 | P7 端到端 |
| keep 语义不变 | `keep.test.ts` 全部锚点 |
| compound 无特例 | `compound.ts` 只用 `keep()`，无 compound 专属规则 |

