# Phase 3 技术实施方案：命名规则与 StmtId / partName 分离

> 本文档是 `docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md` 中 **Phase 3「命名规则与 StmtId/partName 分离」** 的细化方案。
> 仅写方案，不改代码。所有 file:line 引用均基于 **2026-08-26 实际代码核对**（`npx tsc --noEmit` 实测 0 错误）。

---

## 0. 基线校正（重要：推翻上一轮分析的前提）

上一轮分析称「2.8 半截、typecheck 14 处 `returnType` 全红」——**该结论已不成立**。2026-08-26 实测：

- `cd faijs && npx tsc --noEmit` → **0 个 error TS**。
- `src/` 下已无 `CadStatement.returnType` 字段引用；四分类 `ReturnType` 类型已删除（`grep returnType` 仅命中 `args-schema.ts:29` 注释，与 `ReturnType<typeof ...>` 内置工具类型，均无关）。
- `validateStatementArgs`（`src/lang/args-schema.ts:68`）已基于 schema 表的 `void` 标志处理 add_constraint/do_assemble 等无输出 op。

**结论**：Phase 2 的 2.8 已完成，Phase 3 文档**不再需要**为 2.8 兜底。Phase 3 的真实起点是「`CadStatement.id` 仍等于 partName（变量名），`stmtId` 字段已是独立的顺序 `sN`」这一半迁移状态。

---

## 1. Phase 3 要解决的根本问题（用真实代码说话）

### 1.1 当前数据模型（已核对）

`src/lang/types.ts:78-110` 的 `CadStatement` 并存两个 id 字段：

| 字段 | 当前取值 | 来源 |
|---|---|---|
| `id: StmtId`（:82） | **= 变量名（partName）** | 普通 op：`parser.ts:285` `asStmtId(varName)`（恒等，`identity.ts:87`）；group/assembly：`parser.ts:712` `allocateStatementId(...)` → `grp_N` |
| `stmtId?: StmtId`（:89） | **= 顺序 `sN`** | `parser.ts:849` `stmt.stmtId = asStmtId('s'+(base+idx))` |
| `outputs?: PartName[]`（:96） | 默认未填（约定 `[id]`）；split 显式 `[front, back]`（`:398` 一带） | `parseSplitDestructuring` |
| `seq?: number`（:100） | script-store 追加时赋值（Timeline 排序用，非 id） | — |
| `hasAssignment?: boolean`（:108） | parse 期按 AST 设置 | — |

**关键事实**：`asStmtId` 是恒等转换（`identity.ts:87` `return raw as StmtId`），所以 `stmt.id` 本质就是变量名字符串。今天能跑，是因为「终端映射 / 拓扑」都**按 ctx 变量名（partName）建条目**，split 的两输出是两个不同 partName → 自然两条条目（`computeTerminalShapes`，`parser.ts:882-923`）。

### 1.2 「未分开」的真正痛点（不是运行 bug，是身份语义半吊子）

凡是做**反向查找**或**按语句聚合**（Timeline 节点、持久化反查、diff）的代码，对 split 的第二个输出会静默失效：

| 痛点 | 现状（file:line） | Phase 3 修法 |
|---|---|---|
| `stmt.id` 把「语句身份」与「front 变量名」绑死 | split：`parser.ts:398` `stmt.id = asStmtId(frontVarName)`；back 在 `id` 字段上丢失，只在 `outputs` | 3.1：`id` 也改顺序 `sN`；变量名只留 `outputs` |
| 反查假设 id↔partName 1:1 | `findTerminalStatementId` 遍历 `terminalToScopedId` 取 termId（:194） | 3.5：改为「partName → 最后一次写该变量的语句」 |
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

原方案 3.1 写「`asStmtId(varName)`/`varToId` 恒等映射删除」——**表述不精确，按字面删会破坏输入解析**。实测 `varToId`（`parser.ts:574` 新建，`Map<string, PartName>`）并非纯恒等：

- 普通 op：`varToId.set(varName, asPartName(varName))`（:752）→ 恒等。
- split：`:673-674` 恒等。
- **group/assembly**：`:726` `varToId.set(varName, asGroupName(grpId))` → **非恒等**（词法名 → grp 名）。

`varToId` 是「词法变量名 → 物理 PartName」的解析器，供 `inputs`/`$ref`/`$geom.of` 在同脚本内解析上游（`:140/243/255/380/434/489`）。Phase 3 后仍需要它，因为代码里的引用是词法名、`outputs` 里是物理 partName。

**修正后的 3.1 动作**：
- 删 `asStmtId(varName)` 直接赋 `stmt.id`（:285）→ `stmt.id` 改由最终遍历赋 `sN`。
- **保留 `varToId`**（词法→物理解析器），但取消「`varToId` 值 === `stmt.id`」的隐含假设——`inputs` 存储的是 `varToId` 解析出的 **partName**，与 `stmt.id`（`sN`）无关。
- `parseCadStatement`（:284-293）改为：记录词法声明名到临时字段 `declaredOutputs: PartName[]`，最终遍历时 `outputs = declaredOutputs.map(n => varToId.get(n) ?? n)`。

### 2.3 `allocateStatementId` 语义重定向（3.2 + 3.7 共担）

3.2 重写 `allocate-id.ts` 后，`allocateStatementId(op, inputs, ctx)` 返回的字符串格式变为 `partN`（无 `_vM`、无 `grp_N`）。本方案进一步明确：

- 它返回的是 **partName**，应存入 `stmt.outputs`（3d_editor 侧）或 `declaredOutputs`（faijs parser 侧），**不再直接当作 `stmt.id`**。
- 3d_editor 的 `recordFeature`/`appendStatement` 在语句入 store 时**单独**赋 `stmt.id = sN`（顺序）。
- 若类型上要保持严谨：`allocateStatementId` 返回值类型建议由 `StmtId` 改为 `PartName`；但因其当前被 3d_editor 12+ 处直接赋 `stmt.id`，过渡期可保留 `StmtId` 品牌（字符串兼容），仅语义上视为 partName。3.7 把赋值目标从 `stmt.id` 切到 `stmt.outputs`。

### 2.4 3.1 / 3.5 / 3.6 铁三角（强耦合，必须同批落地）

上轮已确认：`TimelinePanel.tsx:85` `terminalToScopedId[asPartName(stmt.id)]` **假设 `stmt.id` 就是 partName**。一旦 3.1 把 `stmt.id` 改成 `sN`，该行 `asPartName('s3')` 去键为 partName 的 `terminalToScopedId` 查 → **直接查不到**，节点↔场景映射全断。

因此：
- **3.1（faijs `id→sN`）+ 3.5（写入键改用 `outputs`）+ 3.6（Timeline 反查改用 `outputs`）必须作为同一次变更提交**，不能分批。
- 3.5 的 `updateTerminalMapping` 与 3.6 的 `TimelinePanel.tsx:85` 是这三角的两个端点，改动点见 §4.5 / §4.6。

### 2.5 3.3 与 2.9 的顺序依赖（必须显式标注）

3.3 把终端判定从 parse 期（`computeTerminalShapes`）移到执行收尾（`ExecutionResult.terminals`）。但 3d_editor 当前 `executeScript.ts:490-505` 仍从 parse 期 `script.terminalShapes[i].id` 建 `terminalToScopedId`。执行收尾产出 `ExecutionResult.terminals` 的前提是 2.9（3d_editor 改用 `CadRuntime.execute/append/update`）已落地。

**决策**：3.3 的实现与验收**必须在 2.9 之后**（或与之同批）。若 2.9 尚未开始，3.3 本次**暂缓**，仅保留「`computeTerminalShapes` 不引用已删除的 `returnType`」现状（2.8 已确保），待 2.9 落地再切终端源。本文档把 3.3 列为「条件任务 T3-cond」，标注阻塞于 2.9。

---

## 3. 细化后的任务清单与精确改动点

### faijs 侧

#### T1 — 3.1 parser：`id` 扶正为 `sN`，`outputs` 显式化（与 T3-cond 同批）

- `src/lang/parser.ts:284-293` `parseCadStatement`：不再 `const id = asStmtId(varName)`；改为记录 `declaredOutputs = [asPartName(varName)]` 到临时结构（可临时挂在 `stmt` 上，最终遍历清掉）。
- `parser.ts:398` 一带 split：`stmt.id = asStmtId(frontVarName)` → 仅设 `declaredOutputs = [front, back]`（partName），`stmt.id` 留给最终遍历。
- `parser.ts:712` group/assembly：`grpId = allocateStatementId(...)`（3.2 后返回 `partN`）→ `declaredOutputs = [grpId]`，`stmt.id` 留给最终遍历。
- `parser.ts:843-851` 最终遍历：将 `stmt.id = stmt.stmtId`（即 `sN`）；`stmt.outputs = declaredOutputs.map(n => varToId.get(n) ?? n)`；**删除 `stmtId?` 字段**（`types.ts:89`）。
- `types.ts:78-110`：删除 `stmtId?`（:89）；`outputs?` 改为必填 `outputs: PartName[]`（去掉 `?`，因为 3.1 保证每语句都有）；更新 `id` 注释（不再是变量名）。
- 同步所有读 `stmt.stmtId` 的代码（`parser.ts` 内、runtime、tests）。
- **同批**：若 T3-cond 不在此批，则 `computeTerminalShapes`（:906 `outputIds.push(stmt.id)`）在 `id` 变 `sN` 后会推错值——故 **T1 必须与 T3-cond 同批**，或 T1 时先把 `computeTerminalShapes` 的 `stmt.id` 处改为读 `stmt.outputs`（为 T3-cond 铺路）。

#### T2 — 3.2 `allocate-id.ts` 重写为 §3.8 三条规则

- `src/lang/allocate-id.ts:140-172` `allocateStatementId`：
  - 删 `GROUP_OPS` → `grp_N` 分支（:148-150）。
  - 单入单出（translate/rotate/drill/extrude/...）：返回 `inputs[0]` 的 partName（复用）。
  - 无输入 / 多输出（box/sphere/split/boolean 2→1）：返回新 `partN`，N = `getMaxModelNum(statements)+1`；split 经 `allocateSplitIds` 返回 `[partN, part(N+1)]`。
  - 返回类型由 `StmtId` 视情况改为 `PartName`（见 §2.3）。
- `:182-191` `allocateSplitIds`：`front = part{N}_v0`→`partN`；`back = part{N+1}`（去掉 `_v0`）。
- `:196-227` 辅助（`isPartVmId`/`getModelNum`/`getVersionNum`/`isGrpId`/`getGroupNum`）：`_vM`/`grp_N` 解析器需保留以兼容**存量 fixture**（见 §5 兼容性），但新分配不再产生该格式。
- `src/lang/allocate-id.test.ts:30-163`：断言全改（旧 `part0_v0`/`grp_1` → 新 `part0`/`part3` 等），补「单入单出复用输入名」「split 两新名」用例。

#### T3-cond — 3.3 终端判定移入执行收尾（阻塞于 2.9）

- 删 `parser.ts:882-923` `computeTerminalShapes` 及 `:853-855` 调用；`PartScript.terminalShapes`（`types.ts:152`）改为可选 override（显式 `return [...]` 时优先，否则运行期算）。
- `runtime.ts` `collectResult`（`ExecutionResult`，:91-118）：从 `result.outputs`（Map<PartName, Shape>）过滤 `isShape(v)` 且 partName 不被任何语句 `inputs` 引用的 → `terminals`（:97）。
- 2.9 落地后 `executeScript.ts:490-505` 改读 `ExecutionResult.terminals[].id`（partName）建 `terminalToScopedId`，不再读 parse 期 `script.terminalShapes`。

#### T4 — 3.4 `codegen.ts` `scriptToCode` 改用 `outputs` + 原地重赋值

- `src/lang/codegen.ts:349-400` `statementToLine` 与 `:410-464` `scriptToCode`：变量名来源由 `stmt.id` 改为 `stmt.outputs[0]`（普通）/ 解构（split）。
- 单入单出：`part0 = cad.drill(part0, ...)`（首声明用 `let`，复用名不再 `const`），需 track 已声明名集合（:412 `varNames` 扩为「已声明」标记）。
- split：`const { front: part1, back: part2 } = cad.split(part0, ...)`（:375-384 逻辑保留，变量名取自 `outputs`）。
- `:444` `PART_VM_RE.test(stmt.id)` → 改测 `stmt.outputs[0]`。
- group/assembly：`let part3 = cad.group({ members: [part0, part1] })`（:421-424 逻辑保留，名取自 `outputs`）。

### 3d_editor 侧（全部依赖 T1）

#### T5 — 3.5 `terminalToScopedId` 写入/反查改吃 `outputs`

- `src/engine/script-engine/ScriptEngine.ts:166-173` `updateTerminalMapping(scopedId, stmtId)`：签名改为 `updateTerminalMapping(scopedId, partNames: PartName[])`；循环写 `terminalToScopedId[pn] = scopedId`。
- 调用点：`:355`（`recordFeature` 默认注册）`updateTerminalMapping(scopedId, stmt.id)` → `updateTerminalMapping(scopedId, stmt.outputs ?? [stmt.id])`；`:381`（`recordShape`）同改。
- `:189-198` `findTerminalStatementId`：当前返回 termId（partName）。改为**返回 StmtId（`sN`）**——扫描 `sceneScript.statements`，找 `outputs` 含该 partName 且位置最靠后的语句，返回其 `id`（`sN`）。需给函数增加 `statements` 参数（或从 `useScriptStore` 取）。
- 调用点审计（grep 命中）：`:308` `getLastStatementId`、`:581`、`:613`、`:987`、`:1320`、`:1430` 共 6 处 `findTerminalStatementId(...)`；逐处确认其消费的是「StmtId」还是「partName」并适配。
- `src/engine/features/load.ts:47-52` 本地 `findTerminalStatementId` 副本：与 ScriptEngine 版同步改（返回 StmtId）。
- `model-store.ts` 的 `terminalToScopedId[asPartName(memberId)]`（:84/127-128/247/724/736/746-747）：键已是 partName，**无需改**（3.5 保持键为 partName）。

#### T6 — 3.6 Timeline 节点键改 StmtId + 反查走 `outputs`

- `src/engine/components/panels/TimelinePanel.tsx`：
  - `:80` `seenIds.has(stmt.id)` → `stmt.id` 已是 `sN`，可保留（去重键用 `sN` 更稳）。
  - `:85` `terminalToScopedId[asPartName(stmt.id)]` → 改 `resolveScopedIdForStmt(stmt)`：取 `stmt.outputs[0]`（普通）或 `stmt.outputs`（多输出首元素）去 `terminalToScopedId` 查。
  - `:251-253` split 反查 `stmt.outputs[0]/[1]` 已正确（保留）。
  - `:264` `deleteStatement(scopedId, stmt.id)` → 第二参可改 `stmt.id`（`sN`，与 store 键一致）。
  - `:307` `key={item.statement.id}`、`311` `editingStatementId === item.statement.id`：`sN` 即稳定键，保留。
  - backfill（方案 3.6「scopedId → partName → 当前语句」）：由 `terminalToScopedId` 反查得 partName，再 `statements.find(s => s.outputs?.includes(partName))` 取当前语句。

#### T7 — 3.7 `features/*.ts` `buildStatement` 适配：分配结果入 `outputs`

- 12 个 feature 文件（`features/drill.ts:54`、`extrude.ts:48`、`knurl.ts:38`、`boolean.ts:35`、`engrave.ts:55`、`text.ts:27`、`group.ts:22`、`assembly.ts:27/43`、`svg-extrude.ts:31`、`screw.ts:27`、`sdf.ts:27`、`primitive.ts:44`、`load.ts:33`、`split.ts:112`）当前 `const id = allocateStatementId(...)` 后赋 `stmt.id`。
- 改：把分配结果存入 `stmt.outputs`（单输出 `[id]`；split 用 `allocateSplitIds` 得 `[front, back]`）；`stmt.id` 由 `recordFeature`/`appendStatement` 赋 `sN`（见 §2.3）。
- `ScriptEngine.ts:371` `recordShape`：`allocateStatementId(op, [])` 结果入 `stmt.outputs`，`stmt.id` 留给 append。
- `ScriptEngine.ts:304-308` `getLastStatementId`：返回 `findTerminalStatementId(...)`（T5 后返回 `sN`），语义即「该 scopedId 当前 partName 对应的最新语句」——与方案 3.7 一致。
- 因 `allocateStatementId` 不再产生 `grp_N`，`features/group.ts`/`assembly.ts` 的 `grp_N` 相关断言需更新（`group.ts:22` 等）。

#### T8 — 3.8 `executeScriptDiff` 按 StmtId diff

- `src/engine/script-engine/executeScript.ts` 的 diff 逻辑：当前按 `stmt.id` diff。Phase 3 后 `stmt.id = sN`（单次解析内位置稳定）。
- 适配：diff 键用 `stmt.id`（`sN`）即可；但 re-parse 会重排 `sN`，故 **增量重执行匹配需结合 `seq`（`types.ts:100`）或 content-key**，不能纯靠 `sN` 跨重解析稳定。具体：diff 先用 `sN` 粗匹配，再用 `statementKey`（ModuleExecutor 已有缓存键，`src/cad-runtime/module-executor.ts`）精匹配。
- 若 `executeScriptDiff` 尚未迁到 CadRuntime（2.9 未完成），本任务随 2.9 一并做。

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

---

## 5. 兼容性（验收硬指标）

- **存量 `partN_vM` fixture 原样通过**：引擎不解析变量名格式（`isPartVmId`/`getModelNum`/`getVersionNum` 保留于 `allocate-id.ts:196-212` 供解析旧名），`varToId` 仍能把旧 `part0_v0` 解析为 partName。验证：`test/faijs/` 下 `.faijs` fixture 全跑绿。
- **AI 生成代码友好性**：同模型多特征脚本中变量名稳定（`part0` 始终是同一模型，因单入单出复用名）。验证：新增 e2e「多 drill 链 `part0` 始终同一模型」。

---

## 6. 验收标准与验证步骤（遵循 AGENTS.md 分层纪律）

### 6.1 验收清单

- [ ] 两项目 `npm run typecheck`（faijs）/ `npx tsc --noEmit`（3d_editor）全绿。
- [ ] faijs `npm test` 全绿；3d_editor `npm run test:components` + 相关 e2e spec 绿（**一次只跑一个 spec，严禁全量 e2e / 严禁跑 CI 总脚本**）。
- [ ] grep 红线：`3d_editor/src` 生产代码不再有 `terminalToScopedId[asPartName(stmt.id)]` 直接反查（必须走 `outputs`）；`src/lang/parser.ts` 不再有 `stmt.id = asStmtId(varName)`。
- [ ] `CadStatement` 无 `stmtId?` 字段（`grep stmtId` 仅剩顺序分配一处）。
- [ ] 装配回归：add_constraint 链式真实生效（新测试，接 2.4 的 `dependentsOf/touch`）。
- [ ] split 在 Timeline 为单节点、场景树 front/back 双条目均正确（既有 `script-engine.test.ts` 的 `recordSplit`/`findTerminalStatementId` 用例绿 + 新增断言）。
- [ ] 旧 `partN_vM` fixture 兼容测试绿。

### 6.2 推荐实施顺序（与强耦合一致）

```
T1(id→sN, outputs 显式)  ──同批──►  T3-cond(终端移执行收尾, 阻塞于 2.9)
T2(allocate-id 重写)     ──►        T4(codegen 改用 outputs)
T1 落地后 ──同批──► T5(updateTerminalMapping/findTerminalStatementId 改 outputs)
                     ──同批──► T6(Timeline 反查走 outputs)
T7(features buildStatement 入 outputs) ──► T8(executeScriptDiff 按 sN+seq)
```

**铁律**：T1 与 T5+T6 同批；T3-cond 与 2.9 同批；其余可独立但建议 T2→T4 紧邻（codegen 测试依赖命名规则）。

### 6.3 验证步骤（每层通过才进下一步，严禁并发）

1. faijs：`npx tsc --noEmit` → `npx vitest run src/lang/allocate-id.test.ts` → `npx vitest run src/lang/parser.test.ts` → `npx vitest run src/lang/codegen.test.ts`
2. faijs：`npm run build`（2.9 依赖的 tarball 前置）
3. 3d_editor：`npm run pack`（faijs）→ `cd 3d_editor && npm install` → `npx tsc --noEmit` → `npm run test:components`
4. 3d_editor：`npx playwright test <name>.spec.ts`（单 spec，需先 build；跑完确认 chrome/vite 子进程退出再跑下一个）

---

## 7. 风险与开放问题

1. **T1 与 T3-cond 的瞬时断裂**：若 T1 先合、T3-cond 后合，`computeTerminalShapes`（:906 推 `stmt.id`）会推 `sN` 而非 partName，终端判定错。→ 必须同批，或在 T1 时先把 :906 改为读 `stmt.outputs`。
2. **`findTerminalStatementId` 返回语义翻转**（partName → StmtId）：6 个调用点（:308/581/613/987/1320/1430）消费语义需逐一确认，部分可能仍要 partName（如 `result.outputs[partName]`）。→ T5 执行时逐点审计，必要时保留「返回 partName」重载 + 新增「返回 StmtId」函数。
3. **2.9 未完成阻塞 T3-cond / T8**：若 2.9 未启动，Phase 3 仅能完成 T1/T2/T4/T5/T6/T7（静态身份分离），终端源切换与 diff 重写留待 2.9。→ 本文档将 T3-cond、T8 标为条件任务。
4. **`allocateStatementId` 返回类型品牌**：改为 `PartName` 会波及 3d_editor 12+ 处类型；过渡期保留 `StmtId` 品牌（字符串兼容）可降低改动面，但类型语义不纯。→ 由实施者按改动面抉择，本文档建议过渡期保留品牌、仅语义重定向。
