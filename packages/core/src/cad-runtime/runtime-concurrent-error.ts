/**
 * runtime-concurrent-error — 并发执行拒绝错误（C1）
 *
 * 独立叶子文件（与 execution-limit-error.ts 同法）：CadRuntime 的三个执行入口
 * （execute / append / update）共用，code = 'E_RUNTIME_CONCURRENT'
 * （宿主可按 code 识别，区别于普通执行错误）。
 *
 * ## 为什么必须拒绝，而不是"尽力而为"
 *
 * `setCurrentStmt`、全局 backends 配置（`configureBackends`）、BREP 内核单例都是
 * **进程级单例**。两个 CadRuntime 交错执行时，后进入者的 `claimBackends()` 会把
 * 全局 backends 指向自己，先进入者的后续语句被**静默劫持**（dispatch 走错槽、
 * 缓存键漂移、顶替释放旧句柄后拓扑重建撞悬空句柄）——症状远离根因，是最难查的一类。
 *
 * 旧代码只在注释里承认"并发交错仍会互踩"（`runtime.ts` 的 claimBackends 文档）。
 * 按项目红线「能力缺口要暴露，不是加旁路开关」，这里改成**显式抛错**：
 * 并发不是"可能不安全"，而是**不受支持**，必须让调用方当场知道。
 *
 * 用户已裁决：**不允许并发执行多 runtime**（开发计划 §4.7 C1）。
 */
export class RuntimeConcurrentError extends Error {
  /** 宿主可按 code 识别的错误码：'E_RUNTIME_CONCURRENT'。 */
  readonly code = 'E_RUNTIME_CONCURRENT'
  constructor(
    /** 当前持有执行态的那个 runtime 的 id。 */
    readonly holderId: number,
    /** 被拒绝的 runtime 的 id。 */
    readonly rejectedId: number,
    /** 被拒绝的入口名（execute / append / update）。 */
    readonly entry: string,
  ) {
    super(
      `[faijs] E_RUNTIME_CONCURRENT: runtime #${rejectedId} cannot ${entry} ` +
        `while runtime #${holderId} is executing — concurrent multi-runtime execution is not supported ` +
        `(setCurrentStmt / backends / kernel are process-wide singletons). Serialize your runtimes.`,
    )
    this.name = 'RuntimeConcurrentError'
  }
}
