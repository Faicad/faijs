/**
 * api extrude — `cad.extrude`（平台 parity op，BREP-only）
 *
 * 归属（分层红线）：`cad.extrude` 是「面 → 棱柱」的**平台** op，FCStd Pad/Pocket
 * 链路与 TS 面共用它（原 `cad.fai_extrude` 路线废弃）。up-to（拉伸到面 / 到支持体端面）属
 * CadQuery `until=` 同族语义，因此落在**本 op**；`fai_extrude`（`fai_` 前缀的
 * faijs 扩展 op，与 fai_drill / fai_split 同族）不得承载它。
 *
 * 为什么是手写 op 而不是继续用生成投影：生成投影是一条 1:1 转发通道
 * （`defineOp({ brep: __own_* })` 直连 api/brep-operations/ 的源函数），有两个硬约束——
 * ① 参数表只有位置形参；D11 归一化只在「单 plain-object 形态」下按 params 表
 *    映射（api/internal/dual-form-args.ts），`(face, { upTo })` 属位置形态 →
 *    原样喂给 compat extrude → 报错，无法表达对象形态；
 * ② 生成投影没有 faijs 侧入参解析挂点，只把实参原样转发给源函数 → 依赖 faceRef 解析 /
 *    内核直调（extrudeUpToSolid）的 up-to 实现无法在生成投影里承载，落回本手写模块。
 * 先例：arg-spec 的 `fillet` 条目（faijs 侧由手写 dual-op 覆盖，生成模块符号为
 * 孤儿 by design）。
 *
 * 长度形态**委托给生成投影**（`projectedExtrude`）：compat 投影仍是唯一拉伸引擎，
 * 既有 `cad.extrude(face, [x,y,z])` 语义零漂移。
 */

import { extrude as projectedExtrude } from './generated/operations'
import { Vec3 as Vec3C } from '../math3d'
import { solidToShape } from '../brep/brep-ops'
import { getSolidBoundingBox } from '../brep/brep-utils'
import { getCurrentStmt, getBackends, MeshUnsupportedError } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, brepOf, isCurveShape } from '../shape'
import { runtimeLineage } from '../topology/naming/lineage'
import { formatRoleName, semantic, wall } from '../topology/naming/role-name'
import type { Provenance } from '../topology/naming/lineage'
import { defineOp } from '../sdk'
import { OpError } from './internal/result-unwrap'
import { assertPositiveNumber } from './assert'
import { meshFaceEntry, meshKernelFailure, meshSolidProductWithBackend } from './internal/mesh-solid-op'
import { normalizeUpToTarget, clipByUpToPlane } from './up-to'
import type { Shape, Vec3 } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { FaceTopoRef } from '../topology/naming'

/**

 * extrude 的 construct 词汇表（计划 §4.4）：`cap:bottom` / `cap:top` / `wall:<i>`。
 *
 * 判定口径：
 * - 拉伸方向**优先由 op 给出**（`hintAxis`），但必须由现场几何裁定：只有当至少
 *   两张面的法向与该方向 |cos| ≈ 1 时才采信，否则回退到纯几何判定（A2，见下）；
 * - 面法向与拉伸轴 |cos| ≈ 1 → 端面：中心沿轴分量小者 `cap:bottom`、大者 `cap:top`；
 * - 面法向与拉伸轴 |cos| ≈ 0 → 侧面 `wall:<i>`，i = 该面在侧面枚举中的相对序
 *   （OCCT prism 的侧面顺序 = profile wire 的边序——makeWire 按构造顺序收边，
 *   prism 不重排；G3-L1 改参重放依赖该稳定性）；
 * - 侧面含**非平面**（profile 里的弧段扫出圆柱面）同样进表：圆柱面 uv 中点法向
 *   是径向，与拉伸轴垂直，判定与平面侧面同式。
 *
 * @param kernel - the OCCT kernel.
 * @param solid - the extruded solid.
 * @param hintAxis - 拉伸方向（op 已知；仅作候选，由现场几何确认）。
 * @returns role（线格式串）→ hash 子表。
 */
function extrudeConstructRoles(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  hintAxis?: readonly [number, number, number],
): Map<string, number[]> {
  const roles = new Map<string, number[]>()
  const faceHandles = kernel.getSubShapes(solid, 'face')
  try {
    const hashes = kernel.subShapeHashes(solid, 'face', 2147483647)
    // A2 (2026-09-26, Beds.FCStd): 侧面可能是**圆柱面**——profile 含弧段时，该弧
    // 沿拉伸方向扫出的就是一个圆柱侧面。旧实现只在 `surfaceType === 'plane'` 时
    // 取法向，于是圆柱侧面 normals[i] === undefined：既拿不到 `wall:<i>`，还让
    // `wallIdx` 跳过它们 —— wall 序号因此不再是 profile 边序（违反 role-name.ts
    // 的契约「wall:3 = 由 profile 第 3 条边扫出」）。实测 Beds part28（轮廓含 4
    // 段弧）10 面只覆盖 6 个（缺序号 2/4/6/8），下游 fillet 的 `cad.edgeRef`
    // 遂抛 `edgeRef: adjacent face ordinal 2 has no role lineage`。
    // 圆柱面 uv 中点的法向是径向、与拉伸轴垂直（|cos| ≈ 0），可直接用于侧面判定。
    const planar = faceHandles.map((f) => kernel.surfaceType(f) === 'plane')
    const normals: (readonly [number, number, number])[] = faceHandles.map((f) => {
      const uv = kernel.uvBounds(f)
      const n = kernel.surfaceNormal(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
      return [n.x, n.y, n.z] as const
    })
    const centers = faceHandles.map((f) => {
      const c = kernel.surfaceCenterOfMass(f)
      return [c.x, c.y, c.z] as const
    })

    // 拉伸轴：op 已知的拉伸方向优先（须由现场几何确认），否则找一对
    // |cos| ≈ 1 的反平行平面法向 → 带符号单位方向。
    //
    // A2 (2026-09-26, Beds.FCStd part28): 纯几何判定取「第一对反平行的平面法向」，
    // 但方形类轮廓的**一对对侧平面侧壁同样反平行**——Beds 的柱子于是把 X 向侧壁
    // 判成端盖、把真正的 Z 向端盖当成 wall，4 个圆柱侧面彻底无名（10 面只覆盖 6，
    // 缺序号 2/4/6/8），下游 fillet 的 `cad.edgeRef` 抛
    // `edgeRef: adjacent face ordinal 2 has no role lineage`。方向由 op 给出、
    // 由几何裁定（至少两张面法向与该方向 |cos| ≈ 1 才采信），两者缺一不可。
    let axis: readonly [number, number, number] | undefined
    const hintLen = hintAxis ? Math.hypot(hintAxis[0], hintAxis[1], hintAxis[2]) : 0
    if (hintAxis && hintLen > 1e-9) {
      const d: readonly [number, number, number] = [
        hintAxis[0] / hintLen, hintAxis[1] / hintLen, hintAxis[2] / hintLen,
      ]
      const aligned = normals.filter((n) => {
        const len = Math.hypot(n[0], n[1], n[2])
        if (len < 1e-9) return false
        return Math.abs((n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / len) > 0.999
      })
      if (aligned.length >= 2) axis = d
    }
    for (let i = 0; i < normals.length && !axis; i++) {
      // 端面必须是一对反平行的**平面**法向（棱柱的端盖恒为平面）。
      if (!planar[i]) continue
      const a = normals[i]
      if (!a) continue
      for (let j = i + 1; j < normals.length; j++) {
        if (!planar[j]) continue
        const b = normals[j]
        if (!b) continue
        const lenA = Math.hypot(a[0], a[1], a[2])
        const lenB = Math.hypot(b[0], b[1], b[2])
        if (lenA < 1e-9 || lenB < 1e-9) continue
        const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (lenA * lenB)
        if (Math.abs(cos) > 0.999) {
          // b 反向即「从 i 面指向 j 面」的方向
          axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
          break
        }
      }
    }
    const axisLen = axis ? Math.hypot(axis[0], axis[1], axis[2]) : 0
    if (axis && axisLen > 1e-9) {
      const ax: readonly [number, number, number] = [axis[0] / axisLen, axis[1] / axisLen, axis[2] / axisLen]
      // 端面：沿轴投影最小者 = cap:bottom，最大者 = cap:top
      const capCandidates: { idx: number; t: number }[] = []
      for (let i = 0; i < normals.length; i++) {
        if (!planar[i]) continue
        const n = normals[i]
        if (!n) continue
        const len = Math.hypot(n[0], n[1], n[2]) || 1
        const cos = Math.abs(n[0] * ax[0] + n[1] * ax[1] + n[2] * ax[2]) / len
        if (cos > 0.999) {
          capCandidates.push({ idx: i, t: centers[i]![0] * ax[0] + centers[i]![1] * ax[1] + centers[i]![2] * ax[2] })
        }
      }
      if (capCandidates.length >= 2) {
        capCandidates.sort((p, q) => p.t - q.t)
        const bottom = capCandidates[0]!
        const top = capCandidates[capCandidates.length - 1]!
        // 端面词汇用 semantic（'bottom'/'top'——与 box 同形）。计划 §4.4 写的
        // `cap:<name>` 前缀形态与 RoleName 契约冲突（semantic 名不允许 ':'，
        // role-name.ts SEMANTIC_NAME_RE），落地以契约为准：semantic 直名。
        if (hashes[bottom.idx] !== undefined) roles.set(formatRoleName(semantic('bottom')), [hashes[bottom.idx]!])
        if (hashes[top.idx] !== undefined) roles.set(formatRoleName(semantic('top')), [hashes[top.idx]!])
      }
      // 侧面：|cos| ≈ 0，按枚举序编号（= profile 边序）。平面/圆柱侧面一律进表
      // （A2）——跳过圆柱侧面会让 wall 序号脱离 profile 边序。
      let wallIdx = 0
      for (let i = 0; i < normals.length; i++) {
        const n = normals[i]
        if (!n || hashes[i] === undefined) continue
        const len = Math.hypot(n[0], n[1], n[2]) || 1
        const cos = Math.abs(n[0] * ax[0] + n[1] * ax[1] + n[2] * ax[2]) / len
        if (cos < 0.001) {
          roles.set(formatRoleName(wall(wallIdx)), [hashes[i]!])
          wallIdx++
        }
      }
    }
    return roles
  } finally {
    for (const h of faceHandles) {
      try { kernel.release(h) } catch { /* 已释放 */ }
    }
  }
}

/** 显式平面目标（up-to 截断面）：点 + 法向（点在平面上即可，无需共面于面边界）。 */
export interface UpToPlaneSpec {
  /** 平面上一点（世界坐标）。type:[x,y,z] */
  point: Vec3
  /** 平面法向（世界坐标，方向仅定半空间语义，截断取两侧之一）。type:[x,y,z] */
  normal: Vec3
}

/** up-to 目标：显式面引用 / 显式平面 / 支持体沿拉伸方向的远端（last）/近端（first）端面 /
 * CadQuery 面选择器字符串（在 baseFeature 上解析，如 `">Z"`，多面命中抛错）。 */
export type ExtrudeUpTo = FaceTopoRef | 'last' | 'first' | 'next' | { plane: UpToPlaneSpec } | string

/** `cad.extrude` 的对象形态参数（位置形态由 {@link normalizeExtrudeOptions} 归一到这里）。 */
export interface ExtrudeOptions {
  /** 拉伸量（mm，>0）。up-to 模式下无需给。 */
  length?: number
  /** 拉伸方向（世界坐标）；缺省 [0,0,1]。 */
  normal?: Vec3
  /** 沿 normal 的前进方向；缺省 'forward'（'backward' 等价于方向取反）。 */
  mode?: 'forward' | 'backward'
  /** 负向长度（mm，≥0，缺省 0 = 单向，现状不变）。>0 时与 length 组成双向拉伸：
   * 沿 normal 正向 length、反向 backwardLength，输入面成为棱柱的**内部平面**（非端面）。
   * 与 `mode:'backward'`（仅反向）及 `upTo` 互斥（assertExtrudeOptions 显式抛错）。 */
  backwardLength?: number
  /** 拉伸到面 / 到支持体端面；提供时忽略 length。字符串 `'last'`/`'first'` 取支持体端面，
   * `'next'` 取沿方向遇到的下一个面（面中心投影近似）；其它字符串为 CadQuery 面选择器
   * （在 baseFeature 上解析，多面命中抛错）。 */
  upTo?: ExtrudeUpTo
  /** upTo 目标的支持体（累积支持体，由转换器显式传入）。 */
  baseFeature?: Shape
  /** 截断面沿其法向的偏移（mm）；缺省 0。 */
  offset?: number
  /** 组合方式：'union'（缺省，产出拉伸实体）/ 'cut'（拉伸体作为刀具从 baseFeature 减去，需给 baseFeature）。 */
  combine?: 'union' | 'cut'
  /** 负向 up-to 目标：与正向 upTo 组成双向到面拉伸；与 backwardLength 互斥。 */
  backwardUpTo?: ExtrudeUpTo
}

/** 判定是否为朴素对象（对象形态判别器，避免误吞 Shape / 数组）。 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
}

/**
 * 归一化 `cad.extrude` 的两种调用形态。
 *
 * - 位置形态（与生成投影同款，历史产物在用）：`cad.extrude(face, 10)` /
 *   `cad.extrude(face, [x,y,z])`——向量即「方向 × 长度」，恒为沿该方向前进。
 * - 对象形态（faijs 面）：`cad.extrude(face, { length, normal, mode, upTo, ... })`。
 *
 * @param params - 调用点第二实参（数字 / 向量 / 对象）。
 * @returns 归一化后的对象形态参数。
 * @throws Error 参数既非数字 / 向量 / 朴素对象时（不猜）。
 */
function normalizeExtrudeOptions(params: unknown): ExtrudeOptions {
  if (isPlainObject(params)) return params as ExtrudeOptions
  if (Array.isArray(params)) {
    const v = params as Vec3
    const len = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0)
    if (!Number.isFinite(len) || len < 1e-12) {
      throw new Error('E_EXTRUDE_ZERO_VECTOR: extrude direction vector has zero length')
    }
    return { length: len, normal: [v[0] / len, v[1] / len, v[2] / len], mode: 'forward' }
  }
  if (typeof params === 'number') return { length: params, normal: [0, 0, 1], mode: 'forward' }
  throw new Error('E_EXTRUDE_BAD_PARAMS: extrude expects (face, number | [x,y,z] | { length | upTo, ... })')
}

/**
 * 参数自校验：up-to 模式下无需 length；否则 length 必须为正数。
 * `backwardLength`（双向负向长度）：≥0；>0 时与 `mode:'backward'`、`upTo` 互斥
 * （双向语义与「仅反向」/「拉伸到面」不可叠加，显式抛错、不静默降级）。
 *
 * @param o - 归一化后的参数。
 */
function assertExtrudeOptions(o: ExtrudeOptions): void {
  const back = o.backwardLength ?? 0
  if (back < 0) {
    throw new OpError(
      'extrude',
      'E_EXTRUDE_BACKWARD_NEGATIVE',
      `[api/extrude] backwardLength must be >= 0, got ${back}`,
    )
  }
  if (back > 0 && o.mode === 'backward') {
    throw new OpError(
      'extrude',
      'E_EXTRUDE_BACKWARD_CONFLICT',
      '[api/extrude] backwardLength cannot be combined with mode:"backward" — bidirectional and reverse-only are mutually exclusive',
    )
  }
  if (o.backwardUpTo !== undefined) {
    if (back > 0) {
      throw new OpError(
        'extrude',
        'E_EXTRUDE_BACKWARD_UPTO',
        '[api/extrude] E_EXTRUDE_BACKWARD_UPTO: backwardLength is mutually exclusive with backwardUpTo',
      )
    }
    if (o.mode === 'backward') {
      throw new OpError(
        'extrude',
        'E_EXTRUDE_BACKWARD_CONFLICT',
        '[api/extrude] E_EXTRUDE_BACKWARD_CONFLICT: backwardUpTo cannot be combined with mode:"backward"',
      )
    }
  }
  if (o.combine === 'cut') {
    if (o.baseFeature === undefined) {
      throw new OpError(
        'extrude',
        'E_EXTRUDE_CUT_NO_BASE',
        '[api/extrude] E_EXTRUDE_CUT_NO_BASE: combine:"cut" requires a baseFeature shape',
      )
    }
    if (o.upTo === undefined && o.backwardUpTo === undefined) {
      throw new OpError(
        'extrude',
        'E_EXTRUDE_CUT_REQUIRES_UPTO',
        '[api/extrude] E_EXTRUDE_CUT_REQUIRES_UPTO: combine:"cut" requires upTo or backwardUpTo (cutting a fixed-length prism is not supported)',
      )
    }
  }
  if (o.upTo !== undefined) {
    if (back > 0) {
      throw new OpError(
        'extrude',
        'E_EXTRUDE_BACKWARD_UPTO',
        '[api/extrude] backwardLength is mutually exclusive with upTo',
      )
    }
    return // up-to 模式：长度由目标面决定
  }
  if (o.backwardUpTo === undefined) assertPositiveNumber(o.length, 'extrude.length')
}



/**
 * up-to extrusion: delegate to the shared api/up-to module. The geometry and
 * error-code contract are unchanged; this thin adapter maps the hand-written
 * op options onto the shared termination-plane machinery so drill / pocket /
 * punch-hole can reuse exactly the same target semantics.
 *
 * @param kernel - BREP kernel.
 * @param inputSolid - profile solid handle.
 * @param o - normalized options (upTo set).
 * @returns the trimmed solid handle.
 * @throws Error E_UP_TO_* on missing base / parallel direction / no intersection.
 */
function extrudeUpToSolid(kernel: BrepEngineApi, inputSolid: BrepHandle, o: ExtrudeOptions): BrepHandle {
  const normal = new Vec3C(...(o.normal ?? [0, 0, 1])).normalize()
  const bb = getSolidBoundingBox(kernel, inputSolid)
  const origin: Vec3 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2]
  return clipByUpToPlane(kernel, inputSolid, normalizeUpToTarget(o.upTo), {
    kernel,
    base: o.baseFeature,
    origin,
    direction: [normal.x, normal.y, normal.z],
    offset: o.offset,
  })
}

/**
 * combine:'cut' — subtract a freshly built cutter solid from the base feature.
 * Returns the base Shape with the cut result; throws when base has no BREP solid.
 */
function cutFromBase(kernel: BrepEngineApi, cutter: BrepHandle, base: Shape): Shape {
  const baseSolid = brepOf(base) as BrepHandle | undefined
  if (baseSolid === undefined) throw new Error('E_EXTRUDE_CUT_NO_BASE: combine:"cut" baseFeature is not BREP')
  const cut = kernel.cut(baseSolid, cutter)
  kernel.release(cutter)
  return fromBrep(solidToShape(kernel, cut), { solid: cut })
}

/**
 * Bidirectional up-to extrusion (正向 upTo/length + 负向 backwardUpTo):
 * each side is clipped to its own target plane, then fused. The profile face
 * becomes an internal plane of the result.
 */
function extrudeBidirectionalUpTo(
  kernel: BrepEngineApi,
  inputSolid: BrepHandle,
  o: ExtrudeOptions,
  normal: Vec3C,
): BrepHandle {
  const backO: ExtrudeOptions = {
    ...o,
    upTo: o.backwardUpTo,
    baseFeature: o.baseFeature,
    normal: [-normal.x, -normal.y, -normal.z],
  }
  const forward = o.upTo !== undefined
    ? extrudeUpToSolid(kernel, inputSolid, o)
    : (() => {
        const L = o.length!
        return kernel.extrude(inputSolid, normal.x * L, normal.y * L, normal.z * L)
      })()
  const backward = extrudeUpToSolid(kernel, inputSolid, backO)
  const fused = kernel.fuse(forward, backward)
  kernel.release(forward)
  kernel.release(backward)
  return fused
}

/**
 * `cad.extrude` 的**网格链**实现（方案 2026-10-01 §4 Phase 3-2）。
 *
 * 输入是一张**网格链面**（`cad.sketchOnFace` 在近似拓扑面上铺出来的那种），
 * 输出是一个**新的网格零件**——与输入网格实体同链。
 *
 * 只支持"面 + 方向 + 距离"这一支：`upTo` 需要精度链上的求交/裁切（`extrudeUpToSolid`
 * 走 BREP 内核），近似链没有对应能力，故如实拒绝而不是静默退化成普通拉伸——
 * "拉伸到那张面"和"拉伸这么长"是两件不同的事，悄悄替换会让用户拿到一个错的实体。
 *
 * 方向语义与 BREP 侧**完全一致**（同一份 `normalizeExtrudeOptions`）：位置形态
 * `cad.extrude(face, 5)` 沿 +Z，`cad.extrude(face, [x,y,z])` 沿该向量；
 * 缺省法向 `[0,0,1]` 不自动改用面法向——那是两条链共同的行为约定，不在这里分叉。
 *
 * @param input - the mesh-chain face to extrude.
 * @param params - the same positional/object forms the BREP branch accepts.
 * @returns the new mesh solid (a new mesh part).
 * @throws {MeshUnsupportedError} on the mesh path when `upTo` is requested.
 */
function extrudeMeshChain(input: Shape, params: unknown): Shape {
  if (!input) throw new Error('[api/extrude] no input geometry')
  if (isCurveShape(input)) {
    throw new Error(
      'E_EXTRUDE_NEEDS_FACE: extrude requires a 2D face input, got a 1D curve (kind="curve")',
    )
  }
  const entry = meshFaceEntry(input, 'extrude')

  const o = normalizeExtrudeOptions(params)
  assertExtrudeOptions(o)
  if (o.upTo !== undefined) {
    throw new MeshUnsupportedError(
      'E_MESH_SOLID_UNSUPPORTED: extrude upTo is not available on the mesh path — it needs the precision ' +
      'chain to intersect and trim against a target face. Give an explicit length instead',
      getCurrentStmt(),
    )
  }
  if ((o.backwardLength ?? 0) > 0) {
    throw new MeshUnsupportedError(
      'E_MESH_SOLID_UNSUPPORTED: extrude backwardLength is not available on the mesh path — ' +
      'bidirectional extrusion needs the precision chain (translate + extrude). Give a single direction instead',
      getCurrentStmt(),
    )
  }

  const normal = new Vec3C(...(o.normal ?? [0, 0, 1])).normalize()
  const sign = o.mode === 'backward' ? -1 : 1
  const v: Vec3 = [normal.x * o.length! * sign, normal.y * o.length! * sign, normal.z * o.length! * sign]

  let solid: BrepHandle
  try {
    solid = entry.kernel.extrude(entry.face, v[0]!, v[1]!, v[2]!)
  } catch (cause) {
    throw meshKernelFailure(
      'extrude',
      'E_EXTRUDE_FAILED',
      `extruding a mesh-chain face by ${o.length} along [${v.join(', ')}]`,
      cause,
    )
  }
  return meshSolidProductWithBackend(entry.backend, solid)
}

/**
 * 沿 normal 拉伸几何（面 → 棱柱）。
 *
 * up-to 模式（`upTo`）与长度模式（`length`）二选一；长度模式委托生成投影
 * （brepjs extrude 为唯一引擎），up-to 模式走半空间组合。
 *
 * **网格链**（`meshEngines: ['brepkit']`，方案 2026-10-01 §4 Phase 3）：输入是
 * `cad.sketchOnFace` 在网格实体识别面上铺出的网格链面时，本 op 沿同一份方向语义
 * 拉伸出**一个新的网格零件**。网格链上不支持 `upTo`
 * （需精度链求交裁切）——会以 `E_MESH_SOLID_UNSUPPORTED` 明确拒绝，不静默当定长拉伸。
 *
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name extrude
 * @returns Shape 拉伸后的几何。
 * @param input - 目标几何（平面面）。type:Shape required:true
 * @param params.length - 总拉伸量（mm，>0）。up-to 模式下无需给。type:number
 * @param params.normal - 拉伸方向（世界坐标）。type:[x,y,z] 默认 [0,0,1]
 * @param params.mode - 沿 normal 的前进方向：forward 正向 / backward 反向。type:'forward' | 'backward' 默认 'forward'
 * @param params.backwardLength - 负向长度（mm，≥0，缺省 0 = 单向）。>0 时与 length 组成双向拉伸（输入面成为棱柱内部平面）；与 mode:'backward' / upTo 互斥。type:number 默认 0
 * @param params.upTo - 拉伸到面：FaceTopoRef（UI 拾取产物字面量）指定面 / 'last' 支持体远端面 / 'first' 近端面 / 'next' 沿方向遇到的下一个面（面中心投影近似）/ 面选择器字符串（如 ">Z"，在 baseFeature 上解析，多面命中抛错）。提供时忽略 length。❌ 禁止 cad.faceRef 序号。type:'last' | 'first' | 'next' | FaceTopoRef | string
 * @param params.baseFeature - upTo 目标 / combine:'cut' 的支持体几何（累积支持体）。type:Shape
 * @param params.offset - 截断面沿其法向的偏移（mm）。type:number 默认 0
 * @param params.combine - 'union'（缺省，产出拉伸实体）/ 'cut'（拉伸体作刀具从 baseFeature 减去；需 baseFeature 与 upTo/backwardUpTo）。type:'union' | 'cut' 默认 'union'
 * @param params.backwardUpTo - 负向 up-to 目标：与 upTo/length 组成双向到面拉伸；与 backwardLength、mode:'backward' 互斥。type:FaceTopoRef | 'last' | 'first' | 'next' | string
 * @example
 * const p = cad.extrude(part0, [0, 0, 10])
 * const p = cad.extrude(part0, { length: 10 })
 * // upTo 接受 FaceTopoRef（UI 拾取产物字面量）；❌ 禁止 cad.faceRef 序号（跨内核不可移植）
 * const p = cad.extrude(sk, { upTo: pickedUpToFace })
 * const p = cad.extrude(sk, { upTo: 'last', baseFeature: part0 })
 * // AI 生成可写 CadQuery 面选择器字符串（在 baseFeature 上解析）
 * const p = cad.extrude(sk, { upTo: '>Z', baseFeature: part0 })
 */
export const extrude = defineOp({
  name: 'extrude',
  meshEngines: ['brepkit'],
  mesh(input: Shape, params: unknown): Shape {
    return extrudeMeshChain(input, params)
  },
  brep: async (input: Shape, params: unknown): Promise<Shape> => {
    if (!input) throw new Error('[api/extrude] no input geometry')
    // Phase 3 执行前预检：1D 曲线（wire / helix / sketch as:'wire'）不是面，不得落进
    // 内核深层才报「操作失败」——维度不符在调用内核前明确拒绝（1D 判别位 kind='curve'）。
    if (isCurveShape(input)) {
      throw new Error(
        'E_EXTRUDE_NEEDS_FACE: extrude requires a 2D face input, got a 1D curve (kind="curve")',
      )
    }
    const o = normalizeExtrudeOptions(params)
    assertExtrudeOptions(o)
    // A2: 拉伸方向同时是链根建表的候选轴（extrudeConstructRoles 的 hintAxis），
    // 两条路径（定长 / up-to）都要用，故提到分支之前。
    const normal = new Vec3C(...(o.normal ?? [0, 0, 1])).normalize()

    if (o.upTo !== undefined) {
      const kernel = getBrepApi()
      const inputSolid = brepOf(input) as BrepHandle | undefined
      if (inputSolid === undefined) throw new Error('[api/extrude] input is not BREP')
      const solid = o.backwardUpTo !== undefined
        ? extrudeBidirectionalUpTo(kernel, inputSolid, o, normal)
        : extrudeUpToSolid(kernel, inputSolid, o)
      if (o.combine === 'cut') return cutFromBase(kernel, solid, o.baseFeature!)
      // E3-b（2026-09-23，同 revolve 修法）：不能对投影产物再走一次 fromBrep——
      // 同语句 registeredStmtId 去重会吞掉第二次登记（part 键保持空表，下游
      // fillet/chamfer 的 edgeRef 报 nameless shape）。upTo 路径不经过投影/
      // adoptOut，fromBrep 只在此走一次，roleTable 直挂 + solid 句柄登记。
      const origin = String(getCurrentStmt()?.id ?? '')
      return fromBrep(solidToShape(kernel, solid), {
        solid,
        roleTable: new Map([[origin, extrudeConstructRoles(kernel, solid, normal.toArray() as Vec3)]]),
      })
    }

    // 长度形态的双向到面（backwardUpTo without upTo）：正向定长 + 负向到面。
    if (o.backwardUpTo !== undefined) {
      const kernel = getBrepApi()
      const inputSolid = brepOf(input) as BrepHandle | undefined
      if (inputSolid === undefined) throw new Error('[api/extrude] input is not BREP')
      const solid = extrudeBidirectionalUpTo(kernel, inputSolid, o, normal)
      if (o.combine === 'cut') return cutFromBase(kernel, solid, o.baseFeature!)
      return fromBrep(solidToShape(kernel, solid), {
        solid,
        roleTable: new Map([[String(getCurrentStmt()?.id ?? ''), extrudeConstructRoles(kernel, solid, normal.toArray() as Vec3)]]),
      })
    }

    // 长度形态：委托生成投影（生成投影自带 Result 翻转 / adopt 收养）
    const sign = o.mode === 'backward' ? -1 : 1
    const back = o.backwardLength ?? 0
    const total = o.length! + back
    let result: Shape
    // 双向（backwardLength > 0；校验已保证 mode==='forward'、无 upTo）：输入面是棱柱的
    // 内部平面。实现：面先沿 −normal·backwardLength 平移，再沿 normal·(length+backwardLength)
    // 拉伸。L1 的 translate + extrude 两引擎（occt / brepkit）都实现，统一走内核；
    // 现状单向两条路径一字不改（backwardLength 缺省 / 0 行为与现在逐字节一致）。
    if (back > 0) {
      const kernel = getBrepApi()
      const faceHandle = brepOf(input) as BrepHandle | undefined
      if (faceHandle === undefined) throw new Error('[api/extrude] bidirectional path: input is not BREP')
      const moved = kernel.translate(faceHandle, -normal.x * back, -normal.y * back, -normal.z * back)
      const solid = kernel.extrude(moved, normal.x * total, normal.y * total, normal.z * total)
      result = fromBrep(solidToShape(kernel, solid), { solid })
    } else {
      const v: Vec3 = [normal.x * o.length! * sign, normal.y * o.length! * sign, normal.z * o.length! * sign]
      // GOTCHA：projectedExtrude 是 occt-gated 的生成投影 op，
      // 在 brepkit 引擎下执行前即抛 E_BREP_UNSUPPORTED。brepkit 有原生 L1 extrude
      // （face→solid），直接走 kernel.extrude——与 revolve.ts 同路径（不经生成投影）。
      // occt 路径保持 projectedExtrude 不变，不回退既有几何/命名行为。
      if (getBackends().config.brepEngineId === 'brepkit') {
        const kernel = getBrepApi()
        const faceHandle = brepOf(input) as BrepHandle | undefined
        if (faceHandle === undefined) throw new Error('[api/extrude] brepkit path: input is not BREP')
        const solid = kernel.extrude(faceHandle, v[0]!, v[1]!, v[2]!)
        result = fromBrep(solidToShape(kernel, solid), { solid })
      } else {
        result = (await projectedExtrude(input, v)) as Shape
      }
    }
    // E3 后续：委托路径同样要建链根表（投影只给几何，命名是 faijs 语义）。
    // E3-b（2026-09-23，同 revolve 修法）：不能对投影产物再走一次 fromBrep——
    // 同语句 registeredStmtId 去重会吞掉第二次登记（part 键保持空表，下游
    // fillet/chamfer 的 edgeRef 报 `input shape has no role table`）。改经
    // runtimeLineage.recordOutput 落语句键表 + part 键权威位。
    // D12（2026-09-24）：取内核走 getBrepApi；引擎未初始化 → 跳过建表（纯 mesh 结果）。
    let kernel: BrepEngineApi | null = null
    try { kernel = getBrepApi() } catch { /* no engine -> skip role table */ }
    const solid = kernel ? (brepOf(result) as BrepHandle | undefined) : undefined
    // D13（2026-10-15）：solid 是 brepkit 0 基句柄，0 是合法实体句柄（首个实体恰为 0）。
    // 必须用 `!== undefined` 判定存在性，禁止真值判断（真值判断在「草图拉伸为首个
    // 实体语句」时跳过登记，下游 fillet/chamfer 的 edgeRef 报 nameless shape）。
    if (kernel && solid !== undefined) {
      const origin = String(getCurrentStmt()?.id ?? '')
      const table = new Map([[origin, extrudeConstructRoles(kernel, solid, normal.toArray() as Vec3)]])
      const part = getCurrentStmt()?.outputs?.[0]
      runtimeLineage.recordOutput(origin as never, table, solid as never, part as never)
    }
    return result
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [{ kind: 'semantic', name: 'top' }, { kind: 'semantic', name: 'bottom' }, { kind: 'wall', index: 0 }] } } as Provenance,

  paramDims: { length: 'length', offset: 'length', backwardLength: 'length', normal: 'plain', backwardUpTo: 'plain' },
})
