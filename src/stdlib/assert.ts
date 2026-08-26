/**
 * stdlib assert — per-op 参数自校验助手（Phase 2.2）
 *
 * 设计文档：docs/plans/2026-08-26-phase2-completion-plan.md §2.C
 *
 * 集中式 validateStatementArgs（runtime.check）是 parse 期 UX 校验；
 * 本模块是 stdlib 被**直接 import**（如 3d_editor 预览路径）时的防御层。
 * 每个 op 文件导出 assertXxxParams(params)，op 函数体在 resolvePath 之前调用，
 * 非法即抛 Error（不静默）。
 */

/** 断言参数为有限数字（类型守卫：通过后 value 收窄为 number）。 */
export function assertNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`[stdlib] ${name} must be a finite number, got ${JSON.stringify(value)}`)
  }
}

/** 断言参数为 > 0 的数字。 */
export function assertPositiveNumber(value: unknown, name: string): void {
  assertNumber(value, name)
  if (value <= 0) {
    throw new Error(`[stdlib] ${name} must be > 0, got ${value}`)
  }
}

/** 断言参数为 >= 0 的数字。 */
export function assertNonNegativeNumber(value: unknown, name: string): void {
  assertNumber(value, name)
  if (value < 0) {
    throw new Error(`[stdlib] ${name} must be >= 0, got ${value}`)
  }
}

/** 断言参数为 vec3（[x, y, z]，全为有限数字）。 */
export function assertVec3(value: unknown, name: string): void {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  ) {
    throw new Error(`[stdlib] ${name} must be a vec3 [x, y, z], got ${JSON.stringify(value)}`)
  }
}

/** 断言参数为数字或 vec3（numberOrVec3 类型）。 */
export function assertNumberOrVec3(value: unknown, name: string): void {
  if (typeof value === 'number') {
    assertPositiveNumber(value, name)
    return
  }
  assertVec3(value, name)
}

/** 断言参数为给定枚举值之一（value 缺省时跳过）。 */
export function assertOneOf(value: unknown, name: string, allowed: readonly string[]): void {
  if (value !== undefined && value !== null && !allowed.includes(value as string)) {
    throw new Error(`[stdlib] ${name} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}`)
  }
}
