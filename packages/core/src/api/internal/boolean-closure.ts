/**
 * boolean-closure — 布尔操作数「网格闭合性」判定的共享实现
 *
 * 方案 2026-10-28 v2 §3/§4。被两处复用：`api/boolean`（脚本面
 * `union`/`subtract`/`intersect`/`fuse`/`cut`）与 `api/boolean-op`（脚本面
 * `cad.boolean` 带选项通用形态）——两者实现不同但 OpenSCAD 的丢弃语义一致。
 *
 * ## 为什么只校验「叶子」操作数
 *
 * CGAL 的闭合性校验**只**发生在 PolySet→Nef 这一跳，Nef→Nef 不再校验。faijs 没有
 * Nef，每一步都产出带 mesh 的 Shape，所以只校验带 `AUTHORED_LEAF` 标记的**作者叶子
 * 网格**（polyhedron / import / 挤出产物 / 3D 原语）。对所有操作数一律校验会把
 * issue591 group B 的 union 产物（两个闭合楔形沿顶棱相接，顶棱被 4 面共用）误判为
 * 非闭合而丢掉，整棵树变空 —— 这正是 v1 实测到的 `no result shape in outputs`。
 *
 * ## 为什么判据是「无向边计数」而不是 BREP shapeType
 *
 * v1 用 `shapeType` 判定，结果 4 例操作数全是 SOLID/COMPOUND、无一个是 SHELL，
 * 判据完全空转（4 例数值与基线逐位相同）。OpenSCAD 看的是网格，不是 BREP 类型。
 */

import type { Shape } from '../../mesh/types'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { fromBrep } from '../../shape'
import { isAuthoredLeaf } from './authored-leaf'
import { readAuthoredClosure } from './authored-closure'

// ── 开关 ────────────────────────────────────────────────────────────────────
// 默认关闭：避免影响非 OpenSCAD 调用方（尤其是 101 个 `import()` 用例里的合法开放
// 网格）。仅由 OpenSCAD 翻译的 `.fai.js` 在文件头 `cad.setBooleanOperandValidation(true)`
// 打开。

let booleanOperandValidation = false

/**
 * 开启/关闭「操作数网格闭合性校验」（OpenSCAD 语义）。
 * @param on - true 时，布尔运算按 OpenSCAD 规则丢弃非闭合的**叶子**操作数。
 */
export function setBooleanOperandValidation(on: boolean): void {
  booleanOperandValidation = on
}

/**
 * 读取当前开关状态（供 `api/boolean-op` 复用判定）。
 * @returns true 表示已开启 OpenSCAD 操作数闭合性校验。
 */
export function getBooleanOperandValidation(): boolean {
  return booleanOperandValidation
}

// ── 判定 ────────────────────────────────────────────────────────────────────

/**
 * 网格闭合性判定：逐三角统计**无向边**被共用的次数。
 *
 * 顶点按坐标量化去重（`round(x*1e6)`），容忍接缝处因 flat/uv 法向切分导致的索引
 * 重复顶点（它们位置相同，必须视作同一顶点，否则会假报边界边）。
 * **不**剔除退化三角：issue802 的 `polyhedron#2` 含 20 个重复坐标点但全边计数为 2，
 * OpenSCAD 保留了它 —— 擅自剔除退化三角会改掉判定口径。
 */
function meshClosure(
  pos: Float32Array,
  idx: Uint32Array,
): { closed: boolean; hist: Record<number, number>; tris: number } {
  const triCount = Math.floor(idx.length / 3)
  if (triCount === 0) return { closed: false, hist: {}, tris: 0 }
  const vCanon = new Map<number, number>()
  const keyToId = new Map<string, number>()
  let nextId = 0
  const canon = (vi: number): number => {
    let id = vCanon.get(vi)
    if (id === undefined) {
      const x = pos[vi * 3] ?? 0
      const y = pos[vi * 3 + 1] ?? 0
      const z = pos[vi * 3 + 2] ?? 0
      const k = `${Math.round(x * 1e6)}|${Math.round(y * 1e6)}|${Math.round(z * 1e6)}`
      id = keyToId.get(k)
      if (id === undefined) {
        id = nextId++
        keyToId.set(k, id)
      }
      vCanon.set(vi, id)
    }
    return id
  }
  const edgeCount = new Map<string, number>()
  const bump = (u: number, v: number): void => {
    const k = u < v ? `${u}|${v}` : `${v}|${u}`
    edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1)
  }
  for (let t = 0; t < triCount; t++) {
    const a = canon(idx[t * 3]!)
    const b = canon(idx[t * 3 + 1]!)
    const c = canon(idx[t * 3 + 2]!)
    bump(a, b)
    bump(b, c)
    bump(c, a)
  }
  const hist: Record<number, number> = {}
  let closed = true
  for (const count of edgeCount.values()) {
    hist[count] = (hist[count] ?? 0) + 1
    if (count !== 2) closed = false
  }
  return { closed, hist, tris: triCount }
}

const NON_SOLID_TYPES = new Set(['wire', 'face', 'shell', 'vertex', 'edge'])

/** 单个操作数的闭合性判定结果。 */
export interface OperandClosure {
  /** OpenSCAD 眼里该操作数是否可用（闭合实体）。 */
  closed: boolean
  /** 该操作数是否带「作者叶子网格」标记（false ⇒ 未参与校验）。 */
  leaf: boolean
  /** 边使用次数直方图（探针输出用）。 */
  hist: Record<number, number>
  /** 三角数（探针输出用）。 */
  tris: number
}

/**
 * 判定一个操作数在 OpenSCAD 眼里是否「可用」（= 闭合实体）。
 *
 * - **非叶子网格**（布尔产物 / 未标记 / 标记在序列化中丢失）⇒ 一律 closed=true
 *   （不校验）。这是 CGAL 的 Nef→Nef 不校验，也是 fail-safe 方向；
 * - 叶子网格但拓扑类型是非实体（wire/face/shell/vertex/edge）⇒ false；
 * - 叶子网格且有三角载荷 ⇒ 按无向边计数判定；无三角载荷（未物化）⇒ true（不判）。
 */
/**
 * 判定一个操作数在 OpenSCAD 眼里是否「可用」（= 闭合实体）。
 *
 * @param api - BREP 内核面（读 shapeType 用）。
 * @param h - 操作数的 BREP 句柄（`brepOf(shape)`）。
 * @param shape - 操作数本身（判定是否叶子网格 + 取三角载荷）。
 * @returns 闭合性判定结果。
 */
export function isClosedOperandForBooleanOp(
  api: ReturnType<typeof getBrepApi>,
  h: unknown,
  shape: Shape | undefined,
): OperandClosure {
  if (!isAuthoredLeaf(shape)) return { closed: true, leaf: false, hist: {}, tris: 0 }
  if (h === undefined || h === null) return { closed: false, leaf: true, hist: {}, tris: 0 }
  // ① 「作者网格」登记结论优先（ext `polyhedron` 缝补**之前**算出的闭合性）。
  //    缝补后的产物 mesh 全闭合，按它判永远判不出 OpenSCAD 眼中的错误
  //    （issue802：原始三角 4 条边界边 ⇒ 缝补后 52 tri）。未登记 ⇒ 走 ②。
  const authored = readAuthoredClosure(h)
  if (authored !== undefined) {
    return { closed: authored, leaf: true, hist: {}, tris: -3 }
  }
  // ② 按产物 mesh 的无向边计数判定（叶子 mesh 未被缝补时的口径）。
  let t = 'solid'
  try {
    t = api.shapeType(h as never) as string
  } catch {
    /* 引擎查询失败：按实体处理，不因探测失败而丢操作数 */
  }
  if (NON_SOLID_TYPES.has(t)) return { closed: false, leaf: true, hist: {}, tris: 0 }
  const pos = shape?.positions as Float32Array | undefined
  const idx = shape?.indices as Uint32Array | undefined
  if (!pos || !idx || idx.length === 0) return { closed: true, leaf: true, hist: {}, tris: 0 }
  const r = meshClosure(pos, idx)
  return { closed: r.closed, leaf: true, hist: r.hist, tris: r.tris }
}

/**
 * 打印探针行（`BOOL_DEBUG=1`）。判定点的统一出口，两个 boolean 实现都调它。
 */
/**
 * 打印探针行（`BOOL_DEBUG=1`）。判定点的统一出口，两个 boolean 实现都调它。
 *
 * @param op - 运算名（探针行标签）。
 * @param i - 操作数序号。
 * @param r - 判定结果。
 */
export function debugOperand(op: string, i: number, r: OperandClosure): void {
  process.stderr.write(
    `[BOOL_DEBUG] op=${op} i=${i} leaf=${r.leaf} tris=${r.tris} ` +
      `edgeHist=${JSON.stringify(r.hist)} closed=${r.closed}\n`,
  )
}

/** 构造一个空实体（无任何几何），用于 OpenSCAD 语义下的「结果为空」分支。 */
/**
 * 构造一个空实体（无任何几何），用于 OpenSCAD 语义下的「结果为空」分支。
 *
 * @param api - BREP 内核面。
 * @returns 空 compound 实体（可继续参与链式操作）。
 */
export function emptyBrepShape(api: ReturnType<typeof getBrepApi>): Shape {
  const handle = api.makeCompound([])
  return fromBrep(solidToShape(api, handle), { solid: handle })
}
