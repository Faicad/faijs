# faijs parser 越权做 UI 层命名（变量重命名）— 分析与修复文档

> ⚠️ **过时修正（2026-08-29）**：本文档正文未改动。§3.3 分层对照表中"parser（先解析后执行）"表述已过时——faijs 的准确执行模型是**先解析后编译、执行交给 JS 虚拟机**（parser 只做语法分析，`compileToModule` 从 IR 编译产物，JS VM 动态 import 执行）。权威表述见 `docs/syntax-design.md` §6 与 `docs/api-contract.md` R-2。

> 日期：2026-08-28
> 范围：faijs `src/lang/parser.ts` + `src/lang/allocate-id.ts` 的命名越权；跨项目核对 `../3d_editor`
> 性质：**架构分层违规修复**（仅写方案，未实施代码）
> 关联文档：`docs/syntax-design.md`、`docs/plans/2026-08-27-faijs-language-normalization-design.md`、`../3d_editor/docs/plans/2026-08-28-ir-strip-source-code-generation-plan.md`

---

## 0. 用户原话（直接引用，作为判定基准）

> 「parser 这是乱来，完全违规。parser 只应对代码进行语法分析，怎么可能改写用户提供的代码。」

> 「partN 这种命名是 UI 层的事情，怎么可能跑到 parser 层里，完全乱来。还篡改用户代码，莫名其妙。而且文档写里的很明白，faijs 的变量可以是任何合法的 js 的变量名。partN 仅用于 UI 层的自动命名。这个 parser 是 faijs 语言的 parser，居然去改 UI 层生成的代码？」

---

## 1. 结论（先给结论）

1. **当前 parser 越权**：`parseScript` 在解析期调用 `derivePartName` 把用户变量（如 `asm1`）重命名为内部物理名 `partN`，并把所有引用（inputs / args / return）改写成物理名。这是 **UI 层代码生成**的职责，不是 L0 语法分析的职责。
2. **违反文档契约**：`docs/syntax-design.md` 白纸黑字规定「语句 id 可以是任意合法 JS 标识符」「`partN_vM` 仅用于 UI 层自动生成的代码」「parser 与 codegen 双向同构」。当前实现两者全破。
3. **连带 bug（同一根因）**：成员调用 `asm1.add_constraint()` 的 `receiver` 字段存词法名 `asm1`，但声明 `outputs` 已被改成物理名 `part1` → 命名空间不一致；且 `collectStatementRefs` 漏收 `receiver` → 依赖边缺失（见 `2026-08-28` 日志「关键发现」）。
4. **修复安全**：faijs 运行时与 3d_editor 都用 `outputs` 的值作**不透明 key**，从不解析 `partN` 结构；3d_editor 自己在生成语句时调 `derivePartName` 产生 `partN`。parser 停改名后，3d_editor 生成的 `partN` 被原样保留、消费路径完全不变，**无回归**。

---

## 2. 问题现象（逐条 file:line 证据）

### 2.1 parser 在解析期分配物理名 partN（篡改用户变量）

`src/lang/parser.ts`：

- `:172` 提取词法名：`const varName = declNode.id.name`（如 `asm1`）。
- `:618-625` 调 `derivePartName` 分配新物理名：
  ```ts
  const result = derivePartName({ callee: stmt.callee, inputCount: stmt.inputs.length, outputCount: 1, statements })
  const allocated = result.behavior === 'reuse' ? stmt.inputs[0] : result.names[0]
  ```
- `:625` `stmt.outputs = [allocated]` → 用户 `asm1` 被覆写为 `part1`。
- `:628` `varToId.set(varName, allocated)` → 建「词法名 → 物理名」映射，**随后用于改写引用**。
- 解构声明 `:582-594`、裸重赋值 `:696-706` 同构，均有 `derivePartName` + `varToId.set(varName, allocated)`。

`src/lang/allocate-id.ts`：

- `:19` `const PART_RE = /^part(\d+)$/`
- `:95-96` `nextPartNames` 按 `getMaxModelNum(statements) + 1` 分配 `partN`——即「扫描已有 outputs、自增序号」。
- `:57` `derivePartName` 是这套命名服务的唯一入口。

### 2.2 parser 在解析期改写所有引用为物理名

`src/lang/parser.ts`：

- `:204` `const inputId = varToId.get(argNode.name)` → 参数里的变量引用经 `varToId` 翻成物理名，`inputs.push(inputId)`。
- `parseValueExpr`（`:86-88`）`const varId = varToId.get(name); return { $ref: varId }` → 嵌套/成员 args 里的引用也翻成物理名。
- `parseReturnObject` / `parseReturnStatement`（`:408-410`、`:353-355`）`varToId.get(prop.value.name)` → return 值也翻成物理名。

后果：用户写 `let part0 = cad.box(); let asm1 = cad.assembly({ members: ['part0'] })` 解析后，`members` 里的 `'part0'` 是**字符串字面量**（原样保留，不走 `varToId`），而声明的 `asm1` 被 `derivePartName` 改成 `part1`——**用户源码的变量名在 IR 里荡然无存**（`asm1` 声明的部分）。

### 2.3 成员调用 receiver 命名空间不一致（连带 bug）

`src/lang/parser.ts:714-749` 成员调用分支：

- `:720` `const targetVar = expr.callee.object.name` → 取词法名 `asm1`。
- `:723` 仅做 `varToId.has(targetVar)` 的「已声明」校验（通过）。
- `:745` `receiver: targetVar` → **直接存词法名 `asm1`，未翻物理名**。

而同一变量的声明 `outputs` 已是物理名 `part1`（§2.1）。于是：
- `computeLeafTerminals` / `consumes` 拿 `part1` 比对 `receiver==='asm1'` → 永不等 → 该分支对真实解析程序是**死代码**（上一轮已删）。
- codegen（`compile.ts:181`）`await ctx.${stmt.receiver}.${stmt.callee}(...)` 生成 `ctx.asm1`，但声明（`compile.ts:190`）生成 `ctx.part1 = ...` → **`ctx.asm1` 为 undefined，运行时崩**（`2026-08-28` 日志已记）。

### 2.4 collectStatementRefs 漏收 receiver（连带 bug）

`src/lang/parser.ts:470-476`：

```ts
function collectStatementRefs(stmt: CadStatement): string[] {
  const refs = new Set<string>(stmt.inputs)
  for (const arg of Object.values(stmt.args)) collectRefsFromArg(arg, refs)
  return [...refs]   // 未包含 stmt.receiver
}
```

`compile.ts:120-121` `if (stmt.refs) return stmt.refs` 对解析产物**总是早返回**，故 `compile.ts:123-124` 的 `if (stmt.receiver) refs.add(stmt.receiver)` 对解析脚本是**死代码**。→ 成员调用对 compound 的**依赖边完全缺失**，排序时可能被排到 `cad.assembly()` 之前。

---

## 3. 根因：分层违规

### 3.1 文档契约（早已写明，parser 未遵守）

`docs/syntax-design.md`：

- `:5` 「重大更新：**partN_vM 格式的命名规则仅用于 UI 层自动生成的代码**。手写、ai 生成代码不在此列。」
- `:21` 「`partN_vM` 命名格式仅用于 **UI 层自动生成的代码**。」
- `:49` 「UI 层自动生成的语句 id 采用 **partName** 格式（`partN_vM`…）」
- `:63-64` 「**语句 id 可以是任意合法 JS 标识符**（`const <id> = cad.op(...)`）。`partN_vM` 只是 **UI 层自动生成代码**时采用的 id 形态…**引擎以 `stmt.id` 为不透明 key 执行，不解析其结构**。」
- `:56` 「合法 JS 是**序列化契约**… parser 还原为结构化语句」——明确 parser 只做「还原/语法分析」。

### 3.2 实际：parser 干了 UI 生成层的活

- `derivePartName` / `getMaxModelNum` / `PART_RE` 是**命名分配**（生成 `partN`），属于「谁写代码谁命名」的生成侧。
- 但 `parser.ts:584/618/696` 在**解析**每个声明时调用它 → parser 替 UI 决定了变量名。
- 用户原话点破本质：这是「faijs 语言的 parser 去改 UI 层生成的代码」的分层倒挂。

### 3.3 分层对照（AGENTS.md L0–L3）

| 层 | 职责 | 命名分配属于？ |
|---|---|---|
| L0 文本层 `src/lang/` | parser（先解析后执行）、codegen、args-schema | ❌ parser **不应**做 |
| L3 Host / UI | 3d_editor 生成代码、AI/CLI 生成代码 | ✅ 生成侧做（`derivePartName` 在此调用） |

当前实现把 L3 的命名分配塞进了 L0 的 parser → 违规。

---

## 4. 影响面（跨项目，结论：修复安全）

### 4.1 faijs 运行时：只用 `outputs` 作不透明 key，不解析 partN

- `identity.ts:91` `asPartName` 只是 branded 强转（`return raw as PartName`），**无解析**。
- 运行时所有缓存以 `outputs` 值为 key：`runtime.ts` 的 `solidCache`/`brepSolids`/`compounds`（`runtime.ts:659/:667-669`、`:654-660`、`:594-601`）、`module-executor.ts:131/245/248`。
- 全仓唯一解析 `partN` 的正则是 `allocate-id.ts:19` 的 `PART_RE`（仅 `getMaxModelNum` 用于命名分配）。**运行时不依赖 partN 结构**。
- 结论：把 `outputs` 从 `part1` 改回 `asm1`，运行时仅是换个 key 字符串，**不崩**。

### 4.2 3d_editor：自己生成 partN，消费 outputs 作不透明 key

3d_editor 在**生成代码时**自己调 `derivePartName`：

- `src/engine/features/types.ts:144` `import { derivePartName, type PartName } from '@faicad/faijs/browser'`
- `:162` `const result = derivePartName({ callee, inputCount: inputNames.length, outputCount, statements })` —— 生成新语句时分配 partN。
- `script-engine/index.ts:8` 把 `derivePartName`/`getMaxModelNum` re-export 给宿主。
- 最新方案 `docs/plans/2026-08-28-ir-strip-source-code-generation-plan.md:179`「命名服务统一走 `derivePartName`… 宿主只传 callee/inputCount/outputCount/**已用 partN（由代码文本提取）**… UI 生成代码的 partN 约定不变」——明确**命名是宿主生成侧职责**。

3d_editor 消费侧（全部以 `outputs` 值/PartName 为不透明 key，不解析 partN）：

- `src/stores/core/script-store.ts:41` `terminalToScopedId: Record<PartName, ScopedId>`（终端 PartName → 场景 scopedId）。
- `executeScript.ts:452-462` 遍历 `terminals` 用 `terminals[i].id`（= PartName）建映射。
- `ScriptEngine.ts` 全文 `terminalToScopedId[partName]` / `s.outputs?.includes(asPartName(...))` 反查（`:1326`、`:1408`、resolve-ref.ts `:93/:96`）。
- `script-engine.test.ts:767-770` 明述「outputs 的 key 必须是 PartName（stmt.outputs[0]，如 "part0"），与 commitSceneResult 按 terminalToScopedId 的 PartName 取 shape 的契约一致；用 stmt.id（StmtId "__pending__"）会导致 shape 查不到」——证明 3d_editor 依赖的是 **`outputs[0]` 携带真实 part 名**，而非 parser 分配的序号。

**安全论证**：3d_editor 生成的代码文本里本就有 `partN`（它自己调 `derivePartName` 写的）。parser 停改名后：
- 解析保留文本里的 `partN` → 3d_editor 的 `terminalToScopedId` key 不变。
- 仅当用户/AI 写非 `partN` 名（如 `asm1`）时，parser 现在**保留**它而非改成 `partN` → 3d_editor 用 `asm1` 作 key，逻辑自洽、无回归。
- 3d_editor 的 `derivePartName` 测试（`script-engine.test.ts:1224-1230` I-3）测的是「宿主生成产生 partN」，与 parser 无关，仍绿。

### 4.3 被破坏的契约（修复后恢复）

| 契约 | 现状 | 修复后 |
|---|---|---|
| 变量可任意合法 JS 名 | ❌ 被强改 partN | ✅ 保留词法名 |
| partN 仅 UI 自动命名 | ❌ parser 也分配 | ✅ 命名归生成侧 |
| parser↔codegen 双向同构 | ❌ rename 导致 round-trip 丢名 | ✅ 同名保留 |
| stmt.id = 变量名（syntax-design.md:53） | ⚠️ 当前 `id=sN`、`outputs=partN` 两不搭 | ✅ 见 §5.4 决策 |

---

## 5. 正确的流程（目标架构）

### 5.1 parser = 纯语法分析，保留词法名

- parser 提取 `declNode.id.name` → 直接作为 `PartName` 写入 `outputs` / `inputs` / `receiver` / 引用 `$ref` / return。**不做任何命名分配、不做任何名称翻译。**
- `varToId` 仅用于**作用域校验**（「变量是否已声明」），不再做「词法名→物理名」映射。

### 5.2 命名服务 `derivePartName` 的归属

- `derivePartName` 保留为 faijs 导出的**纯函数工具**（3d_editor/AI/CLI 在**生成代码文本**时调用），**parser 不再调用**。
- 即「谁写代码谁命名」：UI 面板生成 `partN`、AI 生成任意名、手写任意名——parser 一视同仁地保留。

### 5.3 `PartName` = 左值名（任意合法 JS 名），不透明

- `identity.ts:57` 定义 `PartName` =「左值变量名」。`partN` 只是常见 UI 命名示例，不是类型约束。
- 运行时/宿主以 `PartName` 为不透明 key（§4.1/§4.2），不解析其结构。

### 5.4 `stmt.id` 的澄清（决策点，见 §9）

- 现状：`parser.ts:770-771` 把 `stmt.id` 覆写为语句序号 `sN`；`outputs[0]` 是物理名 `partN`。二者不一致。
- 文档：`syntax-design.md:53` 说「`stmt.id`=变量名」；`runtime.test.ts:556` 注释「`stmt.id === outputs[0]`」。
- 本修复**不改 `stmt.id` 的赋值方式**（保持 `sN`），以最小化爆炸半径：`id` 用于 deps 图与增量执行 key，`outputs` 用于 part key，二者经 `varToStmtId`（compile.ts 以 `outputs` 为 key）桥接，功能自洽。是否把 `id` 对齐为变量名（彻底符合文档）作为**独立后续清理**，不在本次范围。

---

## 6. 修复步骤（file:line，分阶段，附验收）

### Phase 1 — parser 去除命名分配（最小、安全）

| # | 位置 | 当前 | 改为 | 验收 |
|---|---|---|---|---|
| P1.1 | `parser.ts:34` import | `import { derivePartName } from './allocate-id'` | 删除该 import（parser 不再依赖命名服务） | `npm run lint` 无未用导入；`npm run typecheck` 通过 |
| P1.2 | `parser.ts:618-628`（单声明） | `derivePartName`+`varToId.set(varName, allocated)`+`stmt.outputs=[allocated]` | 删 `derivePartName` 调用；`varToId.set(varName, asPartName(varName))`（恒等，仅作用域校验）；`stmt.outputs = [asPartName(varName)]` | 解析 `let asm1=cad.assembly(...)` → `outputs:["asm1"]` |
| P1.3 | `parser.ts:582-594`（解构） | 同上 `derivePartName`+`allocated` | 同 P1.2 逻辑，按 `valueNames` 逐一并恒等 set | 解构 `outputs` 保留词法名 |
| P1.4 | `parser.ts:696-706`（裸重赋值） | 同上 | 同 P1.2 | 重赋值 `outputs` 保留词法名 |
| P1.5 | `parseValueExpr :86-88`、`parseReturn* :353-355/:408-410` | `varToId.get(name)` → 物理名 `$ref`/return | 因 `varToId` 现为恒等映射，`varToId.get(name)` 返回词法名 → **无需改代码**，引用自然保留词法名 | dump 验证 `$ref` 为词法名 |
| P1.6 | 成员调用 `:745` | `receiver: targetVar`（已是词法名） | **不改**（现与 `outputs` 同命名空间） | — |

> Phase 1 后：用户 `asm1` 全程保留；3d_editor 生成的 `partN` 也原样保留 → 修复 §2.1/§2.2/§2.3 的篡改与命名空间不一致。
>
> **行为变化提示（P1.2/P1.4 的语义影响）**：恒等映射意味着单入单出消费性 op（如 `drill`/`translate`）的 `outputs` 从「复用输入名（R2）」变为「保留词法名」。对 3d_editor 生成代码无影响（生成侧自己调 `derivePartName`，写进文本的就是 `partN`，词法名 == 分配名）；对用户/AI 手写代码（如 `let myPart = cad.drill(part0, ...)`）`outputs` 变为 `["myPart"]` 而非 `["part0"]`——这正是修复目标（保留用户命名），消费方以 `outputs` 为不透明 key，逻辑自洽。

### Phase 2 — 补 `collectStatementRefs` 漏收 receiver（连带 bug）

| # | 位置 | 当前 | 改为 | 验收 |
|---|---|---|---|---|
| P2.1 | `parser.ts:470-476` `collectStatementRefs` | 仅 `inputs`+args，漏 `receiver` | 末尾加 `if (stmt.receiver) refs.add(stmt.receiver)` | 成员调用对 compound 的依赖边建立；`computeLeafTerminals` 排序正确 |

> Phase 2 后：§2.4 的依赖边缺失修复；与 Phase 1 配合，`receiver` 词法名与 `outputs` 词法名同空间 → 边指向真实节点。

### Phase 3 — 文档同步 + 测试加固

| # | 位置 | 动作 | 验收 |
|---|---|---|---|
| P3.1 | `docs/syntax-design.md`（生效文档；历史计划文档 `docs/plans/2026-08-27-*.md` 按项目规则不改） | 补一句：「`derivePartName` 由生成侧（UI/AI/CLI）调用，parser 不调用；parser 保留词法变量名」 | 文档与代码一致 |
| P3.2 | `src/lang/parser.test.ts` | 新增用例：解析 `let asm1=cad.assembly({members:['part0']}); asm1.add_constraint({type:'face_mate'})` → 断言 `outputs:["asm1"]`、`receiver:"asm1"`、`stmt.refs` 含 `asm1`、`$ref` 为 `part0`（词法） | 用例绿 |
| P3.3 | `src/lang/derive-part-name.test.ts` | 标注该测试是「命名服务单测（生成侧）」，与 parser 解耦 | 仍绿（parser 不调用不影响） |

---

## 7. 不改动的部分（爆炸半径控制）

- **不碰 `compile.ts` / `runtime.ts` / `module-executor.ts`**：它们以 `outputs` 为 key，改名后只是 key 字符串变化，逻辑不变。
- **不碰 3d_editor**：它生成 `partN`、以 `outputs` 为不透明 key，parser 停改名后行为一致。
- **不碰 `allocate-id.ts` 本身**：保留为生成侧工具。
- **不动 `stmt.id = sN` 赋值**（见 §5.4）。
- **不提交**：改动留工作树，待用户确认后按规范提交。

---

## 8. 验收门禁（单进程串行，不并发）

1. `npm run lint` → `npm run typecheck` → `npm run build`（全绿）。
2. `npx vitest run src/lang/parser.test.ts src/lang/derive-part-name.test.ts`（命名改动单测）。
3. `npx vitest run src/cad-runtime/terminal-dag.test.ts src/cad-runtime/terminal-dag-symbol.test.ts`（上轮 receiver 消费修复仍绿）。
4. **行为零变化闸门**：用一份 3d_editor 既有 `.faijs`（含 `partN`）跑 `parseScript` → `runtime.execute`，前后 `ExecutionResult`（terminals/outputs/compounds）一致；再用手写非 `partN` 名（如 `asm1`）跑同闸门，确认保留原名、无 `ctx.undefined` 崩溃。
5. 受影响 e2e 仅跑相关 spec（装配/布尔/split），不跑全量。

---

## 9. 待用户裁定的决策点

1. **`stmt.id` 是否对齐文档改为变量名**（`syntax-design.md:53` 的「`stmt.id`=变量名」）？本次建议**保持 `sN`** 以控爆炸半径，后续单独清理。若用户要求一步到位，则 `parser.ts:770` 改为 `stmt.id = asStmtId(varName)` 并核查增量执行 key 是否依赖 `sN` 形态。
2. **`derivePartName` 入参形态**：当前 `statements: CadStatement[]`；3d_editor 最新方案倾向「传 `code` 文本、faijs 内部解析取已用 partN」（`ir-strip-source-code-generation-plan.md:190`）。此为生成侧 API 演进，与 parser 修复正交，不阻塞本次。

---

## 10. 一句话总结

parser 越权做了 UI 生成层的 `partN` 命名分配，篡改用户变量并破坏双向同构；修复 = **parser 退回到纯语法分析、保留词法名，`derivePartName` 归还生成侧**，3d_editor 与该修复完全兼容、零回归。
