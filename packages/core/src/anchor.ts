/**
 * anchor — 基本体「锚点在哪 + 锚点落到哪」的唯一裁决点。
 *
 * 设计口径（2026-11-03，蓝本 build123d 的 `align`）：
 * - `align` 只说**包围盒的哪一侧贴到锚点**（`min` / `center` / `max`，可逐轴）。
 * - `at` 只说**锚点落在哪个坐标**，其含义不被任何其它参数改写。
 * - `align:'none'` 是"该图元的原生锚点"的简写（box = 角点、cylinder/cone = 底面轴心、
 *   sphere = 球心），因此 `align:'none'` 与省略 `at` 的裸调用逐点等价。
 * - `centered:true` 是 `align:['center','center','center']` 的语法糖；`centered:false`
 *   等价于省略（历史行为：`params.centered === true` 才生效）。两者与显式 `align`
 *   同给即 `E_ANCHOR_CONFLICT`——同一件事的两种写法不允许同时出现。
 *
 * 为什么要单独一个模块：brep（`primitives/brep-primitives.ts`）与 mesh
 * （`mesh/primitives.ts`）两条路径的内核**原生坐标系不同**（brep 的 box 角点在原点、
 * cylinder 底面轴心在原点；mesh 的 three 系几何一律以原点为中心）。两条路径只允许在
 * 「原生 min 角点」这一个事实上不同，其余全部由本模块算，否则平移量必然算重或算漏
 * （历史事故：mesh 侧 `baseZ + h/2` 与 brep 侧 `baseZ` 各写一套）。
 *
 * 公式（逐轴独立，`nativeMin` = 内核原生几何在该轴的最小值）：
 * ```
 * offset(mode, size) = min → 0 | center → −size/2 | max → −size
 * shift = at + offset − nativeMin
 * ```
 * 同一条 `align` 在两条路径上因此得到**逐点相同的最终包围盒**：brep 的 box
 * `nativeMin = 0`、mesh 的 box `nativeMin = −size/2`，代入同一式子后结果一致。
 *
 * `none` 不会流到 `anchorShift`：`resolveAlign` 已把它展开成该图元的 `nativeAlign`，
 * 否则 'none' 在 brep（角点在原点）与 mesh（中心在原点）会得到不同几何。
 *
 * @platform — 纯算术，无内核依赖（library 侧任何层都可 import）。
 */

/** 包围盒上贴到锚点的那个极值（与 `cad.alignTo` 的 `anchor` 同一套词表）。 */
export type AlignAnchor = 'min' | 'center' | 'max'

/**
 * `align` 的入参取值：`min`/`center`/`max` 把该侧贴到锚点；`none` = 该图元的原生锚点
 * （等价于省略 `at` 的裸调用）。
 */
export type AlignMode = AlignAnchor | 'none'

/**
 * `align` 参数取值：单值 = 三轴同取；三元组 = 逐轴 X/Y/Z。
 * `none` 只允许单值形态（逐轴 `none` 与 `min` 在无 `at` 时结果相同，属语义噪音）。
 */
export type AlignSpec = AlignMode | readonly [AlignMode, AlignMode, AlignMode]

/** 解析后的逐轴对齐方式（长度恒为 3，顺序 X/Y/Z；`none` 已被展开）。 */
export type ResolvedAlign = readonly [AlignAnchor, AlignAnchor, AlignAnchor]

/** 常用组合：三轴全居中（`centered:true` 的等价物）。 */
export const ALIGN_CENTER_ALL: ResolvedAlign = ['center', 'center', 'center']

/** 常用组合：三轴都取 bbox 最小值（box 的原生锚点 = 角点在原点）。 */
export const ALIGN_MIN_ALL: ResolvedAlign = ['min', 'min', 'min']

/**
 * 常用组合：XY 居中、Z 取 bbox 最小 —— box/cylinder/cone 给了 `at` 时的默认锚点
 * （box = 底面中心、cylinder/cone = 底面轴心，即 BASE 语义）。
 */
export const ALIGN_BASE: ResolvedAlign = ['center', 'center', 'min']

const AXIS_MODES: readonly AlignAnchor[] = ['min', 'center', 'max']
const ALL_MODES: readonly AlignMode[] = ['min', 'center', 'max', 'none']

/** 解析锚点参数时需要的入参（`op` 只用于错误信息定位）。 */
export interface AnchorRequest {
  /** op 名，用于错误前缀（`box` / `cylinder` / `cone` / `sphere`）。 */
  op: string
  /** 锚点落点；缺省 = 该图元原生锚点落在原点。 */
  at?: readonly [number, number, number]
  /** 显式对齐方式（未经校验的原始值）。 */
  align?: unknown
  /** 历史布尔开关（未经校验的原始值）。 */
  centered?: unknown
  /** 给了 `at` 但没给 `align`/`centered` 时的逐轴默认对齐。 */
  atAlign: ResolvedAlign
  /** 该图元的原生锚点（`align:'none'` 与"无 at 裸调用"都用它）。 */
  nativeAlign: ResolvedAlign
}

/** 计算平移量时需要的入参。 */
export interface ShiftRequest {
  /** 几何在当前轴的尺寸（bbox 跨度）。 */
  size: readonly [number, number, number]
  /** 内核原生几何在当前轴的最小值。 */
  nativeMin: readonly [number, number, number]
  /** 解析后的逐轴对齐（`none` 已展开）。 */
  align: ResolvedAlign
  /** 锚点落点；缺省视为原点。 */
  at?: readonly [number, number, number]
}

/**
 * 是否为合法的单值对齐模式。
 *
 * @param value - 待判定的入参（已 `unknown`，因为 `align` 从脚本面进来不带类型）。
 * @returns `true` 时 `value` 被收窄成 `AlignMode`，可直接下标访问对齐表。
 */
export function isAlignMode(value: unknown): value is AlignMode {
  return typeof value === 'string' && (ALL_MODES as readonly string[]).includes(value)
}

/** `E_INVALID_ALIGN` 错误（列出合法值域与实收值，报错即文档）。 */
function invalidAlign(op: string, received: unknown): Error {
  return new Error(
    `[faijs/args] ${op}: E_INVALID_ALIGN: \`align\` 只接受 ` +
    "'min' | 'center' | 'max' | 'none'（单值，三轴同取）或三元组 [X, Y, Z]（逐轴；" +
    `三元组里不允许 'none'）。收到 ${JSON.stringify(received)}。`,
  )
}

/**
 * 把 `align` / `centered` / `at` 三个入参解析成逐轴对齐方式。
 *
 * 判定顺序（写死，不留实现空间）：
 * 1. `align` 与 `centered` 同给 → `E_ANCHOR_CONFLICT`（同一件事的两种写法）；
 * 2. `centered:true` → 三轴全 `center`；`centered:false` → 走第 4 条（与今天等价）；
 * 3. 显式 `align` → 校验后展开为三元组；`'none'` 展开为该图元的 `nativeAlign`；
 * 4. 都没给 → 有 `at` 用 `atAlign`，无 `at` 用 `nativeAlign`。
 *
 * @param request - 锚点参数与图元的两套默认值。
 * @returns 逐轴对齐方式（长度 3，不含 `none`）。
 */
export function resolveAlign(request: AnchorRequest): ResolvedAlign {
  const { op, at, align, centered, atAlign, nativeAlign } = request
  if (align !== undefined && centered !== undefined) {
    throw new Error(
      `[faijs/args] ${op}: E_ANCHOR_CONFLICT: \`centered\` 与 \`align\` 不能同时给——` +
      "`centered:true` 等价于 `align:['center','center','center']`，" +
      '`centered:false` 等价于省略 align。请二选一（推荐直接用 `align`）。',
    )
  }
  if (centered !== undefined) {
    if (centered === true) return ALIGN_CENTER_ALL
    if (centered !== false) {
      throw new Error(
        `[faijs/args] ${op}: E_INVALID_ALIGN: \`centered\` 只接受 boolean，收到 ${JSON.stringify(centered)}。`,
      )
    }
    // centered:false ≡ 省略（历史行为：只有 === true 才生效）。
    return at !== undefined ? atAlign : nativeAlign
  }
  if (align !== undefined) {
    if (typeof align === 'string') {
      if (!isAlignMode(align)) throw invalidAlign(op, align)
      return align === 'none' ? nativeAlign : [align, align, align]
    }
    if (Array.isArray(align) && align.length === 3) {
      const triple = align as unknown[]
      for (const axis of triple) {
        if (axis === 'none') {
          throw new Error(
            `[faijs/args] ${op}: E_INVALID_ALIGN: 三元组里不允许 'none'（逐轴 'none' 与 ` +
            "'min' 在无 at 时结果相同）；整体取原生锚点请写 `align:'none'`。",
          )
        }
        if (!(AXIS_MODES as readonly unknown[]).includes(axis)) throw invalidAlign(op, align)
      }
      return triple as unknown as ResolvedAlign
    }
    throw invalidAlign(op, align)
  }
  return at !== undefined ? atAlign : nativeAlign
}

/**
 * 单轴对齐偏移：把该轴的 `min`/`center`/`max` 贴到锚点，需要相对 bbox 最小值的位移。
 *
 * @param size - 该轴尺寸（bbox 跨度）。
 * @param mode - 该轴对齐方式。
 * @returns 相对 bbox 最小值的位移（`min`→0、`center`→−size/2、`max`→−size）。
 */
export function alignOffset(size: number, mode: AlignAnchor): number {
  if (mode === 'min') return 0
  if (mode === 'center') return -size / 2
  return -size
}

/**
 * 算出让「对齐后的包围盒」落到 `at` 的平移量（逐轴）。
 *
 * @param request - 尺寸、内核原生最小值、解析后的对齐与落点。
 * @returns `[dx, dy, dz]`，直接喂给 `kernel.translate` / `translateShape`。
 */
export function anchorShift(request: ShiftRequest): [number, number, number] {
  const { size, nativeMin, align, at } = request
  const anchor = at ?? [0, 0, 0]
  return [
    anchor[0]! + alignOffset(size[0]!, align[0]) - nativeMin[0]!,
    anchor[1]! + alignOffset(size[1]!, align[1]) - nativeMin[1]!,
    anchor[2]! + alignOffset(size[2]!, align[2]) - nativeMin[2]!,
  ]
}
