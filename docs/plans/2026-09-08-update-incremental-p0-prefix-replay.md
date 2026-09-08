# P0：前缀重放式 update 增量执行落地计划

- 日期：2026-09-08
- 状态：方案（未实施）
- 前置评审：`docs/analysis/2026-09-08-update-incremental-execution-review.md`
- 本版修订：补齐「可交付给第三方执行」所需的判定依据（行号基准、清理规则、缓存清单、闸门编号、验收落点）

## 1. 用户需求（原话）

> "在删除IR之前，update增量是有的。删除IR之后，这个暂时取消了。你可以考虑是否有合理的方案来实现这个update？可以把它写为专利。请先写这个的方案。"

> "把这份评审文档写入docs/analysis/， 然后写一份P0 写一个可实施的落地计划"

本计划是增量执行的**第一阶段（P0）**：用最小机制恢复 update 的增量能力，为第二阶段（值驱动单遍跳过）与专利构思提供已验证的实现基座。

## 2. 目标与非目标

### 2.1 目标

1. `update(oldCode, newCode)` 在 **P0 适用闸门内**只重放「首个变更语句 → 末尾」这段区间，其余语句的产出取自持久 ctx，几何结果与全量重跑一致。
2. 不引入中间表示、不重建静态依赖图、不做执行期依赖观测；`ExecutionResult` 的字段结构不变。
3. 宿主调用点零改动（`CadRuntime.update` 签名与语义不变）。
4. 任何不在适用闸门内的编辑自动退化为全量重跑，结果与现状逐字段一致。

### 2.2 非目标（留给 P1）

- 删除语句的增量（需要单元级 diff 对齐）。
- 值驱动单遍跳过（评审 §5 的模型）：P0 的重放区间内是**全量重放**，不做逐条跳过判定。
- 多文件（相对 import）与装配运动学位姿场景的增量。
- params / partTransform 变化触发的增量。
- 块内语句级增量。

## 3. 现状

`CadRuntime.update` → `updateDirectText`（`runtime.ts:593`）→ `executeDirectText` → `DirectExecutor.execute`（`direct-executor.ts:278`）→ `reset()` 清空 ctx 与全部登记 → 整段重跑。

`runCode` 已具备「从某行开始」的能力（`direct-executor.ts:333`：跳过 `lineNo < startLine` 的单元）与「跳过已执行行」的能力（`:334`）。P0 就是把这两条现有能力组装成 update 路径，并补齐四件缺失的事：变更定位、单元行区间、重放前清理、派生缓存失效。

以下既有字段与本计划相关，实现时按此处说明处理：

| 字段 | 位置 | P0 的处理 |
|---|---|---|
| `accumulatedCode` | `runtime.ts:292` | 增量比较的 **old 基准**（`execute`/`append`/`update` 各自维护） |
| `accumulatedIds` | `runtime.ts:294` | 死字段（全仓库仅此一处声明，无任何读写）→ 本计划不改动它，也不要为它新增逻辑 |
| `fullCode` | `direct-executor.ts:169` | `replayFrom` 必须赋值为本次 `newCode`，否则后续 `append` 拼接错 |
| `fnParams` | `direct-executor.ts:257` | 本机函数形参表；**不可清**（前缀函数定义不重放，形参表必须保留） |
| `changedSet` | `direct-executor.ts:253` | 重放前清空；`oldWrites` 在 `:349` 捕获的是**执行前** ctx 值，决定了 `changed` 的实际语义（见 §5） |

## 4. P0 设计：前缀重放

### 4.1 变更定位：公共前缀扫描

**输入与切分。** old 取内部 `accumulatedCode`（不信任宿主传入的 `oldCode`，见 G3），new 为 `newCode`。两侧均按 `code.split(/\r?\n/)` 切分为行数组，下标从 0 开始，**物理行号 = 下标 + 1**。

**比较规则。** 逐行比较 `a.trim() === b.trim()`；两侧 trim 后均为空串时视为相等（空行/纯空白行等价）。令 `i` 为**最小的下标**使 `old[i]` 与 `new[i]` 不相等（某一侧越界也算不相等）。

**分支。**

| 情形 | 处理 |
|---|---|
| 不存在这样的 `i`（两文本等价） | 零变更路径（§4.6） |
| `new.length < old.length` | G2，退化为全量 |
| `i >= old.length`（纯追加） | 物理行 = `i + 1`，指向 new 的新增行，继续走映射 |
| 其余 | 物理行 = `i + 1`，继续走映射 |

**映射。** 物理行交给 §4.2 映射到「单元起始行」，得到 `startLine`；若映射结果为空（改动只落在末尾注释/空行，其后无任何单元），按零变更路径处理（§4.6）但仍需重新 `collectDirectResult`。

不引入 LCS：公共前缀扫描对「改参数 / 改 keep / 末尾追加 / 改函数体」这四类真实编辑都精确命中；定位偏早的后果只是多跑几条语句，不影响正确性。

### 4.2 单元行区间：`unitRanges(code)`

`TransformedUnit` 增加 `endLine`，在 `transformTopNode` 内**统一填充**（switch 之后包装返回值，不改各 `transformXxx` 的签名）：

```ts
const endLine = (node.loc?.end?.line ?? lineNo) - lineOffset
return unit === null ? null : { ...unit, endLine }
```

`DirectExecutor` 新增**公开**方法：

```ts
export interface UnitRange { lineNo: number; endLine: number }
unitRanges(code: string): { ranges: UnitRange[]; lineOffset: number }
```

它复用 `parseAndTransform` 的解析路径（含 `assertSecure`），返回每个单元的闭合区间与 `parseBody` 得到的 `lineOffset`。映射在 **runtime 侧**完成（DirectExecutor 不承担行号语义）：

```
p = physicalLine - lineOffset
startLine = 满足 (r.lineNo <= p <= r.endLine) 的 r.lineNo
          ?? 满足 (r.lineNo > p) 的最小 r.lineNo
          ?? undefined
```

映射结果落在块单元内部时返回块起始行 → 块整体重放（正确，块内无法部分重放）。

`lineOffset !== 0` 的分支是「非 module 旧文本被包裹解析」的兼容路径（`direct-executor.ts:557-574`），行号基准不同 → 由 G0 退化为全量。

### 4.3 重放：`DirectExecutor.replayFrom(code, startLine, opts)`

```ts
async replayFrom(code: string, startLine: number, opts?: DirectExecOpts): Promise<DirectExecOutcome>
```

步骤：

1. `const units = this.parseAndTransform(code)`（安全扫描对全文执行一次；同时得到 `lineOffset`，由调用方在之前用 `unitRanges` 校验过 G0）。
2. 计算 `replayUnits = units.filter(u => u.lineNo >= startLine)`。
3. **计算待清键**（这一步的公式不可简化，见下方说明）：
   ```
   suffixWrites = ⋃ writes(u) for u in replayUnits
   prefixWrites = ⋃ writes(u) for u in units where u.lineNo < startLine
   replayKeys   = suffixWrites − prefixWrites
   ```
   减去 `prefixWrites` 是**正确性要求**：重赋值链（前缀 `partA = cad.box(...)`、重放区间 `partA = cad.cut(partA, ...)`）中 `partA` 同时出现在两个集合里，若把 `suffixWrites` 整体删掉，重放时该语句会读到 `undefined`，与全量重跑不等价。
4. 清理（只动重放区间相关状态，前缀状态一律不动）：
   - `executedLines` 删除 `>= startLine` 的行（否则 `runCode:334` 会把重放单元全部跳过）；
   - `keepByLine` 删除键 `>= startLine` 的登记（残留会让 terminals 判定读到过期 keep）；
   - `blockOutputs` 删除**值** `>= startLine` 的条目；
   - `clearRoundState()`：`changedSet.clear()` + `kinematicsOut.clear()`（进入增量路径时 `kinematicsOut` 必为空，清空是幂等的）；
   - ctx 删除 `replayKeys` 中的键；
   - `this.fullCode = code`。
5. `runCode(code, { ...opts, startLine }, units)`——`runCode` 增加可选第三参 `units`，传入已解析结果，**避免同一次 update 内重复解析与重复安全扫描**（否则会解析三次：runtime 的 `extractMetadata`、本方法、`runCode`）。

**返回与异常。** 返回 `DirectExecOutcome`（`failedAt` 照常填在 outcome 里，不在本方法处理）。`ExecutionLimitError`（`runCode:336`）、`ParseError`、安全扫描异常一律**原样上抛**，不触发 §4.7 的降级；只有 `outcome.failedAt` 才触发降级。

**不动的状态。** `fnParams` 保留（前缀函数定义不重放）；`executedLines` 中 `< startLine` 的部分保留。

### 4.4 派生缓存失效：`releasePartCaches(partNames)`

在 `runtime.ts` 新增私有方法，重放**之前**对 `replayKeys`（经 `asPartName()` 转换）逐一清理：

| 缓存 | 处理 | 说明 |
|---|---|---|
| `solidCache` | 先 `kernel.release(handle)`，再删键 | 参照 `dispose():1194` 的 try/catch 形态；已释放句柄重复 release 不得抛出 |
| `brepChain.meshShapeCache` | 删键 | `ensureBrepChain` 只在 `brepChain` 为 null 时重建（`:476`），因此该 Map **跨轮保留**，不清会返回旧 solid 的三角化结果 |
| `faceEvolutionCache` / `roleTableCache` / `topologyCache` / `statementCache` | 删键 | `topologyCache` 命中即返回（`collectDirectResult:764`），不清会返回过期拓扑 |

`brepChain.solidCache`、`faceEvolutionCache`、`roleTableCache` 与 runtime 的同名字段是**同一个 Map 引用**（`ensureBrepChain:486-490`），删键即生效，不需要重建 BREP 链。`statementCache` 与 `topologyCache` 会在 `collectDirectResult` 中按新几何重新填充。

### 4.5 保守闸门（G0–G8）

任一闸门命中 → 走现状全量路径 `executeDirectText(newCode, opts)`，行为与今天逐字段一致。

| # | 条件 | 判定依据 |
|---|---|---|
| G0 | 非标准解析基线 | `unitRanges(newCode).lineOffset !== 0` |
| G1 | 本实例从未执行过 | `accumulatedCode === null` |
| G2 | 存在删除 | `newLines.length < oldLines.length` |
| G3 | 宿主传入的 oldCode 与内部基准不一致 | `oldCode.trim() !== accumulatedCode.trim()` |
| G4 | 含相对 import 的多文件场景 | `meta.imports` 存在 relative specifier（`ModuleRegistry` 每轮新建、seed 是全新对象，增量无收益） |
| G5 | 上一轮产生了装配运动学位姿 | `lastHadKinematics === true` |
| G6 | params 变化 | `stableFingerprint(opts?.params ?? null)` ≠ `lastParamsFingerprint` |
| G7 | 注册库集合变化 | `stableFingerprint(sortedEntries(libIds))` ≠ `lastLibIdsFingerprint` |
| G8 | partTransform 变化 | `stableFingerprint(opts?.partTransform ?? null)` ≠ `lastPartTransformFingerprint` |

指纹与记录的约定：

- `stableFingerprint`（P0-3）对 `undefined` / `null` 一视同仁地归一化为 `null`，避免「未传 params」与「传空对象」被判为不同。
- `libIds` 是 `Map`，指纹前按 key 升序取出 `[[k, v], ...]` 再计算，避免迭代序影响。
- `lastParamsFingerprint` / `lastLibIdsFingerprint` / `lastPartTransformFingerprint` / `lastHadKinematics` 在**每次成功执行结束时**（`collectDirectResult` 返回前）记录，不是在执行开始时记录。
- G8 不可省略：`partTransform` 在 op 执行期被读取（`runtime.ts:446-447`），前缀语句不重放会保留旧变换下的几何。

### 4.6 零变更路径

不执行任何语句（`executedLines` 为空、`changed` 为空），但仍需：

1. `extractMetadata(newCode, ...)`（与 `executeDirectText:530` 同样的参数）；
2. `await this.ensureBrepChain()`，并按 `opts.partTransform` 同步 `brepChain.partTransform`；
3. `directExecutor.clearRoundState()`（清空 `changedSet` 与 `kinematicsOut`）——**不可省略**，否则会把上一轮的 `changed` 原样带回本轮结果；
4. `collectDirectResult(newMeta, opts)`。

outputs / terminals 与上一轮一致（ctx 未动）。

### 4.7 失败降级（事务性）

`replayFrom` 返回的 outcome 含 `failedAt` → runtime 侧 `directExecutor.reset()` + 全量 `executeDirectText(newCode, opts)`，返回全量结果。失败语义与现状完全一致，代价是失败时付双倍执行成本；P0 接受该降级并在此记录，P1 再引入双写回滚。

`ExecutionLimitError`、`ParseError`、安全扫描异常不在此列（§4.3），必须原样上抛给宿主。

## 5. 契约变化（宿主可见，必须同步）

| 项 | 全量（现状） | P0 增量 | 影响 |
|---|---|---|---|
| `ExecutionResult.changed` | 全部写键 | **重放区间的写键** | 宿主按变更刷新场景时刷新更少；需按新契约消费 |
| `beforeStatement` | 每条语句触发一次 | 仅重放语句触发 | undo 快照栈条目数减少，宿主不得假设「每次 update 都产生 N 条快照」 |
| `failedAt` | `index` = meta.lines 下标 | 不变 | 无影响 |
| `DirectExecOutcome.executedLines` | 全部行号 | 重放行号 | 不进入 `ExecutionResult`，仅引擎内部与测试可见 |

**`changed` 语义的口径已按实现方式选定（决策点 A）。** 因为 §4.3 会先清除 `replayKeys` 的旧值，`runCode:349` 捕获到的 `oldWrites` 恒为 `undefined`，重放后必然判定为「变化」，所以 P0 实际产出的是**重放区间的写键集合**，而不是「值真正发生变化的键」。若需要后者（决策点 B），必须在清除旧值前保存快照并在重放后比对——成本更高，留作 P1 增强。本计划按 A 实施。

`docs/api-contract.md`（含 `.zh.md` 与 `.i18n.yaml`）需记录上述两条语义。

## 6. 任务清单

按顺序实施，后者依赖前者。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| P0-1 | `TransformedUnit` 增加 `endLine`（`transformTopNode` 统一包装）；新增公开 `unitRanges(code)` | `packages/core/src/cad-runtime/direct-executor.ts` | 单测：扁平行 → 单行区间；块 → 起始行到结束行；函数定义 → 闭合区间；容器体 `lineOffset` 正确返回 |
| P0-2 | 新增 `clearRoundState()`；`runCode` 增加可选 `units` 入参；新增 `replayFrom(code, startLine, opts)` | `direct-executor.ts` | 单测：`replayFrom(code, 1)` 的结果与 `execute(code)` 全量一致；重复解析次数不增加（spy `assertSecure` 计次） |
| P0-3 | 新增 `stableFingerprint(value)` | `packages/core/src/cad-runtime/content-key.ts` | 单测：等值同指纹、变值异指纹、键序无关、循环引用不挂死、`null`/`undefined` 归一化、函数与 Symbol 有确定降级规则 |
| P0-4 | 新增私有 `releasePartCaches(partNames)` | `packages/core/src/cad-runtime/runtime.ts` | 单测：调用后 solidCache / meshShapeCache / faceEvolution / roleTable / topology / statementCache 对应键全部消失；已释放句柄重复 release 不抛 |
| P0-5 | 新增 `updateIncremental(oldCode, newCode, opts)`：G0–G8 → 公共前缀扫描 → 单元映射 → `releasePartCaches` → `replayFrom` → `collectDirectResult`；`failedAt` 时降级全量 | `runtime.ts` | 见 §7 |
| P0-6 | `runtime.update` 切到 `updateIncremental`；在每次成功执行结束时记录 `lastParamsFingerprint` / `lastLibIdsFingerprint` / `lastPartTransformFingerprint` / `lastHadKinematics` | `runtime.ts` | 宿主零改动；现有 update 测试全绿 |
| P0-7 | 零变更路径（§4.6，含 `clearRoundState`） | `runtime.ts` | 单测：`executedLines` 空、`changed` 空、outputs 与上轮相同 |
| P0-8 | 契约文档：`changed` 与 `beforeStatement` 的增量语义 | `docs/api-contract.md` + `.zh.md` + `.i18n.yaml` | `npm run doc-sync` 通过 |
| P0-9 | Agent Note：记录「P0 选择前缀重放而非依赖图方案」的决策与放弃项 | `.agents/notes/`（目录与命名见 `.agents/notes/README.md`） | 格式校验通过 |
| P0-10 | 测试落点：新建 `packages/core/src/cad-runtime/update-incremental.test.ts`（单元级 + 等价对拍，直接 `new DirectExecutor(...)` 与 `new CadRuntime(...)`，可访问公开 getter `executedUnitLines`）；集成 fixture 场景放 `packages/tests/faijs/no-ir/` 下新建目录 | 见左 | `npm run test -w @faicad/faijs-core` 与 `-w @faicad/faijs-tests` 全绿 |

重放行数的断言放在 **core 包内单测**（`DirectExecutor.executedUnitLines` 是公开 getter），不为此新增任何对外 API。

## 7. 测试计划

1. **等价对拍（核心）**：对下列**固定**编辑动作（不随机）逐一执行，断言增量 `update` 与 `execute(newCode)` 全量在 `outputs` / `terminals` / `compounds` / `topology` 上逐字段相等，且增量 `changed` ⊆ 全量 `changed`：① 改中间一条语句的尺寸参数；② 改该语句的 keep；③ 末尾追加一条语句；④ 改本机函数体文本；⑤ 改参数行（字面量）；⑥ 只改注释；⑦ 只增删空行；⑧ 改函数体所在行之后的第一条语句。
2. **零变更**：`update(c, c)` → `executedLines` 为空、`changed` 为空、outputs 与上轮相同。
3. **重赋值链（回归 §4.3 公式）**：前缀 `partA = cad.box(...)` + 重放区间 `partA = cad.cut(partA, ...)`，编辑后者 → 结果与全量一致（该用例专门拦截 `replayKeys` 误删前缀产出）。
4. **闸门退化**：删除语句（G2）、`oldCode` 与内部基准不一致（G3）、含相对 import 的 fixture（G4）、装配 fixture（G5）、params 变化（G6）、partTransform 变化（G8）→ 结果与现状全量一致。
5. **keep 隔离**：重放区间的 `keepByLine` 被正确清理，不因残留登记让 terminals 多出零件。
6. **拓扑与 mesh 缓存刷新**：重放后 `topologyCache` 与 `brepChain.meshShapeCache` 中该 part 的条目被删除并按新几何重建（不得命中旧值）。
7. **失败降级**：重放区间内注入失败语句 → 最终结果与全量失败一致（`failedAt` 相同）；注入 `ExecutionLimitError` → 原样上抛，不被降级吞掉。
8. **回归**：`npm run test -w @faicad/faijs-core` 与 `npm run test -w @faicad/faijs-tests` 全绿，stderr 零容忍。
9. **句柄基线**：沿用 `packages/core/src/cad-runtime/arena-bounded.test.ts` 的存活计数方式，记录 update 前后 occt 存活 shape 计数增量，与全量路径基线对比，不得显著恶化。

测试代码风格参照 `packages/core/src/cad-runtime/function-execute.test.ts`（内联代码字符串 + `makeRuntime()`），不新增 fixture 文件。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| `replayKeys` 误删前缀产出（重赋值链） | §4.3 公式减去 `prefixWrites`；测试 3 专项拦截 |
| `partTransform` 变化未纳入判定 → 前缀几何停在旧变换 | G8 闸门 + 测试 4 |
| `lineOffset ≠ 0` 时行号基准错位 | G0 闸门退全量 |
| 派生缓存失效遗漏（几何变了拓扑/mesh 没变） | P0-4 单一收口（含 `meshShapeCache`），测试 6 覆盖 |
| 公共前缀扫描被空行/缩进变化打断，定位偏早 | 逐行 trim 比较、空行等价；偏早只多跑几条，不影响正确性 |
| 句柄泄漏放大 | P0-4 重放前 release 该 part 旧句柄；测试 9 守基线，恶化则追加闸门退化为全量 |
| 失败降级双倍成本 | P0 接受并记录；P1 双写回滚 |
| 同一次 update 内重复解析/重复安全扫描 | `runCode` 增加 `units` 入参（P0-2），测试 2 用 `assertSecure` 计次守住 |
| 重放区间含块单元时整体重放（成本） | P0 接受；P1 用单元级 diff 缩小起点 |

## 9. 与 P1 的边界

P1 在 P0 之上叠加「值驱动单遍跳过」：重放区间内每条语句先用（写键 + 语句文本指纹 + 读键值版本）查记录，命中则跳过执行并复用上次的副作用登记。届时 G2 / G4 / G5 / G6 四类闸门可逐个打开（G4 需先把 `ModuleRegistry` 提升为实例级缓存），`changed` 也可从决策点 A 升级到 B。P0 的接口划分（`unitRanges` / `replayFrom` / `releasePartCaches`）保证 P1 不需要重写任何 P0 已落地的接口。
