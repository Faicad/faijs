# BREP 链修正 + 增量执行方案（Persistent SolidCache）

- 日期：2026-08-18
- 类型：架构修正 + 功能设计
- 状态：待评审 → 待实现

---

## 0. 用户原始要求（原样保留）

> 每次 replay 新建 brepChain？这是什么大傻逼的做法？brep状态只和当前节点有关，不关心之前的，不需要知道之前的。而且是静态就能判断出来的。跟增量执行一点关系都没有。全面梳理brepchain的写法，彻底理解我说的，写一份方案。既改正brepchain的错误，又可以增量执行最后一句。要做的只是保留所有活跃的shape，供最后新增的这一句执行而已。

补充要求（原话）：
> 而且api的语义要对。区分更新参数的update，和append增加语句。应该是分开的api

> （命名依据：`docs/plans/2026-08-16-faijs-evolution-roadmap.md` §3.6 已定 `replay` → `execute` / `update` 命名决策；用户在此之上补充 `append` 作为第三个语义入口。）

用户论点分解（本方案的设计锚点）：

1. **BREP 状态只和当前节点有关**——执行一条语句只需要它的直接输入 solid，不需要知道输入是怎么算出来的。
2. **是静态就能判断出来的**——BREP/mesh 路径由静态规则判定（op 白名单 + 输入是否持有 solid），与"是否从头执行"无关。
3. **与增量执行一点关系都没有**——"全量重放"不是 BREP 的固有代价，是 brepChain 生命周期写错的后果。
4. **要做的只是保留所有活跃的 shape**——solid 缓存跨执行存活，新增语句直接取输入执行。

---

## 1. 现状全量梳理（brepChain 的写法）

### 1.1 数据结构

`BrepChainState`（`src/brep/brep-chain.ts:99-123`）：

```ts
export interface BrepChainState {
  solidCache: Map<string, ShapeHandle>   // statementId → OCCT 实体句柄
  kernel: OcctKernel | null              // OCCT 内核（mesh 模式为 null）
  partTransform?: { position, scale }    // 世界→局部坐标偏移（交互用）
  faceEvolutionCache?: Map<string, Map<number, number[]>>  // 面演化映射
}
```

- **kernel 是环境级单例**（`src/occt-kernel/occtKernel.ts:23-24`）：`kernelInstance`/`initPromise` 模块级变量，`initOcctWasm()` 幂等返回同一实例，多个 CadRuntime 共享。**内核不是问题**。
- `solidCache` 才是每次被重建的对象。

### 1.2 op 的 BREP 实现模式：键值存取，不是"链"

所有 BREP 路径的执行器对 solidCache 的用法是**纯 Map 存取**，按语句 id：

| op | 取输入 | 写输出 |
|---|---|---|
| primitives | 无输入（创建） | `solidCache.set(stmt.id, solid)`（`primitives.ts:45`） |
| drill | `solidCache.get(stmt.inputs[0])`（`drill.ts:102`） | `set`（`drill.ts:130/196/201`） |
| extrude | `get(inputs[0])`（`extrude.ts:57`） | `set`（`extrude.ts:69`） |
| transform | `get(inputs[0])`（`transform.ts:47`） | `set`（`transform.ts:58`） |
| split | `get(inputs[0])`（`split.ts:165`） | `set`（`split.ts:246/249/250`，多输出） |
| boolean | `get(inputRef)`（`boolean.ts:65`，多输入） | `set`（`boolean.ts:110`） |
| engrave | `get(inputs[0])`（`engrave.ts:182`） | `set`（`engrave.ts:261`） |
| load / text / screw / svgExtrude | 无输入（创建） | `set`（`load.ts:55`、`text.ts:67`、`screw.ts:105`、`svgExtrude.ts:58`） |

**结论：op 层根本不"遍历链"。** 执行一条语句 = `get(输入id)` + 几何计算 + `set(输出id)`。这与用户"状态只和当前节点有关"的论点完全一致——**op 层代码已经支持增量执行，不需要改动**。

### 1.3 静态判定（已正确，无需改动）

`canUseBrep`（`src/ops/types.ts:65-71`）：

```ts
export function canUseBrep(ctx: OpContext): boolean {
  if (ctx.mode === 'mesh') return false
  const bc = ctx.brepChain
  if (!bc?.kernel) return false
  return ctx.stmt.inputs.every((id) => bc.solidCache.has(id))
}
```

- 纯静态：mode + op 白名单（`MESH_ONLY_OPS`）+ 输入是否持有 solid。
- mesh-only op（sdf/knurl）不写 solidCache → 下游自动判 mesh（断链）。**这条规则是持久缓存下也正确的**——断链后新增语句的输入无 solid → 走 mesh，不依赖任何"重放历史"。

### 1.4 生命周期：错误所在（每次重放 = 空缓存 + 结束清空）

| 位置 | 代码 | 问题 |
|---|---|---|
| `CadRuntime.replay` | `runtime.ts:190-193`：每次 `await initBrepChainState()` | **每次执行新建空 solidCache** → 执行到第 N 条时前 N-1 条的 solid 不存在 → 必须从头执行 |
| `resolveShapeRef` 子重放 | `runtime.ts:377-379`：同样 `initBrepChainState()` | 跨 part 引用也从头子重放 |
| 3d_editor `replayPart` | `ScriptEngine.ts:1467-1473`：`releaseBrepChainState(brepChain, terminalIdsToKeep)` | **只保留终端 solid，中间语句 solid 全释放** → 下次执行又为空 |
| 3d_editor `editStatement` | `ScriptEngine.ts:1538-1542`：plan 出 stale 后注释"始终整链重放" | 明明有 stale 集合，却调用全量 `replayPart` |
| 3d_editor 多处 | `ScriptEngine.ts:861/927/1204/1286/1541`：`_brepSolidCache.delete(scopedId)` | 重放前删除终端 solid 缓存 |
| `test-helpers.ts` | `replayScript`（`:33`）：每次 `initBrepChainState()`，不释放 | 测试路径泄漏（低危） |

**"全量重放"的唯一真实原因**：solidCache 生命周期错误（每次新建 + 结束清空），导致下次执行时前缀 solid 不存在，只能从头。**这不是几何约束，不是物理约束，是生命周期写错。**

### 1.5 已存在的增量基础设施（正确且未被接上）

- `statementCache`（`runtime.ts:154-158`）：stmtId → `{ statementKey, outputContentKey, output }`，**实例级持久**，replay 只写不读（除 `resolveShapeRef`）。
- `statementKey`（`runtime.ts:112-123`）= `op | JSON.stringify(args) | 输入 contentKey 链`——上游几何变了下游 key 自动变。
- `plan()`（`runtime.ts:444-474`）：按拓扑序算出 `{ stale, reused }`——需要重算的语句集合。**只被 `editStatement` 用来做"有无变化"短路，从未被用来执行 stale。**

---

## 2. 问题诊断（一句话）

> **solidCache 本应是"实例级持久缓存"（与 statementCache 同级），却被写成了"每次执行新建、结束清空"的局部变量——这是全量重放的唯一原因，与 BREP 几何本身无关。**

改正它，增量执行（只执行新增/变更语句）自然成立，因为 op 层的键值存取模式 + 静态判定本来就支持。

---

## 3. 核心设计：Persistent SolidCache

### 3.1 solidCache 生命周期提升

`solidCache` 从"replay 局部状态"升级为 **CadRuntime 实例级持久成员**（与 statementCache 同级）：

```
CadRuntime（实例级，跨 execute 存活）
├── statementCache   // 已有：stmtId → { statementKey, outputContentKey, output }
├── solidCache       // 新：stmtId → ShapeHandle（从 BrepChainState 提升）
├── faceEvolutionCache // 随 solidCache 一并持久（执行副产品）
└── kernel           // 环境级单例引用（initOcctWasm() 幂等，直接取）
```

- `BrepChainState` 接口保留（op 层依赖 `brepChain.solidCache` 存取，零改动），只是实例从"每次新建"变为"runtime 成员，跨 replay 复用"。
- `partTransform` 仍作为执行期上下文随 `replay` 选项注入（它只影响输入坐标转换，不影响已执行 solid 的有效性——solid 始终在局部坐标系）。

### 3.2 释放时机（唯一的生命周期管理）

**不再有"execute 结束后释放中间"的概念。** 释放只发生在三处：

| 时机 | 动作 |
|---|---|
| 语句被重算（同 id 新 solid 产出） | 执行成功后，释放旧 solid 句柄，写入新 solid |
| 语句被删除（diff DELETE / 语句移除） | 释放该 id 的 solid |
| `runtime.dispose()` | 全量释放 |

内存增长 = 语句数 × 单实体大小，与"重放时的峰值"同量级；释放由"重算顶替"机制自然回收。

### 3.3 execute 增量入口（底层统一机制）

`execute(script, opts)` 增加 `opts.startIndex?: number`——**从指定位置开始顺序执行，之前的语句不进入执行循环**（不是"遍历 + 跳过"）：

```ts
async execute(script: PartScript, opts?: ReplayOptions): Promise<ExecutionResult> {
  const start = opts?.startIndex ?? 0
  for (let i = start; i < script.statements.length; i++) {
    const stmt = script.statements[i]
    // 输入从 outputCache / 持久 solidCache 取（由前序语句已填充）
    await this.dispatchStatement(stmt)
    // 执行成功：statementCache.set + 释放旧 solid（顶替）+ solidCache.set（op 层已做）
  }
}
```

- **`startIndex` 缺省 = 0 = 全量执行**（首次执行、缓存被清空时），行为与现状一致。
- 从 `startIndex` 开始的语句**逐个真执行**；`startIndex` 之前的语句完全不进循环——执行成本 = O(剩余语句)，不是 O(全部)。
- 输入缺失（`startIndex` 之后某语句引用缓存中没有的 solid）→ `canUseBrep` 静态判定报错/走 mesh——**不静默回退全量**（与"静态判定，禁止运行时回退"红线同构）。
- 失败路径：op 执行抛错前已自行清理临时实体（drill 等已如此）；结果未写入缓存 → 缓存保持执行前状态，**天然回滚**。

### 3.4 API 语义分离：execute / update / append

**增量场景有两种，语义不同，必须是分开的 API**（用户要求，roadmap §3.6 命名对齐）：

| API | 场景 | 语义 | 起点 |
|---|---|---|---|
| `execute(script)` | 首跑 / 缓存清空 / 全量重算 | 全量顺序执行 | index 0 |
| `update(script)` | **更新参数**（UI 改 size / 改 args） | 从变更点重算受影响后缀 | 内部调 `plan()` 得变更语句位置 |
| `append(script, newIds)` | **追加语句**（UI 新动作：建方体、钻孔） | **只执行新增语句**——不遍历脚本前缀，不关心前缀状态 | 新增语句本身 |

```ts
class CadRuntime {
  // 全量执行（现状 replay 语义，改名对齐 roadmap §3.6）
  async execute(script: PartScript, opts?: ReplayOptions): Promise<ExecutionResult>

  // 更新参数：plan() 算变更语句 → 从变更点开始顺序执行后缀
  async update(script: PartScript): Promise<ExecutionResult> {
    const changeIndex = this.plan(script)   // 第一个受影响语句的 index（无变化 → -1）
    if (changeIndex < 0) return this.execute(script, { startIndex: 0 })  // 无变化 → 直接返回缓存结果
    return this.execute(script, { startIndex: changeIndex })
  }

  // 追加语句：只执行新增语句——直接从持久缓存取输入 dispatch，前缀不进执行循环
  async append(script: PartScript, newIds: string[]): Promise<ExecutionResult> {
    const byId = new Map(script.statements.map((s) => [s.id, s]))
    for (const id of newIds) {
      const stmt = byId.get(id)
      if (!stmt) throw new Error(`[CadRuntime] append: unknown statement "${id}"`)
      await this.dispatchStatement(stmt)    // 取输入（持久缓存）→ 执行 → 写输出
    }                                       // 输入无 solid → canUseBrep 静态选路走 mesh
    return this.collectTerminal(script)     // 终端提取只取需要的语句
  }
}
```

- **append 的核心语义**（用户原话："新增一条语句的时候，我根本不关心你之前的什么状态，只执行最后一条"）：**不检查、不遍历、不验证前缀——只做三件事：取输入、执行、写输出。**
  - **取输入命中持久缓存是 API 契约前提**，不是 runtime 要检查的东西：新增语句的输入必然是此前已执行成功的活跃语句的输出，持久缓存保证其存在，由调用方操作顺序天然保证；前缀以什么方式产生、是否完整，append 一概不知、也无需知道。
  - **`canUseBrep` 不是"报错"，是路径选择**：输入无 solid（断链/mesh-only 上游）→ 静态判定该语句走 mesh，这是正常路径；只有 `mode==='brep'` 强制模式才报 `E_BREP_UNSUPPORTED`——且这是对**本条语句**的判定，不是对前缀的检查。
  - 若输入真缺失（缓存状态已失效：dispose/删除后未同步），是调用方应先 `execute` 全量的信号，不是 append 的职责——append 不做任何前缀完整性验证。
- update 走 `startIndex`（从变更点连续重算）——受影响的语句在顺序列表中是从变更点开始的连续段（语句顺序 = 拓扑序，依赖者总在依赖者之后，输出被引用即受影响，不存在"跳过不受影响的中间语句"）；若未来出现不连续场景（跨 part 引用），由 `resolveShapeRef` 子重放兜底（§3.5）。
- **plan() 成为 update 的内部实现**（不再是被调用方手工接线）。
- 三个入口共享执行器 `dispatchStatement` 与持久缓存；`execute(script, { startIndex })` 是 update 的底层，append 直接用 dispatchStatement——**append 不走全脚本循环**。

3d_editor 侧对应关系（Semantic 入口映射）：

| 3d_editor 场景 | 现有调用 | 改为 |
|---|---|---|
| UI 建方体 / 钻孔 / 拉伸（recordPrimitive / recordDrill / commitAndRecord / commitSplit…） | appendStatement → replayPart | appendStatement → `runtime.append(script, [新语句id])` |
| 改参数（editStatement / editParam / transform 面板） | updateStatement → plan → replayPart | updateStatement → `runtime.update(script)` |
| 首次加载 / 全量刷新 | executeScript | `runtime.execute(script)` |

### 3.5 resolveShapeRef 简化（附带收益）

跨 part 引用解析（`runtime.ts:331-413`）不再需要"从 sceneScript 开头子重放"：
- 优先查持久 statementCache / solidCache（已被本 part 或其它 part 执行过）→ 直接命中。
- 缓存缺失才子重放（且子重放复用同一持久 solidCache，不再新建 brepChain）。

---

## 4. 逐文件改动契约

### 4.1 faijs 侧

| 文件 | 改动 |
|---|---|
| `src/brep/brep-chain.ts` | (1) `releaseBrepChainState` 语义收窄为"全量释放 + 清空"（`keepIds` 参数删除或仅 dispose 场景使用）。(2) `initBrepChainState` 保留（初始化 kernel + 空缓存，供 runtime 首次创建 / 测试）。(3) 新增 `disposeSolidCache` 或直接复用 release。 |
| `src/cad-runtime/runtime.ts` | (1) `CadRuntime` 新增实例成员 `private solidCache = new Map<string, ShapeHandle>()`（+ faceEvolutionCache）。(2) **`replay()` 改名 `execute()`**（roadmap §3.6 命名决策，别名兼容或直接替换调用点），新增 `opts.startIndex`（缺省 0 = 全量）。(3) 新增 `update(script)`（内部 plan → 变更语句 index → execute({ startIndex })）与 `append(script, newIds)`（**不走全脚本循环**，直接对每条新语句 dispatchStatement）两个语义入口。(4) `execute()` 不再 `initBrepChainState()`；执行循环使用实例持久缓存。(5) 执行成功后顶替释放旧 solid。(6) `resolveShapeRef` 优先查持久缓存，子重放复用持久链。(7) `brepSolids` 终端提取改为从持久 solidCache 查（不依赖本次执行）。 |
| `src/ops/**` | **零改动**（键值存取模式天然支持）。仅按 §6 审计"输入 solid 不得释放"。 |
| `src/test-helpers.ts` | `replayScript` 保持"一次脚本一次链"（测试便利性），但新增可选参数 `brepChain?`（外部传入持久链，供增量场景测试）；不传时仍内部创建（不释放，进程回收）。 |
| `src/cad-runtime/runtime.test.ts` | 新增增量测试（§7）。 |

### 4.2 3d_editor 侧

| 文件 | 改动 |
|---|---|
| `ScriptEngine.ts` | (1) `replayPart`（:1467-1473）：**删除 `releaseBrepChainState(brepChain, terminalIdsToKeep)`**——不再释放中间 solid；终端 solid 缓存（`runtime.brepSolidCache`，scopedId → solid）逻辑保留，数据源改为从持久 solidCache 映射。(2) **append 场景（commitAndRecord / recordPrimitive / recordDrill / commitSplit 等）改调 `runtime.append(script, [新语句id])`**——只执行新增语句，不走全脚本循环。(3) **update 场景（editStatement :1530-1542）改调 `runtime.update(script)`**——plan 算变更点，从变更点增量重算，不再全量 `replayPart`。(4) 各 `_brepSolidCache.delete(scopedId)`（:861/927/1204/1286/1541）：改为"释放被删除/重算语句对应的旧 solid"，不再"重放前无差别清空"。 |
| `executeScript.ts` | `executeScriptDiff` 是独立 mesh 路径（不传 brepChain），保持现状；`executeScript`（Alt+E 之外的脚本执行）跟随 replayPart 变化。 |
| `script-engine.test.ts` | 适配：原断言"replay 后中间 solid 释放"的测试翻转；新增 append/update 分离断言。 |

### 4.3 无需改动

- `dispatcher.ts` / 全部 `ops/*.ts` 执行器（键值存取模式不变）。
- `canUseBrep` / `MESH_ONLY_OPS` / 断链静态判定（持久缓存下语义不变）。
- `cli.ts` / `node-host`（走 `runtime.execute`，自动获得增量）。
- `plan()` 本体（已正确，只是把它的输出接入执行）。

---

## 5. 关键不变式（写进契约）

1. **solidCache 持久**：execute 之间不重建、不清空；清空只发生在 `dispose()`。
2. **增量 = 从起点顺序执行，不是"遍历 + 跳过"**：`startIndex` 之前的语句不进执行循环；append 只 dispatch 新语句（用户原话："只执行最后一条"）。
3. **执行失败不改缓存**：失败的语句不写缓存、不释放旧值；已成功语句的 solid 全部保留。
4. **重算顶替释放**：同 id 重算成功后才释放旧 solid。
5. **op 不得释放输入 solid**：BREP 执行器只允许 release 自己创建的临时实体（§6 审计）。

---

## 6. 审计项：输入 solid 不得被释放

增量执行依赖"输入 solid 在缓存中存活"。已确认 drill 只释放工具实体（`brep-ops.ts:299-307`，输入 `solid` 保留）。**其余 op 需逐个审计**：

| op | 文件 | 审计要点 |
|---|---|---|
| transform | `brep-ops.ts`（transform） | 变换生成新 solid，输入是否被 release？ |
| boolean | `src/ops/boolean.ts` BREP 路径 | 布尔后输入实体是否保留？ |
| split | `brep-ops.ts:566-574` 附近 | `kernel.release(frontTranslated)` 等释放的是派生实体，**输入 solid 必须保留** |
| extrude / engrave / text / screw / svgExtrude / load | 各自 BREP 实现 | 同上：只释放临时实体 |

审计结论写入契约（§5.5）：**输入 solid 不得释放**；违规者改为不释放（由"顶替释放"机制兜底）。

---

## 7. 测试计划

### 7.1 faijs（`runtime.test.ts` 新增）

1. **append 增量（append API）**：box → drill → extrude 执行后，再 append 新语句 → `runtime.append(script, [新语句id])` → 断言旧语句的 beforeStatement 钩子未被调用（**只执行新语句，前缀语句完全不进循环**）、输出正确、solidCache 含全部语句 solid。
2. **参数变更增量（update API）**：改 box args → `runtime.update(script)` → 断言只重算了变更点及下游，变更点之前的语句不进循环。
3. **API 语义分离**：`append` 传入已存在缓存中的 id → 重执行该语句（幂等，输出替换）；`update` 无变化 → 直接返回缓存结果；两个 API 互不混用（append 不重算旧语句，update 不跳过变更后缀）。
4. **顶替释放**：重算后旧 solid 句柄被 release（kernel spy）。
5. **输入缺失报错**：`startIndex` 之后某语句引用缓存中不存在的 solid → 静态判定走 mesh（断链正常路径）；`mode==='brep'` 强制模式 → E_BREP_UNSUPPORTED 报错；不静默回退全量。
6. **失败回滚**：执行失败语句 → 缓存保持执行前状态。
7. **断链增量**：knurl（mesh-only）后 append 新语句 → 新语句走 mesh（静态判定），旧 BREP 前缀 solid 仍在。

### 7.2 3d_editor（`script-engine.test.ts`）

1. `editStatement` 走 `update`：plan stale 数量断言 + 只执行 stale 语句。
2. `recordPrimitive` / `commitAndRecord` 走 `append`：只执行新增语句断言。
3. 原"replay 后中间 solid 释放"相关断言翻转/适配。
4. 多 part 场景：跨 part 引用命中持久缓存，不再子重放。

---

## 8. 边界情况

| 场景 | 行为 |
|---|---|
| 首跑 / `dispose` 后重跑 | `execute` startIndex 缺省 → 全量执行（现状行为） |
| mesh-only 断链（knurl/sdf） | 不写 solidCache；下游静态判定走 mesh；断链前的 BREP 前缀 solid 保留 |
| split 多输出 | outputs 各自入 solidCache（`split.ts:249-250` 已有）；下游按 id 引用 |
| partTransform 变化（拖拽零件） | 不改语句 → 不改 solid；只影响输入坐标转换 |
| 多 CadRuntime 实例 | 各自持有独立 solidCache；kernel 共享（环境单例，幂等） |
| 语句删除（diff DELETE） | 释放被删语句的 solid；其下游同步失效（现有 diff 机制） |
| `brep` 强制模式 | 输入无 solid → E_BREP_UNSUPPORTED 报错（`runtime.ts:235-264` 不变） |

---

## 9. 开放决策

1. **`releaseBrepChainState` 的 keepIds 参数**：删除（语义收窄为全量释放）还是保留（供外部选择性释放）？建议删除——释放只发生在重算顶替/dispose，不需要选择性保留。
2. **`replayPart` 的终端 solid 缓存（scopedId → solid）**：保留现有 `runtime.brepSolidCache` 映射，还是直接改为按终端语句 id 查持久 solidCache？建议保留映射（3d_editor 按 scopedId 消费，改动最小）。
3. **faceEvolutionCache 是否随 solidCache 一并持久**：建议是（同为执行副产品、按 id 累积），但不阻塞本方案。
4. **内存上限（LRU）**：本期不做（用户明确"保留所有活跃的 shape"），作为未来增强写入路线图。
5. **`replay` 改名 `execute` 的兼容**：`CadRuntime.replay` 是否保留别名（3d_editor 及测试多处调用）？建议实施时直接替换全部调用点（roadmap §3.6 已列改名清单），不留别名。
6. **`append` 的入参形态**：传新增语句 id 列表（`append(script, newIds)`）还是由 runtime 自行 diff（`append(script)` 内部 plan）？建议显式传 id——调用方（3d_editor）本来就知道自己 append 了哪些语句，语义最清晰；diff 逻辑归 `update`。

---

## 10. 一句话总结

> **solidCache 是实例级持久缓存，不是 execute 局部变量。** op 层已是按 id 键值存取、路径判定已是静态规则——增量执行所需的全部机制都已存在，唯一错误是生命周期：每次 execute 新建、结束清空。改正为"跨 execute 持久 + 重算顶替释放 + dispose 全释放"，并把 API 按语义拆成三个入口：**`execute`（全量）/ `update`（更新参数，plan 算变更点，从变更点顺序重算）/ `append`（追加语句，只执行新增语句，不走全脚本循环——输入直接命中持久缓存）**。用户要求的"保留所有活跃的 shape，供最后新增的这一句执行"就是本方案的全部内容。