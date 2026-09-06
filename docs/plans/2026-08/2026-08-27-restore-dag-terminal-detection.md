# 恢复 DAG 活跃性终端判定 + faijs 封装：技术方案

- 日期：2026-08-27
- 状态：待评审
- 前置文档：`docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md`（§3.6 终端判定）、`docs/plans/2026-08-26-phase3-implementation-plan.md`（Phase 3 命名）
- 范围：faijs 引擎 + 3d_editor 宿主两个项目；本文档只写方案，不包含实施

---

## 1. 需求原话（不准删除）

来自用户 2026-08-27 会话。

> 分析之前的 dag 判断活跃性与现在的全局变量判断活跃性，由哪些差别。如果要恢复 dag 判断活跃性，但是保持目前的 partN 命名，代码要如何调整。本项目和 3d_editor 项目都需要哪些调整？先写一份技术方案，完成这个需求。此外，为何是 ../3d_editor 项目里有这方面的代码，不应该是 faijs 层面来处理这个事情吗？切换算法不应该影响下游。使用：partN 命名下同一名字多语句写，必须用"最后写者 + 下游无消费"判断。或者找到一个变量的最后一次左侧赋值。不管什么算法，应该 faijs 封装。请完成这份文档，并且要详细调查清楚两个项目波及到的代码文件。

> group 也是 shape。新的逻辑是 DAG 里最终活跃的 shape 显示在 UI 上；group/assemble 的处理和其它 shape 没有任何的不同。差别点只在如何在 UI 显示。

第二轮澄清（核心语义，最简表述，用户原话）：

> DAG 活跃性判断就是**看一个变量是否被消费**——被消费了，就不出现在终端。规则只有一条：**compound shape 不消费其子 shape**，所以返回 compound 的语句要从"消费方"里排除；其它语句，只要 shape 出现在右侧（inputs/refs 里的 Shape 引用），就认为被消费了。例：
>
> `x1 = cad.box(...)` / `x2 = cad.drill(x1)` → x1 被 drill 消费 → x1 不进终端。
>
> `x1 = cad.box(...)` / `x1 = cad.drill(x1)` → 同上，只是 x1 被重新赋值，留下的 x1 指向被终端使用的那个 shape（drilled）→ x1 进终端。
>
> `x1 = cad.box(...)` / `x2 = cad.assemble(x1, ...)` / `x1 = cad.drill(x1)` → assemble **不消费** x1，所以 x1 的"消费"只来自 drill；最终 x1（drilled）、x2（assemble）都活跃、都进终端；且 assemble 绑定的是被钻孔后的那个 box（引用的是 x1 的最终值）。

补充澄清（UI 命名规则 + AI 代码的 parser 报错兜底，用户原话）：

> 在UI生成的代码中，按照目前的规则，必需是：
>
> `part0 = box(...)` / `part0 = drill(part0, ...)`
>
> 对于所有输入是一个shape，输出是一个shape的方法，默认不改变变量名。如果输入没有shape，输出是shape的方法，需要一个新的变量名。如果输入和输出的shape数量不同，比如split、boolean，也要用新的变量名。这是静态的规则，UI生成代码时可以遵守。
>
> 对于AI生成的代码，没法强制。那么下面的代码，就在parser的时候报错：
>
> ```
> part0 = box(...)
> part1 = drill(part0, ...)      // part0 被 drill（非 compound）消费 → 非终端
> part2 = group(part0, part1)    // part0 仍是 group 成员
> ```

补充澄清 2（任何已被消费的变量不准再次消费，用户原话）：

> 任何已被消费的变量不准再次消费
>
> ```
> part0 = box(...)
> part1 = drill(part0, ...)
> part2 = extrude(part0) # 这里要报错，part0已经被消费了。
> ```

补充澄清 3（copy 语义确认：方案 B + 源显示 + 需实现 copy API，用户原话）：

> 好的，采用方案B，且源显示（part0=box; part1=copy(part0) → 画布显示 box 和副本两份。而且copy的api目前并没有，需要实现这个api，并且要添加相关测试用例。请更新文档

文档编辑注记（非用户原话，记录文档曾绕的弯路，供评审参考）：

- 第三轮：曾把"入参 shape 不失去活跃性"误读为"成员一律作为独立终端显示 + 成员修改生命周期已解决"，已拆分三层（缓存保全 / 显示层级 / 修改生命周期），见 §4.3；
- 第四轮 + 第五轮：曾把规则扩写成"成员全局保活 / 逐消费者 dedup / 一个 shape 只能被一个 compound 引用"等臆想逻辑——已全部删除。正确语义即上面一句话：consumer 判定时排除 compound 语句即可，无需任何额外不变量或 dedup；
- 第六轮：新增 **parser 静态校验"成员必为终端"**（补充澄清，用户原话）——UI 生成的代码遵守静态命名规则（单入单出保名），AI 生成的代码无法强制，故"成员被非 compound 语句消费"的代码在 parseScript 时直接报 `ParseError`（§4.1 前置）。原 §5.2"保留 groupAssemblyMemberIds 保活兜底"的边角场景随之消失，改为整体删除；
- 第七轮：新增 **通用静态校验"任何变量最多被消费一次"**（补充澄清 2，用户原话）——这是"成员必为终端"规则的推广：对每个 shape 变量 v，在其最后一次赋值（P）之后引用 v 的**非 compound 语句数量必须 ≤ 1**（0 = 终端；1 = 被唯一消费；≥2 = ParseError）。示例 `part1 = drill(part0); part2 = extrude(part0)` 中 part0 被两个非 compound 语句消费 → 报错。保名链 `part0 = drill(part0)` 不受影响（drill 即最后写者，其后无第二个消费者）；
- 第八轮：新增 **copy 语义（方案 B）**（补充澄清 3，用户原话）——copy 是"共享读取"（克隆出新对象，源不变），与 drill/transform 的"独占改写"本质不同：**copy 不消费其源**，从"消费方"中排除（与 group/assembly 同级）；copy 输出是独立新对象 → **归"新名"类**（不保名）；**源显示**（`part0=box; part1=copy(part0)` → 画布显示 box 和副本两份）。faijs 目前**无 copy API**，需实现（含相关测试用例）；
- 三层拆分（缓存保全 / 显示层级 / 修改生命周期）仍成立，见 §4.3；其中修改生命周期与本终端判定正交，未实现。

用户的立场要点：

1. **终端活跃性判断是引擎（faijs）的职责**——3d_editor 里不应存在 DAG 叶子过滤代码，切换算法不应影响下游宿主。
2. **恢复 DAG 语义**（只显示不被下游消费的最终几何），但**保持 partN 命名**（同一名字多语句写，须用"最后写者 + 下游无消费"或"最后一次左侧赋值"判断）。
3. **活跃性判定必须封装在 faijs，3d_editor 不重复实现该判定。** 规则只有一条：变量被**非 compound** 语句消费（shape 出现在右侧）则不进终端；compound 语句（group/assembly）不消费其子 shape，从消费方中排除。group/assembly 自身也是 shape，同样按"是否被消费"判定终端。成员（被 compound 引用的 shape）是否作为独立 part 显示由宿主从 `compounds` 展开层级决定（UI 渲染层，不对成员做二次活跃性判定）；成员的**修改生命周期**（assemble 重算 / group 原子，含"assemble 绑定成员最终值"）见 §4.3，属未实现项，不在本方案终端判定范围内。

---

## 2. 现状基线（2026-08-27 真实代码）

### 2.1 终端判定的两次变迁

| 阶段 | 判定位置 | 算法 | 终端语义 |
|---|---|---|---|
| 旧（`82fa927` 前，已删） | parser 静态（`computeTerminalShapes`） | DAG：不被任何语句 inputs / group members 引用的输出即终端；≤1 个时返回 undefined | 只显示"叶子"（最终几何） |
| 现（Phase 3 起） | runtime 执行收尾（`collectResult`） | 全局变量：所有 Shape 类型的顶层活跃变量即终端（显式 return 优先） | 显示所有活跃 Shape（含中间结果） |

### 2.2 faijs 侧相关代码

| 文件 | 位置 | 现状 |
|---|---|---|
| `src/cad-runtime/runtime.ts` | `collectResult`（L535-646） | 终端判定在 L573-589：显式 `script.terminalShapes` 优先；否则遍历 `outputs`（ctx 中所有 Shape 变量）去重为终端 |
| 同上 | `extractBrepSolids`（L649-689） | **逐终端**提取 BREP solid；`terminals.length === 0` 时回退"最后一条 hasAssignment 语句的 outputs[0]"；assembly 成员 solid 追加提取 |
| 同上 | `ExecutionResult` 接口（L91-118） | `terminals: TerminalShape[]`、`outputs: Map<PartName, Shape>`、`compounds?: Map<PartName, PartName[]>`（另有 `brepChain`/`infos`/`failedAt`/`brepSolids`/`topology`/`changed` 字段，见 L91-118） |
| 同上 | topology 构建（L604-627） | auto 模式只为**终端**构建 BREP 真拓扑；brep 模式为全部输出 |
| `src/lang/parser.ts` | `parseReturnStatement`（L419-468） | 显式 `return [...]` 仍产出 `terminalShapes`（多终端数组）；单终端走 `terminalShapeId` |
| 同上 | `collectStatementRefs`（L546-558） | 已收集 `stmt.refs`（inputs + args 引用 + group/assembly members），**当前未用于终端判定** |
| `src/lang/types.ts` | `TerminalShape`（L129-135） | `{ id: StmtId; meta? }`——Phase 3 后 id 实为 PartName（`collectResult` 用 `asStmtId(partName)` 收口） |
| `src/lang/allocate-id.ts` | `allocateStatementId`（L121-142） | 命名规则：单入单出→复用 inputs[0]；无输入/创建类/boolean→新 partN；group/assembly→新 partN；split→两个新 partN。**无 copy 类** |
| `src/stdlib/*` | 单入单出 op 模板（`transform.ts` 为范本） | `(input, params, exec) => Shape`，`resolvePath` 静态判 brep/mesh；BREP 用 `exec.getSolid`/`setSolid` + `brep-ops`；**目前无 copy op**（occt-wasm `index.d.ts:219` 已提供 `copy(shape): ShapeHandle` 实体复制 API，未接线） |
| `src/browser.ts` / `src/index.ts` | 导出面 | `computeTerminalShapes` **已删除导出**（Phase 3 收尾）；`TerminalShape` 类型仍导出 |
| `demo/main.ts` | `extractShapes`（L229-251） | 按 `result.terminals` 取 outputs；terminals 为空时回退最后一条输出 |
| `src/brep/case2-load-stl-cylinder-assembly.test.ts` | `makePartScript`（L97-104） | 已不再传 terminalShapes（Phase 3 适配） |

### 2.3 3d_editor 侧相关代码（重点：宿主内的重复 DAG 实现）

| 文件 | 位置 | 现状 |
|---|---|---|
| `src/engine/script-engine/executeScript.ts` | `createPartsFromResult`（L363-488） | **本地 DAG 叶子过滤**：`producerIdx` 反向找"最后一条以 partName 为 output 的语句" + `hasDownstreamConsumer` 检查其后是否有语句把它作为 input（L461-477）；另有 `groupAssemblyMemberIds` 兜底（L429-448，把被 group/assembly 直接引用的成员加回建零件）；空终端回退"最后一条 new_shape 语句 outputs[0]"（L440-446） |
| 同上 | `writeScriptStore`（L492-527） | 建立 `terminalToScopedId`（键 = PartName，Phase 3 已适配） |
| 同上 | 三入口（execute/executeDiff/execute-validator 相关） | L223/256/301/334/849/865 全部消费 `result.terminals` |
| `src/engine/script-engine/ScriptEngine.ts` | `commitSceneResult`（L1308-1397） | **第二处本地 DAG 叶子过滤**：`producerIdx` + `hasDownstreamConsumer`（L1325-1345），注释明确说明"Phase 3 单入单出复用名…不能简单用 referencedIds.has 跳过"；只提交叶子几何；`compounds` 结构经 `setSceneCompounds` 存 store |
| `src/stores/core/model-store.ts` | `buildCombinedTree`（L337）/ `buildSceneTreeFromDag`（定义 L83，调用 L379） | 场景树层级从 `terminalToScopedId + sceneScript + sceneCompounds` 重建；compound 子 shape 展开即在此（UI 层） |
| `src/engine/__tests__/contract-entry.test.ts` | 白名单（L68） | **残留 `computeTerminalShapes`**——faijs 已删除该导出，白名单与实际导出面漂移 |
| 同上 | E10 段（L212-220） | `executeDoAssemble/previewAssembly/executeAssemblyPassForStmt` 临时放行段 |
| `src/engine/script-engine/executeScript.test.ts` | L33-102 | 断言 parser 级 `parsed.terminalShapes ?? []` 长度为 0（Phase 3 起 parser 不再计算，断言本身与当前语义一致）；**注释**仍描述旧 DAG 语义（"成员被引用非终端、group 唯一终端"），过时；**fixture 仍用旧命名**（`part0_v0`/`part1_v0`/`grp_1`，L37-47）——faijs 已迁移到 partN（HEAD `79c5389`），测试经 parseScript 往返会重映射为 partN，断言不受影响，但命名风格建议顺手统一 |
| `src/engine/script-engine/script-engine.test.ts` | L1305-1320 | I-4 测试："parser no longer computes DAG-leaf terminals"——当前语义的回归测试 |

### 2.4 关键事实

1. **3d_editor 有两处本地 DAG 叶子过滤**（`executeScript.ts:461-477` 与 `ScriptEngine.ts:1325-1345`），实现的就是"最后写者 + 下游无消费"算法——正是用户要求 faijs 封装的那个算法。这是"切换算法影响下游"的直接证据：Phase 3 把终端判定从 parser 移到 runtime 并改为"全局变量即终端"后，3d_editor 为了保持"只显示叶子"的用户可见行为，不得不在宿主侧重复实现 DAG 过滤。
2. **`stmt.refs` 已被 parser 收集但未用于终端判定**——恢复 DAG 所需的引用信息已在 faijs 侧，只是没接线。
3. **`ExecutionResult.compounds` 已携带 compound 结构**（3.10 落地），宿主场景树已改从执行结果消费；终端判定与 compound 结构解耦。
4. demo 当前 box-boolean 显示 `3 shape(s)`（全局变量语义）；恢复 DAG 后应回到 `1 shape(s)`（仅 subtract 结果）。
5. **compound 语句不消费其子 shape、copy 不消费其源，故成员/源天然不被"消费判定"降级**：终端判定只对"非独占语句的 RHS 引用"计数；group/assembly 这类返回 compound 的语句出现在成员右侧时、以及 copy 出现在源右侧时，直接从消费方排除，成员/源不因被引用而降级为非终端。因此成员/源几何与缓存不会被无意破坏（用户原话："这样子 shape 的缓存也不会被无意破坏"）。宿主 `executeScript.ts:429-448` 的 `groupAssemblyMemberIds` 并集原本"防止成员因非终端被漏建/漏缓存"——该边角场景（成员被独占语句消费 → 非终端）现由 **parser 静态校验直接报 ParseError**（见 §4.1 前置），合法脚本中成员必为终端，故该并集恒为幂等冗余、**整体删除**（§5.2）；"展开层级"（把 compound 成员按 `compounds` 挂到 group 节点下）在 `buildSceneTreeFromDag`（model-store.ts）保留，与建零件无关。
6. **当前 `collectResult` 把 group/assembly 变量（compound 输出）排除在终端判定之外**：仅 `isShapeLike`（含 positions/indices）的变量进入 `outputs`，而 CompoundShape（`{ kind: 'compound', children }`）无 positions/indices，故不进 `outputs`、不参与当前终端判定。新设计须把 compound 输出变量也纳入终端判定的遍历范围（即终端判定按"所有 shape-typed 顶层变量名"遍历，含 compound 变量；几何成员仍从 `outputs`/`compounds` 取），group/assembly 变量才能按同规则成为终端。注意：此规则只解决缓存保全，不解决成员的修改生命周期（见 §4.3）。
7. **终端判定不需要"一个 shape 最多被一个 compound 引用"之类的不变量**：旧文档曾引入此不变量并据此推导"成员保活无歧义"，这是多余且不准确的。正确做法是统一规则——compound 语句（group/assembly）从"消费方"中排除即可；无论某 shape 是否被多个 compound 引用、或同时被 compound 与非 compound 引用，判定都无歧义（非 compound 引用照常计为消费）。`compound.children` 当前只是 Shape 引用，未强制该校验，但本算法不依赖它。
8. **parser 静态校验"成员必为终端" + "任何变量最多被消费一次"（用户补充澄清 + 补充澄清 2）**：UI 生成的代码遵守静态命名规则（单入单出保名 / 无输入新名 / 输入输出 shape 数量不同新名），不会触发这两条校验；AI 生成的代码无法强制命名规则，故 parseScript 收尾处静态校验两条规则（§4.1 前置规则 A/B）——**规则 A**：任何 shape 变量在最后一次赋值后，被**独占语句**（排除 group/assembly/copy）消费的次数 ≤ 1（≥2 抛 `ParseError`，如 `part1=drill(part0); part2=extrude(part0)`）；**规则 B**：group/assembly 成员在最后一次赋值后**不得**被任何独占语句消费（成员必为终端）。这是命名规则不可强制时的报错兜底，也是 §5.2 删除宿主 `groupAssemblyMemberIds` 的前提（合法脚本成员必为终端，无需保活并集）。
9. **copy 语义（补充澄清 3，方案 B）**：copy 是"共享读取"（克隆出新对象，源不变），与 drill/transform 的"独占改写"本质不同——**copy 不消费其源**（从消费方排除，与 group/assembly 同级）；copy 输出是独立新对象 → **归"新名"类**（allocate-id.ts 需新增 copy 分支，不保名）；**源显示**（`part0=box; part1=copy(part0)` → 画布显示 box 和副本两份，part0 与 part1 都是终端）。faijs **目前无 copy API**：stdlib 无该 op、allocate-id 无该分类，但 occt-wasm 已提供 `copy(shape): ShapeHandle` 实体复制 API（`index.d.ts:219`，未接线）——实现落点见 §5.1。copy 对终端判定的影响：源不被降级、副本按普通 shape 判定（被下游独占消费则非终端）。

---

## 3. 问题分析：为什么算法必须封装在 faijs

1. **职责边界（契约）**：faijs 的职责是"执行 faijs 脚本，生成 3D 模型"（faijs-contract.md）；终端 = 画布显示什么，是执行语义的一部分，属于引擎产出。宿主只应消费 `ExecutionResult`，不应重复推导。
2. **切换算法不应影响下游**：当前 3d_editor 在 faijs 改动终端语义后被迫加了两处本地过滤兜底，一旦 faijs 再改（如本次恢复 DAG），宿主逻辑与之耦合、易漂移。正确形态：faijs 输出什么 terminals，宿主就显示什么。
3. **重复实现的成本**：两处本地过滤与 faijs 的 `collectResult` 终端判定是同一件事的三种实现，已出现注释级漂移（`executeScript.test.ts` 注释残留旧 DAG 语义、`script-engine.test.ts` 断言新全局语义并存）。收敛为单一实现（faijs）后，宿主只需删代码。
4. **partN 命名的算法约束**：旧 `computeTerminalShapes` 按"名字是否被引用"判断，在 SSA（partN_vM）下成立；partN 命名下同一名字被多条语句写（`part0 = translate(part0)`），必须按"最后一次写者 + 其后的语句是否消费"判断。该算法是 **PartName 级**的，不依赖 StmtId/命名格式，天然可封装在引擎内。
5. **group/assembly 与其它 shape 在活跃性判定上无任何差别**：compound 也是 shape，是否「最终活跃」同样只看"是否被非 compound 语句消费"。唯一特殊点是 compound 语句**不消费其子 shape**——所以成员出现在 group/assembly 右侧时，不会把成员判成"被消费"。这一条排除规则即用户原话的全部额外语义，不需要任何"成员全局保活""逐消费者 dedup""一个 shape 只能被一个 compound 引用"之类的不变量。"成员是否作为独立 part 显示在场景树"由宿主从 `compounds` 展开、不对成员做二次活跃性判定；成员的**修改生命周期**（assemble 重算 / group 原子）是独立未实现项（见 §4.3），不属于终端判定。§2.4 事实 1 的两处 producerIdx/hasDownstreamConsumer 过滤是宿主重复的活跃性判定，应删。
6. **命名规则是静态的、UI 可遵守；AI 代码由 parser 报错兜底**：UI 生成代码遵守"单入单出保名 / 无输入新名 / 输入输出 shape 数量不同新名 / copy 新名"的静态规则（用户补充澄清），天然不会产生"成员/源被独占消费"或"变量被消费两次"的边角场景；AI 生成的代码无法强制命名规则，故 **parser 静态校验**（§4.1 前置规则 A/B）对两个后果做检查——任何变量被**独占语句**（排除 group/assembly/copy）消费的次数 ≤ 1（规则 A）、成员必为终端（规则 B），违反即抛 `ParseError`。这是把 §2.4 事实 5 的"保活兜底"从宿主（`groupAssemblyMemberIds`）前移到引擎入口的统一处理：引擎静态拒绝非法代码，宿主无需再兜底。

---

## 4. 目标设计

### 4.1 核心：faijs 恢复 DAG 叶子终端判定（partN 兼容）

**在 `runtime.collectResult` 内实现"最后写者 + 下游无消费"算法**，替代当前"所有 Shape 变量即终端"。

**前置：parser 静态校验（用户补充澄清 + 补充澄清 2 + 补充澄清 3，命名规则不可强制时的报错兜底）**。UI 生成的代码遵守静态命名规则（单入单出保名 / 无输入新名 / 输入输出 shape 数量不同新名 / copy 新名），不会触发；AI 生成的代码无法强制命名规则，故 parseScript 收尾处（§2.2 `collectStatementRefs` 之后，`stmt.outputs`/`stmt.refs` 已就绪）做两条静态检查。消费计数统一使用**非独占 op 集合** `NON_CONSUMING_OPS = {group, assembly, copy}`——这三类语句出现在变量右侧时**不消费**该变量（group/assembly 不消费成员，copy 不消费源，见 §2.4 事实 9）。

**规则 A（通用：任何变量最多被消费一次，补充澄清 2）**——对每个 shape 变量 v：

```
P = 最后一条 outputs 含 v 的语句下标                  // v 的最后一次赋值
consumers(v) = { T | T.index > P 且 T.op ∉ NON_CONSUMING_OPS 且 v ∈ T.inputs/refs }
if consumers(v).length > 1：
  throw ParseError("variable v is consumed by more than one non-consuming-op-excluded statement")
```

- 0 个消费者 → v 是终端；1 个消费者 → v 被唯一消费（不进终端）；**≥2 → ParseError**。
- 例：`part0=box; part1=drill(part0); part2=extrude(part0)` → part0 被 drill 与 extrude 两个独占语句消费 → 报错（用户原话"任何已被消费的变量不准再次消费"）。
- 保名链 `part0=box; part0=drill(part0)` 合法：drill 即 part0 的最后写者（P=drill），其后无第二个消费者。
- **copy 不受规则 A 限制**：`part0=box; part1=copy(part0); part2=copy(part0)` → copy ∉ 消费者计数，part0 的独占消费者 = 0 → 合法；part0 是终端（源显示）、part1/part2 是终端（副本显示），三份都显示（补充澄清 3：`part0=box; part1=copy(part0)` → 画布显示 box 和副本两份）。

**规则 B（成员必为终端，补充澄清）**——对每个 group/assembly 语句 G，对每个成员 m ∈ G.args.members：

```
P = 最后一条 outputs 含 m 的语句下标                  // m 的最后一次赋值
if consumers(m).length > 0：
  throw ParseError("member m of group/assembly G is consumed by an exclusive statement")
```

规则 A 与规则 B 是同一套"最后写者 + 下游无消费"消费者计数在两种变量上的不同阈值：**非成员变量允许 0 或 1 个独占消费者；成员只允许 0 个**（成员必为终端，杜绝"成员非终端但 group 仍引用"的边角场景）。二者都是 §4.1 终端判定的静态前置：合法脚本中，每个被消费的变量恰有一个下游消费者（DAG 中"消费边"是链而非扇出），成员必为终端。

```
输入：script.statements（含 outputs/inputs/refs）、outputs Map（PartName → Shape）
输出：terminals: TerminalShape[]

核心语义（用户 2026-08-27 澄清，最简）：
  - 一个变量是否进终端 = 它「是否被消费」。被消费 → 不进终端。
  - "被消费" = 存在一条**独占**语句 T（T.op ∉ NON_CONSUMING_OPS），其 index > 该变量
    最后一条赋值语句 P，且 T 的 inputs/refs 里包含该变量名（shape 出现在右侧）。
  - NON_CONSUMING_OPS = {group, assembly, copy}：这三类语句**不消费**其右侧引用
    （group/assembly 不消费成员，copy 不消费源），在"消费方"判定中直接跳过（不计数）。

1. 显式 return terminalShapes 优先（不变）
2. 预计算 nonConsumingProducers = { stmt | stmt.op ∈ NON_CONSUMING_OPS }
   （等价于：输出 compound 的语句 ∪ op 为 copy 的语句；copy 输出仍是 solid，须按 op 名判定）
3. 遍历每个 shape 变量名 v（含 compound 变量；当前 collectResult 仅遍历 isShapeLike，
   须扩展为覆盖所有 shape-typed 顶层变量名，见 §2.4 事实 6）：
     P = 最后一条 outputs 包含 v 的语句下标          // 最后一次左侧赋值（v 当前指向的实例）
     consumed = exists 语句 T：T.index > P 且 T ∉ nonConsumingProducers 且 T.inputs/refs 包含 v
     if !consumed：terminals.push({ id: v })          // 未被独占语句消费 → 终端
   （变量在 P 之前被消费、但 P 之后又被重新赋值：因 P 已前移，旧实例自然不进终端。
    例：`x1=box; x1=drill(x1)` → P 是 drill，其后无消费 → x1 进终端，box 旧实例不进。）
4. 三个示例对照（验证算法，用户原话）：
   - `x1=box; x2=drill(x1)`
       x1 的 P=S1；S2(drill, 独占) 在 S1 后引用 x1 → x1 被消费 → 不进终端。
       x2 的 P=S2；其后无引用 → x2 终端。              → terminals=[x2]
   - `x1=box; x1=drill(x1)`
       x1 的 P=S2(drill)；其后无消费 → x1 终端（drilled）。 → terminals=[x1]
   - `x1=box; x2=assemble(x1); x1=drill(x1)`
       x2 的 P=S2；其后 S3 引用的是 x1 而非 x2 → x2 终端。
       x1 的 P=S3(drill)；其后无消费 → x1 终端（drilled）。
       assemble 因是 NON_CONSUMING_OPS 语句、不消费 x1，不把 x1 判成"被消费"。
       → terminals=[x1, x2]，二者均活跃。且 assemble 绑定 x1 的最终值（drilled box），见 §4.3。
5. copy 示例（补充澄清 3）：
   - `part0=box; part1=copy(part0)`
       part0 的 P=S1；S2(copy, NON_CONSUMING_OPS) 不消费 part0 → part0 终端（源显示）。
       part1 的 P=S2；其后无消费 → part1 终端（副本显示）。
       → terminals=[part0, part1]，画布显示 box 和副本两份（用户原话）。
   - `part0=box; part1=copy(part0); part2=drill(part1)`
       part0 终端（源显示）；part1 被 drill 独占消费 → 非终端；part2 终端（drilled 副本）。
       → terminals=[part0, part2]。
```

要点：

1. **判定单位是 PartName**，不涉及 StmtId（sN）——与 partN 命名天然兼容，`TerminalShape.id` 语义保持"PartName"（当前 `asStmtId(partName)` 收口不变）。
2. **"最后一次左侧赋值"即最后一条 `outputs.includes(partName)` 的语句**——正好处理 `part0 = translate(part0)` 链：box 的 part0 被 translate 消费 → 非终端；translate 的 part0 无下游 → 终端。split 双输出同理（每个输出独立判定）。
3. **非独占语句（group/assembly/copy）不消费其右侧引用，是终端判定唯一需要特殊处理的点**：group/assemble 本身是 shape、copy 输出也是 solid，都按"是否被独占语句消费"判定；区别仅在 group/assembly 出现在成员右侧、copy 出现在源右侧时**不把成员/源计为"消费"**。因此成员不会因被 compound 引用而降级为非终端，源不会因被 copy 引用而降级，其几何/缓存保留（用户原话："这样子 shape 的缓存也不会被无意破坏"）。该规则**不**使成员/源一律成为独立显示的终端、也**不**解决成员的修改生命周期（见 §4.3）。当前 `collectResult` 仅把 `isShapeLike` 变量放入 `outputs`，导致 compound 变量不进遍历范围，是新设计必须补的缺口——活跃性判定须覆盖所有 shape-typed 顶层变量名（含 compound 变量；copy 输出是 solid，本就在 outputs 中）。3d_editor 从 `ExecutionResult.compounds` 展开子 shape 层级、**不**对成员做二次活跃性判定；宿主 `groupAssemblyMemberIds` 并集（executeScript.ts L429-448）整体**删除**——其"防成员因非终端漏建/漏缓存"的保活边角场景已由 parser 静态校验（§4.1 前置）报错杜绝，合法脚本成员必为终端、必在 terminals 中，并集恒为幂等冗余；"层级展开"在 `buildSceneTreeFromDag`（model-store.ts）消费 `compounds`，与建零件无关。copy 的源与副本都按普通 shape 出现在 terminals（副本若被下游独占消费则非终端），宿主按 terminals 建零件即可，无需额外兜底。
4. **引用来源**：优先用 `stmt.inputs`（已是 PartName）+ group/assembly `args.members`；`stmt.refs` 已含这些（parser 收集），可作统一来源（过滤非 PartName 的 $param 名）。
5. **`ExecutionResult.outputs` 保持不变**（仍含全部 Shape 变量）——中间几何的 mesh 仍在 outputs 中，只是不进 terminals；`brepSolids`/`topology` 继续**按 terminals** 提取/构建（与现状一致），即中间变量不再有 BREP solid 与真拓扑（与 DAG 语义一致：中间结果不导出 STEP、不建拓扑选择器）。

### 4.2 语义对照（box-boolean 示例）

```
let part0 = cad.box({ size: 20 })
let part1 = cad.sphere({ radius: 8, center: [5, 0, 0] })
let part2 = cad.subtract(part0, part1)
```

| 判定 | terminals | demo 状态栏 |
|---|---|---|
| 旧 DAG（parser） | [part2] | 1 shape(s) |
| 现全局变量 | [part0, part1, part2] | 3 shape(s) |
| 新 DAG（faijs 封装，本方案） | [part2] | 1 shape(s) |

链式重赋值示例（`part0 = translate(part0)`）：新算法下只有最后一次写的 part0 是终端——与旧 SSA 语义"最终版本是终端"一致。

copy 示例（补充澄清 3，方案 B——copy 不消费源、源显示、输出新名）：

```
part0 = cad.box({ size: 20 })
part1 = cad.copy(part0)          // copy 不消费 part0 → part0 仍是终端
part2 = cad.drill(part1, { ... }) // part1 被 drill 独占消费 → part1 非终端；part2 终端
```

| 判定 | terminals | 画布显示 |
|---|---|---|
| 现全局变量 | [part0, part1, part2] | box、副本、钻孔副本 3 个 |
| 新 DAG（faijs 封装，本方案） | [part0, part2] | 源 box + 钻孔后的副本 2 个（part1 是中间副本，被消费不显示） |

无下游消费的纯 copy：`part0=box; part1=copy(part0)` → terminals=[part0, part1]，画布显示 box 和副本**两份**（用户原话）。

### 4.3 成员修改生命周期（独立问题，未实现，层未定）

compound 规则只解决「成员不被叶子过滤裁剪、缓存保全」，但成员**被修改后会发生什么**是另一回事，且 assemble 与 group 语义不同。本节记录现状与待决项，不属于 §4.1 终端判定范围。

**assemble（装配）语义**：成员是 assembly 的真实入参（Shape 引用，挂进 `compound.children`）。若某成员被修改——即其产生语句发生变更、生成新版本——装配应引用修改后的对象并**重新计算**（约束求解重跑，moving 成员变换传播到下游）。当前 `compound.ts` 的 `solveAssembly`（L187-235）已具备「对 moving 成员做变换 + `exec.dependentsOf` 向下游传播 + `exec.touch` 变更声明」的骨架，但这是**装配约束求解时的变换传播**，并非「成员源语句变更 → 装配增量重算」的驱动链路；后者（成员改写触发装配重算）目前**无实现、无层决策**。用户示例 `x1=box; x2=assemble(x1); x1=drill(x1)` 中，assemble 绑定的是被钻孔后的 x1（即 x1 的最终值），即 compound 持有对成员变量的引用、取最终值——这正是「成员被修改则装配引用修改后对象」的语义基础，与 §4.1 终端判定的 compound 排除规则一致（assemble 不消费 x1，x1 仍活跃）。

**group（组合）语义**：成员**不准单独被修改**——group 是原子组，要改一起改（修改 group 即整体修改其全部成员）。当前 `compound.ts` 的 `group`（L243-250）仅 `makeCompound(members)` + 空 `behavior`（`constraints: []`、`solve: () => {}`），**无任何原子性约束、无成员单独编辑的禁止逻辑**；该语义同样**未实现、层未定**。

**当前实现状态小结（2026-08-27 核查）**：

| 能力 | 当前状态 | 所在层 |
|---|---|---|
| 装配约束求解时的变换传播（solveAssembly） | 已实现骨架 | faijs `src/stdlib/compound.ts:187-235` |
| 成员源语句变更 → 装配自动增量重算 | **未实现** | 待定（faijs 引擎 / 3d_editor 宿主 / 二者协作） |
| group 原子性（成员不可单独改，改一起改） | **未实现** | 待定（faijs 引擎 / 3d_editor 宿主） |
| 成员修改生命周期与终端判定的解耦 | **未实现** | 待定 |

本节三处「未实现 / 层未定」与第三轮澄清一致——它们与 §4.1 的终端判定是正交的两件事，不得因 compound 规则「不消费子 shape」而误认为已解决。本方案只收口终端判定（§4.1）；成员修改生命周期列为后续独立任务，需另起方案确定层与算法。

---

## 5. 波及文件清单（两项目，已调查确认）

### 5.1 faijs（引擎侧：实现 + 测试 + demo）

| 文件 | 改动 |
|---|---|
| `src/cad-runtime/runtime.ts` | `collectResult` L573-589：终端判定改为 DAG 叶子算法（4.1）；新增私有方法 `computeLeafTerminals(script, outputs)`（或独立工具模块）；`extractBrepSolids`/topology 逻辑不变（仍按 terminals）；`nonConsumingProducers` 判定 = op ∈ {group, assembly, copy} |
| `src/cad-runtime/terminal-dag.ts`（新增，可选） | 把叶子判定抽为纯函数（输入 statements+outputs → TerminalShape[]），便于单测；消费方排除 `NON_CONSUMING_OPS` |
| `src/stdlib/copy.ts`（**新增 op**） | `copy(input, params, exec)`：mesh 路径深拷贝（`positions`/`indices` 复制到新数组 + `solid()`）；BREP 路径 `kernel.copy(inputSolid)`（occt-wasm `index.d.ts:219`）→ `solidToShape` → `setSolid`/`setFaceEvolution`（复制面演化，与 transform 模板一致）。`brepImpl = true`；无参数 |
| `src/stdlib/index.ts` / `src/cad-runtime/internal-stdlib-adapter.ts` | 导出并注册 `copy` 到 cad 命名空间（1 输入类调用形态 `cad.copy(input, args, exec)`） |
| `src/stdlib/schemas.ts` | 新增 `copy` 条目（无字段或空 fields）；改 schema 后必须重跑 `npx tsx scripts/gen-api-dts.ts`（api.d.ts 为生成文件） |
| `src/lang/parser.ts` | **新增两条静态校验**（§4.1 前置，parseScript 收尾处、`stmt.refs` 填充之后）：规则 A——每个 shape 变量在最后一次赋值之后被**独占语句**（op ∉ {group, assembly, copy}）消费的次数 ≤ 1（≥2 抛 `ParseError`）；规则 B——每个 group/assembly 成员在最后一次赋值之后不得被独占语句消费（抛 `ParseError`）。parser 仍保持零终端知识（只校验消费者计数，不重算完整终端集）；`computeTerminalShapes` 薄封装决策见 5.2 |
| `src/lang/allocate-id.ts` | **新增 copy 分类**：copy 归"新名"类（`part2 = copy(part1)` 分配新 partN，不保名）；`isCreatorOp` 列表或新增 `isCloneOp` 分支 |
| `src/lang/codegen.ts` | copy 语句生成：`let partN = cad.copy(input)`（新名，与其它单入单出 op 的保名分支区分——按 outputs[0] 是否为新名如实输出，无需特判） |
| `demo/main.ts` | `extractShapes` 不变（已按 terminals 消费）；若需展示中间结果可加 UI 开关（非本需求） |
| `demo/e2e/demo.spec.ts` | **3 处断言改回 `1 shape(s)`**：L58 默认 box-boolean（`brep: 3 shape(s)…\| mesh: 3 shape(s)` 均改 1）；L111 打开 custom-part.faijs（box+cylinder+subtract，`brep: 3 shape(s)` 改 1）；L164 `Run 按钮` 测试（box+sphere+subtract，`brep: 3 shape(s)` 改 1）——新 DAG 下三者都只剩 subtract 终端；L200 Ctrl+Enter 单 box 本就断言 `1 shape(s)`（无下游消费仍为单终端），保持不变；`EXAMPLE_SNIPPETS` 前缀不变 |
| `test/faijs/multi-mesh/multi-mesh.test.ts` | `terminals.length > 1` 断言仍成立（已确认）：multi-return.faijs 三个独立原语互不消费 → 3 终端；split-dag.faijs（box→split→两路 union）→ 终端 [part4, part6] = 2 个，均 >1 |
| `src/cad-runtime/runtime.test.ts` | 新增/调整终端断言：链式重赋值、boolean 叶子、split 双输出、compound 成员保留 |
| `src/lang/parser.test.ts` | **新增静态校验断言**：规则 A——`part0=box; part1=drill(part0); part2=extrude(part0)`（part0 被独占消费两次）→ `ParseError`；规则 B——`part0=box; part1=drill(part0); part2=group(part0,part1)`（成员被独占消费）→ `ParseError`；合法——单入单出保名（`part0=drill(part0)`）+ 后续唯一消费、`part0=drill(part0)` + group 引用、copy 一源多副本（`part1=copy(part0); part2=copy(part0)`）、无输入新名、split/boolean 新名 |

### 5.2 3d_editor（宿主侧：删除重复实现 + 白名单收敛）

| 文件 | 改动 |
|---|---|
| `src/engine/script-engine/executeScript.ts` | `createPartsFromResult`：删除本地 DAG 过滤（producerIdx/hasDownstreamConsumer，L461-477）、空终端回退（L440-446）、**以及 `groupAssemblyMemberIds` 并集（L429-448，整体删除）**——直接信任 `result.terminals`。理由：faijs 的"非独占语句（group/assembly/copy）不消费右侧引用"规则保证成员/源不被降级，且 **parser 静态校验（§4.1 前置）在解析期报错杜绝"成员/源被独占消费"**，合法脚本成员必为终端、必在 terminals 中，并集恒为幂等冗余。"层级展开"在 `buildSceneTreeFromDag`（model-store.ts）消费 `compounds`（UI 层），与 executeScript 建零件无关、不受影响。 |
| `src/engine/script-engine/ScriptEngine.ts` | `commitSceneResult`：删除本地 producerIdx/hasDownstreamConsumer 过滤（L1325-1345），直接遍历 `terminalToScopedId` 提交；`compounds` 经 `setSceneCompounds` 存 store 保留（UI 展开子 shape 用） |
| `src/engine/script-engine/executeScript.test.ts` | L33-102 断言的是 **parser 级** `parsed.terminalShapes ?? []` 长度为 0（Phase 3 起 parser 不再计算 terminalShapes；新设计 parser 仍不计算，断言**保持不变**，只更新过时注释——"成员被引用非终端 / group 唯一终端"是旧 DAG 语义描述，新语义下成员与 group 都是终端）。如需运行时终端集合断言，另加执行级用例（group 场景：成员终端 + group 终端） |
| `src/engine/script-engine/script-engine.test.ts` | I-4 测试（L1302-1307）更新为"faijs runtime 恢复 DAG 叶子 terminals"断言（parser 级 `terminalShapes` 仍为 undefined 的断言不变） |
| `src/engine/__tests__/contract-entry.test.ts` | 白名单 L68 删除 `computeTerminalShapes`（faijs 未恢复导出则删；若 faijs 恢复薄封装则保留并锁符号） |
| `src/stores/core/model-store.ts` | `buildSceneTreeFromDag`/`buildCombinedTree` 不改（已从 terminalToScopedId + sceneCompounds 消费，终端集合变化自动跟随） |
| `src/stores/core/script-store.ts` | 不改（terminalToScopedId 键仍是 PartName） |

**决策点（需评审确认）**：faijs 是否恢复 `computeTerminalShapes` 公共导出？
- 选项 A：不恢复（推荐）——宿主已全部走 CadRuntime，无直接调用者；白名单删除该符号。
- 选项 B：恢复为薄封装（`computeLeafTerminals` 别名）——便于 faijs 自身单测与外部工具复用；白名单保留。

---

## 6. 实施步骤

### 6.1 faijs 先行（发版后再改宿主）

1. `src/stdlib/copy.ts`（新增 op）：实现 copy 双链路——mesh 深拷贝（positions/indices 新数组 + `solid()`）、BREP `kernel.copy(inputSolid)` + `solidToShape` + `setSolid`/`setFaceEvolution`；注册到 `internal-stdlib-adapter.ts` + `stdlib/index.ts`；`schemas.ts` 加 copy 条目并重跑 `gen-api-dts.ts`；`allocate-id.ts` 新增 copy 归"新名"类；补 stdlib 级测试（mesh 深拷贝独立性、BREP 实体复制）。
2. `src/lang/parser.ts`：新增**两条静态校验**（§4.1 前置规则 A/B，`NON_CONSUMING_OPS = {group, assembly, copy}`）——parseScript 收尾处（`stmt.refs` 填充后）：规则 A 遍历每个 shape 变量，最后赋值后被**独占语句**消费次数 >1 即抛 `ParseError`；规则 B 遍历 group/assembly 成员，最后赋值后仍被独占语句消费即抛 `ParseError`；同步补 `parser.test.ts` 断言（合法：单入单出保名链 + 唯一消费、单入单出保名 + group、copy 一源多副本；非法：变量被独占消费两次、成员被独占消费）。
3. `src/cad-runtime/terminal-dag.ts`（新增）：纯函数 `computeLeafTerminals(script, outputs): TerminalShape[]`——遍历每个 shape 变量名（含 compound 变量），"最后写者 P + 其后无独占语句消费该变量"即终端；`NON_CONSUMING_OPS`（group/assembly/copy）从消费方排除。
4. `runtime.ts` `collectResult`：终端分支改调 `computeLeafTerminals`；`nonConsumingProducers` 按 op ∈ {group, assembly, copy} 判定；注释更新（删除"Phase 3 不再计算 DAG 活跃度"表述）。
5. faijs 单测：`terminal-dag.test.ts` + `runtime.test.ts` 新增断言（链式重赋值 / boolean 叶子 / split / compound 成员 / copy 源与副本终端）。
6. demo e2e 断言更新（L58 box-boolean、L111 custom-part、L164 `Run 按钮`：3 → 1 shape(s)）。
7. faijs 全量 vitest + typecheck + parity 绿；`npm run pack`。

### 6.2 3d_editor 同步（faijs 发版后）

8. `executeScript.ts` 删除两处本地过滤、空终端兜底与 `groupAssemblyMemberIds` 并集；`ScriptEngine.ts` 删除本地过滤。
9. 两个测试文件注释更新 + 如需运行时断言另加执行级用例；`contract-entry.test.ts` 白名单收敛（决策点 A/B）——若 copy 加入公共导出面，白名单需同步新增 `copy` 符号。
10. 3d_editor 分层测试绿（lint → tsc → vitest → 组件测试 → 相关 e2e）。

---

## 7. 测试策略

1. **终端语义单测（faijs 核心）**：
   - `box + sphere + subtract` → 仅 subtract 终端；
   - `part0 = box; part0 = translate(part0)` → 仅 1 个终端（part0 最终值）；
   - split 解构：`front` 被下游 union 消费、`back` 未被消费 → 仅 back 终端；
   - group/assembly：本身按"是否被独占语句消费"判定为终端（若不被下游消费即终端）；其成员因 group/assembly 不消费子 shape（消费方排除 `NON_CONSUMING_OPS`）而**不**被降级为非终端，仍保留可寻址几何——这是缓存保全的机制，无歧义（无需任何额外不变量）。成员是否作为独立 part 显示在场景树由宿主从 `compounds` 展开层级决定，不对成员做二次活跃性判定；`compounds` 结构不变；成员的**修改生命周期**（assemble 重算 / group 原子）不属本测试范围，见 §4.3；
   - **copy（新增 op）**：`part0=box; part1=copy(part0)` → terminals=[part0, part1]（源与副本都显示）；`part0=box; part1=copy(part0); part2=copy(part0)` → 一源多副本合法、三份都是终端；`part0=box; part1=copy(part0); part2=drill(part1)` → part1 被独占消费非终端，terminals=[part0, part2]；mesh 深拷贝独立性（改副本 positions 不影响源）；BREP 实体复制（`kernel.copy` 产物为独立 handle，STEP 导出两份）；
   - **parser 静态校验（新增，规则 A/B）**：规则 A——`part0=box; part1=drill(part0); part2=extrude(part0)`（part0 被独占消费两次）→ 抛 `ParseError`；`part0=box; part0=drill(part0); part0=extrude(part0)`（保名链，唯一消费）→ 合法；`part0=box; part1=copy(part0); part2=copy(part0)`（copy 不计数）→ 合法。规则 B——`part0=box; part1=drill(part0); part2=group(part0,part1)`（成员被独占消费）→ 抛 `ParseError`；`part0=box; part0=drill(part0); part2=group(part0,...)`（单入单出保名 + group 引用）→ 合法；无输入新名 / split、boolean 新名 / copy 新名 → 合法；
   - 显式 `return [...]` 优先于 DAG；
   - 增量（append/update）后终端集合与全量执行一致。
2. **回归对拍**：demo box-boolean 从 3 shape(s) 回到 1 shape(s)；multi-mesh/parity fixture 的 terminals 断言验证。
3. **宿主回归**：3d_editor 建零件数/场景树层级与"旧本地过滤"行为逐场景对拍（box-boolean / drill 链 / split / group / assembly）。
4. **stderr 零容忍**、测试纪律不变（先自己测试 → 受影响测试 → CI）。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 恢复 DAG 后中间几何不再显示，与"所有活跃 Shape 变量显示在 canvas"（v9 需求原话）冲突 | 本需求即用户要求恢复 DAG 语义；如后续需"显示中间结果"可加显式 return 或 ExecutionOptions 开关，不改默认 |
| 宿主删除本地过滤后，若 faijs 与宿主版本不匹配（旧 tarball）→ 行为回退到全局变量语义 | faijs 先发版、宿主更新 tgz 后删代码（两项目 CI 门禁）；契约测试锁 terminals 语义 |
| compound 成员并入终端后，`extractBrepSolids` 对成员提取 solid（现状已有成员 solid 追加逻辑，L674-686） | 保持不变，验证 assembly 成员 STEP 导出回归 |
| `TerminalShape.id` 用 `asStmtId(partName)` 的类型收口（StmtId 名义、PartName 实质） | 维持现状，不扩大改动面；文档注明 |
| 非独占语句不消费右侧引用（consumer 排除 `NON_CONSUMING_OPS` = group/assembly/copy）→ 成员/源不被降级为非终端，几何保留可寻址与缓存，宿主按 terminals 建 part/缓存，成员/源缓存不再因"非终端"被漏建 | 这是规则的主要收益（用户原话："这样子 shape 的缓存也不会被无意破坏"）；回归 assembly 成员与 copy 源/副本 STEP 精确导出（brepSolids 已含成员 solid，runtime.ts:673-686）。注意：此收益仅覆盖**缓存保全**，不覆盖成员的修改生命周期（见 §4.3） |

---

## 9. 非目标（本次不做）

- 不恢复 parser 端静态 `computeTerminalShapes` 计算（除非决策点选 B 的薄封装）。**§4.1 前置的静态校验（规则 A/B）不是终端计算**——它只做"最后写者 + 下游无消费"的消费者计数合法性检查（规则 A：非成员 ≤1；规则 B：成员 =0），parser 仍保持零终端知识。
- 不改命名规则（partN 不变）、不改 `ExecutionResult` 结构（仅 terminals 内容变化）。**命名规则（单入单出保名 / 无输入新名 / 数量不同新名 / copy 新名）是 UI 生成代码的静态约定，引擎不强制**；AI 代码无法遵守时由 parser 静态校验报错兜底（变量最多被独占消费一次 / 成员必为终端），而不是改写代码或运行时回退。
- **copy 是深拷贝语义（方案 B），不是引用/别名（方案 D 不做）**：copy 输出独立几何与独立 BREP 实体（`kernel.copy` 深拷贝），副本后续可被独立编辑；不做共享引用/延迟实例化。copy 不消费源、源显示（补充澄清 3 已定）。
- 不做"中间几何可选显示"的 UI 开关（demo 后续可加）。
- 不处理约束求解器、.faits、第三方库（与本次无关）。
- 不实现成员修改生命周期（assemble 成员变更 → 装配增量重算 / group 原子不可单独改）：属 §4.3 独立未实现项，本方案仅收口终端判定，层与算法另起方案。
