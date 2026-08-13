# UI 操作 → faijs 语句 → 引擎执行（单一几何实现）改造方案

> 日期：2026-08-13
> 范围：3d_editor（C:\my\Faicad\3d_editor）+ faijs（C:\my\Faicad\faijs）
> 前置方案：docs/plans/2026-08-13-naming-validator-design.md（命名语义校验，与本文阶段 B 联动）

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