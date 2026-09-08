# Agent Note: P0 前缀重放式增量更新

[English](2026-09-08-p0-prefix-replay-incremental-update.md) | 中文

Status: implemented

## Problem

`direct` 执行路径（无 IR）没有增量更新能力——每次 `runtime.update(oldCode, newCode)` 都从头重新执行整个脚本，丧失了 `update` 本应提供的性能优势。module 路径有内容寻址的增量执行，但 direct 路径（P6 以来的主路径）没有等价机制。

## Decision

为 direct 执行路径实现**前缀重放式增量更新**。核心思路：找到 old 与 new 代码之间的首个变更行，保留到该点为止的持久 `ctx` 状态，仅重放后缀区间（从变更单元到末尾）。

### 架构

1. **单元区间**（`DirectExecutor.unitRanges(code)`）：仅解析一遍，将物理行映射到逻辑"单元"（简单语句、块、函数定义），每个带 `lineNo` 和 `endLine`。用于当变更落在块内部时定位重放起始行。

2. **`replayFrom(code, startLine, opts)`**：`DirectExecutor` 上的核心重放方法。步骤：
   - 计算 `replayKeys` = `suffixWrites - prefixWrites`（后缀写入但不与前缀写入重合的变量）。此公式确保前缀定义、在后缀中被重新赋值的变量不从 ctx 删除（它们需要之前的值作为输入）。
   - 清理 `executedLines` / `keepByLine` / `blockOutputs` 中 ≥ `startLine` 的条目。
   - `clearRoundState()`——清空上一轮的 `changedSet` 和 `kinematicsOut`。
   - 从 `ctx` 删除 `replayKeys`。
   - `runCode` 传入已解析 units（避免重复解析）。

3. **`stableFingerprint(value)`**：确定性 FNV-1a 哈希。归一化 `null`/`undefined`、排序对象键、用深度限制 + `WeakSet` 处理循环引用、函数/Symbol 降级为类型标签常量。被闸门 G6/G7/G8 用于检测参数/库/partTransform 变化。

4. **`releasePartCaches(partNames)`**：重放前精确缓存失效——释放 OCCT 句柄（`kernel.release`）、清理 `solidCache` / `meshShapeCache` / `faceEvolutionCache` / `roleTableCache` / `topologyCache` / `statementCache` 中受影响 Part 的条目。

5. **`updateIncremental(oldCode, newCode, opts)`**：`CadRuntime` 上的主流程。保守闸门 G0–G8 判定增量是否安全；任何闸门失败退化为全量重执行（`executeDirectText`）。

### 保守闸门（G0–G8）

| 闸门 | 条件 | 行动 |
|------|------|------|
| G1 | 从未执行过（`accumulatedCode === null`） | 全量执行 |
| G2 | 新代码比旧代码短（删除） | 全量执行 |
| G3 | `oldCode` ≠ 内部 `accumulatedCode` | 全量执行 |
| G0 | 非标准解析基线（`lineOffset !== 0`） | 全量执行 |
| G6 | `opts.params` 指纹变化 | 全量执行 |
| G7 | 注册库集合变化 | 全量执行 |
| G8 | `opts.partTransform` 指纹变化 | 全量执行 |
| G5 | 上一轮产生了运动学位姿 | 全量执行 |
| G4 | 含相对 import 说明符 | 全量执行 |

### 零变更路径（§4.6）

当 `firstDiff === -1`（old 与 new 代码逐行 trim 后完全相同），不执行任何语句。调用 `clearRoundState()`，`collectDirectResult` 从持久 ctx 组装结果。此路径上 `changed` 为 `undefined`。

### 失败降级（§4.7）

如果 `replayFrom` 产生 `failedAt`，执行器 reset 后退回 `executeDirectText(newCode)`——结果与全量执行的失败一致。

## Alternatives considered

1. **始终全量重执行**：拒绝——丧失 `update` 的意义。持久 ctx 的优势（OCCT 句柄、拓扑缓存、mesh 缓存）被浪费。前缀重放保留所有前缀工作。

2. **行级 diff（如 module 路径的内容寻址缓存）**：P0 拒绝——direct 路径无 IR、无语句身份键、无 DAG。行级 diff 加内容键需要构建 IR 等价物，P0 明确排除。前缀重放是最简单的正确方案：重放连续后缀，永远正确（只是不一定最小）。

3. **AST 级 diff（树编辑距离）**：拒绝——P0 过于复杂，且 acorn AST 节点跨编辑不稳定（节点身份无意义）。行级 trim 比较简单、快速、对常见场景（单行编辑、追加、注释变更）正确。

4. **运行时 try-catch 回退（mesh → brep）**：拒绝——项目红线禁止运行时回退。BREP 链可用性由静态规则在执行前判定，不是执行中捕获错误。

## Consequences

- `runtime.update()` 在 direct 路径上使用前缀重放增量执行，恢复了 `update` 相对 `execute` 的性能优势。
- `update-incremental.test.ts` 中 22 个新测试验证：unitRanges 映射、replayFrom 等价性、stableFingerprint 属性、update 等价对拍（5 场景）、零变更路径、重赋值链（replayKeys 公式）、闸门退化（G2/G3）、失败降级。
- `ExecuteOptions` 新增 `beforeStatement` 钩子（记录于 `api-contract.md`）。
- `changed` 语义文档化：零变更路径为 `undefined`，否则填充被重放的变量。
- `clearRoundState()` 在 `replayFrom`（后缀执行前）和 `zeroChangePath`（结果组装前）均被调用，确保不携带上一轮的 `changed`/kinematics。
- `stableFingerprint` 使用 FNV-1a（32 位），非加密——唯一要求是对小参数对象的确定性和低碰撞率，不是安全性。
- 测试期间修复了 `stableFingerprint` 中 `??` 运算符优先级的 bug（symbol description 拼接）。
