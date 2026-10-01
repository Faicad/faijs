/**
 * stdlib extrude — `cad.extrude`（平台 parity op，BREP-only）
 *
 * 归属（分层红线）：`cad.extrude` 是「面 → 棱柱」的**平台** op，FCStd Pad/Pocket
 * 链路与 TS 面共用它（docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md M4.6：
 * 「原 `cad.fai_extrude` 路线废弃」）。up-to（拉伸到面 / 到支持体端面）属
 * CadQuery `until=` 同族语义，因此落在**本 op**；`fai_extrude`（`fai_` 前缀的
 * faijs 扩展 op，与 fai_drill / fai_split 同族）不得承载它。
 *
 * 为什么是手写 op 而不是继续用生成投影：生成投影
 * `compatOp(projectBrepOp('extrude', ['face','height'], 'A', vendoredExtrude))`
 * 有两个硬约束——
 * ① 参数表只有位置形参；D11 归一化只在「单 plain-object 形态」下按 params 表
 *    映射（api/internal/dual-form-args.ts），`(face, { upTo })` 属位置形态 →
 *    原样喂给 vendored extrude → 报错，无法表达对象形态；
 * ② compatOp 的入参先经 `borrowDeep` 借成 brepjs 视图（api/internal/compat-op.ts），
 *    在那一层 `brepOf()` 取不到 → 依赖 faceRef / brepOf / 内核直调的 up-to 实现
 *    必然走空（同 AGENTS.md 记录的「compatOp 自动提升边界」）。
 * 先例：arg-spec 的 `fillet` 条目（faijs 侧由手写 dual-op 覆盖，生成模块符号为
 * 孤儿 by design）。
 *
 * 长度形态**委托给生成投影**（`projectedExtrude`）：vendored 仍是唯一拉伸引擎，
 * 既有 `cad.extrude(face, [x,y,z])` 语义零漂移。
 */

import { extrude as projectedExtrude } from './generated/operations'
import * as THREE from 'three'
import { solidToShape, matrixToArray } from '../brep/brep-ops'
import { getSolidBoundingBox } from '../brep/brep-utils'
import { getCurrentStmt, getBackends, MeshUnsupportedError } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, brepOf, isCurveShape } from '../shape'
import { runtimeLineage } from '../topology/naming/lineage'
import { formatRoleName, semantic, wall } from '../topology/naming/role-name'
import type { Provenance } from '../topology/naming/lineage'
import { defineOp } from '../sdk'
import { assertPositiveNumber } from './assert'
import { meshFaceEntry, meshKernelFailure, meshSolidProductWithBackend } from './internal/mesh-solid-op'
import type { Shape, Vec3 } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { FaceTopoRef } from '../topology/naming'
import { TopoRefError } from '../topology/naming'

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

/** up-to 目标：显式面引用 / 显式平面 / 支持体沿拉伸方向的远端（last）/近端（first）端面。 */
export type ExtrudeUpTo = FaceTopoRef | 'last' | 'first' | { plane: UpToPlaneSpec }

/** `cad.extrude` 的对象形态参数（位置形态由 {@link normalizeExtrudeOptions} 归一到这里）。 */
export interface ExtrudeOptions {
  /** 拉伸量（mm，>0）。up-to 模式下无需给。 */
  length?: number
  /** 拉伸方向（世界坐标）；缺省 [0,0,1]。 */
  normal?: Vec3
  /** 沿 normal 的前进方向；缺省 'forward'（'backward' 等价于方向取反）。 */
  mode?: 'forward' | 'backward'
  /** 拉伸到面 / 到支持体端面；提供时忽略 length。 */
  upTo?: ExtrudeUpTo
  /** upTo 'last'/'first' 的支持体（累积支持体，由转换器显式传入）。 */
  baseFeature?: Shape
  /** 截断面沿其法向的偏移（mm）；缺省 0。 */
  offset?: number
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
 *
 * @param o - 归一化后的参数。
 */
function assertExtrudeOptions(o: ExtrudeOptions): void {
  if (o.upTo !== undefined) return // up-to 模式：长度由目标面决定
  assertPositiveNumber(o.length, 'extrude.length')
}

/** bbox 对角线长度（长试探的余量基数）。 */
function bboxDiag(bbox: { min: Vec3; max: Vec3 }): number {
  return Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2])
}

/**
 * 目标面法向负侧的半空间覆盖盒（截断长拉伸用）——定向版。
 *
 * GOTCHA（PadTest Pad001 斜置基准面实测）：轴对齐盒的边界不是斜面本身，
 * 截断呈台阶而非精确斜平面（体积 7076 vs 真值 4860）。正确做法：在局部基
 * (u, v, n) 里构造盒（深度沿 −n 伸出 R、横向 ±R），再用 kernel.transform
 * 旋到世界系——盒的 n=R 端面就是精确的目标平面。
 *
 * @param kernel - BREP 内核。
 * @param faceCenter - 目标面中心（世界坐标，盒的 n=0 端面过此点）。
 * @param faceNormal - 目标面法向（半空间保留 −n 侧…即盒占据 −n 侧深度）。
 * @param reach - 覆盖半径 R。
 * @returns 定向半空间盒的 brep 句柄。
 */
function farSideBox(kernel: BrepEngineApi, faceCenter: Vec3, faceNormal: Vec3, reach: number): BrepHandle {
  const unit = new THREE.Vector3(...faceNormal).normalize()
  const center = new THREE.Vector3(...faceCenter)
  // 与 n 正交的正交基 u,v
  const aux = Math.abs(unit.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const u = new THREE.Vector3().crossVectors(unit, aux).normalize()
  const v = new THREE.Vector3().crossVectors(unit, u).normalize()
  const R = reach
  // 局部系盒：x∈[−R,R] (u), y∈[−R,R] (v), z∈[−R,0] (n 深度侧)
  const box = kernel.makeBoxFromCorners(
    { x: -R, y: -R, z: -R },
    { x: R, y: R, z: 0 },
  )
  // 旋转矩阵：列 = u, v, n；平移 = center（局部 z=0 端面落到过 center 的目标平面）
  const m = new THREE.Matrix4().makeBasis(u, v, unit).setPosition(center)
  return kernel.transform(box, matrixToArray(m))
}

/**
 * up-to 拉伸：occt-wasm 未暴露 `BRepFeat_MakePrism`，用「长拉伸 → 与目标面侧
 * 半空间盒求交」等价组合；长试探上限只作布尔构造辅助，不进入结果几何。
 *
 * @param kernel - BREP 内核。
 * @param inputSolid - 轮廓实体句柄。
 * @param o - 归一化参数（需带 upTo）。
 * @returns 截断后的实体句柄。
 * @throws Error E_UP_TO_* 系列：缺支持体 / 方向与目标面平行 / 不相交（禁静默）。
 */
function extrudeUpToSolid(kernel: BrepEngineApi, inputSolid: BrepHandle, o: ExtrudeOptions): BrepHandle {
  const normal = new THREE.Vector3(...(o.normal ?? [0, 0, 1])).normalize()
  const offset = o.offset ?? 0
  const upTo = o.upTo as ExtrudeUpTo

  // 1) 方向目标：FaceTopoRef → 现场面几何；'last'/'first' → baseFeature 支持体
  //    沿拉伸方向的端面（远端 last / 近端 first）。
  let targetCenter: Vec3
  let targetNormal: Vec3
  if (typeof upTo === 'string') {
    const base = o.baseFeature
    const baseSolid = base ? (brepOf(base) as BrepHandle | undefined) : undefined
    if (!baseSolid) {
      throw new Error('E_UP_TO_NO_BASE: upTo "last"/"first" requires a baseFeature shape')
    }
    // 支持体 bbox 沿拉伸方向的远端/近端平面（R-C：baseFeature 显式传参）
    const bbox = getSolidBoundingBox(kernel, baseSolid)
    const pick = (which: 'max' | 'min'): Vec3 => {
      const c: Vec3 = [
        (bbox.min[0] + bbox.max[0]) / 2,
        (bbox.min[1] + bbox.max[1]) / 2,
        (bbox.min[2] + bbox.max[2]) / 2,
      ]
      const extent = which === 'max' ? 1 : -1
      const proj =
        (bbox.max[0] - bbox.min[0]) * Math.abs(normal.x) +
        (bbox.max[1] - bbox.min[1]) * Math.abs(normal.y) +
        (bbox.max[2] - bbox.min[2]) * Math.abs(normal.z)
      return [
        c[0] + ((normal.x * proj) / 2) * extent,
        c[1] + ((normal.y * proj) / 2) * extent,
        c[2] + ((normal.z * proj) / 2) * extent,
      ]
    }
    targetCenter = pick(upTo === 'last' ? 'max' : 'min')
    targetNormal = [normal.x, normal.y, normal.z]
  } else if (upTo && typeof upTo === 'object' && 'plane' in upTo) {
    // 显式平面目标（datum plane 等无限平面：截断面由平面方程决定，不受
    // 目标面边界限制——斜置基准面时顶面是斜的，定长路径语义错误）。
    targetCenter = [...upTo.plane.point] as Vec3
    targetNormal = [...upTo.plane.normal] as Vec3
  } else {
    // GOTCHA（探针实测）：FaceTopoRef 携带的 hint 是 faceRef 现场捕获的
    // center/normal 快照，直接使用；不要对拉伸轮廓（sketch 面）做二次
    // resolveFaceGeometry——引用的面在目标体上、不在轮廓上，会 E_TOPO_NOT_FOUND。
    if (upTo.hint.center && upTo.hint.normal) {
      targetCenter = [...upTo.hint.center] as Vec3
      targetNormal = [...upTo.hint.normal] as Vec3
    } else {
      throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'extrude upTo: face ref hint has no center/normal snapshot')
    }
  }

  // 2) 长试探长度：GOTCHA（探针实测）——不能按轮廓自身 bbox 对角线算（小轮廓够不到
  //    远处目标面）；必须取「截断平面沿拉伸方向的投影距离」加余量，保证长拉伸至
  //    少穿过目标面。
  const bbox = getSolidBoundingBox(kernel, inputSolid)
  const shiftedCenter0: Vec3 = [
    targetCenter[0] + targetNormal[0] * offset,
    targetCenter[1] + targetNormal[1] * offset,
    targetCenter[2] + targetNormal[2] * offset,
  ]
  // 自动定向（仅 { plane } 目标）：FreeCAD UpToFace 朝目标面所在方向拉伸。
  // GOTCHA（PadTest Pad001 实测，probe 探针）：斜置基准面在草图局部坐标里
  // 位于轮廓的反方向（圆心处平面交点 t=−26 而非 +26），固定沿 +Z 拉截不到
  // 平面（体积 597 ≠ 真值 4860）。轮廓 bbox 中心到截断平面的有向投影与
  // 拉伸方向异号 → 翻转拉伸方向（就地翻转 Vector3，后续 tMax/keepSide 自洽）。
  if (upTo && typeof upTo === 'object' && 'plane' in upTo) {
    const c0: Vec3 = [
      (bbox.min[0] + bbox.max[0]) / 2,
      (bbox.min[1] + bbox.max[1]) / 2,
      (bbox.min[2] + bbox.max[2]) / 2,
    ]
    const tnAuto = new THREE.Vector3(...targetNormal).normalize()
    const dAuto =
      (c0[0] - shiftedCenter0[0]) * tnAuto.x +
      (c0[1] - shiftedCenter0[1]) * tnAuto.y +
      (c0[2] - shiftedCenter0[2]) * tnAuto.z
    // 沿拉伸方向到平面的有向交点参数：t = −((c0−plane)·n) / (dir·n)。
    // t<0 → 平面在行进反方向 → 翻转（FreeCAD UpToFace 朝平面拉伸）。
    const tAuto = -dAuto / normal.dot(tnAuto)
    if (tAuto < 0) {
      normal.multiplyScalar(-1)
    }
  }
  const cornerProjections = [
    [bbox.min[0], bbox.min[1], bbox.min[2]],
    [bbox.max[0], bbox.min[1], bbox.min[2]],
    [bbox.min[0], bbox.max[1], bbox.min[2]],
    [bbox.min[0], bbox.min[1], bbox.max[2]],
    [bbox.max[0], bbox.max[1], bbox.min[2]],
    [bbox.max[0], bbox.min[1], bbox.max[2]],
    [bbox.min[0], bbox.max[1], bbox.max[2]],
    [bbox.max[0], bbox.max[1], bbox.max[2]],
  ] as Vec3[]
  const planePoint0 = new THREE.Vector3(...shiftedCenter0)
  const tn0 = new THREE.Vector3(...targetNormal).normalize()
  const planeD = planePoint0.dot(tn0)
  const dirD = normal.dot(tn0)
  if (Math.abs(dirD) < 1e-9) {
    throw new Error('E_UP_TO_PARALLEL: extrude direction is parallel to the target face plane')
  }
  const tMax = cornerProjections
    .map((p) => (planeD - new THREE.Vector3(...p).dot(tn0)) / dirD)
    .reduce((a, b) => Math.max(a, b), 0)
  const L = tMax + Math.abs(offset) + bboxDiag(bbox) * 0.1 + 1
  const longSolid = kernel.extrude(inputSolid, normal.x * L, normal.y * L, normal.z * L)

  // 3) 截断平面 = 目标面 + offset（沿面法向）。GOTCHA（探针实测）：半空间侧不能固定
  //    取「法向负侧」——目标面法向朝向与拉伸方向无必然关系。正确语义：保留「包含
  //    拉伸起点」的那一侧。farSideBox 覆盖「传入法向的反侧」，因此传 -keepSide。
  const tn = tn0
  const startCenter = new THREE.Vector3(
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  )
  const planePoint = new THREE.Vector3(...shiftedCenter0)
  const d = startCenter.sub(planePoint).dot(tn)
  // 保留侧法向：起点所在侧（d 与 tn 同号 → 正侧；异号 → 负侧）；d≈0 时退化为
  // 拉伸方向（起点在面上时按拉伸方向截）
  const keepSide = Math.abs(d) < 1e-9 ? normal.clone() : tn.clone().multiplyScalar(Math.sign(d))
  // GOTCHA（PadTest Pad001 斜置基准面实测）：targetCenter 可以是平面上离轮廓
  // 很远的任意一点（基准面 point 在草图局部坐标里横向偏 ~100），reach 若只取
  // L（按轮廓到截断面的投影距离）则半空间盒横向盖不住长拉伸体 → common 为空。
  // reach 必须 ≥ 平面点到拉伸体的距离 + 体对角线（全方向覆盖）。
  const reach =
    new THREE.Vector3(...shiftedCenter0).distanceTo(
      new THREE.Vector3((bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2),
    ) + bboxDiag(bbox) + Math.abs(offset) + 1
  const halfspace = farSideBox(kernel, shiftedCenter0, [-keepSide.x, -keepSide.y, -keepSide.z], reach)

  // 4) 求交：长拉伸 ∩ 半空间盒
  const clipped = kernel.common(longSolid, halfspace)
  kernel.release(longSolid)
  kernel.release(halfspace)

  // 预检：方向上不相交 → 显式报错（禁静默）
  const clippedBBox = getSolidBoundingBox(kernel, clipped)
  if (!Number.isFinite(bboxDiag(clippedBBox)) || bboxDiag(clippedBBox) < 1e-9) {
    kernel.release(clipped)
    throw new Error('E_UP_TO_NO_INTERSECTION: extrude direction does not reach the target face')
  }
  return clipped
}

/**
 * `cad.extrude` 的**网格链**实现（方案 2026-10-01 §4 Phase 3-2）。
 *
 * 输入是一张**网格链面**（`cad.sketchOnFace` 在近似拓扑面上铺出来的那种），
 * 输出是一个**新的网格零件**——与输入网格实体同链，同样不具备 STEP 导出资格。
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
  if (!input) throw new Error('[stdlib/extrude] no input geometry')
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

  const normal = new THREE.Vector3(...(o.normal ?? [0, 0, 1])).normalize()
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
 * （vendored extrude 为唯一引擎），up-to 模式走半空间组合。
 *
 * **网格链**（`meshEngines: ['brepkit']`，方案 2026-10-01 §4 Phase 3）：输入是
 * `cad.sketchOnFace` 在网格实体识别面上铺出的网格链面时，本 op 沿同一份方向语义
 * 拉伸出**一个新的网格零件**（同样不具备 STEP 导出资格）。网格链上不支持 `upTo`
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
 * @param params.upTo - 拉伸到面：FaceTopoRef 指定面 / 'last' 支持体远端面 / 'first' 近端面（需 baseFeature）。提供时忽略 length。type:'last' | 'first' | FaceTopoRef
 * @param params.baseFeature - upTo 'last'/'first' 的支持体几何（累积支持体）。type:Shape
 * @param params.offset - 截断面沿其法向的偏移（mm）。type:number 默认 0
 * @example
 * const p = await cad.extrude(part0, [0, 0, 10])
 * const p = await cad.extrude(part0, { length: 10 })
 * const p = await cad.extrude(sk, { upTo: cad.faceRef(part0, 3) })
 * const p = await cad.extrude(sk, { upTo: 'last', baseFeature: part0 })
 */
export const extrude = defineOp({
  name: 'extrude',
  meshEngines: ['brepkit'],
  mesh(input: Shape, params: unknown): Shape {
    return extrudeMeshChain(input, params)
  },
  brep: async (input: Shape, params: unknown): Promise<Shape> => {
    if (!input) throw new Error('[stdlib/extrude] no input geometry')
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
    const normal = new THREE.Vector3(...(o.normal ?? [0, 0, 1])).normalize()

    if (o.upTo !== undefined) {
      const kernel = getBrepApi()
      const inputSolid = brepOf(input) as BrepHandle | undefined
      if (!inputSolid) throw new Error('[stdlib/extrude] input is not BREP')
      const clipped = extrudeUpToSolid(kernel, inputSolid, o)
      // E3-b（2026-09-23，同 revolve 修法）：不能对投影产物再走一次 fromBrep——
      // 同语句 registeredStmtId 去重会吞掉第二次登记（part 键保持空表，下游
      // fillet/chamfer 的 edgeRef 报 nameless shape）。upTo 路径不经过投影/
      // adoptOut，fromBrep 只在此走一次，roleTable 直挂 + solid 句柄登记。
      const origin = String(getCurrentStmt()?.id ?? '')
      return fromBrep(solidToShape(kernel, clipped), {
        solid: clipped,
        roleTable: new Map([[origin, extrudeConstructRoles(kernel, clipped, normal.toArray() as Vec3)]]),
      })
    }

    // 长度形态：委托生成投影（生成投影自带借入 / Result 翻转 / 收养）
    const sign = o.mode === 'backward' ? -1 : 1
    const v: Vec3 = [normal.x * o.length! * sign, normal.y * o.length! * sign, normal.z * o.length! * sign]
    let result: Shape
    // GOTCHA：projectedExtrude 是 occt-gated 的 compat op（vendored brepjs 借入），
    // 在 brepkit 引擎下执行前即抛 E_BREP_UNSUPPORTED。brepkit 有原生 L1 extrude
    // （face→solid），直接走 kernel.extrude——与 revolve.ts 同路径（不经过 vendored 借入）。
    // occt 路径保持 projectedExtrude 不变，不回退既有几何/命名行为。
    if (getBackends().config.brepEngineId === 'brepkit') {
      const kernel = getBrepApi()
      const faceHandle = brepOf(input) as BrepHandle | undefined
      if (!faceHandle) throw new Error('[stdlib/extrude] brepkit path: input is not BREP')
      const solid = kernel.extrude(faceHandle, v[0]!, v[1]!, v[2]!)
      result = fromBrep(solidToShape(kernel, solid), { solid })
    } else {
      result = (await projectedExtrude(input, v)) as Shape
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
    if (kernel && solid) {
      const origin = String(getCurrentStmt()?.id ?? '')
      const table = new Map([[origin, extrudeConstructRoles(kernel, solid, normal.toArray() as Vec3)]])
      const part = getCurrentStmt()?.outputs?.[0]
      runtimeLineage.recordOutput(origin as never, table, solid as never, part as never)
    }
    return result
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [{ kind: 'semantic', name: 'top' }, { kind: 'semantic', name: 'bottom' }, { kind: 'wall', index: 0 }] } } as Provenance,
})
