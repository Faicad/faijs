/**
 * stdlib assert — per-op 参数自校验助手（Phase 2.2）
 *
 * 设计文档：docs/plans/2026-08-26-phase2-completion-plan.md §2.C
 *
 * 阶段 4 起（args-schema/SCHEMAS 已删除），参数校验全部由本模块的 assert 助手
 * 承担（各 stdlib 函数在 resolvePath 之前调用）；非法即抛 Error（不静默）。
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

/** 断言参数为非零 vec3（零向量会使 split/faceNormal 等退化，拒绝）。 */
export function assertNonZeroVec3(value: unknown, name: string): void {
  assertVec3(value, name)
  const v = value as [number, number, number]
  if (v[0] === 0 && v[1] === 0 && v[2] === 0) {
    throw new Error(`[stdlib] ${name} must be a non-zero vec3, got ${JSON.stringify(value)}`)
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
