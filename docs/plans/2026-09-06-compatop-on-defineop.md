# compatOp 收敛到 defineOp 单一入口（v1）：保留 keep / capabilities / outputs，桥接之外零自创

> 状态：已落地（2026-09-06 实施 PR 完成：§9 命名、§3 compat 收敛、§6 测试、§7 实施步骤、文档同步；Agent Note：`.agents/notes/implemented/architecture/2026-09-06-compat-op-shell-on-define-op.md`）
> 日期：2026-09-06
> 关联：docs/plans/2026-09-03-faijs-brepjs-compat-api.md（现状实现来源）；docs/api-contract.md §7.7–7.8（实施后需同步）

---

## 0. 用户原始要求（原话，需求基线，不准删改）

> 「compatOp它是与 defineOp 平行的第二个实现入口？？这个怎么可能有第二入口？？这只能有一个入口。compatOp 必须兼容defineOp ，给我写一份技术实现文档。defineOp 支持的keep，capabilities，outputs等都必须保留。除了桥接必须的部分，不准自己加其他的东西。比如什么consume，完全是乱来。」

> 「consume刚刚被删除了。这就是compatOp乱来的证据。明明之前约定的是keep/keepHidden的接口。」

需求基线的可执行拆解：

1. **单一入口**：compatOp 不得是与 defineOp 平行的第二个实现路径，必须建立在 defineOp 之上（compatOp 兼容 defineOp）。
2. **保留 keep**：被包装的 brepjs 函数必须像 defineOp 的 op 一样支持函数体 `keep` / `keepHidden` 声明（约定接口是 keep/keepHidden）。
3. **保留 capabilities**：compatOp 的 spec 必须支持 `capabilities` 并透传生效。
4. **保留 outputs**：compatOp 的 spec 必须支持 `outputs`（多产物）并透传生效。
5. **桥接必须之外不准自创**：只保留 brepjs 桥接必须的部分（借入/调用/收养），其余机制一律复用 defineOp；禁止任何自创接口（如 consume 类消费接口）。
6. **产出技术实现文档**（本文档）。

---

## 1. 现状问题定义

### 1.1 现状：compatOp 是平行实现，不是 defineOp 之上的壳

`packages/core/src/api/internal/compat-op.ts` 当前自己实现六步契约：参数透传 → 自调 `dispatchPath` 分派 → `borrowDeep` 借入 → `callBrepjs` 调用 → `unwrapResult` 解包 → `adoptEntity` 收养 → 自己 `Object.defineProperty` 挂 `DUAL_OP_META`。

它没有调用 defineOp，也没有复用 defineOp 的以下机制（这正是"平行入口"的证据）：

| defineOp 机制 | compatOp 现状 | 后果 |
|---|---|---|
| `capabilities` 能力路由（D5） | spec 无此字段，`dispatchPath` 恒传 `undefined` | 库无法声明能力，缺能力不报错 |
| `outputs` 多产物声明 | 用自创的 `geometryFields` 字段收养 | 与 defineOp 契约命名分叉，元数据不带 outputs |
| 函数体 `keep` / `keepHidden` | 无任何文档化承诺与测试 | 库作者不敢在 brepjs 函数体内用 keep |
| `DUAL_OP_META` 挂载 | 自己挂 `{kind, brep, schema}`，缺 name/capabilities/outputs | `assertLibConforms` 对 compatOp 产物的校验面小于 defineOp |
| 分派 | 自己调 `dispatchPath(shapes, {brep: impl}, undefined)` | 与 defineOp 的分派逻辑重复维护 |

### 1.2 事实核实：keep 的语义——shape 在 UI 层的显示约定（核心）

**keep / keepHidden 的本质是「shape 是否显示在 UI 层」的核心约定**，不是消费判定机制。消费判定（terminal-dag C0/C1/C3/C5）只是该约定的实现手段。契约出处：`docs/api-contract.md` §6（保留声明、优先级与静态校验）与 Surface C（`keep = keep and render`；`keepHidden = keep but do not render on canvas`）。

两面声明与优先级（用户裁决，与 api-contract §6「priority call site > function body」一致）：

| 声明面 | 作者 | 时机 | 优先级 |
|---|---|---|---|
| 调用点声明 | 用户 / UI / AI（脚本语句 `{keep, keepHidden}`） | 静态（脚本录制期） | 最高 |
| 函数体声明 | 库作者（函数体内 `keep()`/`keepHidden()`） | 运行时（执行期） | 被调用点覆盖 |

- 运行时语义：函数体声明先铺底（登记 `ModuleExecutor.internalKeep`，C1），调用点声明覆盖写入（`lang/keep.ts` `resolveKeep`——「先铺函数体声明，再用调用点覆盖写入」）；`keep` = 保持终端且渲染，`keepHidden` = 保持终端但 canvas 不渲染（`api/boolean.ts` 注释：布尔输入保留但隐藏，只有结果显示）。
- 代码证据：`runtime-state.ts:391/400` 导出 `keep`/`keepHidden`；`api/boolean.ts` 的 `union`/`subtract`/`intersect` 函数体内 `keepHidden(...shapes)` + `capabilities: ['evolution']`。
- **结论**：keep 不是 defineOp 的选项字段，而是**贯穿所有 op（含 compatOp 包装函数）的 UI 层显示契约**：任何在 ModuleExecutor 执行上下文内运行的函数都可以作为「库作者」一方使用函数体声明，调用点声明随时可覆盖。compatOp 的职责是保证这层契约完整穿透——**不拦截、不重写、不另起炉灶**。

### 1.3 事实核实：consume

当前代码库 grep `consume`：无独立 consume 接口。`terminal-dag.ts` 的 `consumes()` 是 keep-syntax 的消费判定实现（判定某语句是否消费某变量，C0/C1/C3/C5），vendored brepjs 内部有 `consumed` 注释（曲线释放），均非对外接口。

**红线**：本项目对外约定只有 `keep` / `keepHidden`。任何"consume 类"自创接口（无论命名 consume / keepConsumed / consumeShapes）一律禁止，方案以测试断言防回归。

### 1.4 consume 删除审计（2026-09-06 工作区核查）

**被删除的对象**：`ConsumeSpec = 'all' | 'none' | number[]`（op 静态消费声明，源起 2026-09-01-layered-api §D2）。

**代码层——已彻底删除（未提交 diff 实据，5 个文件）**：

| 文件 | 删除内容 |
|---|---|
| `api/internal/compat-op.ts` | `ConsumeSpec` import；spec 字段 `consumes?`；meta 挂载 `consumes: spec.consumes ?? 'all'` |
| `define-op.ts` | `ConsumeSpec` 类型定义；`DualOpOptions.consumes` / `DualOpMeta.consumes`；meta 装配 `consumes: decl.consumes`；`isValidConsumeSpec` 校验 |
| `cad-runtime/runtime.ts` | `opConsumes` 注入分支（`fnWithMeta[DUAL_OP_META]?.consumes`，原 C2） |
| `cad-runtime/terminal-dag.ts` | `DagRuntimeView.opConsumes` 字段；`consumes()` 内 C2 判定分支（`declared = view?.opConsumes?.(stmt)`） |
| `sdk.ts` | `ConsumeSpec` 导出 |

全仓 `packages` grep `ConsumeSpec|opConsumes|DUAL_OP_META.consumes|.consumes` = **0 命中**。保留的 `consumes()`（terminal-dag.ts）是 keep 驱动判定（api-contract §6.1），非 ConsumeSpec，保留正确。

**文档层——（5 份残留，plans是历史文档，不改）**：
忽略这个小节

| 文档 | 残留位置 |  |
|---|---|---|
| `docs/plans/2026-09-01-layered-api-architecture.md` | §4.2/§4.3（consumes 设计源头） | 段落标注「已废弃（2026-09-06 移除）」+ 替代 = keep/keepHidden |
| `docs/plans/2026-09-02-faijs-api-surface-completion.md` | `consumes:'none'`（查询 op）多处 | 同上 |
| `docs/plans/2026-09-03-faijs-brepjs-compat-api.md` | §4.3 `compatOp(…, { name:'fuse', consumes:'all' })` | compatOp spec 示例改为无 consumes |
| `docs/plans/2026-09-06-dual-channel-shape-survival.md`（未跟踪） | §2.2/§2.3 把 `opConsumes`/`DUAL_OP_META.consumes` 当现状描述 | 现状段改为「C0/C1/C3/C5 无 C2」，删 opConsumes 行 |
| `docs/plans/2026-09-06-no-ir-dual-channel-runtime.md`（未跟踪） | §4.3 `OpRecord.consumes: string[]` | OpRecord 的消费记录字段与 keep 的关系重新设计或标注废弃 |

**consume 错误设计的根源**（审计结论）：设计者把「keep 是 shape 在 UI 层的显示契约（调用点 > 函数体）」误读为「运行时调用负担」，试图用 op 静态元数据替代它（`2026-09-01-layered-api-architecture.md` §4.3「这替代现在 stdlib 函数体的 keep() 调用」），于是：① 在既有 keep 语义之外发明第三套平行消费声明；② 把判定链污染出 C0/C2/C3/C5 与 C0/C1/C3/C5 的编号冲突（dual-channel 文档自认）；③ compatOp 被要求发明 `spec.consumes`（09-03 §4.3），成为「compatOp 乱来」的书面证据；④ 五处代码侵入 + 五份文档扩散，删除成本极高。

**其他遗留错误设计**：① 上述 5 份文档残留；② 两份未跟踪新文档中的 `OpRecorder`/`OpRecord`（Proxy 包装 `ctx.cad` 记录执行时消费，`consumes: string[]`）是 consume 思想的运行时变体——未实施，属文档层遗留设想，需按「无 IR 双通道」主线重新评估或标注废弃；③ `compat-op.ts` 的 `collectShapes` 深遍历（原用于分派）是重复实现而非自创接口，分派交 defineOp 后删除（见 §3.3）。

### 1.5 现状事实：`positional` 双义性（同名撞车，2026-09-06 代码核查）

代码库中 `positional` 一词承载两个完全不同的含义（另有一个相近概念 `ArgSpec.params`），同一行 `box(10, 20, 30)` 的执行同时涉及两者：

| # | 层 | 位置 | 类型 | 语义 | 消费者 |
|---|---|---|---|---|---|
| ① | 语句层 | `lang/types.ts:137` `StatementIR.positional` | `ArgIR[]` | **值**：这一行传了哪些位置实参（`box(10,20,30)` → `[10,20,30]`） | codegen.ts:235；runtime.ts:812/836/1279（增量 key）；module-executor.ts:641；keep.ts:92；code-to-args.ts:86/146（3d_editor） |
| ② | op 契约层 | `define-op.ts:96/115` `DualOpOptions.positional` / `DualOpMeta.positional` | `PositionalForm`（dual-form-args.ts:206） | **装箱翻译表**：每个位置槽对应哪个对象键（`{ keys:['width','depth','height'] }`） | define-op.ts:246 `positionalToObject`（分派前 位置→对象） |
| ③ | 投影侧（相近，不叫 positional） | `dual-form-args.ts:33` `ArgSpec.params` | `string[]` | **参数名表**：对象键按顺序映射回位置数组 | `resolveArgs`（对象→位置，compat-projection.ts:80；方向与②相反） |

撞车后果：任何检索/讨论"positional"都会同时命中①②两层；`stmt.positional`（值数组）与 `meta.positional`（装箱声明）字段名同型，阅读与工具链（grep）无法仅凭名字区分。用户裁决：「不同含义的positional名字要区分开」——重构方案见 §9。

---

## 2. 设计目标与红线

### 2.1 目标

把 compatOp 重构为 **defineOp 之上的薄壳 + brepjs 桥接适配器**：

```
compatOp(fn, spec)
  = defineOp({
      brep: adapter(fn, spec),        // 桥接必须：borrow → call → unwrap → adopt
      name: spec.name,                // 透传
      capabilities: spec.capabilities, // 透传
      outputs: spec.outputs,          // 透传（唯一多产物契约名，见 §3.6）
      schema: spec.schema,            // 透传
    })
```

defineOp 统一承担：分派（`dispatchPath` + 能力路由）、Result 边界（`runImpl` + `unwrapResult`）、产物包装（`wrapBrepOne`/`wrapByKeys`）、`DUAL_OP_META` 挂载、`assertLibConforms` 校验。compatOp 只做两件事：**spec 透传**（组合接口继承，§3.1）+ **adapter 构造**（brepjs 桥接）。

### 2.2 红线

1. 单一入口：compatOp 内部必须调用 defineOp；禁止自行分派、自行挂元数据、自行包装产物。
2. keep/keepHidden 是 shape 在 UI 层显示的唯一核心约定（调用点声明最高、函数体声明被覆盖）：compatOp 不得实现/发明任何 keep 之外的显示/消费接口（consume 类一律禁止）。
3. 保留项：`name` / `capabilities` / `outputs` / `schema` 全部透传进 defineOp 的声明。
4. 桥接必须项（只允许这些出现在 compatOp 自己的代码里）：
   - 输入借入：faijs Shape → brepjs ShapeHandle（`borrowDeep` + `createBorrowedHandle`，零拷贝）
   - 调用：`callBrepjs`
   - 产物收养：`adoptEntity`（`unregisterFromCleanup` + `fromHandle`；R1：不注销 finalizer 会 double-dispose）
   - `segments` 透传（裁决 1：三角化密度）
5. 不改动 defineOp 的既有对外契约；若需扩展，必须走方案评审（见 §6.5 决策记录）。
6. **`positional` 命名区分**（§1.5/§9）：语句层 `StatementIR.positional`（位置实参**值**）与 op 契约层 `PositionalForm`（装箱**声明**）不得同名；op 层按 §9 更名 `slotMap`；compatOp 收敛方案（§3.1）若透传该声明，必须使用 `slotMap` 命名，禁止引入第三处 `positional`。

---

## 3. 详细设计

### 3.1 compatOp 新签名与 spec（组合接口，不手写复制）

**为什么是组合接口**（用户裁决）：手写复制 `DualOpOptions` 的字段必然偏差——① 会漏字段（现状手写版就漏了 `positional`/`slotMap`）；② 类型不一致（`name` 可选项 vs 必填项）；③ defineOp 增删字段时 compatOp 不会自动同步。组合式 `extends Omit<DualOpOptions, …>` 使 compatOp 的 spec 成为 defineOp spec 的**子类型**——defineOp 加字段自动继承，无需人工复制。

```ts
import type { DualOpOptions } from '../../define-op'

/**
 * compatOp's static spec — 组合自 defineOp 的 DualOpOptions（自动同步），
 * 仅声明桥接必需项。defineOp 增删选项字段 → 本接口自动跟随。
 */
export interface CompatSpec extends Omit<DualOpOptions, 'mesh' | 'brep'> {
  /** 桥接必需（错误信息 + admitCompatLib 成员名）；DualOpOptions.name 可选，此处收紧为必填。 */
  name: string
}
```

**零自创字段**（用户裁决：「文档化的也是错误的文档化。根本不是保留的理由」）：`CompatSpec` 不声明任何 `DualOpOptions` 之外的字段——`geometryFields` 已全仓删除（§3.6），多产物契约名只有 `outputs` 一个。唯一例外是 `name` 的类型收紧（继承字段，非新增字段）。

继承关系（自动同步的字段）：`capabilities` / `outputs` / `schema` / `positional`（§9 改名后为 `slotMap`）。`DualOpOptions` 的字段即 compatOp 可透传的字段全集——**compatOp 不拥有自己的选项字段集**。未来 defineOp 扩展（如 R6 的 `collectInputs`）不经任何改动即被 compatOp 继承（是否透传生效由 §6.5 决策记录判定）。

透传映射（compatOp 主函数）：

```ts
return defineOp({
  brep: buildAdapter(fn, spec),
  name: spec.name,               // 透传（必填收紧）
  capabilities: spec.capabilities,
  outputs: spec.outputs,         // 唯一多产物契约名（§3.6：geometryFields 已删除）
  schema: spec.schema,
  positional: spec.positional,   // 透传（§9 后为 slotMap；组合接口自动带出，不手写）
})
```

**同步保证（测试级）**：单测断言 `CompatSpec` 的可选字段集合 == `Omit<DualOpOptions, 'mesh'|'brep'>` 的可选字段集合（TS 编译期即可保证继承；运行时测试再断言 compatOp 产物 `DUAL_OP_META` 字段集合 == defineOp 产物字段集合，防自创字段回归，§6.1-1）。

### 3.2 adapter：桥接必须的三步（唯一留在 compatOp 内的执行逻辑）

```ts
function buildAdapter(fn: (...args: unknown[]) => unknown, spec: CompatSpec) {
  return async (...args: unknown[]): Promise<BrepProduct> => {
    // ① 输入借入（桥接必须）：深遍历，faijs Shape → createBorrowedHandle 视图
    const borrowed = args.map((a) => borrowDeep(a, 0))
    // ② 调用 + Result 解包（桥接必须：adopt 需要 ok 值）
    const value = unwrapOrThrow(callBrepjs(fn as never, borrowed), spec.name)
    // ③ 输出收养（桥接必须：unregister finalizer + fromHandle；segments 透传）
    return adoptOut(value, spec, readSegmentsFromArgs(args))
  }
}
```

要点：

- **返回值已是 faijs Shape / Record<string, Shape>**（`adoptEntity` 产物）。defineOp 的 `wrapBrepOne` 对 `isShape(v)` 直接透传，`wrapByKeys` 对已是 Shape 的值透传——**无二次包装**。
- **unwrap 的两次出现是无害的**：adapter 内一次（adopt 前必须），defineOp `runImpl` 再调 `unwrapResult` 一次（`unwrapResult` 对非 Result 值原样返回，`result-unwrap.ts`）。共享同一叶子，无语义分叉。
- `outputs` 场景：adapter 按 `outputs` 逐字段 `adoptEntity` → `Record<string, Shape>`；defineOp 的 `wrapByKeys` 透传。

### 3.3 compatOp 主函数：只剩 spec 归一 + 调 defineOp

```ts
export function compatOp(fn, spec): ((...args: unknown[]) => Promise<Shape>) & MetaCarrier {
  const outputs = spec.outputs
  return defineOp({
    brep: buildAdapter(fn, spec),
    name: spec.name,
    capabilities: spec.capabilities,
    outputs,                       // 无多产物时不传（与 defineOp 单产物返回一致）
    schema: spec.schema,
    positional: spec.positional,   // 组合接口自动带出（§9 后为 slotMap），透传不手写
  })
}
```

删除项（现状 compatOp 自做、改后归 defineOp）：

| 删除/移交 | 归属 |
|---|---|
| `dispatchPath` 自调（分派门） | defineOp 的 wrapped 统一分派（含能力路由） |
| `Object.defineProperty(DUAL_OP_META)` | defineOp 统一挂载（meta 现含 name/capabilities/outputs/schema） |
| `collectShapes` 深遍历收集（用于分派） | 移除；分派输入收集用 defineOp 的一层 `filter(isGeometryInput)`（兼容性分析见 §5.2） |
| 产物包装（wrapBrepOne 等价逻辑） | defineOp 的 wrap 路径（对已收养 Shape 透传） |
| spec 校验（构造期） | defineOp 构造期校验 + `assertLibConforms` 装配期校验 |

保留项（桥接必须，见红线 4）：`borrowDeep`、`callBrepjs` 使用、`unwrapOrThrow`（叶子复用）、`adoptOut`/`adoptEntity`/`readSegmentsFromArgs`。

### 3.4 keep / keepHidden 保留（shape 的 UI 层显示约定，零代码）

- **语义**：keep 是 shape 是否显示在 UI 层的核心约定，两面声明：
  - **调用点声明（用户/UI/AI，静态脚本录制期，最高）**：脚本面 `cad.<op>(a, b, {keep: [a], keepHidden: true})`——编译层剥离该键（`withoutKeepDirectives`），运行时覆盖函数体声明，UI 层按调用点显示。
  - **函数体声明（库作者，运行时执行期，被调用点覆盖）**：被包装的 brepjs 函数体内直接调用 `keep(...)`/`keepHidden(...)`（从 `@faicad/faijs` 导入），与 defineOp 的 op（boolean.ts 的 union/subtract/intersect）完全同一机制：登记 `ModuleExecutor.internalKeep`（C1）→ `resolveKeep` 先铺函数体、调用点覆盖写入 → `terminal-dag` 消费判定 → 终端且非 hidden 者进 UI 层渲染。
- **compatOp 的职责 = 保证契约穿透，不破坏**：不拦截函数体内的 keep 调用、不解析、不重写；编译层剥离、运行时合并、UI 层消费全部由既有管线处理（`lang/keep.ts` / `runtime.ts` / `terminal-dag.ts`）。compatOp 自始至终不感知 keep 的存在——这正是「除了桥接必须的部分，不加其他东西」。
- **禁止**：任何「consume」替代接口。库作者表达「保留并显示 / 保留并隐藏」只用 `keep`/`keepHidden`；脚本面同理。
- 第三方库作者手册（`docs/library-dev-guide.md`）补充：brepjs 形态函数体内同样可使用 `keep`/`keepHidden`（作为「库作者」一方的函数体声明，调用点可覆盖），示例见 §6.2。

### 3.5 capabilities 生效路径

`spec.capabilities` → `defineOp decl.capabilities` → defineOp 的 wrapped 计算 `missing = meta.capabilities.find(!config.brepCapabilities[cap])` → `dispatchPath(inputs, meta, missing)`：

- brep 模式缺能力 → `E_BREP_UNSUPPORTED`（显式报错，不静默回退）
- auto 模式缺能力 → 无 mesh 可降（brep-only）→ `E_MESH_UNSUPPORTED`

与 defineOp 的 op（boolean.ts `capabilities: ['evolution']`）完全同一行为。现状 compatOp 无此能力，属于**补齐**，非回归。

### 3.6 outputs 统一，geometryFields 全仓删除

**用户裁决（原话）**：

> 「为什么不直接用outputs，为什么要加不兼容的东西」

> 「文档化的也是错误的文档化。根本不是保留的理由」

**结论**：多产物契约名**只有 `outputs` 一个**。`geometryFields`（裸函数静态属性标注，曾文档化于 `library-dev-guide.md` §3 双语 + `api-contract.md` 六步契约第 5 步）**全仓删除**——文档化是错误设计的扩散，不是保留的理由（与 consume 同一条教训，§1.4）。

**删除后的契约**：

| 面 | 契约 |
|---|---|
| defineOp / compatOp spec | `outputs?: string[]`（唯一多产物声明） |
| 第三方库裸函数标注 | `fn.outputs = [...]`（库作者在函数对象上贴的静态属性，admission 读取） |
| admitCompatLib | 读 `fn.outputs` → 传 `outputs`（不再识别 `fn.geometryFields`） |
| adapter 收养 | 按 `spec.outputs` 逐字段 `adoptEntity` |
| DUAL_OP_META | `outputs` 可见（与 defineOp 完全同一字段） |

**清理清单（实施 PR 内，plans 历史文档不改——§1.4 用户裁决）**：

| 位置 | 清理动作 |
|---|---|
| `packages/gear-lib-demo` | `planetary.geometryFields = [...]` → `planetary.outputs = [...]`（in-repo 样例库迁移） |
| `docs/library-dev-guide.md` + `.zh.md` | §3 整节重写：`geometryFields` → `fn.outputs`；**新增「返回结构三分类契约」**（带 `__occtWasm` 标记的对象 = 几何句柄走 `fromHandle`；number = branded id 走 `fromHandle`；不带标记的 plain object = 纯数据记录透传进值存储，绝不三角化）；示例同步 |
| `docs/api-contract.md` + `.zh.md` | **§7.8 清理**：compatOp 机制（薄壳/三步桥接/spec 透传）是内部实现，从契约文档移除——只保留一句行为说明「裸库函数经 `registerLib(…,{compat:true})` 的 admission 提升为 op，细节见 library-dev-guide 与代码注释」；§7.7 的 Result 边界提及保留为行为说明（非接口） |
| `api/internal/compat-op.ts` | `CompatSpec` 删 `geometryFields`；`adoptOut` 用 `spec.outputs` |
| `cad-runtime/admit-compat-lib.ts` | 删 `GeometryFieldsCarrier`；读 `fn.outputs` |
| 全仓 grep 守卫 | `geometryFields` = 0 命中（docs/plans 历史除外，按 §1.4 不改） |

**文档归属原则（用户裁决，防再犯）**：契约文档只写"库作者 / 宿主必须遵守的规则"，不写"引擎如何实现"。compatOp / admitCompatLib 的**实现细节**（薄壳、adapter 三步、spec 透传）归代码注释与 plans；**行为契约**（`fn.outputs` 标注、返回结构三分类、keep 穿透、compat 提升的入口形态）归 library-dev-guide（库作者手册）。api-contract.md 的 §7.8 机制描述是历史遗留（把实现当契约写），与 geometryFields 文档化同类错误，清理之。

**语义对照**：defineOp `outputs` = "实现返回记录，包装器按 keys 包装产物"；compatOp 侧同一 keys 先被 adapter 逐字段收养（brepjs 句柄 → faijs Shape），再由 defineOp 透传包装。**对外契约一致**：返回 `Record<string, Shape>`，且 `DUAL_OP_META.outputs` 可见。无任何第二名字。

### 3.7 admitCompatLib 调整

```ts
type OutputsCarrier = { outputs?: string[] }

export function admitCompatLib(ns) {
  assertLibConforms(ns)                                  // 顺序不变（R8：先校验后包装）
  for (const [name, v] of Object.entries(ns)) {
    if (typeof v !== 'function') continue
    if (v[DUAL_OP_META]) continue                        // 原生 dual-op 透传
    out[name] = compatOp(v, {
      name,
      outputs: (v as OutputsCarrier).outputs,            // 只认 fn.outputs；fn.geometryFields 已删除（§3.6）
    })
  }
}
```

行为不变：裸 brepjs 函数自动提升；已带 `DUAL_OP_META` 的（含 defineOp 产物）原样透传。唯一变化：多产物标注键名统一为 `fn.outputs`（`fn.geometryFields` 不再识别，全仓 grep 守卫归零）。

---

## 4. 行为变化清单（可追溯）

| # | 变化 | 方向 | 影响面 |
|---|---|---|---|
| 1 | compatOp 产物 `DUAL_OP_META` 现含 `name`/`capabilities`/`outputs`（原仅 kind/brep/schema） | 增强 | `assertLibConforms` 校验面与 defineOp 对齐；`op-set-consistency.test.ts` 若按 meta 字段断言需同步 |
| 2 | `capabilities` 生效（原恒 undefined） | 增强 | 声明能力的库在缺能力引擎上显式报错（brep：`E_BREP_UNSUPPORTED`；auto：`E_MESH_UNSUPPORTED`） |
| 3 | `outputs` 进 meta 且双路径生效（adapter 收养 + defineOp 包装）；**`geometryFields` 全仓删除**（库标注统一 `fn.outputs`，§3.6） | 增强/清理 | 多产物函数（planetary 类）迁移 `fn.outputs` 后返回契约不变；grep `geometryFields` 归零 |
| 4 | keep/keepHidden 的 UI 层显示约定（函数体声明 + 调用点覆盖）文档化承诺 + 测试覆盖 | 增强 | 库作者可用函数体 keep（此前可用但未承诺） |
| 5 | 分派输入收集：深遍历 `collectShapes` → defineOp 一层 `filter(isGeometryInput)` | 行为等价 | 见 §5.2 兼容性分析 |
| 6 | 链外输入报错码：`E_BREP_ONLY_INPUT`（借入时）→ `E_BREP_UNSUPPORTED`（分派时） | 更早暴露 | 语义更准，属改进 |
| 7 | compatOp 不再自挂 meta / 自调分派 | 结构 | 对外无感知 |

---

## 5. 兼容性分析

### 5.1 现有 compatOp 调用点

- `api/generated/operations.ts` / `sketching.ts` / `topology.ts`：`compatOp(projectBrepOp(...), { name })`——spec 只含 name，不受影响（outputs/capabilities 缺省）。
- `api-namespace.ts` / `api/index.ts`：脚本面 op 同款，不受影响。
- `admitCompatLib`：第三方库（gear-lib-demo）裸函数自动提升；多产物标注键统一 `fn.outputs`（`planetary.geometryFields` → `planetary.outputs` 迁移，`compat-e2e/gear-lib-demo-flow.test.ts` 回归）。
- `surface-mechanism.test.ts` / `op-set-consistency.test.ts`：回归范围。

### 5.2 输入收集差异（深遍历 → 一层 filter）

- defineOp 的分派输入收集为 `callArgs.filter(isGeometryInput)`（`isShape` ∨ `isMeshShape`）。
- 现有 brepjs 投影 op 的几何输入全部位于**顶层位置参数**（`fuse(a,b)`、`extrude(face,h)`、`drill(shape,opts)`），一层 filter 与深遍历收集结果一致。
- 对 brep-only op，分派结果整体不受收集方式影响（无 mesh 可降；mesh 模式必抛 `E_MESH_UNSUPPORTED`；brep 模式必走 brep）。
- 唯一差异：若某库函数把几何 Shape 放进 options 对象深层（罕见），一层 filter 漏收 → 判定链上 → adapter 借入时 `borrowBrepjsShape` 抛 `E_BREP_ONLY_INPUT`；深遍历则会在分派层抛 `E_BREP_UNSUPPORTED`。两者都报错，新行为在分派层更早暴露、语义更准，**不算回归**。
- 若未来确实出现"几何藏对象"的库形态，走 §6.5 决策记录扩 defineOp（如可选 `collectInputs` 声明），不在本方案内自行加料。

### 5.3 错误码与失败语义

- `OpError`（unwrapResult 抛）→ 引擎语句级 catch → `ExecutionResult.failedAt`，与现状一致。
- `BrepUnsupportedError` / `MeshUnsupportedError` 由 defineOp 的 `runImpl` 原样重抛（`instanceof` 识别），与现状一致。
- 存量 `.fai.js` 零修改。

---

## 6. 测试计划

### 6.1 单测（packages/core/src/api/internal/compat-op.test.ts，新建）

1. **单一入口断言**：compatOp 产物是 defineOp 产物形态——`DUAL_OP_META.kind === 'dual-op'`、字段集合 == defineOp 产物字段集合（不含任何额外自创字段，防 consume 回归）。
2. **dispatchPath 矩阵**：compatOp 产物 × `{mesh, brep, auto}` × `{链上/链下输入}`，行为与 defineOp brep-only 完全一致（mesh→`E_MESH_UNSUPPORTED`；brep 链外→`E_BREP_UNSUPPORTED`；auto 链外→`E_MESH_UNSUPPORTED`）。
3. **capabilities**：`capabilities: ['evolution']` + 缺能力引擎 → brep 模式 `E_BREP_UNSUPPORTED`、auto 模式 `E_MESH_UNSUPPORTED`；与 `boolean.ts` 的 union 对照。
4. **outputs 多产物**：返回 `{sun, planets, ring}` 句柄记录 + `outputs` 声明 → 三字段各自收养为 faijs Shape，`DUAL_OP_META.outputs` 可见；**`geometryFields` 不识别**（admitCompatLib 只读 `fn.outputs`；`fn.geometryFields` 标注被忽略——全仓 grep 守卫断言该名字归零）。
5. **函数体声明（库作者，C1 兼容）**：被包函数体内 `exec.keep(members)` / `exec.keepHidden(inputs)` → 成员保持终端且可见/隐藏（UI 层显示契约生效）；仿 `keep.test.ts` 的第三方用例，断言与 defineOp 的 op 行为一致。
6. **调用点声明覆盖函数体（用户胜，D1）**：脚本面 `cad.<compatOp>(a, b, {keep: [a]})` / `keepHidden: true` → 编译层剥离、运行时覆盖函数体声明（仿 `keep.test.ts`「优先级：调用点 keepHidden 覆盖函数体 exec.keep（用户胜，D1）」），UI 层按调用点显示。

### 6.2 集成回归

- `packages/tests/faijs/compat-e2e/gear-lib-demo-flow.test.ts`（planetary `fn.outputs` 路径，含迁移后回归）
- `surface-mechanism.test.ts`、`op-set-consistency.test.ts`、`runtime.test.ts`（keep 相关用例）
- `npm run test --workspaces` 全量 + `scripts/ci.ps1`

### 6.3 文档同步（实施 PR 内）

- `docs/api-contract.md` §7.8（双语）：**清理 compatOp 机制描述**（内部实现不写契约文档）——压缩为「库接纳（compat: true）」行为说明；§7.7 的 Result 边界提及改为中性措辞（§3.6 文档归属原则）。**已实施。**
- `docs/library-dev-guide.md`（双语）：**全文重构为 faijs 库开发者视角**（用户裁决：主体讲"作为 faijs 库的开发者应该知道的内容"，brepjs 移植只放末尾一小节）——新结构：§1 faijs 库是什么（三面）→ §2 编写库（Result 语义 / 返回三分类契约 / defineOp 双路径与 keep / 裸函数 fn.outputs / solidOf / 硬约束）→ §3 .fai.js 测试 → §4 脚本面调用矩阵 → §5 移植已有 brepjs 库（压缩小节）。brepjs 桥接概念（borrow / adopt / finalizer）全部移出主体。**已实施。**
- `docs/ops-api-inventory.md`（双语）："定义了 `compatOp` / `defineOp` 的分派规则" → "定义了 op 与库函数的分派规则"。**已实施。**
- `packages/gear-lib-demo`：`planetary.geometryFields` → `planetary.outputs`。

---

## 7. 实施步骤

| 步骤 | 内容 |
|---|---|
| P1 | 重写 `compat-op.ts`：新 spec（+capabilities/outputs）、`buildAdapter`、主函数调 defineOp；删除 `collectShapes` 与自挂 meta/分派；保留 borrowDeep/adoptOut/readSegmentsFromArgs |
| P2 | `admit-compat-lib.ts`：删 `GeometryFieldsCarrier`，只读 `fn.outputs` |
| P3 | 更新 `api/generated/operations.ts` 生成器（`gen-api-dts.ts` / 生成脚本）的 compatOp 调用点（如有多产物传参统一 `outputs`）；重跑生成器，禁手改 |
| P4 | 新建 §6.1 单测；跑 `surface-mechanism` / `op-set-consistency` / compat-e2e 回归 |
| P5 | 同步 `docs/api-contract.md` §7.8（双语）、`docs/library-dev-guide.md` §3 重写（双语）、`packages/gear-lib-demo` 迁移 `fn.outputs` |
| P6 | 全量：`npm run test --workspaces` → `npm run typecheck` → `npm run lint` → `scripts/ci.ps1`；跑通后更新版本号前先过 CI（严禁用 CI 找 bug） |

---

## 8. 风险与决策记录

| # | 风险/决策 | 结论 |
|---|---|---|
| R1 | adapter 返回已收养 Shape，defineOp 再包装是否双包装 | 不双包装：`wrapBrepOne`/`wrapByKeys` 对 isShape 透传（现状行为，§3.2） |
| R2 | adapter 内 unwrap + runImpl 再 unwrap | 无害：`unwrapResult` 对非 Result 透传（§3.2） |
| R3 | 深遍历收集移除后"几何藏对象"报错码变化 | 接受：更早暴露、语义更准；不扩 defineOp（§5.2） |
| R4 | `geometryFields` 是否保留为 outputs 别名 | **删除**：文档化不构成保留理由（用户裁决「文档化的也是错误的文档化。根本不是保留的理由」）；全仓 grep 归零，库标注统一 `fn.outputs`（§3.6） |
| R5 | keep 是否要 compatOp"实现" | 不需要：keep 是函数体级机制，同一 ModuleExecutor 上下文天然共享；compatOp 只保证不破坏（§3.4） |
| R6 | 未来 defineOp 需扩展（如 collectInputs） | 走本文件决策记录更新后再实施，不在 compatOp 内自行加料（§5.2） |

---

## 9. positional 双义性重构（命名区分，2026-09-06 追加）

### 9.0 用户原始要求（原话）

> 「不同含义的positional名字要区分开」

> 「你说的是.fai.js脚本代码里，不是ts代码里。DUAL_OP_META是动态的还是静态的？」（调研结论已并入 §1.5/§9.1：`positional` 的语句层是执行路径直接消费的值，op 层是注册期静态声明）

### 9.1 问题定义

`positional` 在代码库三层含义见 §1.5 表格（语句层值 / op 层装箱声明 / 投影侧参数名表）。本重构只动 ② op 契约层；① 与 ③ 的处理见 §9.2。

### 9.2 命名决策（区分开）

| # | 现状 | 决策 | 理由 |
|---|---|---|---|
| ① | `StatementIR.positional: ArgIR[]`（lang/types.ts:137） | **保留原名** | 唯一对外宿主字段（codeToArgs 的 `HostArg[]`，3d_editor 消费）；10+ 消费点；语义准确（位置实参值）；改名无收益且波极大 |
| ② | `PositionalForm` / `decl.positional` / `meta.positional`（define-op.ts:96/115；dual-form-args.ts:206） | **重命名** `PositionalForm` → `SlotMap`，字段 `positional` → `slotMap` | 与 ① 彻底区分；`keys`/`vec3Keys`/`shapeArity` 全是"槽位"概念（哪个位置槽被哪个键吃掉/透传）——`slotMap` = 位置槽→对象键的装箱声明。候选名：`slotMap`（推荐）/ `positionalSlots` / `argSlots`，待用户裁决 |
| ③ | `ArgSpec.params: string[]`（dual-form-args.ts:33） | **保留**（本不叫 positional）；文档与注释明确为第三概念 | 语义独立（对象→位置的反向参数名表）；改名低优先，等值语义，可在后续独立处理 |

### 9.3 影响面（改名 `slotMap`）

| 文件 | 改动 |
|---|---|
| `api/internal/dual-form-args.ts` | `PositionalForm` 类型 → `SlotMap`；`positionalToObject` 签名参数名（行为不变，改名不改逻辑） |
| `define-op.ts` | `DualOpOptions.positional` → `slotMap`（:96）；`DualOpMeta.positional` → `slotMap`（:115）；装配 :235；使用 :246（`meta.slotMap ? positionalToObject(...)`）；校验 :317/:326 |
| 9 处声明 | `api/primitives.ts` box:159 / sphere:192 / cylinder:240 / cone:286 / wedge:317（5 处）；`api/transform.ts` translate:136 / rotate_euler:167 / scale:202 / scale3d:237（4 处）——`positional:` → `slotMap:` |
| `api/internal/compat-op.ts` | `CompatSpec` 改组合式（§3.1）后**自动继承** `slotMap`（不手写）；主函数透传 `slotMap: spec.slotMap`；`geometryFields` 已全仓删除，无任何别名逻辑 |
| 测试 | `define-op.test.ts` 及双形态相关测试（行为断言不变，仅字段名断言同步） |
| 3d_editor | **零影响**：不读 `DUAL_OP_META`，参数形态靠手工 `PRIMITIVE_EMIT_ORDER`（见 §9.6 备注） |
| 文档 | `docs/api-contract.md`、`docs/ops-api-inventory.md`、`docs/library-dev-guide.md` 检查 `positional`/`PositionalForm` 引用并同步 |

**对外影响**：`defineOp` 是 `@faicad/faijs/sdk` 导出（第三方库作者消费），`slotMap` 改名属 breaking；本项目未发布（专利申请通过前不发布），**当前窗口期改名成本最低**——决策 R8。

### 9.4 与 compatOp 主线的执行顺序

两任务共享 `define-op.ts`（serial），其余文件面独立（parallel 可行）：

```
compatOp 收敛（§3.1）：compat-op.ts / admit-compat-lib.ts / generated
positional 改名（本 §9）：dual-form-args.ts / define-op.ts / primitives.ts / transform.ts
                                ↑ 共享 define-op.ts，必须串行
```

推荐顺序：**先 §9 改名，后 §3.1 收敛**（收敛方案的 `CompatSpec` 直接以 `slotMap` 命名，避免二次返工）；或反向亦可，但 compatOp 收敛 PR 不得引入 `positional` 字段名。

### 9.5 实施步骤（并入主线 P 编号追加）

| 步骤 | 内容 |
|---|---|
| P7 | `dual-form-args.ts`：`PositionalForm` → `SlotMap`（类型 + `positionalToObject` 签名） |
| P8 | `define-op.ts`：`DualOpOptions`/`DualOpMeta` 的 `positional` → `slotMap`（装配 :235 / 使用 :246 / 校验 :317/:326） |
| P9 | 9 处声明：`primitives.ts` 5 处 + `transform.ts` 4 处 `positional:` → `slotMap:` |
| P10 | 测试：双形态/装箱行为全绿（12 个既有用例零改断言值）；新增字段名断言（`meta.slotMap` 存在、`meta.positional` 不存在） |
| P11 | 文档同步：api-contract / ops-api-inventory / library-dev-guide 引用检查；grep 守卫 `PositionalForm|decl\.positional|meta\.positional` = 0 命中（docs/plans 历史除外） |
| P12 | 全量回归：`npm run test --workspaces` → `typecheck` → `lint` → `scripts/ci.ps1`（与 P6 同门禁） |

### 9.6 备注：3d_editor 的手工副本是未来消费方，不是本重构的改动对象

3d_editor 侧参数编辑完全不读 `DUAL_OP_META`：`features/primitive.ts` 的 `buildArgs`（typeof 筛选）、`backfill`（手工 if/else）、`primitive-emission.ts:27` `PRIMITIVE_EMIT_ORDER`（`box: ['width','depth','height']`）就是 faijs `slotMap`+`schema` 的手工副本。本重构不改变 3d_editor 行为；待 compatOp 收敛 + schema 补全完成后，再评估 3d_editor 迁移到 `meta.schema` + `meta.slotMap`（跨仓库方案，另行立项，不在本文件范围）。

### 9.7 决策记录

| # | 风险/决策 | 结论 |
|---|---|---|
| R7 | 语句层保留 `positional`、op 层改 `slotMap` 而非反向 | 消费面与语义双考量：语句层是唯一对外字段且语义准确；op 层是 SDK 声明，改名窗口期成本最低（§9.2） |
| R8 | `slotMap` 改名是 breaking（SDK 面） | 接受：未发布窗口期内成本最低；发布后改名需走废弃过渡（§9.3） |
| R9 | 投影侧 `ArgSpec.params` 是否改名 | 本方案不改（本就不叫 positional）；仅文档/注释澄清第三概念；如后续统一可单独处理（§9.2） |
| R10 | 与 compatOp 主线的顺序 | 先改名后收敛（或反向），共享 `define-op.ts` 必须串行；收敛 PR 禁引入 `positional` 字段名（§9.4） |
