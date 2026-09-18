/**
 * stdlib extrude — 拉伸库函数
 *
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import { extrudeBrep, solidToShape } from '../brep/brep-ops'
import { getSolidBoundingBox } from '../brep/brep-utils'
import { getBackends } from '../runtime-state'
import { fromBrep, brepOf } from '../shape'
import { defineOp } from '../sdk'
import { assertPositiveNumber } from './assert'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { FaceTopoRef } from '../topology/naming'
import { TopoRefError } from '../topology/naming'
import * as THREE from 'three'

// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──

/**
 * Validate extrude parameters: `length` must be a positive number.
 * When `upTo` is present, `length` is not required (up-to mode).
 * @param params - the raw extrude operation parameters.
 */
export function assertExtrudeParams(params: Record<string, unknown>): void {
  if (params.upTo !== undefined) return // up-to mode: no length required
  assertPositiveNumber(params.length, 'extrude.length')
}

/** BREP 路径：OCCT extrude + 三角化 + fromBrep 登记。 */
function extrudeBrepPath(input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/extrude] no OCCT kernel')
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/extrude] input is not BREP')

  // up-to mode（extrude-upto-face 方案 §4.2）：拉伸到面 / 到支持体最后一面。
  // occt-wasm 不暴露 BRepFeat_MakePrism，用「长拉伸 → 与目标面侧半空间盒
  // 求交」等价组合；长试探上限只作布尔构造辅助，不进入结果几何。
  const upTo = params.upTo as FaceTopoRef | 'last' | 'first' | undefined
  if (upTo !== undefined) {
    return extrudeUpToPath(input, params, upTo)
  }

  const normal = (params.normal as Vec3 | undefined) ?? [0, 0, 1]
  const originOffset = (params.originOffset as number | undefined) ?? 0
  const resultSolid = extrudeBrep(kernel, inputSolid, {
    normal,
    originOffset,
    length: params.length as number,
    mode: params.mode as 'centered' | 'forward' | 'backward' | undefined,
  })

  return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid })
}

/**
 * 目标面法向负侧的半空间覆盖盒（截断长拉伸用）。
 *
 * GOTCHA（probe-upto-steps.ts）：不能用「面中心±1」当面 bbox——span 只剩 6，
 * 侧向盖不住长拉伸体，common 结果为空（getBoundingBox 报 no geometry）。
 * 正确做法：以目标面中心为基准，沿法向反方向伸出 R、沿与 n 正交的两个
 * 基向量各 ±R，取 8 个角点的包围盒——侧向与深度全覆盖。
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

/** bbox 对角线长度（试探余量用）。 */
function diag0(kernel: BrepEngineApi, bbox: { min: Vec3; max: Vec3 }): number {
  void kernel
  return Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2])
}

/** up-to 拉伸的 BREP 路径。 */
function extrudeUpToPath(input: Shape, params: Record<string, unknown>, upTo: FaceTopoRef | 'last' | 'first'): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/extrude] no OCCT kernel')
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/extrude] input is not BREP')

  const normal = new THREE.Vector3(...((params.normal as Vec3 | undefined) ?? [0, 0, 1])).normalize()
  const offset = (params.offset as number | undefined) ?? 0

  // 1) 方向目标：FaceTopoRef → 现场面几何；'last'/'first' → baseFeature 支持
  //    体沿拉伸方向的端面（远端 last / 近端 first）。
  let targetCenter: Vec3
  let targetNormal: Vec3
  if (typeof upTo === 'string') {
    const base = params.baseFeature as Shape | undefined
    const baseSolid = base ? brepOf(base) as BrepHandle | undefined : undefined
    if (!baseSolid) {
      throw new Error('E_UP_TO_NO_BASE: upTo "last"/"first" requires a baseFeature shape')
    }
    // 支持体 bbox 沿拉伸方向的远端/近端平面（R-C：baseFeature 显式传参）
    const bbox = getSolidBoundingBox(kernel, baseSolid)
    const pick = (which: 'max' | 'min'): Vec3 => {
      // 取 bbox 沿 normal 最深点的对应端面中心
      const c: Vec3 = [
        (bbox.min[0] + bbox.max[0]) / 2,
        (bbox.min[1] + bbox.max[1]) / 2,
        (bbox.min[2] + bbox.max[2]) / 2,
      ]
      const extent = which === 'max' ? 1 : -1
      // 沿 normal 方向把中心推到 bbox 极端平面
      const proj = (bbox.max[0] - bbox.min[0]) * Math.abs(normal.x) + (bbox.max[1] - bbox.min[1]) * Math.abs(normal.y) + (bbox.max[2] - bbox.min[2]) * Math.abs(normal.z)
      return [c[0] + normal.x * proj / 2 * extent, c[1] + normal.y * proj / 2 * extent, c[2] + normal.z * proj / 2 * extent]
    }
    targetCenter = pick(upTo === 'last' ? 'max' : 'min')
    targetNormal = [normal.x, normal.y, normal.z]
  } else {
    // GOTCHA（probe-upto-min.ts）：FaceTopoRef 携带的 hint 是 faceRef 现场捕获的
    // center/normal 快照，直接使用；不要对拉伸轮廓（sketch 面）做二次
    // resolveFaceGeometry——引用的面在目标体上、不在轮廓上，会 E_TOPO_NOT_FOUND。
    if (upTo.hint.center && upTo.hint.normal) {
      targetCenter = [...upTo.hint.center] as Vec3
      targetNormal = [...upTo.hint.normal] as Vec3
    } else {
      throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'extrude upTo: face ref hint has no center/normal snapshot')
    }
  }

  // 2) 长试探长度：GOTCHA（probe-upto-replica.ts）——不能按轮廓自身 bbox 对角线
  //    算（小轮廓够不到远处目标面）；必须取「截断平面沿拉伸方向的投影距离」
  //    加余量，保证长拉伸至少穿过目标面。
  const bbox = getSolidBoundingBox(kernel, inputSolid)
  const shiftedCenter0: Vec3 = [
    targetCenter[0] + targetNormal[0] * offset,
    targetCenter[1] + targetNormal[1] * offset,
    targetCenter[2] + targetNormal[2] * offset,
  ]
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
  // 截断平面与拉伸方向的交点在方向轴上的参数 t（平面：dot(p, tn)=dot(c, tn)）
  const planeD = planePoint0.dot(tn0)
  const dirD = normal.dot(tn0)
  if (Math.abs(dirD) < 1e-9) {
    throw new Error('E_UP_TO_PARALLEL: extrude direction is parallel to the target face plane')
  }
  const tMax = cornerProjections
    .map((p) => (planeD - new THREE.Vector3(...p).dot(tn0)) / dirD)
    .reduce((a, b) => Math.max(a, b), 0)
  const L = tMax + Math.abs(offset) + diag0(kernel, bbox) * 0.1 + 1
  const longSolid = kernel.extrude(inputSolid, normal.x * L, normal.y * L, normal.z * L)

  // 3) 截断平面 = 目标面 + offset（沿面法向）。GOTCHA（probe-upto-replica.ts）：
  //    半空间侧不能固定取「法向负侧」——目标面法向朝向与拉伸方向无必然关系。
  //    正确语义：保留「包含拉伸起点」的那一侧。farSideBox 覆盖「传入法向的反
  //    侧」，因此传 -keepSide（反侧 = 丢弃侧的反面 = 保留侧）。
  const shiftedCenter = shiftedCenter0
  const tn = tn0
  const startCenter = new THREE.Vector3(
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  )
  const planePoint = new THREE.Vector3(...shiftedCenter)
  const d = startCenter.sub(planePoint).dot(tn)
  // 保留侧法向：起点所在侧（d 与 tn 同号 → 正侧；异号 → 负侧）；d≈0 时退化
  // 为拉伸方向（起点在面上时按拉伸方向截）
  const keepSide = Math.abs(d) < 1e-9 ? normal.clone() : tn.clone().multiplyScalar(Math.sign(d))
  const halfspace = farSideBox(kernel, shiftedCenter, [-keepSide.x, -keepSide.y, -keepSide.z], L)

  // 4) 求交：长拉伸 ∩ 半空间盒
  const clipped = kernel.common(longSolid, halfspace)
  kernel.release(longSolid)
  kernel.release(halfspace)

  // 预检：方向上不相交 → 显式报错（禁静默）
  const clippedBBox = getSolidBoundingBox(kernel, clipped)
  const clippedDiag = Math.hypot(
    clippedBBox.max[0] - clippedBBox.min[0],
    clippedBBox.max[1] - clippedBBox.min[1],
    clippedBBox.max[2] - clippedBBox.min[2],
  )
  if (!Number.isFinite(clippedDiag) || clippedDiag < 1e-9) {
    kernel.release(clipped)
    throw new Error('E_UP_TO_NO_INTERSECTION: extrude direction does not reach the target face')
  }

  return fromBrep(solidToShape(kernel, clipped), { solid: clipped })
}

/**
 * 沿法向拉伸几何。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name fai_extrude
 * @returns Shape 拉伸后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.length - 总拉伸量（mm）。type:number required:true
 * @param params.mode - 拉伸方向：centered 双向各一半 / forward 正向 / backward 反向。type:'centered' | 'forward' | 'backward' 默认 'centered'
 * @param params.normal - 拉伸方向法向。type:[x,y,z] 默认 当前面法向 [0,0,1]
 * @param params.originOffset - 切面在法向上的偏移。type:number 默认 0
 * @param params.space - 坐标空间声明。type:'local' | 'world'
 * @example
 * const p = await cad.fai_extrude(part0, { length: 10 })
 * const p = await cad.fai_extrude(part0, { length: 10, mode: 'forward' })
 * const p = await cad.fai_extrude(part0, { length: 10, normal: [0,0,1], originOffset: 2 })
  */
export const fai_extrude = defineOp({
  mesh: async (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/extrude] no input geometry')
    assertExtrudeParams(params)
    return cad.fai_extrude(input, {
      normal: (params.normal as Vec3 | undefined) ?? [0, 0, 1],
      originOffset: (params.originOffset as number | undefined) ?? 0,
      length: params.length as number,
      mode: params.mode as 'centered' | 'forward' | 'backward' | undefined,
    })
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/extrude] no input geometry')
    assertExtrudeParams(params)
    return extrudeBrepPath(input, params)
  },
})
