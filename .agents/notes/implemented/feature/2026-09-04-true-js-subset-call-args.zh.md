# Agent Note：`.fai.js` 成为真正 JS 子集——顶层调用实参限制取消（D1–D6）

Status: implemented

[English](2026-09-04-true-js-subset-call-args.md) | 中文

## 问题

`.fai.js` 宣称是"合法的 JS 子集"，但顶层调用实参不是：parser 在实参位只接受 `Identifier` 与 `ObjectExpression`。三个后果：裸字面量被拒（`cad.box(10, 20, 30)` → `unexpected argument type: Literal`）；第二个对象实参静默覆盖第一个（`tabAndSlot(p, tabSpec, slotSpec)` 不可用）；成员表达式被拒，脚本里读不了记录字段（`hem(p0.solid, …)` 失败，库被迫提供显式的 `solidOf` 终端函数只为从 part 记录里挖出一个字段）。D11 双形态 API 契约的位置形态只在 TS 兼容面成立。

## 决策

`StatementIR` 实参模型替换为单一位置槽（语句模型：`positional: ArgIR[]`；删除 `inputs: PartName[]` 字段；`args` 仅作为尾随纯对象实参的投影保留）：

1. **D1 —— positional 是唯一数据来源**：每个实参位接受全部表达式形态。尾随纯对象是选项槽（`args` 投影）；非末位的对象实参原样保留——不覆盖、不合并。
2. **D2 —— `ExprIR` 白名单扩大**：`MemberExpression`（沿对象链走，标识符计入 refs）与非命名空间 `CallExpression` 作为运行时表达式被接受；表达式内的命名空间根调用仍被拒（`E_VALUE`），`new` / 箭头 / `await` 同样。
3. **D3 —— refs 即消费**：`collectStatementRefs`、keep 校验、terminal-dag 的 `consumes()`（C2/C5）、下游计算、`emitBrepLost` 与引用预检全部从 `positional` 槽推导（变量引用与表达式标识符算消费；字面量与非末位对象不算）。
4. **D4 —— 表达式求值失败是语句失败**：编译产物把 `ExprIR` 求值包进 try/catch，抛出模块内联的 `__FaiExprEvalError` 标记类（零 import）；executor 只把该标记转为 `OpError(E_EXPR)` → `ExecutionResult.failedAt`。其余异常语义不变（impl 异常仍按 bug 抛穿）。
5. **D5 —— 多对象位置实参**：每个对象实参都保留；`splitPositionalOptions` 为 ABI/选项路径切出尾随对象（编译发射、keep 剥离、codeToArgs）。
6. **D6 —— 宿主契约**：`codeToArgs` 返回 `{ positional, args }`（标记对象 `{$ref}/{$param}/{$call}/{$expr}` 留在 `positional`，宿主降级为只读）；`formatCodeLine` 接受 `positional` + 可选的过渡 `args`；代码打印机按 `{ k:v, … }` 的 args 槽风格打印尾随选项对象，仅含 keep 指令的对象剥离后整个消失。

编译路径按 IR 形态发射每个位置实参（`$param`/`$ref` → `ctx.<name>`，`$call` → await 查询，`$expr` → 箭头包装）；增量 `statementKey` 序列化整个 `positional` 槽（剥 keep），不再只看 `args`。

## 被否决的备选方案

- **`inputs` 与 `positional` 并存**（双份记账）。否决：两个事实来源必然漂移，且每个消费方已被打过两次补丁。
- **D4 用 executor 级全量 try/catch**。否决：会把真正的 impl 异常（bug）也转成语句失败，破坏"impl 异常 = bug = 抛穿"契约与既有 `rejects.toThrow()` 语义；标记类方案只转换表达式求值失败。
- **继续拒绝成员访问，把 `p0.solid` 塞进某种 `CallRefIR` 式特殊形态**。否决：为普通 JS 已能表达的东西发明语法；运行时求值的 `ExprIR` 机制本来就在。
- **`codeToArgs` 只把尾随对象留在 `positional` 里返回**。否决：宿主做编辑回填时会双写或丢失选项对象；显式双槽切分才是向后兼容的超集。

## 后果

- `.fai.js` 在调用点上成为真正的 JS 子集：`cad.box(10, 20, 30)`、`tabAndSlot(p, tabSpec, slotSpec)`、`hem(p0.solid, { kFactor: 0.44 })`、`cad.box(w * 2, h, d)` 全部可解析可执行。旧形态脚本（纯对象实参）是严格子集——零迁移。
- 库不再需要为每个脚本面函数准备对象形态入口，也不再需要 `solidOf` 终端函数只为暴露记录的几何字段（TS 兼容面仍可用）。
- `runtime-state` 编译缓存与增量 key 形态变化（positional 序列化）——内容寻址仍保证跨版本正确性；升级后一次性全量重算是可接受且预期的。
- 3d_editor 跟进（独立仓库）：其 `codeToArgs` 消费方应采用 `{ positional, args }` 契约；跟进前旧的对象形态行为在该仓库保持不变。
- 新诊断码：`E_EXPR`（运行时表达式求值失败，归属到所属语句）。

## 验证

- Parser：位置字面量 / 混排形态 / 多对象 / 成员表达式 / 可折叠表达式；红线（表达式内 `new`、箭头、命名空间根调用）仍被拒；旧对象形态脚本重解析为等价 IR（全部 fixture 重解析，零漂移）。
- 编译/执行：`cad.box(10,20,30)` ≡ `cad.box({size:[10,20,30]})` 几何一致（mesh + brep 双链）；`E_EXPR` 失败归属；positional 变更的增量失效；keep 剥离发射（`union(a, b, { keep: [a, b] })` 编译为 `union(ctx.a, ctx.b)`，无多余 `{}`）。
- codegen/宿主：往返保真（`statementIRToLine` → parse → 同一 IR）、`codeToArgs` 新契约测试、`formatCodeLine` 旧 args 兼容。
- core 全量绿（76 文件 / 996 测试）、mech-lib 绿、lint + typecheck 干净。
