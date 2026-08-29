/**
 * stdlib assert — per-op 参数自校验助手（Phase 2.2）
 *
 * 设计文档：docs/plans/2026-08-26-phase2-completion-plan.md §2.C
 *
 * 阶段 4 起（args-schema/SCHEMAS 已删除），参数校验全部由本模块的 assert 助手
 * 承担（各 stdlib 函数在 dispatchPath 之前调用）；非法即抛 Error（不静默）。
 */
/** 断言参数为有限数字（类型守卫：通过后 value 收窄为 number）。 */
export declare function assertNumber(value: unknown, name: string): asserts value is number;
/** 断言参数为 > 0 的数字。 */
export declare function assertPositiveNumber(value: unknown, name: string): void;
/** 断言参数为 >= 0 的数字。 */
export declare function assertNonNegativeNumber(value: unknown, name: string): void;
/** 断言参数为 vec3（[x, y, z]，全为有限数字）。 */
export declare function assertVec3(value: unknown, name: string): void;
/** 断言参数为非零 vec3（零向量会使 split/faceNormal 等退化，拒绝）。 */
export declare function assertNonZeroVec3(value: unknown, name: string): void;
/** 断言参数为数字或 vec3（numberOrVec3 类型）。 */
export declare function assertNumberOrVec3(value: unknown, name: string): void;
/** 断言参数为给定枚举值之一（value 缺省时跳过）。 */
export declare function assertOneOf(value: unknown, name: string, allowed: readonly string[]): void;
//# sourceMappingURL=assert.d.ts.map