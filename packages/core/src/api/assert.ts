/**
 * stdlib assert — per-op 参数自校验助手（Phase 2.2）
 *
 *
 * 阶段 4 起（args-schema/SCHEMAS 已删除），参数校验全部由本模块的 assert 助手
 * 承担（各 stdlib 函数在 dispatchPath 之前调用）；非法即抛 Error（不静默）。
 */

/**
 * Assert that a parameter is a finite number, narrowing the type to `number`.
 * @param value - the value to check.
 * @param name - the parameter name used in the thrown error message.
 * @returns asserts that `value` is a number.
 */
export function assertNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`[stdlib] ${name} must be a finite number, got ${JSON.stringify(value)}`)
  }
}

/**
 * Assert that a parameter is a number greater than zero.
 * @param value - the value to check.
 * @param name - the parameter name used in the thrown error message.
 */
export function assertPositiveNumber(value: unknown, name: string): void {
  assertNumber(value, name)
  if (value <= 0) {
    throw new Error(`[stdlib] ${name} must be > 0, got ${value}`)
  }
}

/**
 * Assert that a parameter is a number greater than or equal to zero.
 * @param value - the value to check.
 * @param name - the parameter name used in the thrown error message.
 */
export function assertNonNegativeNumber(value: unknown, name: string): void {
  assertNumber(value, name)
  if (value < 0) {
    throw new Error(`[stdlib] ${name} must be >= 0, got ${value}`)
  }
}

/**
 * Assert that a parameter is a vec3 `[x, y, z]` of finite numbers.
 * @param value - the value to check.
 * @param name - the parameter name used in the thrown error message.
 */
export function assertVec3(value: unknown, name: string): void {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  ) {
    throw new Error(`[stdlib] ${name} must be a vec3 [x, y, z], got ${JSON.stringify(value)}`)
  }
}

/**
 * Assert that a parameter is a non-zero vec3 (a zero vector would degenerate
 * operations such as split/faceNormal, so it is rejected).
 * @param value - the value to check.
 * @param name - the parameter name used in the thrown error message.
 */
export function assertNonZeroVec3(value: unknown, name: string): void {
  assertVec3(value, name)
  const v = value as [number, number, number]
  if (v[0] === 0 && v[1] === 0 && v[2] === 0) {
    throw new Error(`[stdlib] ${name} must be a non-zero vec3, got ${JSON.stringify(value)}`)
  }
}

/**
 * Assert that a parameter is either a positive number or a vec3.
 * @param value - the value to check.
 * @param name - the parameter name used in the thrown error message.
 */
export function assertNumberOrVec3(value: unknown, name: string): void {
  if (typeof value === 'number') {
    assertPositiveNumber(value, name)
    return
  }
  assertVec3(value, name)
}

/**
 * Assert that a parameter is one of the given allowed values (skipped when
 * `value` is absent).
 * @param value - the value to check.
 * @param name - the parameter name used in the thrown error message.
 * @param allowed - the list of permitted string values.
 */
export function assertOneOf(value: unknown, name: string, allowed: readonly string[]): void {
  if (value !== undefined && value !== null && !allowed.includes(value as string)) {
    throw new Error(`[stdlib] ${name} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}`)
  }
}
