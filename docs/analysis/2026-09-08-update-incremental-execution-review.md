# direct 路径 update 增量执行：技术评审

- 日期：2026-09-08
- 类型：技术评审（不提出需求，只判定可行性与替代设计）
- 评审对象：2026-09-08 提出的「执行期依赖观测回填」式 update 增量执行设计——其核心是：语句按行号配对、维护 `StatementRecord` 与「ctx 键 → 读取者行号」反向索引 `readersIndex`、用指纹比较标记 dirty、再用队列沿读取者做闭包传播、按行号升序重放失效语句。

## 1. 结论

机制可行，但**设计过重**：`readersIndex`、闭包传播队列、行号配对、Phase B 的 ctx Proxy 观测这四件事里有三件可以删掉而不损失任何收益，剩下的一件（行号配对）必须换成别的主键，否则在插入/删除语句时增量会整轮退化为全量。

建议的判定模型是**顺序单遍、值驱动、读键自举**（见 §5），它比被评审的设计更简单、更精确，且不需要中间表示、不违反 IR 剥离红线。

## 2. 代码事实基线

评审不采信设计文档里的行号与机制描述，以下全部来自当前源码复核（工作区含未提交改动）。

| 事实 | 位置 | 对设计的影响 |
|---|---|---|
| `update` 当前等于全量重跑：`update(_old, new) → execute(new) → reset()` | `direct-executor.ts:304-306`、`runtime.ts:593-596` | 增量确实缺失，需求成立 |
| 语句 id = `'s' + lineNo`，行号 = `node.loc.start.line - lineOffset` | `direct-executor.ts:512`、`lang/statement-summary.ts:26` | 行号随插入/删除整体位移 |
| 顶层语句的 `writes` 来自声明名（精确） | `direct-executor.ts:828/834/854` | 写键可用作主键 |
| 块单元的 `refs` 恒为 `[]`，`writes` 由正则扫 `__ctx.x =` 得到（且 v1 不区分嵌套作用域） | `direct-executor.ts:653-669` | **块单元的读依赖静态不可得** |
| `transformFunction` 把函数体原样切片入 `__ctx.<name> = async function ... { const cad = __ns.cad; <body> }`，只注入 `__ns` | `direct-executor.ts:770-787` | 函数体的自由标识符**不**被 hoist 到 `__ctx`；函数体依赖 = 形参 ∪ 所调用的其它本机函数 |
| `collectRefs` 只收集**直接实参**里的 Identifier | `direct-executor.ts:1037-1069` | 静态读集是窄集合，不是完整读集 |
| `hoistText` 把声明名与当前 ctx 键按词边界替换为 `__ctx.<name>` | `direct-executor.ts:1000-1008` | 顶层语句的读必经 ctx，Proxy 观测在顶层可行 |
| 全量执行时 `changed` = 全部写键（`reset()` 清空 ctx → 旧值 undefined → `old !== new` 全命中） | `direct-executor.ts:261-270`、`349-351` | 增量与之**不可能逐字段相等** |
| `runCode` 对已执行行号直接 `continue` | `direct-executor.ts:334` | 重放必须绕过 `executedLines` |
| `ExecutionResult` 含 `changed?: PartName[]`，不含 `executedLines` | `runtime.ts:157` | 宿主可见的是 `changed` |
| `collectDirectResult` 每次对所有 shape 重算 `computeContentKey`（FNV-1a 全顶点）并写 `statementCache`；`topologyCache` 命中即返回 | `runtime.ts:722-732`、`763-765` | 每轮成本大头可能不在语句执行；重放后若不失效 `topologyCache` 会返回过期拓扑 |
| `loadDirectModuleImports` 每轮 `new ModuleRegistry`，而模块缓存是实例级的 | `runtime.ts:662`、`module-registry.ts:129/178` | 多文件场景 seed 每轮都是新对象 → 依赖它的语句全部 miss |
| `solidCache` 跨 execute 存活并持有所有权，只有 `dispose()` 才 `kernel.release` | `runtime.ts:296-300`、`1192-1205` | 无按 part 释放入口；重放会累积句柄 |

## 3. 设计级缺陷

### 3.1 行号配对在插入/删除时整轮失效

配对键是 `s${行号}`。删除一条语句后，new 中后续所有语句的行号整体位移，`records.get(newLine.lineNo)` 全部落空 → 全部判为「新增 → dirty」→ **退化成全量**。插入同理（在中间插入时，插入点之后全部失效）。

按行号配对也**识别不出「删除」本身**：它只能看到「old 的第 N 行在 new 里没有对应记录」和「new 的若干行没有记录」，无法区分「第 5 行被删」与「第 5 行被改写成别的语句」。而设计在 §4.5 声称支持删除场景（写键传播失效、最后写者判定），这个承诺在行号配对下无法兑现。

建议：配对主键换成 **写键有序列表 + 语句文本指纹**（见 §5），或用 LCS 做单元级对齐。

### 3.2 dirty 预计算与闭包传播队列冗余且自相矛盾

设计先按**旧 ctx 值**把「依赖脏」的语句全部加入 `dirty`，之后又在重放后用「写键指纹变化才传播」来修正。两者矛盾：若语句 A（行 5）与读取 A 的语句 B（行 9）都已进入 `dirty`，那么即使 A 重放后输出值未变，B 也会被重放。

根因是多算了一层：direct 路径是严格顺序执行，**传播是免费的**——按行号升序单遍扫描，扫到 B 时 A 必定已重放完毕，直接用新值判定 B 即可。有了单遍判定，`readersIndex` 与传播队列都不需要存在。

### 3.3 「与全量逐字段等价」的验收标准不成立

全量 `execute` 的 `changed` 是**全部写键**（表内第 8 行），增量只报真正变化的键。二者不可能逐字段相等，除非重定义 `changed` 契约。`beforeStatement` 同理：全量触发 N 次、增量只触发重放的 K 次，若宿主用它打 undo 快照，undo 栈会缺 N−K 项——这不是「撤销语义零变化」。

这两项是**宿主可见的契约变化**，必须显式写进契约并同步宿主，不能标称「`ExecutionResult` 契约零变化」。

### 3.4 块单元在 Phase A 收益为零

块单元的 `refs` 恒为 `[]`，静态收集拿不到任何读依赖 ⇒ 块要么**总是重放**，要么必须上 Phase B 的 Proxy。而 `for` 循环批量生成零件恰恰是最贵、最需要增量的场景。设计文档没有点明这一不对称性。

### 3.5 跳过执行的副作用登记没有来源

`keepByLine`（terminals 判定输入）、`blockOutputs`、`kinematicsOut`、`changedSet`、`setName(v, name)` 全部是执行期登记的产物。语句被跳过时这些登记不会重新产生，而 terminals 判定、块产出锚点、装配位姿都依赖它们。设计只讨论了「keepFingerprint 参与比较」，但真正的问题是**跳过的语句必须从上次记录复用这些登记**。

## 4. 被低估的风险

| 风险 | 说明 |
|---|---|
| 句柄泄漏放大 | 每重放一条语句就产生新的 Shape 与 `BrepHandle`，旧句柄无人释放；而 `solidCache` 只在 `dispose()` 才 release。项目当前的 arena-bounded 断言（shapeCount 增长）本就处于红的状态，增量会把每次编辑变成一次泄漏放大。这比「增量收益」更致命 |
| 派生缓存不失效 | `topologyCache` 命中即返回，重放后几何变了而拓扑缓存仍是旧的 → 静默返回过期拓扑。`faceEvolutionCache` / `roleTableCache` / `statementCache` 同理。增量必须定义「重放语句 ⇒ 失效该 part 的全部派生缓存」 |
| 多文件场景收益归零 | `ModuleRegistry` 每轮新建、缓存实例级 ⇒ seed 每轮都是新对象 ⇒ 依赖 import 值的语句全部 miss |
| 成本大头可能不在语句数 | 每轮 `collectDirectResult` 对所有 shape 做全顶点哈希 + 拓扑构建。若瓶颈在此，「少跑几条语句」的收益有限，应先 profile 再定方向 |

## 5. 更合适的判定模型：顺序单遍、值驱动、读键自举

**核心洞察：direct 路径严格顺序执行，所以「谁读了我」不需要知道。** 语句 i 的输入就是执行到它那一刻的 ctx 快照；上游重放导致输入变化，下游在**被扫描到的那一刻**自然 miss；上游重放但输出值不变，下游自然 hit。依赖图、反向索引、传播队列都是顺序执行已经免费提供的东西。

模型要点：

1. **记录主键 = 写键有序列表 + 语句文本指纹**，不用行号。插入/删除/改名/改参数都表现为「查不到记录」或「指纹不匹配」→ 重放；无任何对齐算法。
2. **读键自举**：`StatementRecord.readKeys` 与读到的值版本由上次执行记录，本次判定直接用记录里的读键去比对当前 ctx 值版本。不需要重新观测，不需要 `readersIndex`，也不需要 old/new 配对。
3. **值版本而非内容哈希**：每个 ctx 变量带一个 epoch（写入/预置时递增），判定是 O(1)，`computeContentKey` 只作兜底。**硬约束**：`applyPendingAssemblyTransforms` 用 `Object.assign(member, ...)` 原地改 mesh 顶点（`direct-executor.ts:476`），这类原地修改必须 bump 版本或改为不可变替换，否则值驱动判定失效。
4. **跳过时复用上次副作用登记**：`keepByLine` / `blockOutputs` / `kinematicsOut` 从记录恢复，而不是留空。
5. **params 无需特例**：params 预置即 bump 版本，沿顺序扫描自然传播，不必「params 变化就退化为全量」。

相比被评审的设计，它更精确（值等价：上游改了参数但下游几何未变 ⇒ 下游跳过），且不需要 Proxy——Phase A 的静态读集只作为「无记录时」的保守回退，Phase B 的 Proxy 从「必选项」降级为「可选优化」。

## 6. 推荐落地路径

| 阶段 | 内容 | 特点 |
|---|---|---|
| P0 | **前缀重放**：定位首个变更行 L，保留 L 之前的 ctx，从 L 重放到末尾 | 无依赖观测、无 Proxy、无配对算法；正确性几乎免费；用约 10% 成本拿到 80–90% 收益 |
| P1 | 在 P0 之上叠加 §5 的**值驱动单遍跳过** | 把「尾部全量重放」变成「尾部按需重放」，同时删掉 P0 的保守闸门 |

P0 的已知限制（P1 消除）：删除语句（行数减少）、含相对 import 的多文件场景、上轮产生了装配运动学位姿、params 变化——这四类保守退化为全量。

## 7. 对专利构思的影响

被评审的设计若直接写成专利，独立权利要求会被 `readersIndex`、传播队列、Proxy 观测这些具体结构限定死。建议独立权利要求写上位形态：**在执行期记录语句对持久变量容器的读集与所读值的版本，按语句顺序单遍判定并重放，无需静态依赖图与中间表示**。这样 P0 与 P1 两种实现都落在同一权利要求内，具体数据结构放从权。

## 8. 相关代码位置

| 设施 | 位置 |
|---|---|
| `DirectExecutor.update` / `execute` / `runCode` / `reset` | `packages/core/src/cad-runtime/direct-executor.ts:278-425` |
| 单元变换（顶层 / 块 / 函数） | `direct-executor.ts:610-787` |
| 读集静态收集 `collectRefs` | `direct-executor.ts:1037-1069` |
| `runtime.updateDirectText` / `executeDirectText` / `collectDirectResult` | `packages/core/src/cad-runtime/runtime.ts:525-596`、`705+` |
| 派生缓存与释放 | `runtime.ts:284-322`、`1192-1205` |
| 几何内容指纹 | `packages/core/src/cad-runtime/content-key.ts:27` |
| 模块装载与缓存 | `packages/core/src/cad-runtime/module-registry.ts:129` |
