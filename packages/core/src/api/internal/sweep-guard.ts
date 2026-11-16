/**
 * sweep-guard — 扫掠/旋转产物的数值对账（post-condition，不修几何）
 *
 * ## 为什么需要
 *
 * 实测（`packages/core/test/probe-case8-pipe-gap.ts`）证明：折线脊柱不会报错，只会
 * **静默少给体积**，且少的量是固定解析系数——
 *
 * | 脊柱 | 实际/解析 |
 * |---|---|
 * | 真弧 R10 / R36.35 | < 0.01% |
 * | 折线弧 16 段 / 40 段（圆截面、环形截面） | 0.63662 = 2/π |
 * | 两段 90° 折线 | 0.5 |
 *
 * 0.01% 到 36% 之间没有任何样本，所以 5% 是安全分界：正常件不会被误判，
 * 丢实体的扫掠一定会被拦。
 *
 * ## 恒等式
 *
 *   期望体积 = 截面积 × 脊柱长度        （等截面、无缩放律）
 *
 * 只在恒等式成立时判：截面必须闭合且平面（`makeFace` 能造出面）、期望值 > 0、
 * 无缩放律（`law ≠ none`）。任一不满足 → 跳过，不猜。
 *
 * ## 与 rotate 的关系
 *
 * 旋转的判据不同（体积/厚度是否为 0），见 `assertNotZeroThickness`。两者共用
 * 同一套失败哲学：**几何自洽不等于结果正确**，能在出口用算术判出来的，就不要
 * 留给调用方去发现。
 */

import type { BrepHandle, BrepVec3 } from '../../brep/engine/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import { OpError } from './result-unwrap'

/** 默认体积对账容差：5%。依据见文件头实测表。 */
export const DEFAULT_SWEEP_VOLUME_TOLERANCE = 0.05

let sweepVolumeTolerance = DEFAULT_SWEEP_VOLUME_TOLERANCE

/** 读取当前容差。
 * @returns Current relative volume tolerance.
 */
export function getSweepVolumeTolerance(): number {
  return sweepVolumeTolerance
}

/**
 * 调整体积对账容差。
 *
 * 只在确有"有意粗扫"证据时使用（如多段真弧拟合）；折线脊柱不会因为放宽阈值变对。
 * @param value - 相对容差，(0, 1) 之间。
 */
export function setSweepVolumeTolerance(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`E_SWEEP_TOL_INVALID: tolerance must be in (0,1), got ${String(value)}`)
  }
  sweepVolumeTolerance = value
}

/** 面截面的面积（带孔面取净面积——与 `pipe` 的"截面原样透传"一致）。
 * @param api - BREP engine API used for surface-area queries.
 * @param face - Face handle to measure.
 * @returns Net area of the face, or undefined when measurement fails.
 */
export function areaOfProfileFace(api: BrepEngineApi, face: BrepHandle): number | undefined {
  try {
    const area = api.getSurfaceArea(face)
    return Number.isFinite(area) && area > 0 ? area : undefined
  } catch {
    return undefined
  }
}

/**
 * wire 是否闭合。
 *
 * 为什么必须自己判、不能靠 `makeFace`：OCCT 的 `BRepBuilderAPI_MakeFace` 对**开口**
 * wire 会**隐式补线闭合**（实测：3 点开口折线造出面积 16 的面），于是"面积 × 长度"
 * 这条恒等式会拿一个用户没指定的截面去对账，误报 83%（`sweep-loft.test.ts` 的
 * 开口截面用例就是这么被打中的）。
 *
 * 判据（拓扑计数）：闭合环的边数 == 顶点数；开口折线是 边数 + 1。无法判定（如
 * 顶点表异常的曲线 wire）时返回 `false` —— 宁可少查，不可误判。
 */
function wireIsClosed(api: BrepEngineApi, wire: BrepHandle): boolean {
  try {
    const edges = api.getSubShapes(wire, 'edge')
    const verts = api.getSubShapes(wire, 'vertex')
    const ne = edges.length
    const nv = verts.length
    for (const h of edges) {
      try { api.release(h) } catch { /* 已释放 */ }
    }
    for (const h of verts) {
      try { api.release(h) } catch { /* 已释放 */ }
    }
    return ne > 0 && nv === ne
  } catch {
    return false
  }
}

/**
 * wire 截面的面积：造一个临时面再量。
 *
 * 造面失败（非平面）或 wire 不闭合 ⇒ 返回 `undefined`，调用方据此跳过对账——
 * 开放截面扫出的是曲面片，体积语义本就不适用。
 * @param api - BREP engine API used to build the temp face and measure it.
 * @param wire - Closed wire handle to measure.
 * @returns Area of the wire's face, or undefined when a face cannot be built.
 */
export function areaOfProfileWire(api: BrepEngineApi, wire: BrepHandle): number | undefined {
  if (!wireIsClosed(api, wire)) return undefined
  let face: BrepHandle | undefined
  try {
    face = api.makeFace(wire)
    const area = api.getSurfaceArea(face)
    return Number.isFinite(area) && area > 0 ? area : undefined
  } catch {
    return undefined
  } finally {
    if (face !== undefined) {
      try { api.release(face) } catch { /* 已释放 */ }
    }
  }
}

/** 脊柱的边数——只用于错误信息（"16 edges" 比"某处"更能指向根因）。 */
function spineEdgeCount(api: BrepEngineApi, spine: BrepHandle): number {
  try {
    const edges = api.getSubShapes(spine, 'edge')
    const n = edges.length
    for (const e of edges) {
      try { api.release(e) } catch { /* 已释放 */ }
    }
    return n
  } catch {
    return 0
  }
}

/**
 * 本次调用实际使用的容差：局部参数优先，缺省回落到进程级全局值。
 *
 * 只接受 `(0, 1)`，与 `setSweepVolumeTolerance` 同一契约——放宽是**知情放行**，
 * 不是「关掉守卫」；把几何改对才是修法。
 * @param local - 调用方显式传入的容差（可选）。
 * @returns Effective relative tolerance.
 */
function resolveTolerance(local: number | undefined): number {
  if (local === undefined) return sweepVolumeTolerance
  if (!Number.isFinite(local) || local <= 0 || local >= 1) {
    throw new Error(`E_SWEEP_TOL_INVALID: tolerance must be in (0,1), got ${String(local)}`)
  }
  return local
}

/**
 * 扫掠体积对账。
 *
 * @param api - 引擎面。
 * @param op - op 名（错误码前缀与消息用）。
 * @param profileArea - 已算好的截面积；`undefined` ⇒ 跳过（开放/非平面/面积非正）。
 * @param spine - 脊柱 wire（量长度、数边数）。
 * @param result - 扫掠产物（量体积）。
 * @param volumeTolerance - 本次调用的相对容差 `(0,1)`；缺省用进程级全局值（5%）。
 * @throws OpError `E_SWEEP_VOLUME_MISMATCH` 当相对偏差超过容差。
 */
export function assertSweptVolumeMatches(
  api: BrepEngineApi,
  op: string,
  profileArea: number | undefined,
  spine: BrepHandle,
  result: BrepHandle,
  volumeTolerance?: number,
): void {
  if (profileArea === undefined) return
  const tolerance = resolveTolerance(volumeTolerance)
  let spineLength: number
  let actual: number
  try {
    spineLength = api.getLength(spine)
    actual = api.getVolume(result)
  } catch {
    return
  }
  const expected = profileArea * spineLength
  if (!Number.isFinite(expected) || expected <= 0) return
  if (!Number.isFinite(actual)) return

  const rel = Math.abs(actual - expected) / expected
  if (rel <= tolerance) return

  const edges = spineEdgeCount(api, spine)
  const pct = (rel * 100).toFixed(1)
  throw new OpError(
    op,
    'E_SWEEP_VOLUME_MISMATCH',
    `[api/${op}] swept volume does not match section area × spine length: ` +
      `expected ${expected.toFixed(2)} (= ${profileArea.toFixed(2)} × ${spineLength.toFixed(3)}), ` +
      `actual ${actual.toFixed(2)} (${pct}% off, tolerance ${(tolerance * 100).toFixed(0)}%). ` +
      `spine has ${edges} edge(s) — a polyline spine loses solid volume at every corner ` +
      `(measured: 2/π for a densely sampled arc, 1/2 for a single 90° bend). ` +
      `Use a single straight segment, or a single true arc. ` +
      `A true-arc spine is written as cad.wireFromEdges([cad.circleArc(...)]) — ` +
      `circleArc yields one edge, and wireFromEdges accepts a single edge (widened 2026-11-14). ` +
      `If a coarse sweep is genuinely intended, pass opts.volumeTolerance (per call) or use ` +
      `setSweepVolumeTolerance() (process-wide). Raising it does NOT fix the geometry.`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * 旋转产物的零厚度判定。
 *
 * `revolve` 对**截面平面不含旋转轴**的轮廓扫出的是二维区域：`getVolume` 为 0，
 * `shapeType` 仍报 `'solid'`（实测，见 probe §P3），所以只能用体积/厚度判，
 * 不能用类型判。
 *
 * @param api - 引擎面。
 * @param op - op 名。
 * @param result - 旋转产物。
 * @throws OpError `E_REVOLVE_ZERO_THICKNESS` 当体积为 0 或包围盒某向为 0。
 */
export function assertNotZeroThickness(api: BrepEngineApi, op: string, result: BrepHandle): void {
  let volume: number
  let box: { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }
  try {
    volume = api.getVolume(result)
    box = api.getBoundingBox(result) as unknown as typeof box
  } catch {
    return
  }
  const sizes = [box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin]
  const flat = sizes.some((s) => !Number.isFinite(s) || Math.abs(s) <= 1e-9)
  if (Number.isFinite(volume) && volume > 1e-9 && !flat) return

  throw new OpError(
    op,
    'E_REVOLVE_ZERO_THICKNESS',
    `[api/${op}] revolve produced a zero-thickness result (volume=${volume}, bbox size=[${sizes
      .map((s) => s.toFixed(3))
      .join(', ')}]). ` +
      `The section plane does not contain the rotation axis: when the axis is perpendicular to ` +
      `the section plane, the section merely spins inside its own plane and never sweeps a volume. ` +
      `Put the section on a plane that CONTAINS the axis ` +
      `(e.g. a profile in XZ revolved about Z works; a profile in XY revolved about Z does not). ` +
      `shapeType alone will not catch this — it still reports 'solid'.`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 判据套件 C1–C3（C4 前置拒绝在 spine-analysis / sweep-strategy 里）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 端面法向容差：1°。
 *
 * 落位正确时实测偏差在 1e-7 量级；15° 塌陷的 |dot| 是 cos15° = 0.966（差 15°），
 * cos1° = 0.99985 有充分余量，又不会因数值噪声误报。
 */
export const CAP_NORMAL_TOL = (1 * Math.PI) / 180
const COS_CAP_NORMAL_TOL = Math.cos(CAP_NORMAL_TOL)

/** 判据失败/降级时对外发的通知（`strict:false` 用）。 */
export interface SweepNotice {
  op: string
  code: string
  message: string
}

let sweepNoticeHook: ((n: SweepNotice) => void) | undefined

/**
 * 注册「非严格模式」的通知接收器。
 *
 * 为什么用钩子而不是 `console.warn`：仓库对 stderr 零容忍，库层不该自己往控制台
 * 写东西；需要看通知的宿主（CLI / 编辑器）自己订阅。
 * @param fn - 接收器；`undefined` 取消订阅。
 */
export function setSweepNoticeHook(fn: ((n: SweepNotice) => void) | undefined): void {
  sweepNoticeHook = fn
}

/** 一个端面检查点：脊柱某一端的端点位置与切向。 */
export interface CapCheck {
  /** 诊断用标签（'start' / 'end'）。 */
  label: string
  /** 脊柱该端的端点（截面居中时它就落在端面内部）。 */
  point: BrepVec3
  /** 该端的单位切向。 */
  tangent: BrepVec3
}

/** 判据套件的入参。 */
export interface SweepGuardContext {
  /** 扫掠产物。 */
  result: BrepHandle
  /** 脊柱 wire：C1 量长度、C3 取包围盒。 */
  spine: BrepHandle
  /** C1：截面积（带孔面传净面积）。`undefined` ⇒ 跳过 C1（开放 / 非平面 / 壳产物）。 */
  profileArea?: number
  /** C1 的相对容差；缺省用进程级全局值（5%）。 */
  volumeTolerance?: number
  /** C2：端面检查点；`undefined` ⇒ 跳过 C2（闭合扫掠、壳产物、截面未落位）。 */
  caps?: CapCheck[]
  /**
   * C3：是否检查「产物覆盖整条脊柱」。默认 false。
   *
   * 前提是截面已经落在路径上：截面整体偏移时管整体挪位（体积仍对、位置错），
   * 那是落位问题（`autoPlace` / `sweepAlong`），不是「丢料」。所以只有调用方
   * 确认落位之后才打开这条判据。
   */
  coversPath?: boolean
  /** 进错误消息的脊柱事实串（`describeSpine` 的产物），让报错自带上下文。 */
  spineNote?: string
  /** `false` ⇒ C2/C3 降级为通知（C1 仍抛）；默认 true。 */
  strict?: boolean
}

interface BoxLike {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  zmin: number
  zmax: number
}

function vecText(p: BrepVec3): string {
  return `(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`
}

function bboxContains(b: BoxLike, p: BrepVec3, eps: number): boolean {
  return (
    p.x >= b.xmin - eps && p.x <= b.xmax + eps &&
    p.y >= b.ymin - eps && p.y <= b.ymax + eps &&
    p.z >= b.zmin - eps && p.z <= b.zmax + eps
  )
}

/**
 * 收集「包围盒含该点」的全部平面面的外法向。
 *
 * 为什么是**全部**而不是第一个：脊柱端点常常正好落在产物的角点上，此时三个面的
 * bbox 都含它（端面 + 两个侧面），取第一个会随机拿到侧面，于是 90° 的假失败。
 * 判据要问的是「有没有一个面朝着切向」，所以候选必须全取回来再挑。
 *
 * 方向修正：occt 的 `surfaceNormal` 不保证外法向，`shapeOrientation === 'reversed'`
 * 时取反。**读不到朝向的引擎（smlib 的 `shapeOrientation` 是 unsupported）不能因此
 * 整面丢弃** —— C2 判的是 `|dot|`，法向整体取反不改变结论；朝向读不出来时保留原法向
 * 即可。（曾经的实现把 `shapeOrientation` 放在同一个 try 里，smlib 上每个面都在
 * 第一行抛错被跳过 ⇒ normals 恒空 ⇒ C2 静默失效。）
 */
function planarNormalsNear(
  api: BrepEngineApi,
  faces: BrepHandle[],
  point: BrepVec3,
  eps: number,
): BrepVec3[] {
  const out: BrepVec3[] = []
  for (const face of faces) {
    try {
      if (String(api.surfaceType(face)).toLowerCase() !== 'plane') continue
      if (!bboxContains(api.getBoundingBox(face) as unknown as BoxLike, point, eps)) continue
      const uv = api.uvBounds(face)
      const n = api.surfaceNormal(face, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
      if (Math.hypot(n.x, n.y, n.z) < 1e-12) continue
      let reversed = false
      try {
        reversed = String(api.shapeOrientation(face)).toLowerCase() === 'reversed'
      } catch {
        // 引擎未实现朝向查询：保留原法向（C2 用 |dot|，符号无关）。
      }
      out.push(reversed ? { x: -n.x, y: -n.y, z: -n.z } : n)
    } catch {
      continue
    }
  }
  return out
}

/**
 * C2：端面法向必须与脊柱端点切向平行（|dot| ≥ cos 1°）。
 *
 * 专抓「截面没转」的塌陷：15° 折角的体积只偏 1.70%，C1 放行；但端面法向仍是原始
 * 截面法向，与端点切向差 15°，这里直接暴露（实测 K4a / K6b）。
 *
 * 找不到平面端面时返回 `undefined`（跳过），不猜。
 */
function capNormalFailure(
  api: BrepEngineApi,
  op: string,
  result: BrepHandle,
  caps: CapCheck[],
): { code: string; message: string } | undefined {
  let faces: BrepHandle[]
  let block: BoxLike
  try {
    const volume = api.getVolume(result)
    // 壳（wire 截面产物）没有实体体积，也没有端面。
    if (!Number.isFinite(volume) || volume <= 0) return undefined
    block = api.getBoundingBox(result) as unknown as BoxLike
    faces = api.getSubShapes(result, 'face')
  } catch {
    return undefined
  }
  const diag = Math.hypot(block.xmax - block.xmin, block.ymax - block.ymin, block.zmax - block.zmin)
  const eps = 1e-6 * diag + 1e-9
  try {
    for (const cap of caps) {
      const tl = Math.hypot(cap.tangent.x, cap.tangent.y, cap.tangent.z)
      if (tl < 1e-12) continue
      const normals = planarNormalsNear(api, faces, cap.point, eps)
      if (normals.length === 0) continue
      // 只要**有一个**面朝着切向，这个端就成立（端点常落在角点上，侧面也在候选里）。
      let best = { n: normals[0]!, c: 0 }
      for (const n of normals) {
        const nl = Math.hypot(n.x, n.y, n.z)
        const c = Math.abs((n.x * cap.tangent.x + n.y * cap.tangent.y + n.z * cap.tangent.z) / (nl * tl))
        if (c > best.c) best = { n, c }
      }
      if (best.c >= COS_CAP_NORMAL_TOL) continue
      const n = best.n
      const c = best.c
      const deg = (Math.acos(Math.min(1, c)) * 180) / Math.PI
      return {
        code: 'E_SWEEP_CAP_NORMAL',
        message:
          `[api/${op}] the ${cap.label} cap does not face the spine tangent at that end: ` +
          `cap normal ${vecText(n)} vs tangent ${vecText(cap.tangent)}, off by ${deg.toFixed(2)}° ` +
          `(tolerance ${CAP_NORMAL_TOL * (180 / Math.PI)}°). ` +
          `A cap that does not face the tangent means the section never rotated along the path — ` +
          `the solid is a translated slab, not a swept tube. This is a geometry error, not a tolerance ` +
          `issue: widening volumeTolerance will only hide it. Fix it with cad.sweepAlong (which places ` +
          `the section and picks the corner transition), or pass withContact + withCorrection yourself.`,
      }
    }
    return undefined
  } finally {
    for (const f of faces) {
      try { api.release(f) } catch { /* 已释放 */ }
    }
  }
}

/**
 * C3：产物包围盒必须包含脊柱包围盒。
 *
 * 只做廉价粗筛，抓「整段丢失 / 产物被截断」（混合边类型实测少一条腿：z 跨度 16 vs 26）。
 * 它不承担主要判据——体积对得上但 bbox 缺一块的组合才靠它。
 */
function bboxFailure(
  api: BrepEngineApi,
  op: string,
  result: BrepHandle,
  spine: BrepHandle,
): { code: string; message: string } | undefined {
  let out: BoxLike
  let sp: BoxLike
  try {
    out = api.getBoundingBox(result) as unknown as BoxLike
    sp = api.getBoundingBox(spine) as unknown as BoxLike
  } catch {
    return undefined
  }
  const diag = Math.hypot(sp.xmax - sp.xmin, sp.ymax - sp.ymin, sp.zmax - sp.zmin)
  const eps = 1e-6 * diag + 1e-9
  const inside =
    sp.xmin >= out.xmin - eps && sp.xmax <= out.xmax + eps &&
    sp.ymin >= out.ymin - eps && sp.ymax <= out.ymax + eps &&
    sp.zmin >= out.zmin - eps && sp.zmax <= out.zmax + eps
  if (inside) return undefined
  const span = (b: BoxLike): string =>
    `${(b.xmax - b.xmin).toFixed(3)}×${(b.ymax - b.ymin).toFixed(3)}×${(b.zmax - b.zmin).toFixed(3)}`
  return {
    code: 'E_SWEEP_BBOX_MISMATCH',
    message:
      `[api/${op}] the swept body does not cover the spine: spine bbox ${span(sp)} ` +
      `[${vecText({ x: sp.xmin, y: sp.ymin, z: sp.zmin })} .. ${vecText({ x: sp.xmax, y: sp.ymax, z: sp.zmax })}], ` +
      `result bbox ${span(out)}. Part of the path produced no material — typically a mixed-kind ` +
      `multi-edge spine losing a leg (measured: one straight leg vanishes entirely). ` +
      `Use cad.sweepAlong, which splits such spines into segment-wise sweeps.`,
  }
}

/**
 * C1 + C2 + C3 的合并入口。
 *
 * 执行顺序：C1（体积恒等式）→ C2（端面法向）→ C3（包围盒包含）。任一判据的输入
 * 不成立（面积未知、找不到平面端面）就跳过它自己，其余照判。
 *
 * @param api - 引擎面。
 * @param op - op 名（错误码前缀与消息用）。
 * @param ctx - 见 {@link SweepGuardContext}。
 * @throws OpError `E_SWEEP_VOLUME_MISMATCH`（C1）/ `E_SWEEP_CAP_NORMAL`（C2）/
 *         `E_SWEEP_BBOX_MISMATCH`（C3）。`strict:false` 时 C2/C3 降为通知，C1 仍抛。
 */
export function assertSweepResult(api: BrepEngineApi, op: string, ctx: SweepGuardContext): void {
  // C1：永远抛——体积错就是几何错，没有「知情放行」以外的语义。
  assertSweptVolumeMatches(api, op, ctx.profileArea, ctx.spine, ctx.result, ctx.volumeTolerance)

  const strict = ctx.strict
  const checks: { code: string; message: string }[] = []
  if (ctx.caps !== undefined) {
    const f = capNormalFailure(api, op, ctx.result, ctx.caps)
    if (f !== undefined) checks.push(f)
  }
  if (ctx.coversPath === true) {
    const b = bboxFailure(api, op, ctx.result, ctx.spine)
    if (b !== undefined) checks.push(b)
  }

  if (checks.length === 0) return
  if (strict === false) {
    if (sweepNoticeHook !== undefined) {
      for (const c of checks) {
        try { sweepNoticeHook({ op, code: c.code, message: c.message }) } catch { /* 订阅方异常不外溢 */ }
      }
    }
    return
  }
  const first = checks[0]!
  const extra = checks.length > 1 ? ` (+${checks.length - 1} more post-condition failure(s))` : ''
  throw new OpError(op, first.code, first.message + extra)
}
