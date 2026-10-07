# shape 存活判断：现状实现（DAG + keep）与新方案变化（说明文档）

日期：2026-09-06
基线仓库：`C:\my\Faicad\faijs`、`C:\my\Faicad\3d_editor`
状态：方案（未实施）
定位：**说明性文档**，只解释一件事——"哪些 shape 最终显示在 UI 上"（shape 存活判断）的**现状实现**与**新方案下的变化**，帮助理解实施文档 [2026-09-06-no-ir-dual-channel-runtime.md](2026-09-06-no-ir-dual-channel-runtime.md)。本文件**不包含实施内容**（组件设计、文件清单、迁移、测试、验收全部在实施文档中）。

> 本文的现状结论均以 2026-09-06 读代码为准：`lang/parser.ts`、`lang/compile.ts`、`lang/statement-summary.ts`、`lang/keep.ts`、`cad-runtime/terminal-dag.ts`、`cad-runtime/runtime.ts`、`cad-runtime/module-executor.ts`、`define-op.ts`、`3d_editor/src/engine/script-engine/executeScript.ts`。

---

## 0. 用户原始需求（逐字，与 shape 存活判断相关部分）

> 有几个功能，要能在运行时实现：
> 1. 判断哪些shape最终输出到UI上。

> 哪些shape在UI上显示，运行时是否可以处理的？比如收集所有shape，最后存活的就是UI上显示的，是否可行。

> 方案大方向正确，就是要彻底删除中间无用的IR层。……还有哪些shape保留到UI上，目前是如何实现的，新的方案是否有变化，如何保证兼容。

> 这份文档只写shape 存活判断的现状实现（DAG + keep）与新方案有哪些变化，这份文档是说明性的，帮我我了解上面的方案。而2026-09-06-no-ir-dual-channel-runtime.md则要包含所有实施内容。

---

## 1. 现状实现（DAG + keep）

### 1.1 语义目标

"哪些 shape 显示在 UI 上"的现状语义（`terminal-dag.ts` 头部注释）：

> 一个变量是否进终端 = 它「是否被消费」。被消费 → 不进终端。被消费 = 存在一条语句 T（位于该变量最后一条赋值语句 P 之后）判定 T 消费了该变量。

三个来源共同决定：**DAG 叶子**（最后写者 + 其后无语句消费）、**keep 声明**（用户/库作者显式保留）、**显式 return 终端**（脚本 `return { shape }`）。

### 1.2 数据来源

| 数据 | 来源 | 说明 |
|---|---|---|
| `ScriptIR.statements` | parseScript | 每条语句的 outputs / hasAssignment / positional / args / refs（静态文本提取） |
| `shapeVarNames` | runtime 收集（`allShapeVarNames`） | 所有 shape 类型顶层变量名集合（含 compound 变量） |
| `DagRuntimeView` | runtime 注入 | `value`（变量当前值）、`internalKeep`（函数体 keep 登记） |

### 1.3 消费判定 `consumes(stmt, v)`（实际代码，短路）

对"语句 T 是否消费变量 v"，`consumes`（`terminal-dag.ts:52-106`）按以下顺序短路判定：

| 顺序 | 判定 | 条件 | 结论 |
|---|---|---|---|
| 1 | **keep 声明** | `resolveKeep(stmt, view?.internalKeep(stmt)).kept.has(v)`（合并函数体 `exec.keep` 登记与调用点 keep，调用点覆盖函数体） | **不消费** |
| 2 | **无几何输出** | `stmt.hasAssignment && outputs.length > 0 && outputs 全部非几何`（不在 `shapeVarNames`） | **不消费任何输入**（测量/查询函数） |
| 3 | **默认消费** | `statementInputs(stmt).includes(v)`（positional 中的 VarRefIR）；或递归扫描 positional/args 中的 VarRefIR / `ExprIR.refs`（嵌套调用 CallRefIR 内 = 只读查询不消费；receiver 不消费 receiver 变量） | **消费** |

> 消费判定链是 C0/C1/C3/C5（C1 = 函数体 `exec.keep` 登记，经 C0 的 `resolveKeep` 合并）。历史上 P4（2026-09-01）曾引入 C2（op 静态 consumes 声明，`ConsumeSpec` / `DUAL_OP_META.consumes` / `DagRuntimeView.opConsumes`），经用户裁决为错误做法（对外约定只有 keep/keepHidden），已于 2026-09-06 提交 f72c0d8（consume audit）整体删除；现状 `consumes()` 只含上述三步，**没有 op 静态 consumes 声明**。

### 1.4 终端集合 `computeLeafTerminals`（`terminal-dag.ts:144-200`）

```
1. hidden 预计算（最后一次保留声明胜出）：
   按语句顺序遍历，resolveKeep(stmt).kept 的 hidden 被后续声明覆盖；未声明 = 可见

2. lastProducer：每个变量名 → 最后一条 outputs 含该名的语句下标（仅 hasAssignment 语句计入）。**注意：这是"消费检查起点"的行号锚点，不是"找最后写者"**——ctx 键值天然就是最后写者的结果（JS 赋值覆盖），静态扫描产出的是"从哪一行之后开始查消费"

3. 对每个 shape 变量名：
   ├─ 无生产者（如手工注入变量）→ 直接进终端
   └─ 有生产者 P → 检查 P 之后每条语句 consumes(v)：
        任一消费 → 不进终端
        全部不消费 → 进终端（hidden 按 hiddenOf 归一：仅 hidden=true 才带 hidden 字段）
```

### 1.5 keep 机制（`lang/keep.ts`）

| 面 | 形态 | 说明 |
|---|---|---|
| 调用点声明 | `cad.op(input, { keep: [a, b], keepHidden: true })` | `parseUserKeep`：targets + 逐条目 hidden + 语句级 hidden 默认 |
| 函数体声明 | `exec.keep(...shapes)` / `exec.keepHidden(...shapes)` | 库作者声明；运行时登记为 `InternalKeepRecord`（`ModuleExecutor.internalKeep: Map<StmtId, InternalKeepRecord>`） |
| 合并优先级 | `resolveKeep`：先铺函数体声明，再用调用点覆盖写入 | 调用点 > 函数体 |
| hidden 三态 | 未列出 = 可见；`{shape, hidden}` 显式条目 / 语句级 `keepHidden` 兜底 | 终端 hidden 仅 true 时带字段 |
| 剥离 | `withoutKeepDirectives` / `withoutKeepDirectivesFromPositional` | 编译发射与 statementKey 前剥离 keep 键（防挤占参数槽 / 被当 Shape 传入 union/split） |

### 1.6 产出路径（`runtime.ts:1022-1045`）

```
explicitTerminals = script.terminalShapes（显式 return 终端）
terminals =
   explicitTerminals 非空 → 直接用
   否则 → computeLeafTerminals(script, shapeVarNames, view)
           .map(t => isCompoundLike(getCtxVar(t.id)) ? { ...t, kind: 'compound' } : t)
另外：
   activeValues = 活跃但非几何的值（不进 terminals）
   brepSolids  = 从 terminals 提取
   compounds   = compound 变量 → 成员变量名列表
```

view 注入（`runtime.ts:1030-1033`）：`value` 从 `executor.getCtxVar(name)`；`internalKeep` 从 `executor.getInternalKeep(stmt.id)`（无 op 静态声明——该机制已删除，见 §1.3 注）。

### 1.7 参与方分工（parser 与 runtime 都参与，缺一不可）

| 输入 | 提供方 | 内容 |
|---|---|---|
| `script.statements`（outputs / hasAssignment / positional / args / refs） | **parser**（parseScript → ScriptIR） | 消费判定与 lastProducer 的文本侧：语句写了什么、赋值给谁、引用了谁 |
| `script.terminalShapes` | **parser**（parseScript） | 显式 return 终端列表（非空时优先） |
| `shapeVarNames` | **runtime**（`allShapeVarNames`，ctx 值结构判定） | 哪些变量真的算 shape/compound 候选——由执行后 ctx 的值决定，parser 无法提供（含 append 累积的旧变量、第三方返回的未注册 compound） |
| `view.internalKeep` | **runtime**（ModuleExecutor.internalKeep，执行期登记） | 函数体 `exec.keep`/`exec.keepHidden` 声明（C1） |
| `view.value` / compound kind | **runtime** | 变量当前值、`isCompoundLike` 标记 |

结论：**parser 与 runtime 都参与且互补**——parser 提供"语句的静态文本事实"（outputs/refs/keep 文本），runtime 提供"运行时才有的动态事实"（哪些变量真是 shape、函数体声明了什么）。缺任何一方都无法得到 terminals。

### 1.8 宿主消费（3d_editor）

3d_editor **直接信任 `result.terminals`**（"faijs runtime 已按 DAG 叶子算法产出 terminals，宿主直接信任 result.terminals，不重复实现 DAG 过滤"，`executeScript.ts`）：用 `TerminalShape.id`（PartName）反查 statementIndex → `createPartForTerminal` 创建场景零件 → `commitSceneResult` 提交几何。场景树的显示结构由宿主按 scopedId 管理，terminals 只负责"哪些 shape 提交几何"。

---

## 2. 新方案下的变化

### 2.1 数据来源变化（从静态 IR 到执行记录 + 元数据）

| 现状数据 | 新方案数据 | 提供者 |
|---|---|---|
| `ScriptIR.statements`（outputs/refs 静态） | 存活候选 = 执行后 ctx 中 Shape 类型键；refs 静态候选 = 元数据提取器 | 共享 ctx（执行侧）+ 元数据提取器（UI 侧） |
| `consumes` keep 驱动静态判定（keep 声明 → 无几何输出 → 默认消费，基于语句文本 + 运行时 view） | **同一判定算法**，输入从 StatementIR 换 StatementSummary（lines 面原样，C0/C3/C5 不变）；行内 keep 查元数据 keep 表；块单元做词法级引用扫描 | MetadataExtractor（文本侧）+ 运行时（keep 登记） |
| `resolveKeep(stmt)`（parseUserKeep + internalKeep） | keep 语义不变：行级 keep/keepHidden 提取（元数据提取器 → keep 表）+ `exec.keep` 运行时登记 | 元数据提取器 + 运行时 |
| `script.terminalShapes`（显式 return） | 保留：执行结果显式列表优先 | 执行通道 |

### 2.2 `computeLiveShapes` 算法

```
候选   = 执行后 ctx 中 Shape 类型键（与现状 allShapeVarNames 同源）
         变量名来源：标识符作用域提升 / 宿主自报 / Node vm sandbox / 块内 ctx diff
消费   = keep 驱动 consumes() 判定（C0/C3/C5 原样，输入换 StatementSummary；行内 keep 查元数据 keep 表；块单元词法级引用扫描）
         无 op 静态声明、无执行时消费记录——对外约定只有 keep/keepHidden（红线）
保留   = 行级 keep/keepHidden（元数据提取器从 args 提取）+ 函数体 exec.keep（运行时登记）
         优先级与 hidden 三态完全沿用现状（调用点 > 函数体；最后一次保留声明胜出）
显式   = 脚本显式 return 列出的 shape（AI 手写 .fai.js 场景，优先）
存活   = (候选 − 消费 + 保留) ∪ 显式
```

执行顺序与现状语义逐点对应：候选 = ctx 键（值即最后写者的结果，天然处理重赋值）；消费 = 从 producerIdx+1（行级元数据反查锚点）起被后续 op 调用吃掉的；保留 = keep 声明拉回的。

### 2.3 与现状判定逐点对照

| 现状分支 | 现状实现 | 新方案对应 | 差异 |
|---|---|---|---|
| 消费检查起点 | `lastProducer` 静态扫 outputs 得 producerIdx（行号锚点，`for i = producerIdx+1`） | ctx 键天然给出候选与最后写者（值即最新）；锚点行号从行级元数据反查（v 最后一次出现在 outputs 的行 +1） | 等价；重赋值（`bp = bp2`）两边都天然处理；起点之前的消费（旧值被覆盖前的消费）两边都不算 |
| keep 声明不消费 | `resolveKeep(stmt).kept`（函数体 + 调用点） | 保留集合 = 行级 keep + `exec.keep` 登记（语义不变） | 无差异 |
| 无几何输出不消费 | outputs 全非几何 → 不消费 | 同一判定，输入换 StatementSummary（outputs 字段同形） | 无差异 |
| 默认消费 | 静态扫描 positional/args 的 VarRefIR | 同一扫描，输入换 StatementSummary（HostArg 引用形态保真） | 无差异 |
| 嵌套调用只读 | CallRefIR 内不消费 | 同一规则（HostArg call-ref 形态） | 无差异 |
| hidden 最后一次声明胜出 | 静态遍历 | 保留集合按声明顺序合并（同现状） | 无差异 |
| 显式 return | `script.terminalShapes` | 执行结果显式列表优先 | 无差异 |
| compound kind | 运行时 `isCompoundLike` 标记 | 保留（ctx 值判定） | 无差异 |

### 2.4 兼容保证（逐条）

1. **产出形态**：`ExecutionResult.terminals`（`TerminalShape[]`，`{ id, hidden?, kind? }`）字段不变 → 3d_editor 的 `createPartForTerminal` / `writeScriptStore` 零改动。
2. **行为等价**：对现有 `.fai.js` fixture（扁平行式、无控制流），`computeLiveShapes` == `computeLeafTerminals`。用黄金数据对比测试锁定（实施文档验收 A-14）。
3. **keep 契约不变**：调用点 > 函数体优先级、hidden 三态、剥离规则全部沿用 `keep.ts`，逻辑一行不改（行内 keep 提取输入从 StatementIR.args 换元数据 keep 表）。
4. **消费判定同源**：新方案与现状使用**同一个** keep 驱动 `consumes()`（C0/C3/C5），无新接口；差异仅在输入形态（StatementIR → StatementSummary + keep 表）与块单元的词法级扫描（自由 JS 新增场景）；扁平行式代码两者等价，不存在回归。
5. **多文件导出复用同一判定**：`computeLiveShapes` 同时产出模块导出面（`liveShapes`），"引用判定与 UI 显示判定一致"。

### 2.5 语义差异（如实记录）

| 场景 | 现状（静态） | 新方案（动态） | 影响 |
|---|---|---|---|
| 条件分支 | 不支持（语法被禁） | 块整体词法级引用扫描（保守，含未执行分支文本） | 自由 JS 新增能力 |
| 循环 | 不支持 | 块整体词法级引用扫描（同变量多次出现只记一次，集合语义） | 自由 JS 新增能力 |
| 跨文件引用 | 无此概念 | 引用行不在被引用模块的行级元数据中，不参与其消费判定（**跨文件引用 ≠ 消费**） | 多文件新增语义 |
| 未执行的语句 | 静态仍判定其消费 | 静态扫描仍覆盖块内未执行文本（保守） | 自由 JS 场景更保守，扁平行式无差异 |

---

## 3. 变化小结

一句话：**判断逻辑从"执行前静态数 DAG 叶子"变成"执行后看 ctx 里还活着的 shape"**——候选集合从 parser 的静态文本变为运行时 ctx 的 shape 键（更接近"收集所有 shape"），但**消费判定与 keep 契约完全沿用现状**（keep 驱动 consumes C0/C3/C5，无任何新接口）；两者对现有扁平行式代码产出完全一致，`ExecutionResult.terminals` 的形态不变，3d_editor 无需改动。实施内容（组件设计、文件清单、迁移、测试、验收）见 [2026-09-06-no-ir-dual-channel-runtime.md](2026-09-06-no-ir-dual-channel-runtime.md) §4.4 / §6。
