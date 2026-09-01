# Agent Note：控制流放松——条件表达式 + 本机函数（D1–D15）

状态：已实施

[English](2026-09-01-control-flow-relaxation.md) | 中文

## 问题

faijs（R10）禁止一切控制流；循环驱动的零件（齿轮、阵列）无法表达，任何引用语句变量的参数表达式在 parse 期即被拒绝（`E_VALUE`）。路线图（v2/v3）早已声明终点——控制流住在子函数内部、顶层保持线性——但语言层面尚未实现任何一部分。

## 决策

在 v1 一步到位地把 R10 放松为「顶层无控制流」：

1. **运行时表达式（`ExprIR`，Phase 1）**：静态折叠失败（表达式引用的是*语句变量*而非参数/字面量）时，表达式原文保留为 `ExprIR { $expr: { text, refs, params } }`，由 JS 引擎经箭头包装 `((names) => text)(ctx.names)` 运行时求值。白名单文法为 `Literal/Identifier/Unary/Binary/Logical/Conditional/Array`（递归）——**不含调用与成员访问**（嵌套调用继续走 `CallRefIR`），且 `ObjectExpression` 刻意不整体回退（属性值引用变量本就走 `VarRefIR`，整体回退会误伤顶层 args 容器）。
2. **本机函数（Phase 2）**：`function <name>(<params>) { <body> }` 解析为 `FunctionDefIR`（新增 `bodyHash` + `bodyRange` + 重名检查），函数体可含任意控制流（`if/for/while/switch/try/throw/break/continue/labeled`，外加 `var`——D12 维持现状、不新增收紧），顶层经裸标识符 callee 以四种形式（赋值／重赋值／解构／副作用）调用。
3. **ABI（D7/D11）**：编译包装器为 `async function <name>(__ctx, __ns, <用户形参>)`——用户形参表原样保留在两个注入的引擎参数之后；调用按「位置 + 按名」绑定：位置实参映射前 `M` 个形参、末尾对象键按名映射剩余形参（超位／未知键／占用冲突 → `E_ARG`），未绑定形参为 `undefined`，`keep`／`keepHidden` 在绑定前剥离。
4. **keep 隔离（D5）**：本机函数运行期间 `userFunctionDepth > 0` 使 `registerKeep` 变 no-op——函数体内 `cad.*` 的内部 keep 永不污染外层语句；调用点 `keep` 是唯一的保留通道。
5. **函数 BREP 域（D13）**：函数体内产生的瞬态 OCCT 句柄被登记（`registerFunctionBrep`，hook 在 `fromBrep`），返回时释放除返回值可达句柄外的全部（`finally`，异常路径同样）——函数体中间几何永不进入顶层 `solidCache`。
6. **内容寻址（D6/P4）**：本机调用语句的 `statementKey` 为 `local.<callee>#<bodyHash>`——编辑函数体使所有调用者失效；未改动的函数体零重算。
7. **v1 范围收窄（D10/D9/D2/D15）**：函数体内**不得**调用另一个本机函数（顶层 ABI 与 verbatim 函数体语义冲突，同时收窄安全面）；`export function` 维持拒绝；参数声明保持字面量值；未知函数名 parse 期即报 `E_REFERENCE`，故 `check()` 无需扩展 symbol 阶段。
8. **执行护栏（D8）**：可选 `executionTimeoutMs` 在整轮超时抛 `ExecutionLimitError`（`E_EXEC_LIMIT`）；同步 `while(true)` 是 JS 单线程限制、护栏无法打断——真正防护在宿主层。

## 备选方案

- **`ExprIR` 存 AST + mini-printer。** 拒绝：零改写用户文本（R13），无需维护打印机。
- **允许 `ExprIR` 内嵌调用。** 拒绝：v1 收窄求值面（D4）；`CallRefIR` 已存在。
- **允许函数体内调用兄弟本机函数。** 拒绝（D10）：体内 `gear(part0, { n: 3 })` 是普通 JS 位置调用（整个对象落进第二个形参），与顶层绑定语义不一致——且递归无法设防。
- **包装器只注入单个 `params` 对象。** 拒绝（D7）：用户的形参名永远拿不到值。
- **函数体中间几何强制 mesh。** 拒绝作为首选（D13）：值级 `hasBrep` 分派在体内照常工作；句柄登记域以有界内存保住 BREP。
- **本机调用走 symbol 阶段存在性检查。** 拒绝（D15）：parse 期拦截最早，`check()` 更简单。

## 后果

- 新顶层能力：任何参数值里的运行时表达式、本机函数调用（四种形式）。不含函数的既有脚本解析不变；参数/字面量表达式依旧按原样折叠（零回归）。
- 新诊断码：`E_ARG`（ABI）、`E_REFERENCE`（未知本机函数）、`E_STATEMENT`（重名函数、体内本机调用）。
- 函数体是嵌入编译产物的用户源码——对「用户文本不进 VM」（R-3）的已记录例外，边界是 acorn 闸门 + 白名单，与 faqts 整模块通道同构。
- `derivePartName` 新增可选 `excludeRanges`，函数体内的 `partN` 不再干扰顶层命名。

## 验证

- `expr-ir.test.ts`（21 个）：条件 / 数组 / 对象（属性级）的 ExprIR 回退、静态折叠零回归、白名单边界（调用/成员 → `E_VALUE`）、箭头包装发射、往返、`ExprIR` refs 的 `consumes()` C5 判定。
- `function-def.test.ts`（24 个）：函数体控制流矩阵、安全红线保持、四种调用形式、ABI 矩阵（`E_ARG`）、重名/未知名拒绝、`bodyHash` 确定性、编译发射（包装器 + `localFns` + 按形参序 ABI）、往返。
- `function-execute.test.ts`（11 个）：keep 隔离、`bodyHash` 增量失效、超时护栏类型、terminal-dag、函数 BREP 域句柄释放（循环重函数：只有返回值进入 `solidCache`）、模块结构。
- core 全量测试绿（含回归的 297 个 lang/cad-runtime 测试）；`npm run typecheck` 通过。
