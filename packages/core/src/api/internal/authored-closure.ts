/**
 * authored-closure — 「作者网格」闭合性结论的句柄登记表
 *
 * ## 为什么需要它
 *
 * OpenSCAD（CGAL）在 **PolySet → Nef** 这一跳校验网格闭合性，看到的是**作者写出来
 * 的原始三角**。faijs 的 ext `polyhedron` 会先 `sew` + `makeSolid` 把开放网格**缝补**
 * 成闭合实体（`bugs/issue802`：原始三角 4 条边界边 ⇒ 缝补后 52 tri 全闭合），
 * 于是「按产物 mesh 判闭合性」永远判不出 OpenSCAD 眼中的错误。
 *
 * 结论必须在**缝补之前**算出来，并按句柄号登记，供布尔判定点取用。
 *
 * ## 为什么挂在 globalThis
 *
 * 登记方是 ext 包（`@faicad/faijs-openscad-ext` 的 `ops/polyhedron.ts`），
 * 读取方是内核（`api/internal/boolean-closure.ts`）。两者是**独立的包**、可能解析到
 * 不同的 `@faicad/faijs` 副本，模块级 `Map` 不共享。用
 * `globalThis[Symbol.for(…)]` 保证同进程内唯一，跨包、跨副本都能对上。
 *
 * ## 失败方向是 fail-safe
 *
 * 只登记 `closed === false`（开放网格是少数派）；表缺失 / 未登记 ⇒ 读取方回退到
 * 「按产物 mesh 边计数」，与本次改动前逐位一致，绝不凭空丢操作数。
 */

/** 登记表在 globalThis 上的键（跨包共享的唯一约定）。 */
const REGISTRY_KEY = Symbol.for('faijs.authoredClosure')

/** 条目上限：只登记开放网格，正常模型不会触及；超限清空防止无界增长。 */
const MAX_ENTRIES = 4096

type Registry = Map<number, boolean>

/** 取（必要时创建）全局登记表。 */
function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, unknown>
  let m = g[REGISTRY_KEY] as Registry | undefined
  if (!(m instanceof Map)) {
    m = new Map<number, boolean>()
    g[REGISTRY_KEY] = m
  }
  return m
}

/**
 * 登记一个句柄的「作者网格」闭合性结论（仅登记开放者为限）。
 *
 * @param handle - OCCT 句柄号（ext 产物的最终句柄，即下游 `brepOf(shape)` 的值）。
 * @param closed - 作者原始三角是否闭合；`true` 不入表（未登记即回退，等价 true）。
 */
export function recordAuthoredClosure(handle: number, closed: boolean): void {
  if (typeof handle !== 'number' || !Number.isFinite(handle)) return
  if (closed) return
  const m = registry()
  if (m.size >= MAX_ENTRIES) m.clear()
  m.set(handle, false)
}

/**
 * 读取一个句柄的「作者网格」闭合性结论。
 *
 * @param handle - OCCT 句柄号。
 * @returns `false` 表示作者网格开放（OpenSCAD 会丢弃该操作数）；
 *          `undefined` 表示未登记，调用方应回退到按产物 mesh 判定的既有口径。
 */
export function readAuthoredClosure(handle: unknown): boolean | undefined {
  if (typeof handle !== 'number' || !Number.isFinite(handle)) return undefined
  const g = globalThis as unknown as Record<symbol, unknown>
  const m = g[REGISTRY_KEY] as Registry | undefined
  if (!(m instanceof Map)) return undefined
  return m.get(handle)
}

/** 清空登记表（单测用）。 */
export function clearAuthoredClosure(): void {
  registry().clear()
}
