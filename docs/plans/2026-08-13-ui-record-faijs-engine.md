# UI 操作 → faijs 语句 → 引擎执行（单一几何实现）改造方案

> 日期：2026-08-13
> 范围：3d_editor（C:\my\Faicad\3d_editor）+ faijs（C:\my\Faicad\faijs）
> 前置方案：docs/plans/2026-08-13-naming-validator-design.md（命名语义校验，与本文阶段 B 联动）

---

## 0. 用户原始需求（对话轨迹，2026-08-13）

需求链路从一条「命名语义检查」问题开始，逐步收敛为本次 UI 引擎统一改造：

1. **命名检测**：运行时能否检查出下列代码的错误——按语法规范，`part` 前缀相同的变量是同一个模型的一系列处理版本；这里 `part0_v1` 明显是另一个模型（独立 sphere），应命名为 `part1_v0`。能否在 parse 时刻检测出类似错误？

   ```js
   // apiVersion: 1
   export default async (cad) => {
     const part0_v0 = cad.box({ size: 20 })
     const part0_v1 = cad.sphere({ radius: 8, center: [5, 0, 0] })  // ← 错误：独立模型占用 part0 版本链
     const part0_v2 = cad.subtract(part0_v0, part0_v1)
     return { shape: part0_v2, name: 'box-boolean' }
   }
   ```

   → 产出 docs/plans/2026-08-13-naming-validator-design.md。

2. **调研澄清**：调研 3d_editor 后发现 UI 路径提交权威几何来自工具自算（manifold CSG），faijs 语句只是账本。**用户纠正：「UI 层的操作是预览。实际执行必须走代码引擎」**。

3. **本方案**：写一份方案，如何实现 UI 层点击时生成 faijs 语句；如何通过 faijs 引擎进行真正的几何计算；整个架构要做哪些调整。

4. **补充约束**：UI 展示的代码（timeline「查看代码」等）必须对应 faijs 里实际执行的代码（本文 R-0）。

总之，只有一份权威的代码。实际几何计算通过执行这份代码完成。

比如代码：
   export default async (cad) => {
     const part0_v0 = cad.box({ size: 20 })
     const part0_v1 = cad.sphere({ radius: 8, center: [5, 0, 0] })  // ← 错误：独立模型占用 part0 版本链
     const part0_v2 = cad.subtract(part0_v0, part0_v1)
     return { shape: part0_v2, name: 'box-boolean' }
   }
应该如此修正：
1. 当用户点击创建立方体，生成const part0_v0 = cad.box({ size: 20 })
2. 当用户点击生成球体，生成const part1_v0 = cad.sphere({ radius: 8, center: [5, 0, 0] })
3. 当用户先后选择这两个模型，执行布尔减，生成const part2_v0 = cad.subtract(part0_v0, part0_v1)
4. 用户对布尔结果进行钻孔， 生成const part2_v1 = cad.drill({...})

最终用户导出的时候，faijs代码就是：
```
     const part0_v0 = cad.box({ size: 20 })
     const part1_v0 = cad.sphere({ radius: 8, center: [5, 0, 0] })
     const part2_v0 = cad.subtract(part0_v0, part0_v1)
     const part2_v1 = cad.drill({...})
```
取消export这套外层的封装。timeline节点查看的代码直接对应faijs对应的代码。每次新增操作，直接执行新增的代码。
如果用户通过timeline回溯修改历史代码，则只修改对应代码行的参数。

faijs本身不处理UI层的状态。比如执行cad.subtract后，原来的两个模型自动隐藏，只显示布尔后的结果, 这由UI层处理。

---

## 1. 背景与问题

**R-1 契约（docs/api-contract.md）**：语句 op 与几何核心函数一一映射，存在唯一分派入口（faijs dispatcher），严禁「UI 一份、重放一份」两份实现。

**现状违反 R-1**：UI 提交路径的权威几何来自工具自算（manifold CSG），faijs 语句只是账本：

```
DrillHolePanel 提交
→ executeDrillHole / DrillCommandExecutor（manifold CSG，DrillCommandExecutor.ts:174）
→ commitGeometry('drill', 工具几何)          // 工具几何 = 权威，直接进 VersionStore
→ recordDrill（faijs 语句，仅记账）
→ void replayPart（异步补 BREP 缓存；mesh 模式引擎几何不落地）
```

已证实的后果：
- 钻孔位置走 raycast 快照（anchor），无 `faceOrdinal` 拓扑引用——权威几何不在引擎手里，GeomRef 退化为锚点
- `CommandPipeline.replayVersion`（undo 兜底重放）只能重放 manifold executor，重放不了语句链
- `recordTransform` 后烘焙被注释（transform-session.ts:166-170），变换几何根本没有引擎执行
- AI 文本路径（executeScript/executeScriptDiff）与 UI 路径各算各的，两套几何可能不一致

**目标**：UI 点击 = 产生意图（预览 + 录制 faijs 语句）；实际几何计算一律由 faijs 引擎执行语句产出；预览与提交、UI 与 AI 共用同一份几何实现。

**R-0 显示即执行（硬约束）**：任何向用户展示的代码（timeline「查看代码」、导出 `.faijs`、Alt+E 基线）必须对应 **faijs 引擎实际执行的那条语句**——同一 id、同一 op、同一 args。展示层只做格式化（`statementToCode`），不做参数改写或语义重排；禁止「显示一份、执行一份」。落地手段：A5 的代码-语句等价断言（§4）。

## 2. 目标架构

```
UI 事件（点击面/拖 gizmo/面板参数）
   │
   ├─ 预览路径：CommandPipeline.preview() → 引擎执行（不进 VersionStore，P-1/P-7 语义保留）
   │
   └─ 提交路径：build*Statement（录 faijs 语句，partN_vM）
             → 引擎执行（CadRuntime.replay / executeStatement，唯一几何实现）
             → 引擎产物 commitGeometry → VersionStore → 场景
             → undo/redo 恢复 VersionStore 快照；兜底重放 replayVersion 走同一引擎
             → 展示（timeline/导出/Alt+E）= statementToCode(同一语句)  ── R-0
```

改造后 `commitAndRecord` 不再接收工具几何：

```
commitAndRecord(type, partId, fileId, params)     // 签名变化：删掉 positions/indices
  → record*（append 语句）
  → await 引擎执行（mesh 模式即时；BREP 缓存异步补）
  → commitGeometry(type, ..., 引擎 positions/indices)
```

## 3. 有利现状（改造工作量低于直觉）

| 事实 | 位置 | 意义 |
|---|---|---|
| primitive 已走引擎 | ScriptEngine.ts:893 `_computePrimitiveShape` 调 faijs `cad.box/sphere/...` | 基本体无需改造 |
| 语句构造器已存在 | `buildDrillStatement`(:121) / `buildSplitStatement`(:169) / recordExtrude/Engrave/Knurl/Boolean/Transform/Load | 参数 → faijs 语句的映射基本齐备 |
| 引擎 dispatcher 已覆盖全部 UI op | faijs `brep/ops/dispatcher.ts:116-194`：box/sphere/cylinder/cone/wedge/translate/rotate/scale/drill/split/extrude/boolean/engrave/text/screw/svgExtrude/knurl/load/sdf | 无缺 op |
| 引擎执行入口完整 | ScriptEngine.ts:1128 `executeStatement` → cadExecuteStatement；ScriptEngine.ts:1159 `replayPart` → CadRuntime.replay（BREP/mesh 双路径、断链、拓扑重建） | 无需新引擎能力 |
| Timeline 编辑已走引擎 | `editStatement`(plan+重放) / `deleteStatement`→recomputePart / executeScriptDiff | 编辑/删除路径已统一 |
| CommandPipeline 有 preview/commit 双模式 + executor 抽象 | CommandPipeline.ts:135/223 + CommandExecutor 接口 | 适配层天然存在 |

## 4. 阶段 A：提交路径执行统一（核心改造）

### A1. 改造提交入口（3d_editor）

- `commitAndRecord`（ScriptEngine.ts:1021）：**删除 positions/indices 参数**。流程改为：
  1. `record*` 追加语句
  2. `await replayPart(partId)` 取引擎终端几何（mesh 模式 `finalShape`；BREP 模式拓扑重建 mesh）
  3. `commitGeometry(type, ..., 引擎几何)` 进 VersionStore
- `replayPart`（:1159）：mesh 模式下出口补一次 `commitGeometry`（现状 BREP 模式已 commit，:1213）；提交统一收敛在 replayPart 出口，避免两次提交
- `commitSplit`（:1078）：改 `recordSplit` → `await` 引擎执行 split 语句 → 取 `outputs` 两个 shape → `commitGeometry` × 2
- `commitBoolean`（:1098）：改 `recordBoolean` → 引擎执行 boolean 语句（inputs[0] = 主体）→ 引擎几何提交
- `DrillHolePanel`/`ExtrudePanel`/`SplitPanel`/`BooleanToolbar` 等调用方：不再传自算几何（面板内 manifold 计算降级为纯预览，或直接删除）

### A2. 恢复变换烘焙（transform 走引擎）

- `transform-session.ts:166-170` 取消注释：退出变换模式时 `recordTransform` 后 **await 引擎执行**（translate/rotate/scale 语句 dispatcher 已支持），几何提交
- `assemble-store.ts:272-277` 装配烘焙同样改走引擎（recordTransform 已存在，补执行即可）
- 语义核对：UI gizmo 的世界坐标变换 ↔ 引擎 transform 语句的 `offset/anglesDeg/angles/factor` 参数（含 pivot），需与现有 `recordTransform` 的 args 构造核对（阶段 A4）

### A3. 预览一致性（决策点 D1）

两种选择：
- **A3-1（推荐）**：`CommandPipeline` 的 executor 也引擎化——`drillCommandExecutor.execute` 改为「构造 CadStatement → executeStatement → 返回 positions/indices」。预览与提交天然一致，`replayVersion` 兜底重放同时获得引擎化
- **A3-2**：预览保持 manifold 工具计算（交互更快），接受预览与提交几何的微小差异（参数语义一致时通常视觉不可辨）

若选 A3-1，executor 需要「输入几何」：优先从 `statementCache` 取上游语句输出；`inputVersion` 快照仅作兜底（决策点 D2）。

### A4. 参数语义映射核对表（必须逐项对齐）

引擎 op 的 args schema（docs/ops-api-inventory.md）与 UI CommandParams 的差异点：

| op | 关键差异 | 风险 |
|---|---|---|
| drill | 引擎 holeType 枚举 vs UI 'simple'/'screw'；tolerance 语义；盲孔中心算法（DrillHoleCore.computeBlindHoleCenter vs 引擎） | 预览/提交孔位置偏差 |
| split | UI 传 planeRotation/planePosition/bbCenter/bboxSize（buildSplitStatement 已映射 normal/offset/side） | 切割面语义必须一致 |
| boolean | UI 的 CSG 是 manifold，引擎 boolean 是另一实现 | 结果网格拓扑不同（形状一致即可） |
| transform | UI 世界坐标增量 vs 引擎局部坐标参数 | 需计算净变换后按引擎参数语义写入 |

对策：为每个 op 写一个「参数映射 + 结果对照」的 parity 测试（同一输入跑工具实现与引擎实现，断言形状级一致，见 §8）。

### A5. 展示代码 = 引擎执行代码（R-0 落地）

现状缺口：timeline「查看代码」显示的是 `statementToCode` 片段（codegen.ts:343，无 const 前缀），且 UI 语句 id 为 `st_*`——显示的变量名与导出文本（partN_vM）不一致；更隐蔽的风险是片段里的 args 与 `dispatchStatement` 实际收到的 args 出现漂移（buildArgsParts 改写/遗漏键）。

约束与做法：

- **A5-1 等价断言（代码 ↔ 语句，双向）**：
  - `语句 → 代码`：`statementToCode(stmt)` 输出的片段，包上 `const part0_v0 = <片段>` + `return { shape: part0_v0 }` 后必须能被 `parseScript` 无错解析
  - `代码 → 语句`：解析出的语句与原始 `stmt` 在 `op / args（键集合与值）/ inputs` 上**完全相等**（id 与变量名允许不同——那是命名层，由 B 阶段统一）；GeomRef 的 `of/feature/anchor/faceOrdinal` 逐字段相等
  - 该断言覆盖全部 UI op，作为 `buildArgsParts`/`statementToCode` 的回归测试，任何显示层改写都会在这里暴露
- **A5-2 显示与执行同源**：timeline「查看代码」/`ViewCodeDialog`/`FaijsCodeEditorDialog` 基线一律从**引擎持有的同一份 CadStatement** 生成（不缓存展示用副本、不走第二条序列化路径）；`statementToCode` 是唯一格式化入口
- **A5-3 片段完整性**：`statementToCode` 允许输出单条片段（不含 const/await），但必须满足 A5-1 的可解析性；若某 op 的片段无法包裹成合法语句（如参数缺失），该 op 禁止展示，直接报错而不是显示残缺代码
- **A5-4 变量名一致**：阶段 B 完成后（UI 直接分配 partN_vM），timeline 显示代码的变量名 = 导出 `.faijs` 的变量名 = 引擎语句 id，三者恒等；`st_*` 兼容期内的不一致视为临时态，由 A5-1 断言兜底（断言只比较语义，不比较 id）

## 5. 阶段 B：id 与命名统一（与 naming-validator 联动）

现状：UI 录制 id = `st_<partId>_<n>`（createStatementId，types.ts:181），`partN_vM` 只在 codegen 导出时分配——同一份脚本在 UI 态与文本态有**两套 id**，这是「两套 statement」的根。

- **B1**：faijs 新增共享分配器 `allocateStatementId({op, inputs, prevStatements}) → partN_vM`，规则与 naming-validator 一致：
  - 无输入（primitive/load/sdf）→ 新模型 `partN_v0`
  - split 输出 → 两个新模型 `_v0`
  - 有输入 → 跟随 `inputs[0]` 的模型号，版本 = 该模型已见最大版本 + 1（布尔同样跟随第一输入）
- **B2**：`record*` 系列改用分配器；`script-store` 不再用 `createStatementId`
- **B3**：`sceneToCode`（codegen.ts:554）保留对旧 `st_*` 场景的兼容重命名；新场景 id 已是 partN_vM 则直接使用
- **B4**：`check()` 的 naming 闸（naming-validator 方案第 ④ 闸）覆盖 UI 路径：每次 `appendStatement` 后可本地校验（UI 层自己生成的语句若违规，立即提示——UI 是引擎保证，违规即 bug，可作为 dev warning）
- **B5**：`partId ↔ 终端语句 id` 绑定不变（`groupScopedId`/`terminalToScopedId` 机制沿用）

## 6. 阶段 C：增量执行与拓扑增强（可选，后续迭代）

- **C1**：提交路径改为增量：`plan()` 命中缓存的语句不重算，只执行 stale 后缀（editStatement 已有此逻辑，commitAndRecord 复用）
- **C2**：UI 点击面时补 `faceOrdinal`（raycast hit.face.index → BREP 面序号映射），GeomRef 走拓扑引用而非 anchor 兜底——引擎拥有权威几何后此能力才成立
- **C3**：mesh 模式即时提交 + 异步 BREP 重放补 `brepSolidCache`（现状 `void replayPart` 的异步语义保留，但几何来源换成引擎）

## 7. 风险与决策点

| # | 决策点 | 选项 | 建议 |
|---|---|---|---|
| D1 | 预览实现 | A3-1 引擎化 executor / A3-2 保留 manifold | A3-1（预览与提交一致，R-1 彻底） |
| D2 | undo replayVersion 输入 | 引擎执行以 statementCache 为准 / VersionStore 快照兜底 | 快照兜底（快照存在时作为语句输入几何覆盖），防 redo 后缓存漂移 |
| D3 | 提交时序 | await 引擎（阻塞到 mesh 结果）vs 异步 | mesh 模式 await（毫秒级），BREP 异步补 |
| D4 | 布尔/split 的引擎实现与 manifold 结果差异 | 接受形状级一致 / 逐一收敛 | 接受（parity 测试兜底） |
| D5 | 装配 recompute 依赖 `getCurrentGeometry`（VersionStore 快照） | 不受影响 | 无需改动 |
| D6 | 旧场景 `st_*` 兼容 | sceneToCode 兼容重命名保留 1 个版本周期 | 保留 |

## 8. 测试计划

- **parity 测试**（faijs 或 3d_editor test/faijs/）：同一 params 分别走工具实现（manifold）与引擎实现（dispatcher），断言体积/包围盒/面数形状级一致——drill / split / boolean / transform 各一
- **ScriptEngine 集成**（3d_editor）：`commitAndRecord` 后 `VersionStore` 几何的 contentKey == `CadRuntime.replay` 输出
- **round-trip**：UI 操作 → 导出 `.faijs` → 重新导入 → 场景几何 contentKey 一致
- **R-0 代码-语句等价**：对全部 UI op——`statementToCode(stmt)` 包裹解析后与原语句 `op/args/inputs` 逐字段相等（A5-1，含 GeomRef 展开对比）；timeline 显示代码与导出文本的变量名一致性断言（阶段 B 后恒等）
- **undo/redo**：操作后 undo → redo，几何与操作前一致（现有 undo e2e 覆盖 + 断言 contentKey）
- **naming**：UI 录制生成的 partN_vM 全部通过 naming-validator（新增断言）

## 9. 实施顺序

1. A1（commitAndRecord/replayPart 出口统一）——primitive/drill 先跑通
2. A4 参数映射表 + parity 测试（drill 先行）
3. A2（变换烘焙恢复）
4. A3（executor 引擎化，预览一致）
5. B1-B4（id 统一 + 分配器）
6. C 系列（增量/faceOrdinal）按需

## 10. 范围外

- 引擎自身 op 实现的重写（如 drill 盲孔算法与 manifold 对齐）——parity 测试暴露差异后单独立项
- VersionStore/undo 体系本身的替换——维持「几何快照 + 命令」作为场景层，只是快照内容变为引擎产物
- 装配约束求解算法