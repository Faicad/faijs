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
 * - B1 条目：直接返回原样（brepjs options 对象即唯一对象形态，§4.2「无需判别」）
 * - 对象形态：按 params 表映射为位置数组
 * - 位置形态：直接返回原样
 *
 * B1 为何原样返回：B1 的 brepjs 位置形态首参本身就是配置对象（如
 * `thread(options: ThreadOptions)`），对象形态与它在首参上撞型，判别式失效；
 * 方案 §4.2 B1 的定义即「faijs 侧无独立对象 schema 时，直接以 brepjs options
 * 对象为唯一对象形态（单名单形态，无需判别）」。若在此处按 params 表归一，
 * 任何 options 键都会因不在 params 表里而误抛 E_ARGS_FORM。
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
  // B1 条目：brepjs options 对象即唯一对象形态，无需判别（§4.2）
  if (spec.formClass === 'B1') {
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
  if (spec.formClass === 'B2' || spec.formClass === 'B1') {
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

// ─────────────────────────────────────────────────────────────────────────────
// 反方向：位置形态 → 对象形态（faijs 特有 dual op，impl 原生对象形态）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 位置形态声明（D11 反方向，§4.2「归一方向 = 位置→对象」）。
 *
 * faijs 特有 dual op 的 impl 是对象形态原生（`box({ size })` /
 * `translate(shape, { offset })`），brepjs 生态的位置形态
 * （`box(10, 20, 30)` / `translate(shape, 1, 0, 0)`）需先归一成对象形态。
 * 声明式而非 if 分支：op 作者只列「哪个键吃几个位置参数」，判别与装箱由
 * {@link positionalToObject} 统一完成。
 */
export interface PositionalForm {
  /**
   * 对象形态键名，按位置顺序（只描述 Shape 之后的**非几何**形参）。
   * 例：`box(10, 20, 30)` → `keys: ['size']`；`cylinder(5, 40)` →
   * `keys: ['radius', 'height']`。
   */
  keys: string[]
  /**
   * 哪些键是 vec3 槽位（吃掉最多 3 个连续位置参数）。
   * 1 个 → 标量（number 或数组原样）；2~3 个 → `[x, y(, z)]` 数组。
   * 例：`box(10)` → `{ size: 10 }`；`box(10, 20, 30)` → `{ size: [10, 20, 30] }`。
   */
  vec3Keys?: string[]
  /**
   * 前置 Shape 形参个数（原样透传，不参与装箱），缺省 0。
   * 例：`translate(shape, 1, 0, 0)` → `shapeArity: 1`。
   */
  shapeArity?: number
}

/** 判定值是否是可作为对象形态形参的 plain object（与 {@link isObjectForm} 同判别式）。 */
function isPlainObjectValue(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return false
  if (isShape(v)) return false
  if (isHandleLike(v)) return false
  return Object.getPrototypeOf(v) === Object.prototype
}

/**
 * 位置形态 → 对象形态归一（faijs 特有 dual op 的 D11 反方向）。
 *
 * 触发条件：声明了 positional 且对象槽位（第 `shapeArity` 个实参）不是
 * plain object。已是对象形态或实参不足时原样返回（交由 op 自身的断言报错）。
 *
 * @param args - 调用参数数组
 * @param form - 位置形态声明
 * @param name - op 名（错误信息用）
 * @returns 归一后的参数数组（前置 Shape 原样 + 末尾一个对象形态参数）
 * @throws E_ARGS_FORM 位置参数个数与声明的槽位不匹配时
 */
export function positionalToObject(args: unknown[], form: PositionalForm, name: string): unknown[] {
  const shapeArity = form.shapeArity ?? 0
  if (args.length <= shapeArity) return args // 无位置形参可装箱 → 原样（op 断言报错）
  if (isPlainObjectValue(args[shapeArity])) return args // 已是对象形态

  const rest = args.slice(shapeArity)
  const obj: Record<string, unknown> = {}
  let i = 0
  for (const key of form.keys) {
    if (i >= rest.length) break
    if (form.vec3Keys?.includes(key)) {
      // vec3 槽位：吃掉最多 3 个连续实参（1 个 → 标量，2~3 个 → 数组）。
      // 若剩余序列最末是 plain object（候选尾参 options），先为它留位，不让
      // vec3 槽把它吞进拓扑参数（`box(10,20,30,{centered:true})`、`box(20,{centered:true})`）。
      const avail = rest.length - i
      const reserveOptions = avail > 1 && isPlainObjectValue(rest[rest.length - 1]) ? 1 : 0
      const take = Math.min(3, avail - reserveOptions)
      const chunk = rest.slice(i, i + take)
      obj[key] = take === 1 ? chunk[0] : chunk
      i += take
      continue
    }
    obj[key] = rest[i]
    i += 1
  }
  // D11 尾参 options 合并（§6.2）：位置槽装箱后，若剩余实参恰好 1 个且为
  // plain object → 作为 options 并入 args。让 `box(10,20,30,{centered:true})`、
  // `sphere(5,{at,segments})`、`cylinder(5,40,{centered:true})` 在脚本面可用。
  if (i < rest.length) {
    if (rest.length - i === 1 && isPlainObjectValue(rest[i])) {
      const opts = rest[i] as Record<string, unknown>
      const dup = Object.keys(opts).filter((k) => form.keys.includes(k) || k in obj)
      if (dup.length > 0) {
        throw new Error(
          `[faijs/args] ${name}: E_ARGS_FORM: option key(s) ${dup.join(', ')} ` +
          `conflict with positional slot(s) (${form.keys.join(', ')})`
        )
      }
      Object.assign(obj, opts)
      return [...args.slice(0, shapeArity), obj]
    }
    throw new Error(
      `[faijs/args] ${name}: E_ARGS_FORM: expected ${form.keys.join(', ')} ` +
        `(${form.keys.length} positional slot(s)); got ${rest.length} value(s): ` +
        rest.map((a) => (typeof a === 'object' ? '[object]' : String(a))).join(', ')
    )
  }
  return [...args.slice(0, shapeArity), obj]
}
