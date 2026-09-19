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
import { solidToShape } from '../brep/brep-ops'
import { getSolidBoundingBox } from '../brep/brep-utils'
import { getBackends } from '../runtime-state'
import { fromBrep, brepOf } from '../shape'
import { defineOp } from '../sdk'
import { assertPositiveNumber } from './assert'
import type { Shape, Vec3 } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { FaceTopoRef } from '../topology/naming'
import { TopoRefError } from '../topology/naming'

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
 * 目标面法向负侧的半空间覆盖盒（截断长拉伸用）。
 *
 * GOTCHA（探针实测，旧 probe-upto-steps.ts）：不能用「面中心 ± 1」当面 bbox——
 * span 只剩 6，侧向盖不住长拉伸体，common 结果为空（getBoundingBox 报 no geometry）。
 * 正确做法：以目标面中心为基准，沿法向反方向伸出 R、沿与 n 正交的两个基向量各
 * ±R，取 8 个角点的包围盒——侧向与深度全覆盖。
 *
 * @param kernel - BREP 内核。
 * @param faceCenter - 目标面中心。
 * @param faceNormal - 目标面法向。
 * @param reach - 覆盖半径 R。
 * @returns 半空间盒的 brep 句柄。
 */
function farSideBox(kernel: BrepEngineApi, faceCenter: Vec3, faceNormal: Vec3, reach: number): BrepHandle {
  const unit = new THREE.Vector3(...faceNormal).normalize()
  const center = new THREE.Vector3(...faceCenter)
  // 与 n 正交的正交基 u,v
  const aux = Math.abs(unit.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const u = new THREE.Vector3().crossVectors(unit, aux).normalize()
  const v = new THREE.Vector3().crossVectors(unit, u).normalize()
  const R = reach
  const corners: THREE.Vector3[] = []
  for (const deep of [0, -1]) {
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        corners.push(
          center.clone()
            .addScaledVector(unit, deep * R)
            .addScaledVector(u, su * R)
            .addScaledVector(v, sv * R),
        )
      }
    }
  }
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const zs = corners.map((c) => c.z)
  return kernel.makeBoxFromCorners(
    { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
    { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
  )
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
    if (dAuto * normal.dot(tnAuto) < 0) {
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
 * 沿 normal 拉伸几何（面 → 棱柱）。
 *
 * up-to 模式（`upTo`）与长度模式（`length`）二选一；长度模式委托生成投影
 * （vendored extrude 为唯一引擎），up-to 模式走半空间组合。
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
  brep: async (input: Shape, params: unknown): Promise<Shape> => {
    if (!input) throw new Error('[stdlib/extrude] no input geometry')
    const o = normalizeExtrudeOptions(params)
    assertExtrudeOptions(o)

    if (o.upTo !== undefined) {
      const kernel = getBackends().kernel.brep as BrepEngineApi | null
      if (!kernel) throw new Error('[stdlib/extrude] no OCCT kernel')
      const inputSolid = brepOf(input) as BrepHandle | undefined
      if (!inputSolid) throw new Error('[stdlib/extrude] input is not BREP')
      const clipped = extrudeUpToSolid(kernel, inputSolid, o)
      return fromBrep(solidToShape(kernel, clipped), { solid: clipped })
    }

    // 长度形态：委托生成投影（生成投影自带借入 / Result 翻转 / 收养）
    const normal = new THREE.Vector3(...(o.normal ?? [0, 0, 1])).normalize()
    const sign = o.mode === 'backward' ? -1 : 1
    const v: Vec3 = [normal.x * o.length! * sign, normal.y * o.length! * sign, normal.z * o.length! * sign]
    return (await projectedExtrude(input, v)) as Shape
  },
})
