# Phase 3 技术实施方案：命名规则与 StmtId / partName 分离（2026-08-26 复核修订版）

> 本文档是 `docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md` 中 **Phase 3「命名规则与 StmtId/partName 分离」** 的细化方案。
> 仅写方案，不改代码。本版基于 **2026-08-26 对两个仓库实际代码的二次核对**：所有 file:line 引用已按 faijs HEAD（`1d0ca65`）与 3d_editor 当前 main 逐行校正，并补齐了上一版遗漏的波及点（compile.ts / runtime.ts / exec-context / internal-stdlib-adapter / transform feature），保证方案按本文档可落地。

---

## 0. 基线校正（重要：推翻上一轮分析的部分前提）

上一轮分析称「2.8 半截、typecheck 14 处 `returnType` 全红」——**该结论已不成立**。2026-08-26 实测：

- `cd faijs && npx tsc --noEmit` → **0 个 error TS**。
- `src/` 下已无 `CadStatement.returnType` 字段引用；四分类 `ReturnType` 类型已删除（`grep returnType` 仅命中 `args-schema.ts:29` 注释，与 `ReturnType<typeof ...>` 内置工具类型，均无关）。
- `validateStatementArgs`（`src/lang/args-schema.ts:68`）已基于 schema 表的 `void` 标志处理 add_constraint/do_assemble 等无输出 op。

**上一轮的另一个前提也已变化（2026-08-26 复核发现）**：上一版把 T3-cond（终端判定移执行收尾）与 T8（executeScriptDiff）标为「阻塞于 2.9（3d_editor 改用 CadRuntime.execute/append/update）」。**实测 2.9 已经落地**：

- `executeScript.ts:203`（`_executeScriptImpl`）已 `runtime.execute(script, ...)`；
- `ScriptEngine.ts:1128`（`editStatement`）已 `runtime.update(sceneScript)`；
- `ScriptEngine.ts:1166`（`executeScene`）已 `runtime.execute(sceneScript)`；
- `ScriptEngine.ts:1327`（`recomputePart`）已 `runtime.execute(partScript, ...)`；
- `executeScriptDiff`（`executeScript.ts:810`）已 `runtime.execute(newScript, ...)`。

即「3d_editor 改用 CadRuntime.execute/append/update」**已全部完成**，T3-cond/T8 不再有 2.9 前置。唯一残留：`executeScript.ts:486-504` 仍从 parse 期 `script.terminalShapes[i].id` 建 `terminalToScopedId`——这正是 T3-cond 要切的点，且 2.9 已就绪，可以直接切。

**结论**：Phase 2 的 2.8、2.9 均已完成，Phase 3 文档**不再需要**为它们兜底。Phase 3 的真实起点是「`CadStatement.id` 仍等于 partName（变量名），`stmtId` 字段已是独立的顺序 `sN`」这一半迁移状态。

---

## 1. Phase 3 要解决的根本问题（用真实代码说话）

### 1.1 当前数据模型（已核对）

`src/lang/types.ts:78-110` 的 `CadStatement` 并存两个 id 字段：

| 字段 | 当前取值 | 来源 |
|---|---|---|
| `id: StmtId`（:82） | **= 变量名（partName）** | 普通 op：`parser.ts:285` `asStmtId(varName)`（恒等，`identity.ts:87`）；split：`parser.ts:398` `asStmtId(frontVarName)`；group/assembly：`parser.ts:711` `allocateStatementId(...)` → `grp_N` |
| `stmtId?: StmtId`（:89） | **= 顺序 `sN`** | `parser.ts:848` `stmt.stmtId = asStmtId('s'+...)` |
| `outputs?: PartName[]`（:96） | 默认未填（约定 `[id]`）；split 显式 `[front, back]`（`:400`） | `parseSplitDestructuring` |
| `seq?: number`（:100） | script-store 追加时赋值（Timeline 排序用，非 id） | 3d_editor `script-store.ts:259` `appendSceneScriptStatement` |
| `hasAssignment?: boolean`（:108） | parse 期按 AST 设置 | — |

**关键事实**：`asStmtId` 是恒等转换（`identity.ts:87` `return raw as StmtId`），所以 `stmt.id` 本质就是变量名字符串。今天能跑，是因为「终端映射 / 拓扑」都**按 ctx 变量名（partName）建条目**，split 的两输出是两个不同 partName → 自然两条条目（`computeTerminalShapes`，`parser.ts:881-926`）。

### 1.2 「未分开」的真正痛点（不是运行 bug，是身份语义半吊子）

凡是做**反向查找**或**按语句聚合**（Timeline 节点、持久化反查、diff）的代码，对 split 的第二个输出会静默失效：

| 痛点 | 现状（file:line） | Phase 3 修法 |
|---|---|---|
| `stmt.id` 把「语句身份」与「front 变量名」绑死 | split：`parser.ts:398` `id = asStmtId(frontVarName)`；back 在 `id` 字段上丢失，只在 `outputs` | 3.1：`id` 也改顺序 `sN`；变量名只留 `outputs` |
| 反查假设 id↔partName 1:1 | `findTerminalStatementId` 遍历 `terminalToScopedId` 取 termId（`ScriptEngine.ts:193-195`） | 3.5：改为「partName → 最后一次写该变量的语句」（返回 partName 不变，见 §2.7 修正） |
| Timeline 节点键用 `stmt.id` | `TimelinePanel.tsx:80/85/307/311` | 3.6：节点键改 `sN`；反查走 `outputs` |
| `_vM` 版本后缀 | UI 代码 `part0_v0/part0_v1...` | 3.2/3.8：统一 `partN`，版本号语义取消 |

### 1.3 目标（原方案 §3 原话）

> **目标**：UI 生成代码采用 `partN`（废 `_vM`）；StmtId 独立；终端 = 活跃 Shape 变量。

---

## 2. 核心设计决策（必须先定，否则 3.5/3.6 会断）

### 2.1 两套键模型（本方案的核心不变量）

Phase 3 落地后，**每个 part 在一个 PartScript 内有两个正交标识**：

| 键 | 含义 | 分配规则 | 用途 |
|---|---|---|---|
| **StmtId（`sN`）** | 一条语句的身份，顺序稳定 | 编译/追加期按语句顺序 `s1,s2,...` | Timeline 节点键、增量调度的 plan 缓存键、`executeScriptDiff` 的 diff 键 |
| **partName（`partN`）** | 变量名，一条语句可有 0~多个 | §3.8 三条规则（`allocate-id.ts`） | `terminalToScopedId` 键、执行 ctx 变量键、`ExecutionResult.outputs/terminals/compounds` 键 |

**不变量**：
- `CadStatement.id` **等于** `CadStatement.stmtId`（顺序 `sN`）。3.1 删除 `stmtId?` 字段，将其值并入 `id`。
- `CadStatement.outputs: PartName[]` 始终显式存在：单输出 op = `[partName]`；split = `[front, back]`；void op（add_constraint/do_assemble）= `[]`（无几何产出）。
- `terminalToScopedId: Record<PartName, ScopedId>` 的键**永远是 partName**（类型不变）。今天它「恰好」也等于 `stmt.id` 只是因为 `id===partName` 的巧合；3.1 后该巧合消失，但**键类型与含义不变**。

### 2.2 对原方案 3.1「删除 `varToId` 恒等映射」的修正（必须遵守）

原方案 3.1 写「`asStmtId(varName)`/`varToId` 恒等映射删除」——**表述不精确，按字面删会破坏输入解析**。实测 `varToId`（`parser.ts:644` 新建，`Map<string, PartName>`）并非纯恒等：

- 普通 op：`parser.ts:751` `varToId.set(varName, asPartName(varName))` → 恒等。
- split：`:672-673` 恒等。
- **group/assembly**：`:725` `varToId.set(varName, asGroupName(grpId))` → **非恒等**（词法名 → grp 名）。

`varToId` 是「词法变量名 → 物理 PartName」的解析器，供 `inputs`/`$ref`/`$geom.of` 在同脚本内解析上游（`:140/243/255/380/434/489`）。Phase 3 后仍需要它，因为代码里的引用是词法名、`outputs` 里是物理 partName。

**修正后的 3.1 动作**：
- 删 `parser.ts:285` `asStmtId(varName)` 直接赋 `stmt.id` → `stmt.id` 改由最终遍历（`:842-850`）统一赋 `sN`。
- **保留 `varToId`**（词法→物理解析器），但取消「`varToId` 值 === `stmt.id`」的隐含假设——`inputs` 存储的是 `varToId` 解析出的 **partName**，与 `stmt.id`（`sN`）无关。
- `parseCadStatement`（`:193-293`）改为：记录词法声明名到临时字段 `declaredOutputs: PartName[]`，最终遍历时 `outputs = declaredOutputs.map(n => varToId.get(n) ?? n)`。

### 2.3 `allocateStatementId` 返回类型：**直接改为 `PartName`**（决策确定，推翻上一版「过渡期保留 StmtId 品牌」）

上一版写「过渡期保留 `StmtId` 品牌（字符串兼容）可降低改动面，由实施者抉择」——**2026-08-26 全量搜索后推翻**：保留品牌的"降低改动面"收益并不成立，且会产生类型语义不纯的长期债务。完整分析如下。

#### 2.3.1 全量使用点清单（faijs + 3d_editor，共 22 处 + 2 处 re-export + 2 处测试断言）

**faijs 侧（5 处）**：

| 位置 | 用途 | 现状类型流向 |
|---|---|---|
| `allocate-id.ts:140-144` | 定义，返回 `StmtId` | — |
| `allocate-id.ts:182-191` `allocateSplitIds` | **已返回 `{ front: PartName; back: PartName }`**（唯一已是 PartName 的分配器） | 与目标一致，不改 |
| `parser.ts:711-713`（group/assembly） | `const grpId = allocateStatementId(...)` → `id: grpId`（**直接赋 `stmt.id`，无品牌转换**） | T1 已改：结果入 `declaredOutputs`，`id` 由最终遍历赋 sN |
| `parser.ts:817-818`（add_constraint/do_assemble） | `id: allocateStatementId(...)`（**直接赋 `stmt.id`**） | 同上 |
| `index.ts:43-45` / `browser.ts:50-53` | re-export `allocateStatementId`/`allocateSplitIds` | 类型随签名自动传播，无需改 |

**3d_editor 侧（17 处 + 2 处 re-export + 2 处测试）**：

| 位置 | 现状 | 直接赋 `stmt.id`？ | T7 后去向 |
|---|---|---|---|
| `ScriptEngine.ts:370-372`（`recordShape`） | `const id = allocateStatementId(...)` → `id,`（**直接赋，无 asStmtId**） | **是（1 处）** | `stmt.outputs = [id]`，id 由 append 赋 sN |
| `features/drill.ts:54/56` | `const id = ...` → `id: asStmtId(id)` | 否（asStmtId 包裹） | 删包裹，`outputs: [id]` |
| `features/extrude.ts:48/50` | 同上 | 否 | 同上 |
| `features/knurl.ts:38/40` | 同上 | 否 | 同上 |
| `features/boolean.ts:35/38` | 同上 | 否 | 同上 |
| `features/engrave.ts:55/57` | 同上 | 否 | 同上 |
| `features/text.ts:27/29` | 同上 | 否 | 同上 |
| `features/group.ts:22/25` | 同上 | 否 | 同上 |
| `features/assembly.ts:27/30` | 同上 | 否 | 同上 |
| `features/assembly.ts:43/51`（do_assemble） | 同上 | 否 | 同上 |
| `features/svg-extrude.ts:31/33` | 同上 | 否 | 同上 |
| `features/screw.ts:27/29` | 同上 | 否 | 同上 |
| `features/sdf.ts:27/29` | 同上 | 否 | 同上 |
| `features/primitive.ts:44/46` | 同上 | 否 | 同上 |
| `features/load.ts:41/44`（`buildLoadStatement`） | 同上 | 否 | 同上 |
| `features/load.ts:138/156`（`recordLoadStatement`） | `const id = ...` → `id,`（**直接赋**） | **是（2 处之一）** | `stmt.outputs = [id]` |
| `features/split.ts:112/114` + `:262` | `id: asStmtId(id)`；`outputs: [asPartName(frontId), asPartName(backId)]`（frontId/backId 来自 `allocateSplitIds`，已是 PartName，`asPartName` 冗余） | 否 | 删 asStmtId；outputs 已正确 |
| `features/transform.ts:54/56` | `id: asStmtId(id)` | 否 | 删包裹 |
| `script-engine/index.ts:8-9` | re-export | — | 类型自动传播 |
| `script-engine.test.ts:1291-1296`（I-3） | `expect(id).toMatch(/^part\d+_v\d+$/)` | — | 断言改 `/^part\d+$/` |
| `contract-entry.test.ts:64` | 契约测试 re-export 存在性 | — | 无需改 |

#### 2.3.2 结论：直接改 `PartName`，不做过渡品牌

- **真正「直接赋 `stmt.id`（StmtId 字段）」的只有 4 处**：faijs `parser.ts:713/818` + 3d_editor `ScriptEngine.ts:372` / `load.ts:156`。上一版「15+ 处类型报错」是**误判**——其余 15 处全用 `asStmtId(id)` 包裹（`asStmtId` 接受 string，`asStmtId(partName)` 类型合法，不会报错）。
- 这 4 处**全部位于 T1 / T7 的必改清单内**（T1 改 parser 的 `id` 为 sN 最终遍历赋、T7 改 recordShape/load 的分配结果入 `outputs`）——改为 `PartName` **不产生任何额外改动**，与 T1/T7 同批提交即零成本。
- 15 处 `asStmtId(id)` 包裹在 T7 中一律删除（分配结果改存 `outputs: PartName[]`），包裹本来就是语义噪音。
- **`allocateSplitIds` 早已返回 `PartName`**，`allocateStatementId` 改为 `PartName` 后两个分配器类型对齐，杜绝「split 是 PartName、其余是 StmtId」的割裂。

**最终动作**：
- `allocate-id.ts:144` 返回类型 `StmtId` → `PartName`；`allocate-id.ts:138` JSDoc `@returns` 同步改。
- T1：`parser.ts:711-713/817-818` 分配结果入 `declaredOutputs`（PartName 自然兼容）。
- T7：15 个 feature 删 `asStmtId(id)` 包裹、结果入 `outputs`；`ScriptEngine.ts:370-372` 与 `load.ts:138-156` 两处直接赋 `id` 改 `outputs`（兼修类型）。
- 测试断言：`allocate-id.test.ts` 期望值、`script-engine.test.ts:1291` 正则、`compile.test.ts:127-130`（`groupMeta.writes` 断言 `['grp_1']` → 新名）同步更新。

### 2.4 3.1 / 3.5 / 3.6 铁三角（强耦合，必须同批落地）

上轮已确认：`TimelinePanel.tsx:85` `terminalToScopedId[asPartName(stmt.id)]` **假设 `stmt.id` 就是 partName**。一旦 3.1 把 `stmt.id` 改成 `sN`，该行 `asPartName('s3')` 去键为 partName 的 `terminalToScopedId` 查 → **直接查不到**，节点↔场景映射全断。

因此：
- **3.1（faijs `id→sN`）+ 3.5（写入键改用 `outputs`）+ 3.6（Timeline 反查改用 `outputs`）必须作为同一次变更提交**，不能分批。
- 3.5 的 `updateTerminalMapping` 与 3.6 的 `TimelinePanel.tsx:85` 是这三角的两个端点，改动点见 §3 T5 / T6。
- **新增第三端（2026-08-26 复核发现）**：`compile.ts:246` `writes = [stmt.id]`（单输出语句的 writes 键）与 `runtime.ts:440` `writeSets.set(stmt.id, ...)`（reconcileCtx 的活跃键）也**假设 `stmt.id` 即首输出 partName**——`id→sN` 后执行器会把 `sN` 当 ctx 变量键，输出全部错位。这第三端必须与 3.1 同批，具体见 T1 的「同批波及面」。

### 2.5 3.3 与 2.9 的顺序依赖（**已解除**，修正上一版）

上一版写「3.3 的实现与验收必须在 2.9 之后；若 2.9 尚未开始，3.3 本次暂缓」。**2026-08-26 实测 2.9 已完成**（见 §0），因此：

- **T3-cond 不再阻塞**，与 T1 同批落地。
- `executeScript.ts:486-504` 从 parse 期 `script.terminalShapes[i].id` 建 `terminalToScopedId` 的代码，改为消费 `ExecutionResult.terminals[].id`（partName）。
- 本文档 T3-cond 由「条件任务」改为**必做任务**；T8 也不再标「随 2.9 一并做」。

### 2.6 【新增】`findTerminalStatementId` 返回语义（修正上一版 T5 的翻转方案）

上一版 T5 写「`findTerminalStatementId` 返回语义翻转（partName → StmtId），6 个调用点消费语义需逐一确认」。**2026-08-26 复核 6 个调用点后发现：全部消费的是 partName，没有一个要 StmtId**：

| 调用点（3d_editor `ScriptEngine.ts`） | 消费方式 | 需要什么 |
|---|---|---|
| `:307` `getLastStatementId` | 返回给 feature 的 `ctx.getLastStatementId`，作为新语句的 `inputs`（partName） | **partName** |
| `:580` `ensureTopology` | `runtime.buildBrepTopology(asStmtId(termStmtId))` | **partName**（runtime 内 `asPartName` 还原查 solidCache，见 `runtime.ts:836-838`） |
| `:611` `_rebuildBrepTopology` | `topology.get(asPartName(termStmtId))` | **partName** |
| `:950` `executePart` | `s.outputs?.includes(asPartName(termId))` 找语句 | **partName** |
| `:1286` `recomputePart` | 同 executePart 模式 | **partName** |
| `:1396` `_recomputePartLegacy` | 同 executePart 模式 | **partName** |

**修正决策**：`findTerminalStatementId` **保持返回 partName（termId），不做语义翻转**。3.1 后「id=partName」的巧合消失，上述调用点里凡是 `s.id === termId` 的语句查找（如 `executePart:955-957`、`commitSceneResult:1234-1235`、`recomputePart:1293-1295`）改为 `s.outputs?.includes(termId)` 匹配；凡是传 `asStmtId(termId)` 给 runtime 的（`:581`）不变——runtime 内部本就按 partName 语义消费。

---

## 3. 细化后的任务清单与精确改动点

### faijs 侧

#### T1 — 3.1 parser：`id` 扶正为 `sN`，`outputs` 显式化（与 T3-cond/T5/T6 同批）

- `src/lang/parser.ts:193-293` `parseCadStatement`：不再 `const id = asStmtId(varName)`（`:285`）；改为记录 `declaredOutputs = [asPartName(varName)]` 到临时结构（可临时挂在 `stmt` 上，最终遍历清掉）。
- `parser.ts:397-406` 一带 split（`parseSplitDestructuring`）：`const id = asStmtId(frontVarName)`（`:398`）→ 仅设 `declaredOutputs = [front, back]`（partName），`stmt.id` 留给最终遍历。
- `parser.ts:711-719` group/assembly：`grpId = allocateStatementId(...)`（3.2 后返回 `partN`）→ `declaredOutputs = [grpId]`，`stmt.id` 留给最终遍历。
- `parser.ts:842-850` 最终遍历：`stmt.id = stmt.stmtId`（即 `sN`）；`stmt.outputs = declaredOutputs.map(n => varToId.get(n) ?? n)`；**删除 `stmtId?` 字段**（`types.ts:89`）。
- `types.ts:78-110`：删除 `stmtId?`（:89）；`outputs?` 改为必填 `outputs: PartName[]`（去掉 `?`，因为 3.1 保证每语句都有）；更新 `id` 注释（不再是变量名）。
- **同批波及面（2026-08-26 新增，缺一不可）**：
  - `compile.ts:246` `writes = [stmt.id]` → `writes = stmt.outputs`（单输出即 `outputs[0]`；split 多输出本来就走 `stmt.outputs` 分支）。**不改则执行器 ctx 键变成 `sN`，几何错位**。
  - `compile.ts:239` `const id = stmt.stmtId ?? asStmtId(...)` → `const id = stmt.id`（T1 后 `stmt.id` 已是 sN，`stmtId` 字段删除）。
  - `runtime.ts:440` `reconcileCtx`：`activeIds.add(stmt.id)` / `writeSets.set(stmt.id, [asPartName(stmt.id), ...])` → 键改用 `stmt.outputs`（首输出 = `outputs[0]`）。**不改则跨 part 引用的活跃键判定失效，变量被误释放**。
  - `runtime.ts:365` `sourceIdToCompiled.set(stmt.id, meta.id)`（append/update 的 newIds 映射）→ 同步改为 `stmt.outputs` 各输出映射到 meta.id。
  - `runtime.ts:706` `resolveShapeRef` 内 `asPartName(s.id) === partName`（跨 part 语句查找）→ 改 `(s.outputs ?? []).includes(partName)`。
  - `runtime.ts:651` `extractBrepSolids` 单终端回退 `asPartName(lastStmt.id)` → `asPartName(lastStmt.outputs?.[0] ?? lastStmt.id)`。
  - `exec-context.ts:200` `outNames = [asPartName(stmt.id), ...outputs]`（dependentsOf 上游输出名）→ 首项改 `stmt.outputs?.[0]`。
  - `internal-stdlib-adapter.ts:55` `asPartName(stmt?.id ?? '')`（emitBrepLost 的 partName）→ `stmt?.outputs?.[0] ?? stmt?.id`。
- 同步所有读 `stmt.stmtId` 的代码（`compile.ts:239` 已列；`runtime.test.ts` 中 makeStmt 直接用 `'s1'` 作 id 的用例**不受影响**，反而更一致）。
- `allocate-id.ts` 的 `getMaxModelNum/getMaxGroupNum`（`:31-64`）读 `stmt.id` 的循环 → **必须同步改读 `stmt.outputs`**（T2 里细化）。

#### T2 — 3.2 `allocate-id.ts` 重写为 §3.8 三条规则

- `src/lang/allocate-id.ts:140-172` `allocateStatementId`：
  - 删 `GROUP_OPS` → `grp_N` 分支（`:147-150`）。
  - 单入单出（translate/rotate/drill/extrude/knurl/engrave/...）：返回 `inputs[0]` 的 partName（复用）。
  - 无输入 / 多输出（box/sphere/load/sdf/text/screw/svgExtrude/split/boolean 2→1）：返回新 `partN`，N = `getMaxModelNum(statements)+1`；split 经 `allocateSplitIds` 返回 `[partN, part(N+1)]`。
  - 返回类型**直接改为 `PartName`**（决策已定，见 §2.3——全量使用点已核对，真正直接赋 `stmt.id` 仅 4 处且全在 T1/T7 清单内，其余 `asStmtId(id)` 包裹一律删除）。
- `allocate-id.ts:182-191` `allocateSplitIds`：`front = part{N}_v0`→`partN`；`back = part{N+1}`（去掉 `_v0`）。
- `allocate-id.ts:31-64` `getMaxModelNum`/`getMaxGroupNum`：**改从 `stmt.outputs`（含 `[id]` 时代）扫描 `partN` 格式**，不再依赖 `stmt.id`；`PART_VM_RE` 扩展兼容 `partN`（无 `_vM`）与存量 `partN_vM`（见 §5 兼容性）。
- `:196-227` 辅助（`isPartVmId`/`getModelNum`/`getVersionNum`/`isGrpId`/`getGroupNum`）：`_vM`/`grp_N` 解析器需保留以兼容**存量 fixture**（见 §5），但新分配不再产生该格式。
- `src/lang/allocate-id.test.ts:30-163`：断言全改（旧 `part0_v0`/`grp_1` → 新 `part0`/`part3` 等），补「单入单出复用输入名」「split 两新名」「getMaxModelNum 从 outputs 扫描」用例。

#### T3-cond — 3.3 终端判定移入执行收尾（**不再阻塞，与 T1 同批**）

- 删 `parser.ts:881-926` `computeTerminalShapes` 及 `:854` 调用；`PartScript.terminalShapes`（`types.ts:152`）改为可选 override（显式 `return [...]` 时优先，否则运行期算）。
- `runtime.ts` `collectResult`（`:536-631`）：当前 `terminals = script.terminalShapes ?? []`（`:574`）。改为：`script.terminalShapes`（显式 return）优先；否则从 `result.outputs`（Map<PartName, Shape>）过滤 `isShapeLike(v)` 且 partName 不被任何语句 `inputs` 引用的 → `terminals`。
- 3d_editor 侧（2.9 已落地）：`executeScript.ts:486-504` 改读 `ExecutionResult.terminals[].id`（partName）建 `terminalToScopedId`；`createPartsFromResult`（`:353-467`）的 `script.terminalShapes` 消费同步切换（`:425` 等）。
- `runtime.ts:609/643` `asPartName(t.id)`（buildFor/extractBrepSolids 读 terminal id）——终端 id 语义保持 partName，**无需改**。

#### T4 — 3.4 `codegen.ts` `scriptToCode`/`statementToLine` 改用 `outputs` + 原地重赋值

- `src/lang/codegen.ts:349-400` `statementToLine` 与 `:410-490` `scriptToCode`（注意函数体到 `:490` 结束，非上版写的 `:464`）：变量名来源由 `stmt.id` 改为 `stmt.outputs[0]`（普通）/ 解构（split）。
- 单入单出：`part0 = cad.drill(part0, ...)`（首声明用 `let`，复用名不再 `const`），需 track 已声明名集合（`:412` `varNames` 扩为「已声明」标记）。
- split：`const { front: part1, back: part2 } = cad.split(part0, ...)`（`:375-384` 逻辑保留，变量名取自 `outputs`）。
- `:444` `PART_VM_RE.test(stmt.id)` → 改测 `stmt.outputs[0]`。
- group/assembly：`let part3 = cad.group({ members: [part0, part1] })`（`:421-426` 逻辑保留，名取自 `outputs`）。
- `statementToLine` 是 Timeline「查看代码」的数据源（`TimelinePanel.tsx:329`），T4 后显示文本与 T1 的新 id 语义一致。

### 3d_editor 侧（全部依赖 T1）

#### T5 — 3.5 `terminalToScopedId` 写入/反查改吃 `outputs`（按 §2.6 修正：返回 partName 不变）

- `src/engine/script-engine/ScriptEngine.ts:165-172` `updateTerminalMapping(scopedId, stmtId)`：签名改为 `updateTerminalMapping(scopedId, partNames: PartName[])`；循环写 `terminalToScopedId[pn] = scopedId`。
- 调用点：`:354`（`recordFeature` 默认注册）`updateTerminalMapping(scopedId, stmt.id)` → `updateTerminalMapping(scopedId, stmt.outputs)`；`:380`（`recordShape`）同改。
- `ScriptEngine.ts:188-197` `findTerminalStatementId`：**保持返回 partName（termId），不改签名**（§2.6）。
- 语句查找适配（`id=partName` 巧合消失后）：
  - `executePart`（`:950` 一带）：`:955-957` `s.id === termId || s.outputs?.includes(asPartName(termId))` → 保留 outputs 分支即可（`s.id === termId` 不再命中，删掉避免误导）。
  - `commitSceneResult`（`:1234-1235`）：`s.id === stmtId ?? s.outputs?.includes(asPartName(stmtId))` → 同改 outputs 分支。
  - `recomputePart`（`:1293-1295`）、`_recomputePartLegacy`（`:1398-1399`）：同改。
  - `load.ts:102/120` `sceneScript.statements.find(s => s.id === termStmtId)` → 改 `s.outputs?.includes(termStmtId)`。
- `model-store.ts` 的 `terminalToScopedId[asPartName(memberId)]`（`:138/757`，上版引用的 :84/127-128/247/724/736/746-747 行号已失效）：键已是 partName，**无需改**（3.5 保持键为 partName）。
- `recordShape`（`:365-382`）：`allocateStatementId(op, [], ...)` 结果入 `stmt.outputs`；`:380` `updateTerminalMapping(scopedId, stmt.outputs)`。
- `ensureTopology`（`:580-581`）与 `_rebuildBrepTopology`（`:611-612`）：传 `asStmtId(termStmtId)` / `asPartName(termStmtId)` 不变——runtime 按 partName 语义消费。

#### T6 — 3.6 Timeline 节点键改 StmtId + 反查走 `outputs`

- `src/engine/components/panels/TimelinePanel.tsx`：
  - `:80` `seenIds.has(stmt.id)` → `stmt.id` 已是 `sN`，可保留（去重键用 `sN` 更稳）。
  - `:85` `terminalToScopedId[asPartName(stmt.id)]` → 改 `resolveScopedIdForStmt(stmt)`：取 `stmt.outputs[0]`（普通）或 `stmt.outputs`（多输出）去 `terminalToScopedId` 查。
  - `:250-253` split 反查 `stmt.outputs[0]/[1]` 已正确（保留）。
  - `:264` `deleteStatement(scopedId, stmt.id)` → 第二参可改 `stmt.id`（`sN`，与 store 键一致）。
  - `:307` `key={item.statement.id}`、`:311` `editingStatementId === item.statement.id`：`sN` 即稳定键，保留。
  - backfill（方案 3.6「scopedId → partName → 当前语句」）：由 `terminalToScopedId` 反查得 partName，再 `statements.find(s => s.outputs?.includes(partName))` 取当前语句。

#### T7 — 3.7 `features/*.ts` `buildStatement` 适配：分配结果入 `outputs`

- **涉及文件（2026-08-26 复核为 15 个文件，上版「12 个」不准确，且漏了 `transform.ts`）**：
  `drill.ts:54`、`extrude.ts:48`、`knurl.ts:38`、`boolean.ts:35`、`engrave.ts:55`、`text.ts:27`、`group.ts:22`、`assembly.ts:27/43`、`svg-extrude.ts:31`、`screw.ts:27`、`sdf.ts:27`、`primitive.ts:44`、`load.ts:41/138`（load 有两处分配：`buildLoadStatement` 与 `recordLoadStatement`）、`split.ts:112/262`、**`transform.ts:54`**。
- 统一改法（含返回类型处理，见 §2.3）：`const id = allocateStatementId(...)` → 分配结果存入 `stmt.outputs`（单输出 `[id]`；split 用 `allocateSplitIds` 得 `[front, back]`，`split.ts:262` 已如此）；`stmt.id` 由 `recordFeature`/`appendStatement` 赋 `sN`（见 §2.3）。**15 处 `id: asStmtId(id)` 包裹一律删除**（`asStmtId` 对 `PartName` 输入虽然类型合法，但语义上是噪音）。
- 两处**直接赋 `stmt.id`**（无 `asStmtId` 包裹）兼修类型：`ScriptEngine.ts:370-372` `recordShape` 的 `const id = allocateStatementId(...)` → `{ id, ... }` 改 `outputs: [id]`；`load.ts:138/156` `recordLoadStatement` 同改。这是改 `PartName` 后仅有的两处编译报错点（另两处在 faijs `parser.ts:713/818`，由 T1 处理）。
- `ScriptEngine.ts:370` `recordShape`：`allocateStatementId(op, [])` 结果入 `stmt.outputs`，`stmt.id` 留给 append。
- `ScriptEngine.ts:305-308` `getLastStatementId`：返回 `findTerminalStatementId(...)`（partName），语义即「该 scopedId 当前 partName 对应的最新语句」——与方案 3.7 一致，**签名不变**。
- 因 `allocateStatementId` 不再产生 `grp_N`，`features/group.ts:22`/`assembly.ts:27/43` 的 `grp_N` 相关断言需更新。
- `load.ts:155-171` `recordLoadStatement`：`[stmt.id]: scopedId` 的 terminalToScopedId 写入 → 改 `[stmt.outputs[0]]`（若 load 有 outputs）或保持（load 单输出 `[id]`）。

#### T8 — 3.8 `executeScriptDiff` 按 StmtId diff（**不再阻塞于 2.9**）

- `src/engine/script-engine/executeScript.ts:678-855` `executeScriptDiff` 的 diff 逻辑：当前按 `stmt.id` diff（`:719-748` 建 `baseById/newById`，键 = `s.id`）。Phase 3 后 `stmt.id = sN`（单次解析内位置稳定）。
- 适配：diff 键用 `stmt.id`（`sN`）即可；但 re-parse 会重排 `sN`，故 **增量重执行匹配需结合 `seq`（`types.ts:100`）或 content-key**，不能纯靠 `sN` 跨重解析稳定。具体：diff 先用 `sN` 粗匹配，再用 `statementKey`（ModuleExecutor 已有缓存键，`module-executor.ts:69-70/203-206/256-260`）精匹配。
- 2.9 已落地：`executeScriptDiff` 已走 `runtime.execute`（`:810`），本任务只需调整 diff 分类键与 `writeScriptStore` 的终端源（T3-cond）。

---

## 4. 系统化命名规则（§3.8 细化版，含修正）

| 情形 | 变量名（partName） | 示例 |
|---|---|---|
| 单入单出（translate/rotate/drill/extrude/scale/knurl/engrave/boolean 等） | **复用输入名** | `part0 = cad.drill(part0, ...)` |
| 无输入/单输出（box/sphere/cylinder/cone/wedge/text/screw/svgExtrude/sdf/load） | **新名** `partN`，N = 当前最大模型号 + 1 | `let part0 = cad.box(...)` → `let part3 = cad.sphere(...)` |
| 输入输出数量不同（split 1→2、boolean 不算，因 2→1 走「新名」） | 按输出数分配新 `partN` | `const { front: part1, back: part2 } = cad.split(part0, ...)` |
| group/assembly | **取消 `grp_N`**，按「数量不同」规则拿新 `partN`（单输出 → 新名） | `let part4 = cad.group({ members: [part0, part1] })` |
| void op（add_constraint/do_assemble） | 无输出，`outputs: []`；链式调用 `assem4.add_constraint(...)` | — |

**版本号 `_vM` 语义取消**：模型号 `N` 在单次脚本内单调递增，不再有版本维。重新保存脚本会用新 `partN` 序列重排（存量 `partN_vM` fixture 仍可加载，见 §5）。

**注意（2026-08-26 复核）**：`allocate-id.ts` 的「复用输入名」规则要求 `getMaxModelNum` 从 `stmt.outputs`（而非 `stmt.id`）扫描模型号——T1 后 `stmt.id` 是 `sN`，T2 必须同步改（见 T2）。

---

## 5. 兼容性（验收硬指标）

- **存量 `partN_vM` fixture 原样通过**：引擎不解析变量名格式（`isPartVmId`/`getModelNum`/`getVersionNum` 保留于 `allocate-id.ts:196-212` 供解析旧名），`varToId` 仍能把旧 `part0_v0` 解析为 partName。验证：`test/faijs/` 下 `.faijs` fixture 全跑绿。
- **AI 生成代码友好性**：同模型多特征脚本中变量名稳定（`part0` 始终是同一模型，因单入单出复用名）。验证：新增 e2e「多 drill 链 `part0` 始终同一模型」。

---

## 6. 验收标准与验证步骤（遵循 AGENTS.md 分层纪律）

### 6.1 验收清单

- [ ] 两项目 `npm run typecheck`（faijs）/ `npx tsc --noEmit`（3d_editor）全绿。
- [ ] faijs `npm test` 全绿；3d_editor `npm run test:components` + 相关 e2e spec 绿（**一次只跑一个 spec，严禁全量 e2e / 严禁跑 CI 总脚本**）。
- [ ] grep 红线：`3d_editor/src` 生产代码不再有 `terminalToScopedId[asPartName(stmt.id)]` 直接反查（必须走 `outputs`）；`src/lang/parser.ts` 不再有 `stmt.id = asStmtId(varName)`；`compile.ts` 不再有 `writes = [stmt.id]`。
- [ ] `CadStatement` 无 `stmtId?` 字段（`grep stmtId` 仅剩顺序分配一处）。
- [ ] 装配回归：add_constraint 链式真实生效（新测试，接 2.4 的 `dependentsOf/touch`）。
- [ ] split 在 Timeline 为单节点、场景树 front/back 双条目均正确（既有 `script-engine.test.ts` 的 `recordSplit`/`findTerminalStatementId` 用例绿 + 新增断言）。
- [ ] 旧 `partN_vM` fixture 兼容测试绿。
- [ ] **新增红线（T1 同批波及面）**：`runtime.ts`/`exec-context.ts`/`internal-stdlib-adapter.ts` 无 `asPartName(stmt.id)` / `asPartName(stmt?.id)` 残留；`allocate-id.ts` 的 `getMaxModelNum/getMaxGroupNum` 只读 `stmt.outputs`。

### 6.2 推荐实施顺序（与强耦合一致）

```
T1(id→sN, outputs 显式, 含 compile/runtime 波及面) ──同批──► T3-cond(终端移执行收尾, 2.9 已就绪)
T2(allocate-id 重写, 读 outputs)    ──►        T4(codegen 改用 outputs)
T1 落地后 ──同批──► T5(updateTerminalMapping 改 outputs, findTerminalStatementId 保持 partName)
                     ──同批──► T6(Timeline 反查走 outputs)
T7(features buildStatement 入 outputs) ──► T8(executeScriptDiff 按 sN+seq)
```

**铁律**：T1 与 T3-cond + T5 + T6 同批；T2 与 T1 同批或紧随（`getMaxModelNum` 依赖 `outputs`）；T4 建议紧随 T2；其余可独立。

### 6.3 验证步骤（每层通过才进下一步，严禁并发）

1. faijs：`npx tsc --noEmit` → `npx vitest run src/lang/allocate-id.test.ts` → `npx vitest run src/lang/parser.test.ts` → `npx vitest run src/lang/codegen.test.ts` → `npx vitest run src/cad-runtime/runtime.test.ts`
2. faijs：`npm run build`（tarball 前置）
3. 3d_editor：`npm run pack`（faijs）→ `cd 3d_editor && npm install` → `npx tsc --noEmit` → `npm run test:components`
4. 3d_editor：`npx playwright test <name>.spec.ts`（单 spec，需先 build；跑完确认 chrome/vite 子进程退出再跑下一个）

---

## 7. 风险与开放问题（2026-08-26 复核更新）

1. **T1 波及面遗漏即断裂**：`compile.ts:246` `writes = [stmt.id]`、`runtime.ts:440/365/651/706`、`exec-context.ts:200`、`internal-stdlib-adapter.ts:55` 一旦漏改，`id→sN` 后执行器 ctx 键错位、跨 part 引用解析失效、变量被误释放。→ 已在 T1 列为同批强制项，验收红线兜底（§6.1）。
2. **`findTerminalStatementId` 返回语义（已修正）**：上一版「翻转 partName → StmtId」被推翻——6 个调用点全部消费 partName（§2.6 逐点核对）。保持 partName 返回；语句查找统一走 `outputs` 匹配。
3. **2.9 已完成的连锁影响（已修正）**：T3-cond/T8 不再阻塞；`executeScript.ts:486-504` 是唯一残留的 parse 期终端源，随 T3-cond 切换。
4. **`allocateStatementId` 返回类型（决策已定，见 §2.3）**：**直接改为 `PartName`**，不做过渡品牌。全量使用点核对：真正直接赋 `stmt.id` 仅 4 处（faijs `parser.ts:713/818` + 3d_editor `ScriptEngine.ts:372` / `load.ts:156`），全部位于 T1/T7 必改清单内，改 `PartName` 零额外成本；其余 15 处 `asStmtId(id)` 包裹一律删除。**风险从「改动面未知」降级为「T1/T7 同批遗漏」**——遗漏时 3d_editor typecheck 会在上述 2 处报错（`PartName` 不可赋给 `StmtId`），由 §6.1 验收红线兜底。
5. **`getMaxModelNum` 从 `outputs` 扫描的正确性**：`outputs` 必填后单输出 `[partName]`、split `[front, back]`、void `[]`——扫描逻辑必须跳过 `[]` 与 `grp_N` 旧格式；新分配只在 `outputs` 中出现。T2 用例覆盖（§6.3 第 1 步）。
6. **Timeline `data-timeline-statement-id`（`:172`）**：T1 后由 partName 变 `sN`，若 e2e 断言该值需同步更新（T6 提及）。
