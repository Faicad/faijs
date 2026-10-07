# 参数表达式在 Timeline 中可编辑：技术实现方案

- 日期：2026-09-08
- 状态：**已落地（P0–P1 全部开发与测试任务完成：faijs 侧 `ArgSource` 提取 / `UiMetadata.names` / `validateExpression` / `editArgSource` 已随 0.11.1 打包；3d_editor 侧 T0 编辑确认、T1 参数节点、T2 表达式编辑器、P1 的 T3 op 引用槽逐槽编辑、backfill 引用槽感知（结构保证：参数引用行永不进数值面板）、T4 删除预检（含计算参数 refs 引用）落地并测试通过。剩余仅限 P2 可选：参数重命名、自动补全、面板级 `fx` 徽标）**
- 涉及仓库：`faijs`（槽位提取 + 表达式校验 + 源区间编辑 API）、`../3d_editor`（timeline 呈现与编辑）

---

## 0. 用户需求（原话）

> "实现参数表达式在../3d_editor项目的timeline中可编辑。"

> "采纳你说的：把 splice 纯函数放进 faijs（editArgSource(code, stmtId, path, newText): Result<string>），而非 3d_editor 的 source-patch.ts。"

> "一行多参、undo 快照、坏表达式整体降级提示、断言失败自动恢复等，也都按你的建议补充进方案里。"（"可以交给第三方无歧义的执行。"）

本文按此组织：先给方案总览，再给代码事实基线，然后给出数据契约与编辑 API（无歧义规格）、实施计划、完整链路、风险红线、实测表达式范围、测试方案与决策表。

---

## 1. 方案总览

| 问题 | 结论 |
|---|---|
| 编辑模型 | **参数槽的源码区间精确编辑**：每个参数槽携带自己的源码区间（`ArgSource`），编辑 = 精确替换该区间，**不重印整行**，表达式原文永不丢失 |
| 粒度决策 | **显式双粒度**：引用型槽位向用户提供「改这一处」（局部，仅本语句）与「改定义」（全局，跳参数节点）两个明确入口，由用户选择，不做系统自动判定 |
| 参数行 | 成为 timeline 上的**一等节点**：可编辑、可跳转、可查引用；computed 派生参数（`const d = w * 2`）同样呈现 |
| 是否触碰现有只读闸门 | **P0 不触碰**（纯新增能力，零回归）；**P1 才放开** `hasComputedArgs` 一刀切，改为逐槽判定 |
| faijs 改动 | **只加不改**：新增 `ArgSource` 提取、`UiMetadata.names`、`validateExpression`、`editArgSource`；`StatementSummary` 与 `ParamEntry` 字段零改动 |
| 3d_editor 改动 | 参数节点、表达式编辑器、逐槽判定、backfill 引用槽感知、删除预检 |
| 执行模型 | 沿用 `updateSceneCode(old, new)` 全量重跑；不依赖增量执行，增量落地后自动受益 |

一句话：**管理"参数槽的源码原文"，由用户显式选择改哪里，系统保证改得精确、不丢失、可回滚。**

---

## 2. 代码事实基线（2026-09-08 源码复核，非文档推断）

### 2.1 执行通道：direct，参数与表达式是真 JS（有利事实）

- `CadRuntime.executorMode = 'direct'`（`packages/core/src/cad-runtime/runtime.ts:282`），3d_editor 用 `createRuntime(ports, mode)`（`3d_editor/src/engine/script-engine/ScriptEngine.ts:115/134`）走 direct 路径。
- direct 路径下 `const w = 40` 是**独立执行单元**（`direct-executor.ts:639-640` → `transformVariable`），`box(w * 2)` 由 JS VM 真实求值。
- **含义**：执行侧不存在"参数"这个实体类别，参数就是普通 JS 变量；改 `const w = 40` 这一行，全量重跑后所有引用者自动拿到新值。**"联动"在执行侧是免费的、天然正确的**。

### 2.2 UI 通道：metadata-extractor 会折叠掉表达式（核心障碍）

`packages/core/src/lang/metadata-extractor.ts`：

| 事实 | 位置 | 后果 |
|---|---|---|
| `tryFoldConstExpr` 优先折叠 `Unary/Binary/Logical/Template/Conditional` | `:379-391` | `w * 2` → `80`（值对，但表达式原文丢失） |
| 折叠成功且用到了参数 → `ctx.computed.value = true` | `:388-389` | 最终落成 `hasComputedArgs: true`（`:656`） |
| 折叠失败且在白名单内 → 落成 `expr-ref`（保原文） | `:392-404` | 仅当折叠失败时才保留表达式 |
| positional 的 `Identifier` 只查 `declared`，**不查 `paramNames`** | `:561-566` | positional 里的参数名一律判成 `var-ref`，不会产生 `param-ref` |
| `paramNames ⊆ declared`（参数名同时进两个集合） | `:1084-1085` | 上一条的直接原因 |
| `param-ref` 只在尾随选项对象的 `parseValueExpr` 里产生 | `:416-419`、`:475-479` | 参数引用形态只在 args 上成立 |
| 派生参数（`const d = w * 2`）→ `computed: true`，**不进 `paramNames`** | `:1090-1094` | 溯源表查不到它，"溯源到不可编辑表达式"断链 |
| 参数行进 `params[]`，**不进 `lines[]`** | `:1077-1087` vs `:1056-1061` | `analyzeCode` 只返回 lines ⇒ **参数行在 timeline 上不存在** |

### 2.3 宿主写回：整行重印，引用槽一律跳过

3d_editor `src/stores/core/script-store.ts:174-259` `updateStatementArgs`：

- 走 `formatCodeLine`（`faijs/packages/core/src/lang/codegen.ts:137`）**重印整行**；
- `:243` `if (isHostRef(oldArgs[key])) continue` —— **引用类型旧值永不被 patch 覆盖**（"引用即只读"的代码落点）；
- `formatCodeLine` 对 `expr-ref` 打印 `(原文)`（`codegen.ts:79`），**表达式可无损往返**——但整行重印会丢失行内注释、改写行内其它无法表示的形态，不能作为表达式编辑的载体。

### 2.4 Timeline 现状：三重只读闸门

`3d_editor/src/engine/components/panels/TimelinePanel.tsx`：

| 闸门 | 位置 | 效果 |
|---|---|---|
| R2：positional 含非 var-ref 元素 → 只读 | `:75-87`、`:155`、`:282` | param-ref / call-ref / expr-ref 一律弹"查看代码" |
| F1-E1：`hasComputedArgs` → 只读降级 | `:158`、`:185`、`:210` | 只要折叠用到过参数，整条语句不可编辑 |
| 无 Feature 匹配 → 不渲染 | `:196` | 参数行没有 StatementSummary，天然不渲染 |

`src/engine/features/arg-field.ts:12-16` `fieldEditState`：`isHostRef(value) → { editable: false }` —— 面板层同样只读。

### 2.4.1 现存隐患：R2 闸门与 backfill 能力不匹配

`primitive.ts:118-121` 的回填只认 `typeof pos[i] === 'number'`：

```ts
if (callee === 'box') {
  if (typeof pos[0] === 'number') params.width = pos[0]   // var-ref 是 object → 静默跳过
  ...
}
```

- `box(w, h, d)`（positional 全为 `var-ref`）→ R2 判定为"可编辑"（`:75-87` 只拦**非** var-ref）→ 进入编辑面板 → backfill 因 `typeof === 'object'` 静默跳过 → `width/depth/height` 缺失 → 面板显示空值/默认值 → 用户确认后把 `w, h, d` 写成默认值，**破坏模型且无报错**。
- 这说明：`hasComputedArgs` 只读闸门保护的并不只是"丢表达式"，它顺带挡住了一批 backfill 无能力处理的形态。**P1 放开闸门时，必须同时给 backfill 加引用槽感知**（回填不了就明确只读该槽，而不是静默跳过）。

### 2.5 update 的"增量"当前是全量重跑

`runtime.ts:602-605`：`updateDirectText(_oldCode, newCode)` → `executeDirectText(newCode)`，**丢弃 oldCode，整段重跑**。
（增量能力的 P0 方案见 `docs/plans/2026-09-08-update-incremental-p0-prefix-replay.md`，与本方案正交：本方案不依赖增量，增量落地后自动受益。）

---

## 3. 方案设计

### 3.1 核心思路

单一真源是**源码文本**（与 3d_editor 既有铁律一致：sceneCode 是真源、执行必须走 faijs）。因此：

1. **每个参数槽都携带自己的源码区间**（`ArgSource`）：知道自己在文本里的 `[start, end)`，编辑就是精确替换这一小段，不碰同行的其它部分——彻底消除"重印整行导致表达式丢失/注释丢失"的顾虑。
2. **值 / 表达式双表示**：折叠值继续用于几何无关的展示与兼容；表达式原文用于呈现与编辑。两者同时可见（`160` + `fx w*2`）。
3. **显式双粒度**：引用型槽位提供两个明确入口——「改这一处」（局部覆盖）与「改定义 w」（跳到参数节点，全局联动）。不做自动判定。
4. **参数行进入 timeline**：参数是一等公民节点，可编辑、可跳转、可查引用。
5. **编辑动作是 faijs 的纯函数**（`editArgSource`）：宿主拿到 `result.ok` 的新全文后走既有 `updateSceneCode`，不做任何自己的文本变换。

### 3.2 交互原则：显式双粒度（不做系统自动判定）

"由系统判定改定义 / 改局部 / 提升为参数"是个坏设计：

1. **不可预测**：用户点开一个输入框，系统可能改的是另一行代码。用户无法预期"我这次编辑会影响谁"。
2. **判定依据是启发式**（"改定义影响面过大就改局部"），阈值无法客观化，同类操作可能得到不同结果。
3. **"驱动参数提升"是低频需求**，却要求一整套"新增参数行 + 引用替换 + 位置合法性"的机制，投入产出比差。

替代思路：**把决策权还给用户，把精度交给系统**。系统负责"改得精确、不丢原文、可回滚"，用户负责"改这一处还是改定义"。

### 3.3 数据契约

新增类型放在 faijs 的 `metadata-extractor.ts`（随 `UiMetadata` 一起导出），**`StatementSummary` 与 `ParamEntry` 字段一个都不改**（参数行的 RHS 由 `argSources` 里的 `'rhs'` 槽覆盖，无需给 `ParamEntry` 加字段）。

```ts
/** 单个参数槽的源码来源信息（UI 通道新增，非 IR）。 */
export interface ArgSource {
  /** 所属语句 id（'s' + lineNo）；参数行的 rhs 槽同样使用 's' + lineNo */
  stmtId: StmtId
  /** 槽位路径，见 4.2.1 的路径命名表；对宿主是不透明标识符，只读后原样回传 */
  path: string
  /** 该槽的源码原文（字面量 → `40`；表达式 → `w * 2`；引用 → `w`） */
  text: string
  /** 字符区间 [start, end)，相对 extractMetadata 的入参 code（含 codeOffset 归一化） */
  start: number
  end: number
  /** 依赖的参数名（命中 paramNames） */
  params: string[]
  /** 依赖的其它变量名（命中 declared，含 op 产出） */
  refs: string[]
  /** 非平凡表达式（非字面量）→ UI 显示 fx 徽标 */
  isExpression: boolean
}
```

`UiMetadata` 增加两个字段（均为**新增字段**，现有消费者零影响）：

```ts
export interface UiMetadata {
  // … 现有字段不变 …
  /** 全语句参数槽的源码来源（按语句顺序；参数行的 RHS 槽 path = 'rhs'） */
  argSources: ArgSource[]
  /** 表达式校验白名单全集：paramNames ∪ declared ∪ nsBindings ∪ 本机函数名（按词法序去重） */
  names: string[]
}
```

> **偏移稳定性**：`argSources` 的偏移只在"本次提取对应的 code 文本"上有效。任何编辑后必须重新 `extractMetadata`（与现状 `replaceCodeAt` 后重新 `analyzeCode` 一致，不引入新的生命周期问题）。偏移失效由 `editArgSource` 内部断言拦截（见 3.4.2 步骤 4 与 6.1.1）。

### 3.4 faijs 编辑与校验 API（无歧义规格）

#### 3.4.1 `validateExpression`（新增文件 `packages/core/src/lang/expr-validate.ts`）

```ts
export interface ExprValidateInput {
  /** 待校验的表达式文本（不含语句上下文，单表达式） */
  text: string
  /** 已知名字白名单（参数名 ∪ 变量名 ∪ 命名空间名）；宿主从 UiMetadata.names 取 */
  knownNames: string[]
}
export type ExprValidateResult =
  | { ok: true }
  | { ok: false; code: 'E_SYNTAX' | 'E_REFERENCE' | 'E_VALUE'; message: string; line?: number }

export function validateExpression(input: ExprValidateInput): ExprValidateResult
```

约束：

- `validateExpression` 的职责**只回答"这个表达式文本在当前脚本里是否合法"**，不做参数/变量的精确分类——引用归属一律从 `meta.argSources` / `meta.params` 获取（分类需要符号表，宿主只有名字列表，无法区分；编辑提交通道 `editArgSource` 内部有完整符号表，那里才是精确分类的位置）。
- 结构白名单判定复用 `metadata-extractor.ts` 内部的 `isExprWhitelist`（`:266`）——**抽为共享导出或移入 expr-validate.ts 供 extractor 反向导入，唯一实现，不允许复制**。
- 名字判定规则必须与提取路径一致：表达式里每个 Identifier 必须命中 `knownNames`（命名空间成员表达式 object——`cfg.OUTX` 的 `cfg`——按命中处理），否则 `E_REFERENCE`。实现时把 `knownNames` 全量塞入符号表的 `paramNames`/`declared` 两个集合喂给共享收集函数即可（不区分分类，仅判定存在性——这是唯一语义放宽点，见上一条）。
- 与 `extractMetadata` 的完全同界由 `editArgSource` 保证（内部步骤 5 用真实符号表跑同一套判定规则）；`validateExpression` 是宿主的**实时反馈层**（输入即提示），提交时以 `editArgSource` 结果为准。
- 不调用 `assertSecure`——安全扫描由执行侧统一负责（extractMetadata 首行与 direct-executor 均跑 A1），校验层只管语法与引用。
- 导出到 `browser` 面，供 3d_editor 编辑器做实时校验与错误提示（接线见 4.2.4）。

#### 3.4.2 `editArgSource`（新增文件 `packages/core/src/lang/source-edit.ts`）

```ts
export type EditSourceError =
  | { kind: 'E_SLOT_NOT_FOUND'; message: string }   // stmtId+path 在 argSources 中无匹配
  | { kind: 'E_RANGE_STALE'; message: string }      // code.slice(start,end) !== src.text（偏移已失效）
  | { kind: 'E_PARSE'; message: string; line?: number }    // 原脚本本身无法提取（坏表达式/语法错→整体不可编辑）
  | { kind: 'E_SYNTAX'; message: string; line?: number }   // 新文本或替换后全文语法失败
  | { kind: 'E_REFERENCE'; message: string; line?: number } // 新文本引用了未声明名字
  | { kind: 'E_VALUE'; message: string; line?: number }     // 新文本不在表达式白名单

/**
 * 用 newText 替换 code 中 (stmtId, path) 槽位的源码区间，返回新全文。
 * 纯函数：不触碰任何运行时状态；结果 ok 时保证新文本语法可解析（执行侧仍全量校验语义）。
 */
export function editArgSource(
  code: string,
  stmtId: StmtId,
  path: string,
  newText: string,
  options?: ExtractMetadataOptions,
): Result<string, EditSourceError>
```

**路径约定（不透明标识符）**：`path` 必须等于 `meta.argSources` 中某条记录的 `path`（**字符串全等匹配，不解析结构**）。宿主不得自行构造 path，只能从 `ArgSource` 读取后原样回传。这保证嵌套对象槽位（`args.offset[1]` 等）无歧义。

**内部步骤（实现者照此执行）**：

1. `meta = extractMetadata(code, options)`——抛 `ParseError` 时**转为** `err({ kind: 'E_PARSE', message, line })` 返回（编辑面对已存在的坏脚本时应给"整体不可编辑"信号，不允许抛异常穿透）。`extractMetadata` 首行自带 `assertSecure`，此处天然继承安全门禁。
2. 在 `meta.argSources` 中查找 `stmtId + path` 全等匹配的记录；无 → `err({ kind: 'E_SLOT_NOT_FOUND', ... })`，message 携带 stmtId/path。
3. 匹配到多条（同名同路径理论上唯一；若出现取第一条）——实现按数组顺序取第一条即可。
4. **偏移断言**：`code.slice(src.start, src.end) !== src.text` → `err({ kind: 'E_RANGE_STALE', ... })`（宿主依此触发刷新流程，见 4.3.1）。
5. **新文本校验**：对 newText 做 acorn 单表达式 parse → 失败 `E_SYNTAX`；再查 `isExprWhitelist` → 失败 `E_VALUE`；再跑 `collectExprIdentifiers`（knownNames = 内部符号表 paramNames ∪ declared ∪ nsBindings ∪ localFnParams）→ 未知名 `E_REFERENCE`。
6. **splice**：`newCode = code.slice(0, src.start) + newText + code.slice(src.end)`（纯字符串拼接，不做任何格式化/规范化；JS UTF-16 下标与 acorn 的 start/end 一致，CRLF 无影响）。
7. **全量回验**：对 newCode 做一次 acorn `module` 级 parse（不跑安全扫描）→ 失败 `E_SYNTAX`（防线：保证"编辑通过"的 code 至少语法可解析；执行侧 update 会做完整校验，宿主照常处理 failedAt）。
8. 返回 `ok(newCode)`。

**明确不做**：

- 不新增 `findParamUses`（宿主过滤 `argSources` 中 `params.includes(name)` 三行可算，见 4.3.4）。
- 不做表达式的值回写/规范化/安全扫描（职责分层见步骤 1/5）。

---

## 4. 实施计划

### 4.1 分期总表

| 阶段 | 内容 | 是否触碰现有只读闸门 | 测试改写量 |
|---|---|---|---|
| **P0** | faijs：`ArgSource` 提取（含参数行 rhs 槽）+ `UiMetadata.names` + `validateExpression` + `editArgSource`；3d_editor：T1 参数节点 + T2 表达式编辑器 + T0 编辑确认流程 | **否**（参数节点是新增，不改动任何 op 语句的现有行为） | **0** |
| **P1** | T3 op 槽 `fx` 徽标 + 逐槽判定取代 `hasComputedArgs` 一刀切 + backfill 引用槽感知 + T4 删除预检 + 参数重命名 | 是 | 1 条（`TimelinePanel.test.tsx:210`） |

**P0 结束时用户诉求已达成**：参数与表达式在 timeline 上可见、可编辑、可溯源。P1 是把它扩展进 op 语句的参数槽。

> **与增量执行计划的关系（已确认）**：`docs/plans/2026-09-08-update-incremental-p0-prefix-replay.md`（另一 agent 开发中）改的是 `update` 的执行范围。本方案只用既有的 `updateSceneCode(old, new)` 入口，**不依赖增量、也不与之冲突**。参数声明行通常位于脚本前部，改参数 → 公共前缀扫描的最小变更点靠前 → 前缀重放区间接近全量但仍是单遍，语义与全量一致；增量落地后本方案自动受益，无需改动。

### 4.2 faijs 侧改动（全部落在 P0）

#### 4.2.1 P0-A：`ArgSource` 提取（`metadata-extractor.ts`）

**提取位置**：`parseValueExpr` / `parsePositionalArgs`（含 `classifyDestructure` 的实参、`classifyExpression` 的重赋值实参——凡进入这两个函数解析的表达式节点）在**折叠之前**记录：无论折叠成功与否，原文与区间都要产出。这是治愈 2.2 的关键——折叠不再等于丢失。

**记录方式**：

- 在 `ValueParseCtx` 增加 `argSources: ArgSource[]` 累积数组，外加当前路径段（父路径传入）。
- `parseValueExpr(node, ctx, path)` 入口处（折叠逻辑之前）压入一条 `ArgSource`，再递归子节点（数组元素 `[i]`、对象属性值 `<key>` 拼接路径）。
- `parsePositionalArgs` 对每个实参节点压入 `positional[i]`。
- `isExpression` = 节点类型不是 `Literal`（负字面量 `-5` 视为字面量，与 `:1068-1076` 的同构判定一致）。
- `text` = `parseCode.slice(node.start, node.end)`；`start/end` = 节点区间 `- codeOffset`（与 `FunctionEntry.bodyRange` / `BlockEntry.range` 同款归一化）。
- `params` / `refs` 复用 `collectExprIdentifiers`（`:296`）的结果，不重复实现。

**路径命名表**（全部为**不透明标识符**，仅要求提取端与 `editArgSource` 全等匹配一致）：

| 槽位 | path 示例 |
|---|---|
| 位置实参 | `positional[0]`、`positional[2]` |
| 尾随选项对象属性值 | `args.size`、`args.offset` |
| 数组元素（嵌套） | `args.offset[1]`、`positional[0][2]` |
| 对象属性值（嵌套） | `args.points[0].x` |
| call-ref 的实参 | `args.normal[0]`（即 call-ref 内部实参按同规则继续编号） |
| 参数行 RHS | `rhs`（**保留路径段**，仅参数行使用） |

**参数行 rhs 槽**（`VariableDeclaration` 分支，`:1030-1099`）：

- 字面量参数行（`:1064-1088`）：压入一条 `ArgSource`：`stmtId='s'+dlineSrc`、`path='rhs'`、`text`=init 原文、`isExpression=false`、`params/refs=[]`。
- computed 参数行（`:1090-1095`）：同样压入一条：`text`=init 原文、`isExpression=true`（非字面量 init）、`params/refs`= `collectExprIdentifiers` 结果。
- 由此**`ParamEntry` 无需任何新字段**（原文/区间/依赖全部从 `argSources` 的 `rhs` 槽获取），现有 `params` 消费者零影响。

**spread/shorthand 等边界形态**：`SpreadElement` 的 argument 按普通表达式节点记一条（path 为所在槽位路径 + 展开的 `[i]` 由数组元素规则覆盖）；对象 `shorthand` 属性以属性名为 `text` 记一条（`path='args.<key>'`，`isExpression=false`）——保证 `{ size }` 形态可编辑。

**导出**：`extractMetadata` 结果新增 `argSources`；类型随 `UiMetadata` 从 `browser.ts` 导出（接线见 4.2.4）。

#### 4.2.2 P0-B：`UiMetadata.names` 集合（`metadata-extractor.ts`）

- 在 `extractMetadata` 返回前，从内部符号表收集 `paramNames ∪ declared ∪ nsBindings.keys() ∪ localFnParams.keys()`，按词法序去重输出 `names`。
- 用途：宿主实时校验 `validateExpression` 的 `knownNames` 直取；**宿主不自己拼装白名单**（避免与执行侧符号表漂移）。

#### 4.2.3 P0-C：`validateExpression`（新文件 `lang/expr-validate.ts`）

按 3.4.1 规格实现。注意：`isExprWhitelist` 与 `collectExprIdentifiers` 从 `metadata-extractor.ts` 抽为共享导出（本文件定义、extractor 导入，或 extractor 导出、本文件导入——二选一，**唯一实现**，不复制）。`collectExprIdentifiers` 需要符号表参数（`paramNames/declared/nsBindings` 集合）——`expr-validate.ts` 内部构造轻量符号表：`paramNames = declared = knownNames` 全集，`nsBindings` 不填（不区分分类、仅判定存在性，见 3.4.1）；`metadata-extractor.ts` 内部继续用真实符号表精确分类。两处调用同一个共享函数，不允许各自实现一套名字判定。

#### 4.2.4 P0-D：`editArgSource`（新文件 `lang/source-edit.ts`）与导出接线

- 按 3.4.2 规格实现。`Result/ok/err` 从 `../vendored/brepjs/core/result.js` 导入（该文件位于 `packages/core/src/lang/source-edit.ts`，故相对路径为 `../vendored/...`；同款导入先例：`api/generated/core.ts:147` 的 `export { ok } from '../../vendored/brepjs/core/result.js'`，注意 api 目录层深一层）。
- **browser 面接线**（`browser.ts` A 类区，`:66-70` 附近追加）：
  ```ts
  export { validateExpression } from './lang/expr-validate'
  export type { ExprValidateInput, ExprValidateResult } from './lang/expr-validate'
  export { editArgSource } from './lang/source-edit'
  export type { EditSourceError } from './lang/source-edit'
  ```
- `ArgSource` 类型加进 `:67-70` 的 `UiMetadata` 类型导出行。

**兼容红线**：`StatementSummary` 字段一个都不改；`ParamEntry` 不改；`extractMetadata` 现有返回字段不动，仅**新增** `argSources` / `names`——`analyzeCode` 投影（`statement-summary.ts`）与 A-16 对拍不受影响。

### 4.3 3d_editor 侧改动

#### 4.3.1 T0：编辑确认流程（复用 `ScriptEngine.updateSceneCode`，无新纯函数文件）

`src/engine/param-edit/param-edit.ts`（新文件，UI 无关的编排逻辑）：

```ts
/** 尝试提交一次槽位编辑；返回是否成功。 */
export async function commitArgEdit(opts: {
  code: string                    // 当前 sceneCode
  stmtId: string
  path: string
  newText: string
  editMeta: ExtractMetadataOptions  // 与宿主 extractMetadata 同参（defaultNs/namespaces/security）
}): Promise<{ ok: true } | { ok: false; error: EditSourceError }> {
  const res = editArgSource(opts.code, opts.stmtId, opts.path, opts.newText, opts.editMeta)
  if (!isOk(res)) return { ok: false, error: res.error }
  // undo 快照必须在改码之前 push（与 handleNodeDelete 的 pushSnapshot 同位置约定）
  useUndoStore.getState().pushSnapshot('undo.label.editParam')
  await ScriptEngine.updateSceneCode(opts.code, res.value)
  return { ok: true }
}
```

**调用方（UI）必须遵守的流程**：

1. 编辑前 `validateExpression({ text: newText, knownNames: meta.names })` 做实时校验（输入即提示，不等提交）。
2. 提交走 `commitArgEdit`（内含 `editArgSource` + `pushSnapshot` + `updateSceneCode`）。
3. **`E_RANGE_STALE` 自动恢复**（断言失败不得静默忽略、也不得把旧值写回）：提示「代码已变化，正在刷新…」→ 重新 `extractMetadata(sceneCode)` 刷新 `argSources` → 用刷新后的 `path/区间` 重新发起一次编辑；仍失败则明确报错并关闭编辑面板（数据不一致时宁可不改，见 6.1.1）。
4. **`E_PARSE` 整体降级提示**（坏表达式场景）：当前脚本无法提取时（如含 `Math.max` 这类非法表达式），编辑功能整体不可用——UI 在参数节点/编辑面板上显示「脚本存在无法解析的表达式，请先在代码中修正」并**保留「查看代码」入口**（该入口读 sceneCode 原文，不依赖提取）。不允许表现为节点消失或静默失败（见 6.1.2）。
5. 编辑成功 → 等待 `updateSceneCode` 完成 → 重新 `extractMetadata`（statementIndex/argSources 全部重建），UI 从新 meta 渲染。

#### 4.3.2 T1：timeline 参数节点（`TimelinePanel.tsx`）

- 数据源新增：`const meta = useMemo(() => extractMetadata(sceneCode), [sceneCode])`（当前宿主尚未调用 `extractMetadata`，这是首次引入）。
- 归并：`meta.params`（`lineNo`）+ `meta.lines`（`line`）合成一个按行号升序的 `TimelineItem[]`，item 增加 `kind: 'op' | 'param'`。
- **一行多参**：`const w = 40, h = 20` 时同一 `lineNo` 有两条 `ParamEntry` ⇒ 同一行位置渲染**两个并列参数节点**。判定与 key：
  - 节点 key 用 `param:${name}`（**不是 lineNo**）；
  - 编辑/删除一律走**区间**（`editArgSource` 的 `'rhs'` 槽各自独立区间，互不影响），**禁止行级整行替换**；
  - 归并时参数行不再渲染成一个 op 节点（参数行本就不在 `statementIndex` 中，无冲突）。
- 参数节点渲染：专用图标 + 标签 `w = 40`（computed 显示 `d = w*2`），`fx` 徽标（`isExpression` 时）。
- 交互：
  - 单击 → 打开参数编辑 popover（输入框 + 实时校验，knownNames = `meta.names`）；
  - 确认 → `commitArgEdit`（路径 `'rhs'`）；
  - 右键菜单：编辑 / 查看代码 / 删除（有引用时预检并阻止，见 T4）/ **查找引用**（高亮引用它的 op 节点）。
- 风险：参数行不在 `statementIndex` 里，`getLineById(stmtId)` 取不到 —— 参数节点直接用 `meta.params[i].lineNo` 取行文本，不复用 `getLineById`。

#### 4.3.3 T2：表达式编辑器（`src/engine/param-edit/ExpressionField.tsx`）

- 一个受控输入 + 校验状态（复用 `validateExpression`）+ 已知名字自动补全（可选，P2）。
- 显示在两处：① 参数节点 popover；② op 编辑面板中带 `fx` 徽标的字段（P1）。
- 输入即所见：`w * 2` 原样提交，不做求值、不做规范化。

#### 4.3.4 T3：op 编辑面板：引用槽可编辑（P1，替换现有只读）

- 逐槽判定替代一刀切：
  - `arg-field.ts:12-16` 的 `fieldEditState` 改为返回三态：`editable-literal` / `editable-expression`（有 `ArgSource`）/ `readonly`（无 `ArgSource`，如第三方库调用槽）。
  - `TimelinePanel.tsx:158/185/210` 的 `hasComputedArgs` 一刀切只读**降级为**：`hasComputedArgs` 只影响"是否显示 fx 徽标"，不再阻断编辑。
- 引用槽的 `fx` 徽标下拉提供**显式双粒度**：
  - 「编辑此处的表达式」→ `editArgSource` 该槽（局部，仅本语句）；
  - 「编辑参数定义 w」→ 跳转参数节点（T1）并高亮全部引用者（全局）；**表达式依赖多个参数时下拉列出全部依赖**（子菜单逐项跳转）。
- **backfill 引用槽感知**（P1 必备，缺一不可）：`primitive.ts:118-129` 等 backfill 增加 `ArgSource` 感知——有 `ArgSource` 且可编辑 → 回填 `src.text`；无法回填 → 该槽**明确只读并显示原值**，禁止静默跳过、禁止写默认值。所有 Feature 的 backfill 一体改造（`transform.ts` / `fai_drill.ts` / `chamfer.ts` / `engrave.ts` / `fai_extrude.ts` / `knurl.ts` / `fai_split.ts` 逐一核对引用槽形态）。
- `script-store.ts:243` 的"引用类型旧值不被 patch 覆盖"保留**作为兜底**（无 `ArgSource` 的槽仍然安全），但在有 `ArgSource` 时走 `editArgSource` 通道。

#### 4.3.5 T4：删除/重命名的引用预检（P1）

- 删除参数前：`argSources` 中 `params` 含该名且非自身 `rhs` 槽的条目非空 → 阻止并提示「被 N 处引用」（删除会让 update 抛 `E_REFERENCE`）。实现即宿主过滤，**不新增 faijs API**（`argSources.filter(s => s.params.includes(name) && s.path !== 'rhs').length`）。
- 参数重命名：先替换全部引用槽（`editArgSource` 逐个，按刷新后的 argSources 依序），再替换定义行 `'rhs'`。列 P2，非必需。

### 4.4 一次编辑的完整链路（局部粒度示例）

```
用户在 timeline 点开 box 节点 → 编辑面板「width」字段显示 160 与 fx 徽标 (w*2)
  ↓ 点击 fx → 「编辑此处的表达式」
ExpressionField 输入 "w * 3" → validateExpression({text, knownNames: meta.names})（语法 ok，w ∈ knownNames）
  ↓ 确认
commitArgEdit({ code, stmtId, path: 'positional[0]', newText: 'w * 3' })
  ↓ editArgSource 内部：extractMetadata → 定位 argSources → 偏移断言 → 校验 → splice → 全量回验
ScriptEngine.updateSceneCode(oldCode, newCode)
  ↓ faijs update → direct 全量重跑（未来：前缀重放增量）
commitSceneResult → 几何更新；statementIndex 重建；extractMetadata 重新提取 argSources
```

全局粒度链路相同，只是 `path` 换成参数行的 `'rhs'`；跳转由 UI 完成。

---

## 5. 风险与红线

| 风险 | 处理 |
|---|---|
| 偏移失效（编辑后旧 ArgSource 过期） | `editArgSource` 内部断言 `code.slice(start,end) === src.text`，不符返回 `E_RANGE_STALE`；宿主自动刷新（重提取 → 重试一次 → 仍失败则关闭面板并报错），**禁止静默忽略或写回旧值**（见 4.3.1-3） |
| 脚本含坏表达式 → 提取整体失败 | `E_PARSE` 明确降级：保留「查看代码」，编辑入口提示先修代码；**禁止表现为节点消失或静默失败**（见 4.3.1-4）。这是"能提取=能执行=能编辑"三方同界的自然结果（§7），不是缺陷 |
| 折叠值与表达式不一致（显示 `160` 但原文 `w*2`） | 两者同框显示，值用于展示、表达式用于编辑；不做"值回写覆盖表达式" |
| 用户输入恶意表达式 | 执行侧 A1 安全扫描已覆盖（`extractMetadata` 首行 + `direct-executor`）；校验层只做语法/引用，不重复安全职责 |
| 一行多参（`const w=40, h=20`） | 参数节点 key 用参数名、编辑/删除走各自 `'rhs'` 区间，禁止行级整行替换（见 4.3.2） |
| undo 缺失 | 每次 `editArgSource` 成功后、`updateSceneCode` 前必须 `pushSnapshot`（见 4.3.1）；与删除操作的既有约定同位置 |
| `hasComputedArgs` 放开后的回归 | 现有 R2/F1-E1 的只读测试会红，需按新语义改写（T3），不是删除断言；backfill 引用槽感知必须同批交付（见 4.3.4） |
| 参数行与 statementIndex 双源 | 参数节点只用 `meta.params`，不伪造 StatementSummary；两者按 lineNo 归并，不合并成一种类型 |
| `validateExpression` 白名单与执行侧漂移 | `knownNames` 直取 `UiMetadata.names`（提取端符号表导出），宿主不自行拼装；判定规则与提取共用同一份实现（4.2.3） |
| 本方案与增量执行计划的关系 | 正交：本方案只用 `updateSceneCode(old, new)`；前缀重放落地后自动获得增量收益，无需改动 |

---

## 6. 可编辑的表达式范围（2026-09-08 实跑验证，非推断）

**前提事实**：UI 通道与执行通道**共用同一个解析器**——`runtime.ts:537` 的 `executeDirectText` 与 `analyzeCode` 都调用 `extractMetadata`。因此"能提取"="能执行"="能编辑"三者同界，**不会出现"编辑通过但执行报错"**。本方案的 `validateExpression` / `editArgSource` 复用同一套规则，刻意保持这个性质。

**判定规则的两道闸门**（`metadata-extractor.ts`）

| 闸门 | 位置 | 规则 |
|---|---|---|
| 结构白名单 `isExprWhitelist` | `:266-293` | Literal / Identifier / Unary / Binary / Logical / Conditional / Array / MemberExpression（非可选链）/ CallExpression（非可选链、无 spread） |
| 引用必须已声明 `collectExprIdentifiers` | `:296-313` | 表达式里的 Identifier 必须命中 `paramNames`、`declared` 或 `nsBindings`，否则 `E_REFERENCE` |

**实测清单**（`extractMetadata` 实跑 20 例）

| 表达式 | 结果 | 当前槽位形态（实测） | 本方案实施后 |
|---|---|---|---|
| `20` / `[1,2,3]` / `'txt'` | ✅ | 字面量，`computed=false` | 可编辑（值） |
| `w`（参数引用，args 槽） | ✅ | `param-ref`，`computed=false` | 可编辑（值/表达式双粒度） |
| `w`（参数引用，positional 槽） | ✅ | **`var-ref`**（`:561-566` 先查 declared） | 可编辑（同上） |
| `w * 2` | ✅ | **折叠成 `80`**，`computed=true` | ✅ 可编辑——`ArgSource` 在折叠前取回原文 `w * 2`（本方案的核心收益） |
| `-w` | ✅ | 折叠成 `-40`，`computed=true` | ✅ 可编辑（原文保回） |
| `w > 10 ? 20 : 30` | ✅ | 折叠成 `20`，`computed=true` | ✅ 可编辑（三元条件） |
| `w \|\| 15` | ✅ | 折叠成 `40`，`computed=true` | ✅ 可编辑（逻辑运算） |
| `` `w-${w}` `` 模板字符串 | ✅ | 折叠成 `"w-40"`，`computed=true` | ✅ 可编辑 |
| `[w, 2, 3]` 数组元素 | ✅ | 元素保 `param-ref`，`computed=false` | ✅ 可编辑（含逐元素 `args.x[0]` 路径） |
| `cfg.OUTX`（命名空间成员） | ✅ | **`expr-ref` 保原文**，`computed=true` | ✅ 可编辑 |
| `cfg.max(w, 20)`（命名空间调用） | ✅ | **`call-ref`**，`computed=false` | ✅ 可编辑（一等支持） |
| `cfg.OUTX * 2` | ✅ | **`expr-ref` 保原文** `cfg.OUTX * 2` | ✅ 可编辑 |
| `cad.faceNormal(p)` 嵌套调用 | ✅ | `call-ref`（`p` 必须已声明） | ✅ 可编辑 |
| `d`（`const d = w * 2` 派生参数引用） | ✅ | `var-ref`，**`computed=false`** | ✅ 可编辑（值）；全局粒度待附录 A 的 A1 决策 |
| `const w = 40` 参数定义行 | ✅ | 在 `params[]`，`computed=false` | ✅ **P0 新增为 timeline 节点** |
| `const d = w * 2` 派生参数定义行 | ✅ | 在 `params[]`，`computed=true`，`value=undefined` | ✅ **P0 新增为 timeline 节点** |
| `Math.max(w, 20)` | ❌ | `unknown identifier "Math" in expression`（`E_REFERENCE`） | ❌ 仍然不可用（见下方说明） |
| `new Number(w)` | ❌ | `unsupported value expression: NewExpression` | ❌ |
| `(() => w)()` 箭头/IIFE | ❌ | `nested calls in args must be <ns>.<ident>(...) or a whitelisted expression` | ❌ |
| `{ ...o }` 对象展开 | ❌ | `cannot statically evaluate object spread in args` | ❌ |
| `a?.b` 可选链 | ❌ | `isExprWhitelist` 显式返回 false（`:282`/`:286`） | ❌ |

**三条需要知道的边界**

1. **今天 UI 上几乎看不到表达式**：除 `cfg.X` 这类折叠失败的情形外，所有算术/条件/逻辑/模板表达式都被折叠成值。所以"表达式可编辑"这件事现在在界面上是空的——本方案把它变实。
2. **全局对象（`Math` 等）不能直接出现在表达式里**，这是最反直觉的一条：`Math.max(w, 20)` 是合法 JS，但在 faijs 里会让整段脚本解析失败（UI 与执行同源），且会导致该脚本的**编辑功能整体降级**（`E_PARSE`，见 5）。
   - 实测可行的写法：先 `const max = Math.max` 提升为已声明变量，再用 `max(w, 20)` → 落成 `expr-ref{text:'max(w, 20)', refs:['max'], params:['w']}`，执行侧 hoist 为 `__ctx.max = Math.max`，JS VM 里可正常求值。
   - 代价：参数行的 `const init` 走 `:1091` 分支时**不做表达式校验**（宽松口子）。这是特性还是漏洞需要产品定夺——若收紧，`Math` 就彻底不可用。
3. **一等支持的是命名空间成员/调用**（`cfg.X`、`cfg.fn(...)`），不是裸全局。想给脚本提供函数库，应当走 `import * as cfg` 而非依赖宿主全局。

**多变量表达式（2026-09-08 实跑确认）**

`width + tolerance` 这类**多变量组合表达式完全支持**，且不依赖本方案——数据结构天然就是集合形态（`HostExprRef.params/refs` 均为数组，`collectExprIdentifiers` 对 BinaryExpression 递归左右子树各自收集）：

| 表达式（前置声明齐全） | 实测结果 |
|---|---|
| `width + tolerance`（两字面量参数） | ✅ 折叠成 `40.2`，`computed=true` |
| `width * 2 + tolerance`（复合） | ✅ 折叠成 `80.2` |
| `[width + tolerance, 20, 30]`（数组内多变量） | ✅ 折叠成 `[40.2, 20, 30]` |
| `width + part0`（数值参数 + 几何输出） | ✅ 折叠失败 → **`expr-ref` 保原文**，`params:['width']`、`refs:['part0']` |
| 引用未声明变量 | ❌ `SEC_FREE_IDENT`（安全扫描拦截） |

对本方案的含义：

1. `ArgSource.params/refs` 天然容纳多个变量；编辑 `width + tolerance` → `width * 2 + tolerance` 只是源区间替换，校验时两个名字都在 `knownNames`（= `meta.names`）即通过。
2. **联动也是免费的**：改 `width` 或 `tolerance` 任一定义行 → 全量重跑（未来前缀重放）→ 表达式重算。
3. **UI 细节（P1）**：表达式有多个依赖时，fx 徽标的「编辑参数定义」下拉需列出**全部依赖变量**（子菜单逐项跳转），而不是单个目标。
4. **可选增强**：`width + part0` 这种"几何输出参与算术"结构上被 UI 通道接受，但执行语义可疑（Shape + number）；`validateExpression` 可对"refs 中含 op 产出变量且参与算术"给出**软警告**（不阻止——变量类型在 UI 通道不可全知，误报风险存在）。

---

## 7. 测试方案

**faijs（`packages/core/src/lang/`）**

1. `argSources` 提取：字面量槽 / 参数引用槽 / 二元表达式槽 / 嵌套 call-ref / 数组元素槽 / 对象键槽 / 折叠成功与失败的槽都要有记录；
2. 参数行 `rhs` 槽：字面量行、computed 行、负数字面量行、**一行多参**（`const w=40, h=20` 两条记录、区间各自正确）；
3. 偏移正确性：单行语句、多行语句、CRLF、含 `codeOffset` 的封装场景（扁平带 import / 扁平无 import / container 三种）、`code.slice(start,end) === text` 全等断言；
4. `UiMetadata.names`：参数 ∪ 变量 ∪ 命名空间 ∪ 本机函数，词法序去重；
5. `validateExpression`：合法表达式、未知标识符 `E_REFERENCE`、非白名单节点 `E_VALUE`、语法错 `E_SYNTAX`、命名空间成员表达式（`cfg.OUTX`、`cfg.fn(w)`）判定通过；
6. `editArgSource`：正常替换返回新全文 / `path` 不存在 `E_SLOT_NOT_FOUND` / 篡改 code 后 `E_RANGE_STALE`（偏移失效模拟）/ 新文本语法错 `E_SYNTAX` / 引用未声明 `E_REFERENCE` / 原脚本含 `Math.max` → `E_PARSE` / 替换后全文回验失败 → `E_SYNTAX` / 连续两次编辑同一槽（第二次基于第一次结果重新提取）；
7. 兼容：现有 `metadata-extractor.test.ts` / `statement-summary.test.ts` 全部保持绿（`StatementSummary`、`ParamEntry` 未改，`analyzeCode` 投影不变）。

**3d_editor**

1. `commitArgEdit` 编排：成功链路 pushSnapshot 出现在 `updateSceneCode` 之前；`E_RANGE_STALE` 自动恢复（重提取 → 重试）；`E_PARSE` 降级提示不抛异常；
2. `TimelinePanel` 参数节点：渲染、按行号与 op 节点正确交错、computed 参数显示原文、**一行多参渲染两个节点且各自编辑互不影响**；
3. 编辑 e2e：改参数值 → 引用它的 op 几何更新（局部粒度只改本语句、全局粒度改全部）；undo 一步回滚（快照恢复 sceneCode 与几何）；
4. 往返一致性：编辑 → `extractMetadata` → 再编辑，无漂移、无重复包裹括号；
5. 删除预检：删除被引用参数被阻止并提示引用数；
6. 坏表达式脚本：`Math.max` 场景下参数节点显示降级提示、保留「查看代码」，其余可编辑节点不受影响；
7. 回归：原只读场景（第三方库节点、无 Feature 匹配）行为不变。

---

## 8. 决策与待确认（均已带默认决策，可直接执行）

| # | 问题 | 决策（默认） | 变更条件 |
|---|---|---|---|
| 1 | 显式双粒度 vs 系统自动判定 | **显式双粒度（已定）**：引用槽挂 fx 徽标，下拉给「编辑此处的表达式」（局部）与「编辑参数定义 w」（全局）——用户显式选粒度，系统不做判定 | 无 |
| 2 | computed 参数（`const d = w * 2`）是否并入 `paramNames` | **P0 选 A3（不动）**，P1 随逐槽改造一起切 A1（只进 `paramNames`、不进 `paramValues`）——完整分析见附录 A | 无（P1 已绑定） |
| 3 | 参数节点是否也进 FeatureTreePanel | **本期不做**（本文只覆盖 Timeline）；特征树是否同步呈现参数，产品可后续决定 | 产品决策后另立方案 |
| 4 | faijs 是否提供 `findParamUses` | **不提供**：宿主过滤 `argSources` 三行可算（4.3.5）；删除预检、引用高亮、影响面提示全部宿主侧实现 | 宿主出现多处重复实现时再议 |
| 5 | P0 是否放开 `hasComputedArgs` 只读闸门 | **不放开**（P0 只加参数节点，零回归）；P1 放开时同批交付三件事：① 逐槽判定取代一刀切；② backfill 引用槽感知（含"回填不了就只读该槽"的显式降级）；③ `TimelinePanel.test.tsx:210` 那条断言按新语义重写（断言"有编辑项、点击进编辑面板、size 字段显示 `120` 与 fx 徽标 `base + 20`"）——完整分析见附录 B | 无（P1 已绑定） |

---

## 附录 A：computed 参数是否并入 `paramNames`

**现状（源码复核）**

| 声明 | 进 `paramNames` | 进 `paramValues` | 进 `params[]` | 在引用槽里的形态 |
|---|---|---|---|---|
| `const w = 40`（字面量） | ✅ `:1084` | ✅ `:1086` | ✅ `computed:false` | positional → `var-ref`（`:561-566` 先查 declared）；args → `param-ref`（`:418`） |
| `const d = w * 2`（computed） | ❌ `:1090-1094` 只 add declared | ❌ | ✅ `computed:true` | 一律 `var-ref`；在 `collectExprIdentifiers` 里进 `refs` 而非 `params`（`:309-310`） |

由此产生两个后果：

1. **行为不一致**：同样是"引用一个常量"，`box(w * 2)` 会被折叠成 `80` 并置 `hasComputedArgs`（`:386-389`），而 `box(d)` 因 `d` 不在 `paramNames` 而折叠失败（`:161`）、保留 `var-ref`。一个丢原文、一个保名字。
2. **引用集合算不出来**：`d` 的引用者被记在 `refs`（与几何输出引用 `part0` 混在一起），无法与"参数引用"区分 ⇒ 「编辑参数定义 d」的全局入口拿不到引用集合 ⇒ 双粒度的"全局"分支对 computed 参数不可用。

**三种选项**

| 选项 | 做法 | 收益 | 代价 |
|---|---|---|---|
| **A1（P1 采用）** | 进 `paramNames`，**不进 `paramValues`** | `d` 有稳定参数身份；引用集合可精确计算；**不会被折叠**（`tryFoldConstExpr:163` 对 `paramValues` 缺失已返回 `ok:false`，无需改折叠逻辑） | `d` 在 UI 通道由 `var-ref` 变 `param-ref`（`:418` 优先命中）⇒ 宿主页形态变化，3d_editor 的 R2 闸门（非 var-ref 即只读）会把它判为只读，**必须等 P1 逐槽改造完成后才能上**，否则比现状更糟 |
| A2 | 进 `paramNames` + 进 `paramValues` | 与字面量参数完全同构 | 引入"派生参数值快照"——改 `w` 后 UI 显示 `d` 的旧折叠值，与执行结果不一致；这正是我们要治的病 |
| A3（P0 采用） | 维持现状 | 零改动 | computed 参数永远只能用局部粒度，且它的引用者与几何输出引用无法区分（影响 T4 删除预检的准确性） |

**结论**：这是"派生常量算不算参数"的产品语义问题，不是纯技术选择。A1 的实现量极小（`paramNames.add` 一行），但它的**上线时点被 P1 卡住**，且会改变宿主可见的参数形态。P0 选 A3（不动）先把能力建起来，P1 随逐槽改造一起切 A1。

## 附录 B：`hasComputedArgs` 闸门放开的真实成本

**实测成本（2026-09-08 全仓 grep）**

- `hasComputedArgs` 全仓共 9 处引用：3d_editor 侧 3 处生产代码（`TimelinePanel.tsx:158/185/210`）+ 1 处测试断言（`TimelinePanel.test.tsx:216`）+ 1 处测试数据构造（`assemble-store.test.ts:44`）；faijs 侧仅生产代码。
- `TimelinePanel.test.tsx` 全文 7 个 `it`，**只有 1 个**（`:210`「计算参数节点（base+20）：右键菜单无「编辑」，点击节点打开「查看代码」而非表单」）断言只读降级。其余用「查看代码」的用例是断言"可编辑节点也有查看代码项"，**不受放开影响**。
- 结论：**测试改写量 = 1 条断言**。

**但真实成本不在测试，在 backfill**

F1-E1 当初加这个闸门，防的是两件事，而测试只覆盖了其中一件：

| 防的是什么 | 现状 | 放开的后果 |
|---|---|---|
| ① 写回丢表达式（面板显示 `120`、写回后 `base + 20` 没了） | 有效挡住 | **本方案已解决**：有 `ArgSource` 就走源区间精确替换，不再重印整行 ⇒ 这一条不再需要闸门 |
| ② backfill 无能力处理引用形态，静默丢参数 | 顺带挡住（但漏了 var-ref，见 2.4.1） | **仍未解决**：`primitive.ts:118-121` 只认 `number`，引用槽被静默跳过 ⇒ 放开后会出现"面板空值 → 确认 → 参数被写成默认值且无报错" |

所以准确的表述是：**放开闸门的可行性取决于 P1 是否同时给 backfill 加引用槽感知**（有 `ArgSource` 且可编辑 → 回填表达式文本；无法回填 → 该槽明确只读，而不是静默跳过）。

**结论**

- P0 **不放开**（只做新增能力，零回归）；
- P1 放开时，必须同批交付三件事，缺一不可：① 逐槽判定取代一刀切；② backfill 引用槽感知（含"回填不了就只读该槽"的显式降级）；③ 那 1 条测试按新语义重写（断言"有编辑项、点击进编辑面板、size 字段显示 `120` 与 fx 徽标 `base + 20`"）。
