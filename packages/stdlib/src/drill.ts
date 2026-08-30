/**
 * stdlib drill — 钻孔库函数
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh。
 * BREP 路径：OCCT cut（简单孔）或 threadBrep + cut（螺丝孔）。
 */

import type { Shape, Vec3 } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import {
  drillBrep,
  solidToShape,
  matrixToArray,
} from '@faicad/faijs-core/brep/brep-ops'
import { threadBrep } from './brepjs-mirror/threadFns'
import { getScrewSpec, threadToPitchMm } from '@faicad/faijs-core/primitives/screw/screw-db'
import * as THREE from 'three'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { solid, fromBrep, brepOf } from '@faicad/faijs-core/shape'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'
import { assertPositiveNumber, assertNumber, assertVec3 } from './assert'

/** BREP 实现标记（drill 有 OCCT 精确钻孔） */
const brepImpl = true

// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──

/** drill: diameter 必填 > 0；position（如有）为 vec3；depth（如有）为数字（<=0 表示通孔）。 */
export function assertDrillParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.diameter, 'drill.diameter')
  if (params.position !== undefined && params.position !== null) {
    assertVec3(params.position, 'drill.position')
  }
  if (params.depth !== undefined && params.depth !== null) {
    assertNumber(params.depth, 'drill.depth')
  }
}

/** 世界坐标 → 几何体局部坐标（含单位缩放）。 */
function worldToLocalPosition(
  worldPos: [number, number, number],
  partTransform: { position: [number, number, number]; scale?: [number, number, number] } | undefined,
): [number, number, number] {
  const offset = partTransform?.position
  if (!offset) return worldPos
  const scale = partTransform?.scale
  if (scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1)) {
    return [
      (worldPos[0] - offset[0]) / scale[0],
      (worldPos[1] - offset[1]) / scale[1],
      (worldPos[2] - offset[2]) / scale[2],
    ]
  }
  return [
    worldPos[0] - offset[0],
    worldPos[1] - offset[1],
    worldPos[2] - offset[2],
  ]
}

/** 解析 direction 枚举 → 钻孔方向向量。 */
function resolveDirection(params: Record<string, unknown>, faceNormal: Vec3): Vec3 {
  const directionEnum = (params.direction as string | undefined) ?? 'normal'
  if (directionEnum === 'normal') return faceNormal
  if (directionEnum === 'x') return [-1, 0, 0]
  if (directionEnum === 'y') return [0, -1, 0]
  if (directionEnum === 'z') return [0, 0, -1]
  return faceNormal
}

/** BREP 螺丝孔：底孔（圆柱 cut）+ 内螺纹（threadBrep + cut）。 */
function screwHoleBrep(
  kernel: BrepEngineApi,
  upstreamSolid: BrepHandle,
  params: Record<string, unknown>,
  direction: Vec3,
  faceNormal: Vec3,
  localPosition: [number, number, number],
): BrepHandle {
  const diameter = params.diameter as number
  const depth = params.depth as number
  // 1. 底孔（圆柱 cut）
  const result = drillBrep(kernel, upstreamSolid, {
    diameter,
    depth,
    position: localPosition,
    direction,
    faceNormal,
    holeType: 'simple',
  })

  // 2. 螺纹（内螺纹 ridge，inward=true）
  const screwSystem = (params.screwSystem as 'metric' | 'imperial') ?? 'metric'
  const screwSpecIdx = (params.screwSpecIdx as number) ?? 4 // M5 default（与 mesh 路径一致）
  const screwThread = (params.screwThread as 'coarse' | 'fine' | 'custom') ?? 'coarse'
  const spec = getScrewSpec(screwSystem, screwSpecIdx)
  const pitch = threadToPitchMm(screwSystem, spec, screwThread)

  if (pitch > 0) {
    const threadSolid = threadBrep(kernel, {
      radius: diameter / 2,
      pitch,
      height: depth > 0 ? depth : 20,
      inward: true,
    })
    const dir = new THREE.Vector3(...direction).normalize()
    const fn = new THREE.Vector3(...faceNormal)
    if (dir.dot(fn) > 0) dir.negate()

    const zAxis = new THREE.Vector3(0, 0, 1)
    const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, dir)
    const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quat)
    const transMatrix = new THREE.Matrix4().makeTranslation(localPosition[0], localPosition[1], localPosition[2])
    const fullMatrix = new THREE.Matrix4().multiplyMatrices(transMatrix, rotMatrix)

    const positionedThread = kernel.transform(threadSolid, matrixToArray(fullMatrix))
    kernel.release(threadSolid)

    const finalResult = kernel.cut(result, positionedThread)
    kernel.release(result)
    kernel.release(positionedThread)
    return finalResult
  }

  return result
}

/** BREP 路径：OCCT cut（简单孔）或 threadBrep + cut（螺丝孔）。 */
function drillBrepPath(input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/drill] no OCCT kernel')
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/drill] input is not BREP')

  const faceNormal = (params.faceNormal as Vec3) ?? [0, 0, 1]
  const direction = resolveDirection(params, faceNormal)
  const holeType = params.holeType as 'simple' | 'screw' | undefined

  // 世界坐标 → 局部坐标（cad.load 返回的几何体在原始文件坐标系中）
  const partTransform = getBackends().config.partTransform
  const localPosition = worldToLocalPosition(params.position as [number, number, number], partTransform)

  let resultSolid: BrepHandle
  if (holeType === 'screw') {
    resultSolid = screwHoleBrep(kernel, inputSolid, params, direction, faceNormal, localPosition)
  } else {
    resultSolid = drillBrep(kernel, inputSolid, {
      diameter: params.diameter as number,
      depth: params.depth as number,
      position: localPosition,
      direction,
      faceNormal,
      holeType: 'simple',
    })
  }

  return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid })
}

/** mesh 路径：manifold-3d mesh-CSG。 */
async function drillMeshPath(input: Shape, params: Record<string, unknown>): Promise<Shape> {
  const faceNormal = (params.faceNormal as Vec3) ?? [0, 0, 1]
  const direction = resolveDirection(params, faceNormal)
  const partTransform = getBackends().config.partTransform
  const localPos = worldToLocalPosition(params.position as [number, number, number], partTransform)

  const scale = partTransform?.scale
  const unitScale = scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1)
    ? scale[0]
    : 1

  return cad.drill(input, {
    diameter: (params.diameter as number) / unitScale,
    depth: (params.depth as number) / unitScale,
    type: (params.depth as number) > 0 ? 'blind' : 'through',
    position: localPos,
    direction,
    faceNormal,
    tolerance: (params.tolerance as number | undefined) !== undefined ? (params.tolerance as number) / unitScale : undefined,
    holeType: params.holeType as 'simple' | 'screw' | undefined,
    screwSystem: params.screwSystem as string | undefined,
    screwSpecIdx: params.screwSpecIdx as number | undefined,
    screwThread: params.screwThread as string | undefined,
    screwHead: params.screwHead as string | undefined,
  })
}

/**
 * 在几何体上钻孔（CSG 减除）。depth=0 为通孔，>0 为盲孔。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name drill
 * @note 键名以本表为准：`type: 'through'|'blind'` 与 `direction` 为向量的旧素材是无效写法——孔型由 `depth`（0=通孔）推导，`direction` 是 'normal'|'x'|'y'|'z' 枚举。
 * @returns Shape 钻孔后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.diameter - 孔径（mm）。type:number required:true
 * @param params.depth - 孔深（mm）；0 = 通孔，> 0 = 盲孔。type:number 默认 0
 * @param params.holeType - 孔类型：simple 简单孔 / screw 螺丝孔。type:'simple' | 'screw' 默认 'simple'
 * @param params.direction - 钻孔轴向（normal 表示沿面法向）。type:'normal' | 'x' | 'y' | 'z' 默认 'normal'
 * @param params.position - 孔心位置（建议几何引用 cad.faceCenter）。type:[x,y,z] 默认 原点
 * @param params.faceNormal - 面法向（决定朝向）。type:[x,y,z] 默认 [0,0,1]
 * @param params.tolerance - 公差（mm）。type:number 默认 0.3
 * @param params.screwSystem - 螺丝孔制式（holeType='screw' 时用）。type:'metric' | 'imperial' 默认 'metric'
 * @param params.screwSpecIdx - 螺丝规格索引（holeType='screw' 时用；4 → M5）。type:number 默认 4
 * @param params.screwThread - 螺丝螺纹类型。type:'coarse' | 'fine' | 'custom' 默认 'coarse'
 * @param params.screwHead - 螺丝头型。type:'hex' | 'chc' | 'none' 默认 'none'
 * @example
 * const p = await cad.drill(part0, { diameter: 5 })
 * const p = await cad.drill(part0, { diameter: 5, depth: 3 })
 * const p = await cad.drill(part0, { diameter: 5.2, depth: 8, holeType: 'screw', screwSystem: 'metric', screwSpecIdx: 4, screwThread: 'coarse', screwHead: 'none' })
  */
export async function drill(input: Shape, params: Record<string, unknown>): Promise<Shape> {
  if (!input) throw new Error('[stdlib/drill] no input geometry')
  assertDrillParams(params)
  const path = dispatchPath([input], brepImpl)
  if (path === 'brep') return drillBrepPath(input, params)
  return solid(await drillMeshPath(input, params))
}
