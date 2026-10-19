/**
 * execution-stats — 执行路径观测（宿主与测试消费）。
 *
 * 为什么必须存在：`update(old, new)` 会在闸门命中时**静默退化全量**。没有这个字段，
 * 宿主只能靠耗时猜「这轮到底增量了没有」，测试也只能断言结果等价、无法断言路径。
 * weapp 增量接入的直接障碍就在这里（见 3d_editor docs/plans/2026-10-19-weapp-incremental-execution-plan.md）。
 *
 * 为什么挂在 `ExecutionResult` 上且**必填**：可选字段会让新增构造点静默漏填——
 * 那正是本次问题的起点。必填把「忘填」变成编译错误。
 *
 * 命名注：`ExecutionMode` 已被 `ports.ts` 占用（`auto | brep | mesh`，几何后端策略），
 * 语义完全不同，故本文件的路径类型叫 {@link ExecutionPath}，字段名用 `path`。
 */

/**
 * 本轮实际走的执行路径。
 *
 * - `full`：清 ctx 后全量重跑（首次执行、或闸门退化）
 * - `incremental`：保留前缀 ctx，只重放后缀单元
 * - `noop`：逐行比较无差异，零执行、仅从 ctx 重组结果
 */
export type ExecutionPath = 'full' | 'incremental' | 'noop'

/**
 * `path === 'full'` 时的退化原因（闸门 id 对应 runtime 的 G0–G8）。
 * `zero-change` 只出现在 `path === 'noop'`。
 */
export type ExecutionFallbackReason =
  /** G1：本实例从未执行过 */
  | 'first-run'
  /** G3：宿主传入的 oldCode 与内部累计代码不一致 */
  | 'old-code-mismatch'
  /** G2：新代码行数少于旧代码（删除语句） */
  | 'lines-decreased'
  /** G0：解析基线行偏移 ≠ 0（注释/空行导致的行号不齐） */
  | 'non-standard-baseline'
  /** G6：params 指纹变化 */
  | 'params-changed'
  /** G7：注册库集合变化 */
  | 'libs-changed'
  /** G5：上一轮产生过装配运动学位姿 */
  | 'kinematics'
  /** G4：新代码含相对 import（多文件装配场景） */
  | 'relative-imports'
  /** 后缀重放失败 → 清 ctx 全量重试；本字段描述**被降级的那一轮** */
  | 'replay-failed'
  /** 逐行无差异（仅 `path === 'noop'`） */
  | 'zero-change'

/**
 * 一轮执行的路径观测。
 *
 * 示例（3 条语句的脚本改末条）：
 * `{ path: 'incremental', startLine: 3, replayedUnits: 1, skippedUnits: 2 }`
 */
export interface ExecutionStats {
  /** 本轮实际走的路径。 */
  path: ExecutionPath
  /** `path === 'full'` 时的退化原因；`path === 'noop'` 时为 `'zero-change'`。 */
  reason?: ExecutionFallbackReason
  /** `path === 'incremental'` 时的后缀重放起始行（1 起）。 */
  startLine?: number
  /** 本轮真正执行过的单元数（`noop` = 0）。 */
  replayedUnits: number
  /** 本轮从持久 ctx 复用、未执行的单元数。 */
  skippedUnits: number
}
