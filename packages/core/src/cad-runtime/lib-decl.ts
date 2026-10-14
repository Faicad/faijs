/**
 * lib-decl — 库级定位声明（`package.json` 的 `faijs.lib`）的契约与装配期校验。
 *
 * 两级声明（2026-10-14 内核取用面收敛 §3.3）是**两个不同维度**，不是粗细两层：
 *
 * - **库级 = 定位属性**：「这个库能不能在某个内核上成立」。判据不是它的函数调了
 *   哪些方法，而是它的语义基准（`conformsTo`）依赖什么——`faijs-freecad` 的几何
 *   结果必须与 FreeCAD 一致，而 FreeCAD 的几何由 occt 定义，所以它只能跑 occt。
 *   这条约束**任何 `fn.engines` 都写不出来**。
 * - **函数级 = 实现事实**（`fn.engines`）：「这个函数的实现调了哪个内核的东西」。
 *
 * 有效引擎的判定链：`fn.engines ?? lib.platform ?? 中立`（缺省 = 中立 = 今日行为）。
 * 该链在**装配期一次解析完**（`admit-compat-lib.ts`），所以分派侧
 * （`backend-dispatch.ts`）只读 op 元数据，不需要认识库级声明。
 *
 * 装配期校验两条：
 * 1. `platform` 的取值必须是合法引擎 id（`BREP_ENGINE_IDS`）；
 * 2. **单向** peer 约束：`platform` 含 `occt` ⟹ 该库必须有 `occt-wasm` 的
 *    `peerDependencies`。反向不成立——`faijs-fasteners` 有 `occt-wasm` peer，库级
 *    `platform` 却是中立的（只有两条支路用到 occt）。所以 peer **不能**反推 `platform`。
 */

import { BREP_ENGINE_IDS, type BrepEngineId } from '../brep/engine/types'

/** 库在系统中的角色（§3.3 第 1 项）。缺省按最严处理：`library`。 */
export const LIB_ROLES = ['library', 'host', 'declaration', 'adapter'] as const

/** 见 {@link LIB_ROLES}。 */
export type LibRole = (typeof LIB_ROLES)[number]

/**
 * 库级定位声明（库自身 `package.json` 的 `faijs.lib` 字段）。
 */
export interface LibDecl {
  /** 库在系统中的角色；缺省 `'library'`（门禁取最严策略）。 */
  role?: LibRole
  /** **语义基准**：本库的几何语义以谁为准（`'faijs'` / `'cadquery'` / `'freecad'` / `'openscad'` / …）。 */
  conformsTo?: string
  /** 由基准推导出的引擎约束（显式写出，供门禁静态读）；`[]` = 中立。 */
  platform?: readonly BrepEngineId[]
}

/**
 * 一个库的装配元数据（`package.json` 的 `faijs` 字段 + 其 peer 声明）。
 *
 * 这是 **`package.json` 的原始投影**，不是校验后的形态：`lib` 故意留成 `unknown`
 * （来源是不可信的磁盘 / 网络 JSON），由装配期 `assertLibDecl` 校验后才成为
 * {@link LibDecl}。`LibLoader.libMetaFor` / `registerLib({ lib })` 都用这个形状。
 *
 * `peers` 只用于装配期单向校验（§3.3 第 1 项），不参与运行期判定。
 */
export interface LibMeta {
  /** 逐库 autoLift 覆盖（D3-autoLift，既有字段）。 */
  autoLift?: boolean
  /** `package.json` 的 `faijs.lib` 原始值（未校验）。 */
  lib?: unknown
  /**
   * 库自身 `peerDependencies`（键 = 包名，值 = range）。
   *
   * `undefined` 与 `{}` **语义不同**：`undefined` = 该来源没提供 peer 事实（跳过单向
   * 校验）；`{}` = 查过了、确实没有 peer（照常校验，`platform` 含 occt 即被拒）。
   * 读盘来源（CLI / 浏览器 meta / `lib-meta.json`）一律给 `{}`，所以磁盘上的缺位会被
   * 判红而不是被放过。
   */
  peers?: Readonly<Record<string, string>>
}

const DECL_KEYS = new Set(['role', 'conformsTo', 'platform'])

/**
 * 校验并归一化库级声明。缺失 = 未声明（返回 `undefined`，按中立处理）。
 *
 * @param lib - 库 `package.json` 的 `faijs.lib`，或 host 手动注册时给的等价对象。
 * @param peers - 库 `peerDependencies`。`undefined` = 事实未提供（跳过 peer 单向校验）；
 *   `{}` = 确实没有 peer（照常校验）。读盘来源一律给 `{}`，见 {@link LibMeta.peers}。
 * @param where - 报错定位串（库名 / binding），仅用于消息。
 * @returns 归一化后的声明，或 `undefined`（未声明）。
 * @throws 声明形态非法 / 引擎 id 非法 / `platform` 含 occt 而无 `occt-wasm` peer。
 */
export function assertLibDecl(
  lib: unknown,
  peers?: Readonly<Record<string, string>>,
  where = '<unknown>',
): LibDecl | undefined {
  if (lib === undefined || lib === null) return undefined
  if (typeof lib !== 'object' || Array.isArray(lib)) {
    throw new Error(`[faijs] lib '${where}': faijs.lib must be an object, got ${Array.isArray(lib) ? 'array' : typeof lib}`)
  }
  const raw = lib as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!DECL_KEYS.has(key)) {
      throw new Error(
        `[faijs] lib '${where}': unknown faijs.lib field '${key}' (expected one of ${[...DECL_KEYS].join('/')})`,
      )
    }
  }

  const out: LibDecl = {}

  if (raw.role !== undefined) {
    if (typeof raw.role !== 'string' || !(LIB_ROLES as readonly string[]).includes(raw.role)) {
      throw new Error(
        `[faijs] lib '${where}': faijs.lib.role must be one of ${LIB_ROLES.join('/')}, got ${JSON.stringify(raw.role)}`,
      )
    }
    out.role = raw.role as LibRole
  }

  if (raw.conformsTo !== undefined) {
    if (typeof raw.conformsTo !== 'string' || raw.conformsTo.trim() === '') {
      throw new Error(`[faijs] lib '${where}': faijs.lib.conformsTo must be a non-empty string`)
    }
    out.conformsTo = raw.conformsTo
  }

  if (raw.platform !== undefined) {
    if (!Array.isArray(raw.platform)) {
      throw new Error(`[faijs] lib '${where}': faijs.lib.platform must be an array of engine ids`)
    }
    const seen = new Set<string>()
    for (const id of raw.platform) {
      if (typeof id !== 'string' || !(BREP_ENGINE_IDS as readonly string[]).includes(id)) {
        throw new Error(
          `[faijs] lib '${where}': faijs.lib.platform contains unknown engine id ${JSON.stringify(id)} ` +
            `(expected one of ${BREP_ENGINE_IDS.join('/')})`,
        )
      }
      if (seen.has(id)) {
        throw new Error(`[faijs] lib '${where}': faijs.lib.platform has duplicate engine id '${id}'`)
      }
      seen.add(id)
    }
    out.platform = raw.platform as readonly BrepEngineId[]
  }

  // 单向 peer 约束（§3.3 第 1 项）：platform 含 occt ⟹ 库必须有 occt-wasm peer。
  // 反向不成立（fasteners 是活反例），所以 peer 不能用来反推 platform。
  if (out.platform?.includes('occt') && peers !== undefined && peers['occt-wasm'] === undefined) {
    throw new Error(
      `[faijs] lib '${where}': faijs.lib.platform declares 'occt' but the package has no ` +
        `'occt-wasm' peerDependency — a library that needs the OCCT platform must declare that dependency`,
    )
  }

  return out
}

/**
 * 有效引擎判定链：`fn.engines ?? lib.platform ?? 中立`（§3.3 第 2 项）。
 *
 * @param fnEngines - 函数自身的 `fn.engines` 声明（可选）。
 * @param libPlatform - 库级 `platform` 声明（可选）。
 * @returns 有效引擎集合；`undefined` = 中立（所有引擎）。
 */
export function resolveFunctionEngines(
  fnEngines: readonly BrepEngineId[] | undefined,
  libPlatform: readonly BrepEngineId[] | undefined,
): readonly BrepEngineId[] | undefined {
  if (fnEngines !== undefined && fnEngines.length > 0) return fnEngines
  if (libPlatform !== undefined && libPlatform.length > 0) return libPlatform
  return undefined
}

/** {@link CadRuntime.describeLib} 的逐函数视图。 */
export interface LibFunctionView {
  /** 脚本面函数名。 */
  name: string
  /** 有效引擎（已解析 `fn.engines ?? lib.platform`）；`undefined` = 中立。 */
  engines?: readonly BrepEngineId[]
  /** 产物名清单（`fn.outputs`）。 */
  outputs?: string[]
}

/** {@link CadRuntime.describeLib} 的返回值：一个库的定位 + 逐函数清单。 */
export interface LibDescription {
  /** 注册时使用的 binding 名（语句面 `binding.fn(...)`）。 */
  binding: string
  /** 库的 npm 包名（注册时声明；缺省 undefined）。 */
  packageName?: string
  /** 库级角色（未声明 = `library`）。 */
  role: LibRole
  /** 语义基准（未声明 = undefined）。 */
  conformsTo?: string
  /** 库级引擎约束（未声明 = 中立）。 */
  platform: readonly BrepEngineId[]
  /** 逐函数视图。 */
  functions: LibFunctionView[]
}

/** {@link CadRuntime.libsUnder} 的可调用项。 */
export interface LibCallableView {
  binding: string
  name: string
}

/** {@link CadRuntime.libsUnder} 的静态拒绝项。 */
export interface LibRejectedView extends LibCallableView {
  /** 拒绝原因（含声明的引擎集合，用于人工排查）。 */
  reason: string
}

/** {@link CadRuntime.libsUnder} 的返回值：给定引擎下的可调用 / 静态拒绝两分。 */
export interface LibsUnderEngine {
  engineId: string
  callable: LibCallableView[]
  rejected: LibRejectedView[]
}
