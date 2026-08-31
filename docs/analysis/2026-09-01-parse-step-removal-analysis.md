# 分析：faijs 执行前的 parse 步骤能否取消，或移入运行时由库提供

日期：2026-09-01
范围：`packages/core/src/lang/`（L0 文本层）+ `packages/core/src/cad-runtime/`（L2 编排层）

## 1. 用户原话

> 分析本项目faijs代码执行前的parse步骤，能否取消，或者必须的功能移到运行时，通过库提供

## 2. 结论摘要

**parse 步骤不能整体取消**。`execute(code)` / `update` / `append` 全部依赖 parseScript 产出的 ScriptIR，再经 compileToModule 编译为模块代码后交给 JS 虚拟机（`import()` data URL）执行——即「先解析后编译，执行交给 JS 虚拟机」是当前架构的既定路线（见 AGENTS.md L0）。把 parse 取消意味着直接执行任意 JS，会同时失去 DAG 依赖图、StmtId 命名、安全红线、静态错误报告四项执行必需能力。

**但 parse 中"校验类"功能的大部分已经、或可以移入运行时由库提供**，项目已有明确先例：args-schema/SCHEMAS 已在阶段 4 删除，参数校验全部由 `packages/stdlib/src/assert.ts`（库函数内、dispatchPath 之前）承担。逐项评估见 §5。

**独立 check 步骤（`runtime.check`）不是执行必需**——它只是 CLI `check` 命令的干跑预检（parse + 符号表 + keep + 引用预检），`execute` 路径本身不调用它。它可保留为可选的 IDE 预检服务，也可在未来并入执行路径（执行时已有等价校验能力）。

## 3. parse 步骤现状

### 3.1 组件清单（`packages/core/src/lang/`）

| 组件 | 文件 | 职责 | 是否执行必需 |
|---|---|---|---|
| parseScript | `parser.ts`（~440 行） | acorn 解析 + AST 校验 + ScriptIR 构建 | 是 |
| compileToModule | `compile.ts` | ScriptIR → CompiledModule（deps DAG + 模块文本） | 是 |
| ModuleExecutor | `cad-runtime/module-executor.ts` | `import()` 编译产物 → 逐语句按 deps 执行 | 是 |
| symbol-table | `symbol-table.ts` | callee 符号表（由 `gen-symbol-table.ts` 从 stdlib 生成） | check ② 用，执行非必需 |
| codegen | `codegen.ts` | IR → 源码文本（往返保真、formatCodeLine） | 否（宿主侧 + 测试） |
| statement-summary | `statement-summary.ts` | parse 结果投影 → StatementSummary（宿主展示/编排） | 否（宿主侧） |
| code-to-args | `code-to-args.ts` | 单行反提 args（编辑回填） | 否（宿主侧） |
| keep | `keep.ts` | keep/keepHidden 指令静态校验 | check ②.5 用 |

> 注：`args-schema` 已不存在（阶段 4 删除），参数校验由 stdlib assert 运行时承担——见 §4.3。

### 3.2 parseScript 内部步骤（按执行顺序）

1. **顶层 import/export 预扫描**（F1/F2）：拒绝顶层 export；import 必须头部连续段（E_IMPORT）。
2. **扁平封装**：无 `export default` 时自动包装为 `export default async (cad) => {...}`，import 段提到函数外（acorn 约束）。
3. **acorn 语法闸门**：解析失败 → E_SYNTAX（含行号）。
4. **AST 结构校验**：必须是 `export default async (cad) => { ... }` 单参数形态。
5. **AST walk → ScriptIR**：
   - 语句识别：`const x = [await] cad.op({...})`、裸重赋值、命名空间调用、成员方法调用、解构；
   - 参数识别：字面量声明 → ParamDef（number/bool/vec3）；
   - F1 常量折叠（binary/template/conditional/spread 表达式折叠为字面量，`hasComputedArgs` 置位）；
   - 作用域检查（varToId → E_REFERENCE：unknown variable）；
   - 安全红线：eval / new / 动态 import() → E_STATEMENT / E_CONTROL_FLOW；
   - import 处理 → ScriptIR.imports + 命名空间绑定表（F2）；
   - 顶层函数定义 → FunctionDefIR（A1，不进 statements）；
   - return → ScriptMetaIR + terminalShapes。
6. **StmtId 分配 + 引用收集**：每条语句分配 `sN`（N 从参数数后递增），收集 refs。

### 3.3 执行链中 parse 的位置

```
execute(code)      ──parseScript──▶ ScriptIR ──compileToModule──▶ CompiledModule ──importModule──▶ 模块加载 ──▶ 按 deps 执行
update(old,new)    ──parseScript ×2──▶ 同上（增量）
append(code)       ──parseScript(fullCode, {looseVars})──▶ 同上（累加场景）
check(code)        ──parseScript──▶ ②符号检查 ②.5 keep ③引用预检 ④终端预检（纯静态，不执行）
cli run/check      ──以上入口的薄包装──▶
```

- 执行路径（execute/update/append）：**parse 是硬前置**，因为执行的是编译产物而非原文本。
- 预检路径（check）：parse 的 ScriptIR 是②③④三类静态检查的数据源。

## 4. 关键先例：参数校验已经移入运行时

`packages/stdlib/src/assert.ts` 头部注释（原文）：

> 阶段 4 起（args-schema/SCHEMAS 已删除），参数校验全部由本模块的 assert 助手承担（各 stdlib 函数在 dispatchPath 之前调用）；非法即抛 Error（不静默）。

即：**schema 校验这一类"parse 期静态检查"已经整体移出 parse，改由库函数自身在运行时自校验**。这是"必须的功能移到运行时，通过库提供"的已落地样板，证明该迁移路线在本项目可行且被采用。

## 5. parse 功能逐项评估

| # | parse 功能 | 可否取消 | 可否移入运行时（由库提供） | 理由 |
|---|---|---|---|---|
| 1 | acorn 语法闸门（E_SYNTAX） | 不可 | 否 | .faijs 是合法 JS 子集，语法错误必须报错；执行依赖 AST 形态（`export default async (cad)` 包装）。移入运行时 = 执行时报错，等价于保留 parse |
| 2 | 扁平封装（自动包装 export default） | 不可 | 否 | 属语法层预处理，取消则要求宿主必须写完整容器，且 F2 import 提升逻辑无处安放 |
| 3 | import 预扫描 + 命名空间绑定（F2） | 不可 | 可部分 | 绑定表是命名空间调用解析的依据；库侧可通过 `registerLib` 注册（check ② 已查 libs[ns]），但"文件头部连续段"约束属语法契约，留在 parse |
| 4 | AST 结构校验（export default async (cad)） | 不可 | 否 | 契约形态校验，执行前置 |
| 5 | 语句识别 + ScriptIR 构建（DAG 拓扑） | 不可 | 否 | 增量执行、缓存 key、keep、terminal 判定、语句命名（sN/PartName）全部依赖语句结构化。移入运行时 = 逐语句执行时动态建图，失去"执行前知晓"能力，且与 ModuleExecutor 的 deps 静态列表冲突 |
| 6 | 参数识别（ParamDef） | 不可 | 否 | 参数是 DAG 的 s1..sK 节点（compileToModule 参数语句），编译必需 |
| 7 | F1 常量折叠（表达式→字面量） | 可（有条件） | 可 | 折叠为"惰性求值"时：`hasComputedArgs` 标记（宿主编辑只读降级）需保留，折叠值影响参数参与 DAG 的确定性；但折叠本身可在运行时求值。**收益小、改动大**，不建议动 |
| 8 | 作用域检查（E_REFERENCE：unknown variable） | 可（有条件） | 可 | check ③ 引用预检已覆盖同目标；执行时可改为"运行时取不到 ctx 变量即报错"。但 looseVars 模式已为此兜底（append 外部变量透传）。**保留更稳**：错误行号提前到 parse 期 |
| 9 | 安全红线（eval / new / 动态 import） | 不可 | 否 | 直接执行任意 JS 时这些红线必须由沙箱兜底，而本项目执行走 `import()` 原生模块（无沙箱），红线必须在 parse 期拦截。取消即开安全洞 |
| 10 | 参数校验（原 args-schema） | — | **已移入** | 阶段 4 完成，stdlib assert 运行时自校验（见 §4） |
| 11 | 符号检查（callee 存在性） | 可 | 可 | check ② 已独立于 parse 做（getFunctionSymbol / libs[ns]）；执行时未注册 callee 由 backend-dispatch 报错。符号表本身由 `gen-symbol-table.ts` 从 stdlib 生成——已是"库提供"形态 |
| 12 | keep 指令校验 | 可 | 可 | check ②.5 已独立于 parse（validateKeepDirectives 静态纯函数）；执行时 keep 指令由运行时消费（setKeepSink）。库侧校验可行 |
| 13 | 引用预检（inputs 先定义） | 可（有条件） | 可 | check ③ 已独立；执行时 deps 静态构建仍需要知道 inputs→定义映射，故 DAG 层不可省，但"校验报错"环节可移运行时 |
| 14 | StmtId 分配 + refs 收集 | 不可 | 否 | sN（StmtId）与 partN（PartName）命名是场景树、增量执行、命名服务的基础（allocate-id） |
| 15 | codegen（IR→文本） | — | — | 非执行必需，已是库导出能力（formatCodeLine/fmtNum），无取消问题 |
| 16 | statement-summary / code-to-args | — | — | 宿主消费形态，内部复用 parseScript——**"通过库提供"的现成样板**，宿主不需要自己解析 |

### 5.1 汇总

- **不可取消（执行必需，移入运行时等价于保留）**：#1 #2 #4 #5 #6 #9 #14，以及 #3 的语法契约部分。
- **已移入运行时**：#10（stdlib assert）。
- **已独立于 parse（check 层做，执行非必需）**：#11 #12 #13 —— 它们本来就不在 parseScript 内部，而是 runtime.check 的独立阶段，消费 ScriptIR。
- **可移入但收益小/不建议**：#7 #8。
- **根本不存在于执行路径**：#15 #16（宿主/测试侧）。

## 6. 结论与建议

1. **parse 不能取消**：执行链（execute/update/append → compileToModule → import() 虚拟机）以 ScriptIR 为编译输入；取消 parse 要么把解析器搬进运行时（等于保留，还丢失执行前报错），要么直接执行任意 JS（丢失 DAG/命名/安全红线三项契约）。

2. **"必须的功能移到运行时，通过库提供"已部分落地且可继续推进**：
   - 已完成：参数校验（stdlib assert）、符号表（gen-symbol-table 生成 + registerLib 注入）、keep 校验（validateKeepDirectives）、命名空间解析（check ② 查 libs[ns]）。
   - 可继续：若目标是"宿主不感知 parse"，statement-summary / code-to-args / formatCodeLine 已经是库提供的宿主消费 API（IR 剥离红线，见 `statement-summary.ts` 头注）——宿主侧无需自行解析，方向正确。
   - 不建议继续：F1 折叠、作用域检查移入运行时收益小、风险大（行号提前、增量稳定性依赖）。

3. **check 步骤定位**：它是可选干跑预检（CLI `check`），不阻塞执行；若产品形态要求"最小 API 面"，check 可降级为 execute 时的错误合并报告，或保留为 IDE 预检服务——两种选择都不影响执行能力。

4. **一条可选的激进路线（供决策，未建议执行）**：若未来产品要求"宿主只提交文本、完全零 parse API"，可把 parseScript+compileToModule 收敛为运行时内部私有实现（不再对外导出 ScriptIR 类型），对外只暴露 `execute(code)` / `analyzeCode(code)` / `codeToArgs(line)`——即"parse 保留在引擎内部，库提供高层 API"。这与当前 IR 剥离方向一致，属于 API 面收缩而非功能取消。
