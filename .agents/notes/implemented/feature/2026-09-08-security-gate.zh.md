# Agent Note：`.fai.js` 静态安全检查

Status: implemented

[English](2026-09-08-security-gate.md) | 中文

## 问题

`.fai.js` 脚本会在宿主运行时（Node.js 或浏览器 worker）中执行任意 JavaScript。若没有静态安全门禁，恶意或 AI 生成的代码就可能访问 `eval`、`globalThis`、`process`、`fetch`、`setTimeout`、原型链污染等逃逸通道。此前的 parser 只做语法与分析，在顶层校验语法与控制流，不会递归进入函数体、块或嵌套作用域，藏在控制流块里的危险标识符成为盲区。

## Decision

实现一个**静态安全扫描器**（`security-scanner.ts`）：在解析与执行之前，对 `.fai.js` 源码做完整 AST 递归遍历。扫描器接三个集成点（A1/A2/A3）：

- **A1**（`extractMetadata`）：UI 通道——在 `acornParse` 之前扫描，行号与用户编辑器一致。
- **A2**（`DirectExecutor.parseAndTransform`）：执行通道——在 `parseBody` 之前扫描。
- **A3**（`ModuleRegistry`）：子模块通道——扫描子模块源码（固定 `strict` 策略）。

扫描器强制六类规则：

| Rule | ID | Description |
|------|----|-------------|
| S1 | `SEC_IDENT` | Dangerous identifier blacklist (eval, globalThis, process, fetch, etc.) |
| S2 | `SEC_SYNTAX` | Dangerous syntax nodes (dynamic import(), with, debugger, tagged templates, import.meta) |
| S3 | `SEC_MEMBER` | Dangerous member names (__proto__, constructor, prototype, defineProperty, etc.) |
| S4 | `SEC_FREE_IDENT` | Free-identifier whitelist — undeclared identifiers not in safe globals or known namespaces are rejected |
| S5 | `SEC_LIMIT` | Structural limits (source length ≤ 1 MiB, ≤ 5000 top statements, ≤ 200K AST nodes, depth ≤ 100) |
| S7 | `SEC_NS_ASSIGN` | Namespace protection — assignment to namespace names (cad, gearlib, etc.) is rejected |

三档策略：

- `strict`（默认）：所有规则全开，含 strict 专用标识符（setTimeout、crypto、Reflect、Proxy）。
- `balanced`：放宽 S1 的 strict-only 标识符与 S2 的 strict-only 语法；S4/S5/S7 仍生效。
- `off`：不做扫描（仅供受控调试）。

### 通道一致性

A1 与 A2 使用同一个扫描器、同一策略，保证 UI 与执行通道拒绝同一份代码。违规产生 `ParseError(code='E_SECURITY', ruleId=<rule>)`，`CadRuntime.check()` 以 `CheckError(stage='security', ruleId=<rule>)` 暴露给调用方。

### 追加与参数集成

- `DirectExecutor.runCode` 把 `opts.params` 与 `opts.imports` 的键作为 `knownNames` 传入，避免对预注入变量产生 `SEC_FREE_IDENT` 误报。
- `appendDirectText` 在 A1 之前先跑 `missingPrefixVar`（`skipSecurity=true`），让缺失引用的 `AppendPrefixError` 优先于 `SEC_FREE_IDENT`。
- S7 使用独立的 `nsNames` 参数（只装命名空间名，不含 ctx 变量），避免与同名 `let` 变量重新赋值时误报。
- `scanSource` 捕获 acorn `SyntaxError` 并返回 `ok=true`（无安全违规），让调用方主解析路径把语法错误按 `E_SYNTAX` 处理。

## 已考虑的其他方案

1. **基于 RegExp 的扫描**：否决——无法可靠处理嵌套作用域、成员表达式或计算属性访问；必须用 AST 遍历才能保证正确性。

2. **运行时沙箱（vm 模块 / Worker 隔离）**：否决为第一道防线——对常规情况过重，且不能预防代码尝试逃逸（只能在事后捕获）。静态扫描在执行前就切断能力来源。运行时隔离保留为互补层（R7，未来工作）。

3. **Acorn 插件 / 自定义 parser**：否决——会把安全规则与 parser 实现耦合。现设计把规则（数据驱动的 S1/S2/S3 表）与遍历逻辑（R6）解耦，新增 op 或语法形态不需要改扫描器。

4. **接入 ESLint**：否决——ESLint 是开发工具而非运行时依赖。扫描器必须零依赖（只用 acorn，且 acorn 已是既有依赖）并在 Node 与浏览器环境都能运行。

## 必然影响

- 全部 `.fai.js` fixture 文件（119 个）都以 `strict` 策略通过扫描——零误报。
- 152 个新测试（33 unit + 119 fixture 回归）覆盖扫描器行为。
- `CadRuntimeOptions.security` 字段允许宿主设置策略档位（默认 `strict`）。
- `CheckError` 增加 `stage='security'` 与 `ruleId`，给 AI 精准反馈。
- `ParseError` 增加 `ruleId` 字段（仅 `code='E_SECURITY'` 时设置）。
- 新增可选 `LibLoader.loadSource` 钩子，供未来库源码扫描使用（P4，尚未接线）。
- 该扫描器是诚实理解的静态防御，不宣称与沙箱等价（D9）：字符串拼接的属性访问（`g['ev'+'al']`）、字符串内部的代码、已持有引用的复用都无法静态检出。S4（自由标识符白名单）为剩余攻击路径切断能力来源。