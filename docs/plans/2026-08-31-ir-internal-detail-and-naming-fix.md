# IR 是内部实现细节：文本唯一事实源 + scriptToCode 命名修正方案

- 日期：2026-08-31
- 性质：**技术方案**（代码部分未实施，等用户确认「可以」后实施；文档部分已在本方案之前修复）
- 范围：faijs（`C:\my\Faicad\faijs`）+ 3d_editor（`C:\my\Faicad\3d_editor`）

## 0. 需求原话（用户原话逐字，2026-08-31）

> 「怎么可能一个正常的语言，其IR反而是唯一的事实，而代码是反向生成的？荒唐透顶。只有代码是唯一事实，IR是根据代码编译出来的内部细节，可以随时变更。」

> 「IR相关的api，严禁导出，必需私有」

> 「本项目自己测试IR，当然是正常的呀！！是不准第三方库依赖IR，比如../3d_editor」

> 「从编译出的 IR 重打文本、再解析回去，模型相同？？ 完全错误。如果有IR重打文本，那一定只能用于调试，不准干别的事情。我当初说的是在3d_editor项目里，导出代码，保存为faijs文件，在导入这个文件，得到的模型必须一致。」

> 「最高原则：IR是内部实现细节」

> 「而且script / code, 不管是什么，都必须指的是代码。IR是内部细节。绝对没有什么script2code这种错误的api」

> 「改代码必须先写文档，写明技术方案，更改清单。」

> 「不准动代码，撤销也是改代码，不准改」——实施前只写文档。

> 「而且说了IR是细节，为何公开接口文档里大量写这些？？这些怎么可能属于接口契约？？？」——接口契约（api-contract）里大量出现 `ScriptIR` / `StatementIR` / `parseScript` / `scriptToCode` 等 IR 符号是错的；IR 是内部实现细节，不属于接口契约，公开接口文档只描述代码文本面。

## 1. 错误根源

### 1.1 教义错误：文本是 IR 的投影

以下文档/注释宣称「文本是 IR 的投影 / 序列化投影 / 确定性投影」，方向颠倒（IR 变成事实源、文本变成派生物）：

| 位置 | 错误表述（原文） |
|---|---|
| `docs/syntax-design.md` §1.2 约束 7 | `text is a deterministic projection of ScriptIR` |
| `docs/syntax-design.zh.md` §1.2 约束 7 | 文本是 `ScriptIR` 的确定性投影 |
| `docs/syntax-design.md` §3.2 | Text is a projection of the IR |
| `docs/syntax-design.zh.md` §3.2 | 文本是 IR 的投影 |
| `docs/api-contract.md` §5 | Code text is a deterministic serialization projection of ScriptIR; parser and codegen are isomorphic in both directions |
| `docs/api-contract.zh.md` §5 | 代码文本是 ScriptIR 的确定性序列化投影，parser 与 codegen 双向同构 |
| `docs/api-contract.md` §13.3 | printer round-trip is stable (IR → text → re-parse yields an identical model) —— 把「IR 重打文本」当成契约 |
| `docs/api-contract.zh.md` §13.3 | 打印往返稳定（从编译出的 IR 重打文本、再解析回去，模型相同） |
| `packages/core/src/lang/types.ts` 头注释 | 语句形式是唯一事实源，文本由语句序列确定性生成（pretty-print） |
| `packages/core/src/lang/codegen.ts` 头注释 | codegen — 语句 → 文本 确定性生成器（S-5 不变式） |

### 1.2 契约错误：把「IR 重打往返」当成一致性契约

§13.3 应描述的是**文本级保存/加载往返**（3d_editor 导出代码 → 保存 .faijs 文件 → 再导入该文件 → 模型一致），而不是「IR 重打文本再解析」。IR 重打文本只允许用于调试。

### 1.3 命名错误：scriptToCode / statementToLine

「script / code 都必须指代码」，IR 是内部细节，**不存在「IR → 代码」的转换 API**。现有 `scriptToCode`、`statementToLine` 的命名把 IR 当作可「变成代码」的东西，语义错误。它们实际是**调试用的打印工具**（把 IR 承载的信息打回文本），应改名为调试语义的名字，并明确 debug-only。

## 2. 正确原则（本方案的契约基线）

1. **代码文本是唯一事实源**；`ScriptIR` 是 parser 从文本编译出的内部表示，属内部细节，可随时变更。
2. **IR 是内部实现细节**；「script / code」一律指代码文本，IR 不与代码混称。
3. **IR 重打文本只准用于调试**，不准用于导出、保存、持久化等任何正式用途。
4. **「模型一致」是文本级往返**：3d_editor 导出代码保存为 `.faijs` 文件、再导入该文件，模型必须一致。
5. **IR API 私有边界**：第三方宿主（3d_editor）禁止 import 任何 IR 符号（`parseScript` / `ScriptIR` / `statementToLine` / `scriptToCode` / `createStatementIR` 等）；项目自身及其测试使用 IR 是正常的。
6. **接口契约文档不含 IR**：`docs/api-contract.md/zh.md` 只描述代码文本面（`execute(code)` / `append(code, newIds)` / `update(code)` / `check(code)` / `analyzeCode` / `codeToArgs` / `formatCodeLine` / `derivePartName` / `ExecutionResult` / `Shape` 等）与行为契约；`ScriptIR` / `StatementIR` / `parseScript` / `compileToModule` / `statementKey` 等 IR 内部符号不作为契约内容出现。
7. 引擎零函数知识、先解析后编译、无控制流、增量执行等既有约束不受影响。

## 3. 已完成修复（文档/注释，本方案之前已实施）

| 文件 | 改动 |
|---|---|
| `docs/syntax-design.md` | §1.2 约束 7 → 「Code is the single source of truth… debug-only printers」；§3.2 → 「IR is compiled from text… debug-only printers」 |
| `docs/syntax-design.zh.md` | 同上中文配对 |
| `docs/api-contract.md` | §5 → 「Code text is the single source of truth… debug-only printers」；§13.3 → 「save/load round trip… debug-only」 |
| `docs/api-contract.zh.md` | 同上中文配对 |
| `packages/core/src/lang/types.ts` | 头注释改为「代码文本是唯一事实源；IR 只是 parser 编译出的内部表示」 |
| `packages/core/src/lang/codegen.ts` | 头注释改为「codegen — IR → 文本 打印工具（调试用）；文本并不由 IR 生成」 |
| `docs/analysis/2026-08-28-canvas-display-set-alternatives.md` | 开头追加带日期更正说明（不改原文） |
| `../3d_editor/docs/plans/2026-08-13-single-code-truth-design.md` | 开头追加带日期更正说明（不改原文） |

## 4. 待实施变更清单（代码，等用户确认「可以」）

### 4.1 codegen 调试打印函数改名（用户 2026-08-31 已裁定）

用户裁定：**`scriptToCode(script: ScriptIR)` → `scriptIRToCode(script: ScriptIR)`；带 IR 的函数都类似处理（名字显式带 IR）；不带 IR 的 script 就是默认代码本身。**

| 现状 | 改为 | 说明 |
|---|---|---|
| `scriptToCode(script: ScriptIR): string` | `scriptIRToCode(script)` | 用户点名裁定；参数是 ScriptIR，名字显式带 IR |
| `statementToLine(stmt: StatementIR): string` | `statementIRToLine(stmt)` | 带 IR 的函数类似处理 |
| `buildArgsParts(stmt: StatementIR): string[]` | `buildIRArgsParts(stmt)` | 带 IR 的函数类似处理 |
| `fmtNum(n: number): string` | 保持 | 参数是 number，不带 IR |
| `formatCodeLine(input: FormatCodeLineInput): string` | 保持 | 输入是平铺摘要（非 IR 类型），宿主 timeline 显示用；名字无 script/code 歧义 |

涉及文件：
- `packages/core/src/lang/codegen.ts`（函数定义 + 头注释）
- `packages/core/src/index.ts` / `browser.ts`（导出面同步）
- 根门面 `src/index.ts` / `src/browser.ts`（`export *` 自动同步，无需手改）
- `packages/core/src/lang/*.test.ts`、`packages/core/src/cad-runtime/*.test.ts`（import 同步）
- `packages/tests/faijs/**`（import 同步：`syntax.test.ts` / `syntax/syntax.test.ts` 等）
- 3d_editor `contract-entry.test.ts` 的 FORBIDDEN_SYMBOLS（旧名 → 新名，宿主红线继续生效）
- 3d_editor `src/engine/script-engine/index.ts`（注释提及旧名 → 新名）

### 4.2 其余 IR 导出私有化评审（用户 2026-08-31 已裁定：选 B——结构性隔离）

盘点结果（任务 4 完成）：`parseScript`、`ScriptIR/StatementIR/ArgIR/ParamRefIR/VarRefIR/CallRefIR/ScriptMetaIR`、`createStatementIR/createScriptIR`、`isVarRef/isParamRef/isCallRef`、`statementToLine/scriptToCode/fmtNum/buildArgsParts`、`SYMBOL_TABLE/getFunctionSymbol` 当前从 `@faicad/faijs` 与 `@faicad/faijs/browser` 导出。

用户裁定：**选 B——IR API 一律不导出、引擎私有**。靠宿主侧 FORBIDDEN_SYMBOLS 契约测试约束"自己不 import IR"不是正常做法（那只是宿主自觉）；正常做法是引擎从公开导出面移除 IR，第三方宿主在根上就拿不到，无需任何宿主侧契约测试兜底。

**落地机制：结构性隔离，而非宿主契约测试。** 已核实的关键事实：
- `@faicad/faijs-core` 的 `exports` map **没有 `/lang/*` 子路径**——IR 所在路径（`packages/core/src/lang/`）对 npm 消费者结构性不可达（`import '@faicad/faijs-core/lang/parser'` 报 `ERR_PACKAGE_PATH_NOT_EXPORTED`）。此机制保持。
- 真正的泄漏面是 `packages/core/src/index.ts` / `browser.ts` 的**命名导出**：它们 re-export 了 IR 符号，经 `"."` 与 `"./browser"` 入口暴露给所有消费者。3d_editor 的 FORBIDDEN_SYMBOLS 契约测试正是在防这个泄漏——它是"宿主自觉"，不是"引擎强制"。

实施清单：
- `packages/core/src/index.ts` / `browser.ts`：**删除 IR 符号导出**（IR 类型 `ScriptIR/StatementIR/ArgIR/ParamRefIR/VarRefIR/CallRefIR/ScriptMetaIR`、`parseScript`、`createStatementIR/createScriptIR`、`isVarRef/isParamRef/isCallRef`、`statementToLine/scriptToCode/buildArgsParts`、`SYMBOL_TABLE/getFunctionSymbol` 等）
- 保留文本面：`execute(code)` / `append(code, newIds)` / `update(code)` / `check(code)` / `analyzeCode` / `codeToArgs` / `formatCodeLine` / `derivePartName` / `StatementSummary` / `ExecutionResult` / `Shape` 等
- 项目自身测试（正常使用 IR）：`packages/core/src/**/*.test.ts` 走相对路径 import `./lang/...`（现状已是）；`packages/tests` 走 vitest alias / tsconfig paths 直接消费 `packages/core/src`（M7 免打包，无需 `@faicad/faijs-core/lang/*` 子路径）
- **三个执行入口 `execute` / `append` / `update` 是公开接口，输入必须是代码文本**（用户 2026-08-31 裁定）；引擎内部解析文本为 IR 再执行。签名从 `execute(script: ScriptIR)` 改为 `execute(code: string)`（`append(code, newIds)` / `update(code)` 同理）；IR 参数版本降为内部实现
- **`executeCode` 删除**（用户 2026-08-31 裁定，方案明确而非"合并/保留"）：它的职责并入三个公开入口——`execute(code)` 全量、`append(code, newIds)` 增量追加（`newIds` 覆盖原 `executeCode` 的 `stmtIds` 子集语义）、`update(code)` 增量更新；`incremental` 开关由调用哪个入口表达，不再需要独立参数；`sceneCode` 并入 `ExecuteOptions`（跨 part 引用的整场景代码文本）。内部私有实现保留 IR 版本（如 `executeIR` / `appendIR` / `updateIR`）供引擎内部与项目测试使用
- 3d_editor 侧 `contract-entry.test.ts`：FORBIDDEN_SYMBOLS **降级为可选附加防线**（引擎不再导出后自然无法再被违反），或删除；白名单中已允许的 IR 符号（`ParseError`/`getApiVersion`/`SYMBOL_TABLE` 等）随引擎导出移除同步从白名单剔除
- `scripts/api-surface-snapshot.json`：构建后重生成

### 4.3 文档配套

- 改名后同步 `docs/syntax-design.md/zh.md` 与 `docs/api-contract.md/zh.md` 中的函数名引用
- 重算 i18n 哈希（`npm run verify-translation-pairing -- --write docs/syntax-design.md docs/api-contract.md`）
- doc-sync 12 项门禁 + 文档字数预算（api-contract ≤5200、syntax-design ≤3000）

## 5. 验证步骤（实施后）

1. `npm run test -w @faicad/faijs-core`（lang/codegen/parser/cad-runtime 相关）
2. `npm run test -w @faicad/faijs-tests`（integration，含 syntax fixtures）
3. `npm run doc-sync`（12 项门禁 + 预算）
4. 3d_editor 侧 `contract-entry.test.ts`（宿主零 IR 红线不回归）
5. 不跑全量 CI 找 bug——只重跑失败用例

## 6. 开放决策（用户裁定记录）

1. ~~`scriptToCode` → `printScript` 还是 `dumpScript`？~~ **已裁定（2026-08-31）**：`scriptToCode` → `scriptIRToCode`；带 IR 的函数名字显式带 IR（`statementIRToLine` / `buildIRArgsParts`）；不带 IR 的 script 就是默认代码本身。
2. ~~4.2 选 A 还是 B？~~ **已裁定（2026-08-31）**：选 B——IR API 一律不导出，引擎私有；宿主契约测试兜底不是正常做法。
3. `formatCodeLine` / `fmtNum`：**已裁定**——不带 IR（输入是平铺摘要/number），保持原名。
4. ~~FORBIDDEN_SYMBOLS 契约测试是否保留？~~ **已裁定（2026-08-31）**：不用 FORBIDDEN_SYMBOLS 做主要防线；改用**结构性隔离**（IR 符号不进公开导出面 + `exports` map 不暴露 `/lang/*`），项目自身测试走内部路径。FORBIDDEN_SYMBOLS 降级为可选附加防线或删除。
5. ~~execute/update/append 三种执行方式是否变化？~~ **已裁定（2026-08-31）**：**三种方式保持不变，且必须是公开接口，输入是代码文本**（`execute(code)` / `append(code, newIds)` / `update(code)`）；引擎内部解析文本为 IR，IR 参数版本降为内部实现（`executeIR` / `appendIR` / `updateIR`）。
6. ~~`executeCode` 与 `execute` 的关系？~~ **已裁定（2026-08-31）**：**`executeCode` 删除**，不保留。其职责并入三个公开入口：`execute(code)` 全量、`append(code, newIds)` 增量追加（`newIds` 覆盖原 `stmtIds` 子集语义）、`update(code)` 增量更新；`incremental` 开关由选择入口表达，`sceneCode` 并入 `ExecuteOptions`。不存在第四个执行入口。
