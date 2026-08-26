/**
 * stdlib drill — 钻孔库函数
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/drill.ts 迁出并改写为 stdlib 形态：
 * `(input, params, exec) => Promise<Shape>`，resolvePath 静态判定 brep/mesh。
 * BREP 路径：OCCT cut（简单孔）或 threadBrep + cut（螺丝孔）。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import {
  drillBrep,
  solidToShape,
  matrixToArray,
} from '../brep/brep-ops'
import { threadBrep } from '../brep/brepjs-mirror/threadFns'
import { getScrewSpec, threadToPitchMm } from '../primitives/screw/screw-db'
import * as THREE from 'three'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import { assertPositiveNumber, assertNumber, assertVec3 } from './assert'
import type { ExecContext, ExecContextImpl } from '../cad-runtime/exec-context'

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
  kernel: import('occt-wasm').OcctKernel,
  upstreamSolid: import('occt-wasm').ShapeHandle,
  params: Record<string, unknown>,
  direction: Vec3,
  faceNormal: Vec3,
  localPosition: [number, number, number],
): import('occt-wasm').ShapeHandle {
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
  const screwSpecIdx = (params.screwSpecIdx as number) ?? 5 // M6 default
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
function drillBrepPath(input: Shape, params: Record<string, unknown>, exec: ExecContext): Shape {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/drill] no OCCT kernel')
  const inputSolid = exec.getSolid(input)
  if (!inputSolid) throw new Error('[stdlib/drill] input is not BREP')

  const faceNormal = params.faceNormal as Vec3
  const direction = resolveDirection(params, faceNormal)
  const holeType = params.holeType as 'simple' | 'screw' | undefined

  // 世界坐标 → 局部坐标（cad.load 返回的几何体在原始文件坐标系中）
  const partTransform = (exec as ExecContextImpl).brepChain.partTransform
  const localPosition = worldToLocalPosition(params.position as [number, number, number], partTransform)

  let resultSolid: import('occt-wasm').ShapeHandle
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

  const shape = solid(solidToShape(kernel, resultSolid))
  exec.setSolid(shape, resultSolid)
  return shape
}

/** mesh 路径：manifold-3d mesh-CSG。 */
async function drillMeshPath(input: Shape, params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  const faceNormal = params.faceNormal as Vec3
  const direction = resolveDirection(params, faceNormal)
  const partTransform = (exec as ExecContextImpl).brepChain.partTransform
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

export async function drill(input: Shape, params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  if (!input) throw new Error('[stdlib/drill] no input geometry')
  assertDrillParams(params)
  const path = resolvePath(exec, [input], brepImpl)
  if (path === 'brep') return drillBrepPath(input, params, exec)
  return solid(await drillMeshPath(input, params, exec))
}
