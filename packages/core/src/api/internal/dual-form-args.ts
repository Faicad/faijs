/**
 * dual-form-args — D11 参数双形态归一化判别器
 *
 * 设计文档：docs/plans/2026-09-03-faijs-brepjs-compat-api.md §4.2 / §4.3.2
 *
 * 本文件实现参数双形态归一化（D11）：
 * - A 类（明显可区分）：单名双形态，函数内部按参数形态切换实现
 * - B1 类（人类看来不明显）：单名单形态，brepjs options 对象即唯一对象形态
 * - B2 类（人类看来不明显）：双名，brepjs 形态占正名，faijs 对象形态加描述性后缀
 *
 * 判别规则：
 * 1. 首参是 plain object（Object.getPrototypeOf(a) === Object.prototype）
 *    且非 Shape、非句柄、非数组 → 对象形态
 * 2. 否则 → 位置形态
 *
 * 对象形态映射：
 * - 按 params 表（机器参数名）将对象键映射为位置数组
 * - 缺省键 → undefined
 * - 对象形态含 params 外未知键 → 抛 E_ARGS_FORM
 *
 * B2 条目不走判别器（两个名字各自固定形态）。
 */

import { isShape } from '../../shape'

/** 形态分类。 */
export type FormClass = 'A' | 'B1' | 'B2'

/** 参数规格。 */
export interface ArgSpec {
  /** op 名（错误信息用）。 */
  name: string
  /** 机器参数名表（按位置顺序），用于对象形态→位置数组映射。 */
  params?: string[]
  /** 形态分类。 */
  formClass: FormClass
}

/** 句柄类型守卫（vendored 句柄有 .wrapped 属性）。 */
function isHandleLike(v: unknown): boolean {
  return typeof v === 'object' && v !== null && 'wrapped' in v
}

/**
 * 判定参数是否为对象形态。
 *
 * 判别式（全仓统一）：
 * - 首参是 plain object（Object.getPrototypeOf(a) === Object.prototype）
 * - 且非 Shape、非句柄、非数组
 *
 * @param args - 调用参数数组
 * @returns 是否为对象形态
 */
export function isObjectForm(args: unknown[]): boolean {
  if (args.length === 0) return false
  const first = args[0]
  if (first === null || typeof first !== 'object') return false
  if (Array.isArray(first)) return false
  if (isShape(first)) return false
  if (isHandleLike(first)) return false
  return Object.getPrototypeOf(first) === Object.prototype
}

/**
 * 将对象形态参数归一化为位置数组。
 *
 * @param obj - 对象形态参数
 * @param params - 机器参数名表
 * @param opName - op 名（错误信息用）
 * @returns 位置数组（缺省键 → undefined）
 * @throws E_ARGS_FORM 对象含 params 外未知键时
 */
export function normalizeObjectForm(
  obj: Record<string, unknown>,
  params: string[],
  opName: string,
): unknown[] {
  const keys = Object.keys(obj)
  const unknownKeys = keys.filter(k => !params.includes(k))
  if (unknownKeys.length > 0) {
    throw new Error(
      `[faijs/args] ${opName}: E_ARGS_FORM: unexpected parameter(s): ${unknownKeys.join(', ')}. ` +
      `Expected: ${params.join(', ')}`
    )
  }
  return params.map(k => obj[k])
}

/**
 * 参数双形态归一化判别器。
 *
 * 根据 args 和 spec 归一化参数：
 * - B2 条目：直接返回原样（两个名字各自固定形态）
 * - 对象形态：按 params 表映射为位置数组
 * - 位置形态：直接返回原样
 *
 * @param args - 调用参数数组
 * @param spec - 参数规格
 * @returns 归一化后的参数数组
 * @throws E_ARGS_FORM 形态无法匹配或对象含未知键时
 */
export function resolveArgs(args: unknown[], spec: ArgSpec): unknown[] {
  // B2 条目不走判别器（两个名字各自固定形态）
  if (spec.formClass === 'B2') {
    return args
  }

  // 无 params 表时无法归一化对象形态，只能接受位置形态
  if (!spec.params) {
    if (isObjectForm(args)) {
      throw new Error(
        `[faijs/args] ${spec.name}: E_ARGS_FORM: object form requires params specification`
      )
    }
    return args
  }

  // 判定形态
  if (isObjectForm(args)) {
    // 对象形态 → 位置数组
    return normalizeObjectForm(
      args[0] as Record<string, unknown>,
      spec.params,
      spec.name,
    )
  }

  // 位置形态 → 原样返回
  return args
}

/**
 * 双形态归一化结果。
 *
 * 包含归一化后的参数和是否为对象形态的标记。
 */
export interface ResolvedArgs {
  /** 归一化后的参数数组。 */
  args: unknown[]
  /** 是否为对象形态。 */
  isObjectForm: boolean
}

/**
 * 参数双形态归一化判别器（带形态信息）。
 *
 * 与 resolveArgs 相同，但返回形态信息。
 *
 * @param args - 调用参数数组
 * @param spec - 参数规格
 * @returns 归一化结果
 */
export function resolveArgsWithInfo(args: unknown[], spec: ArgSpec): ResolvedArgs {
  if (spec.formClass === 'B2') {
    return { args, isObjectForm: false }
  }

  if (!spec.params) {
    if (isObjectForm(args)) {
      throw new Error(
        `[faijs/args] ${spec.name}: E_ARGS_FORM: object form requires params specification`
      )
    }
    return { args, isObjectForm: false }
  }

  if (isObjectForm(args)) {
    return {
      args: normalizeObjectForm(
        args[0] as Record<string, unknown>,
        spec.params,
        spec.name,
      ),
      isObjectForm: true,
    }
  }

  return { args, isObjectForm: false }
}
