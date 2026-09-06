/**
 * execution-limit-error — 整轮执行超时错误（§6.3 / D8）
 *
 * 独立叶子文件：DirectExecutor（单元循环内检查）与 CadRuntime（module 路径
 * runWithFailureHandling 的 Promise.race）共用，避免 runtime ↔ direct-executor
 * 循环依赖。code = 'E_EXEC_LIMIT'（宿主可按 code 识别，区别于普通执行错误）。
 */
export class ExecutionLimitError extends Error {
  /** 宿主可按 code 识别的错误码：'E_EXEC_LIMIT'。 */
  readonly code = 'E_EXEC_LIMIT'
  constructor(timeoutMs: number) {
    super(`[faijs] execution timed out after ${timeoutMs}ms`)
    this.name = 'ExecutionLimitError'
  }
}
