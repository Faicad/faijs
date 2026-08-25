/**
 * 钻孔操作分派器
 *
 * BREP 路径：用 OCCT cut（简单孔）或 threadBrep + cut（螺丝孔）
 * Mesh 路径：用 manifold-3d mesh-CSG
 *
 * 静态分派：链活跃时必走 BREP 路径（开发期写死），异常冒泡上报。
 */

import type { Shape, Vec3 } from '../mesh/types'
import type { ShapeHandle } from 'occt-wasm'
import { cad } from '../mesh'
import {
  drillBrep,
  solidToShape,
} from '../brep/brep-ops'
import { threadBrep } from '../brep/brepjs-mirror/threadFns'
import { getScrewSpec, threadToPitchMm } from '../primitives/screw/screw-db'
import * as THREE from 'three'
import { matrixToArray } from '../brep/brep-ops'
import type { OpContext } from './types'
import { canUseBrep } from './types'
import { asPartName } from '../identity'

/**
 * 执行钻孔操作
 */
export async function executeDrill(ctx: OpContext): Promise<Shape> {
  const { stmt, inputGeometries, args } = ctx

  if (inputGeometries.length === 0) {
    throw new Error(`[ExecutionValidator] drill statement "${stmt.id}" has no input geometry`)
  }
  const shape = inputGeometries[0]

  const directionEnum = (args.direction as string | undefined) ?? 'normal'
  const faceNormal = args.faceNormal as [number, number, number]
  let direction: [number, number, number]
  if (directionEnum === 'normal') {
    direction = faceNormal
  } else if (directionEnum === 'x') {
    direction = [-1, 0, 0]
  } else if (directionEnum === 'y') {
    direction = [0, -1, 0]
  } else if (directionEnum === 'z') {
    direction = [0, 0, -1]
  } else {
    direction = faceNormal
  }

  // 链不活跃 → mesh 路径（链已在前面静态断掉，正常继续）
  if (!canUseBrep(ctx)) {
    return executeDrillMesh(shape, args, direction, faceNormal, ctx.brepChain?.partTransform)
  }

  // 链活跃 → BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  return executeDrillBrep(ctx, direction, faceNormal)
}

/**
 * 将世界坐标的 position 转换为几何体局部坐标。
 *
 * cad.load 返回的几何体在原始文件坐标系中（无居中偏移、无单位缩放），
 * 而用户交互产生的 clickPosition 是世界坐标（含 mesh.position 居中偏移
 * 和单位缩放，如系统猜测 STL 单位为非 mm 时会缩放）。
 *
 * localPos = (worldPos - position) / scale
 */
function worldToLocalPosition(
  worldPos: [number, number, number],
  partTransform: { position: [number, number, number]; scale?: [number, number, number] } | undefined,
): [number, number, number] {
  const offset = partTransform?.position
  if (!offset) return worldPos
  const scale = partTransform?.scale
  // 如果有单位缩放，需要除以缩放因子
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

/**
 * BREP 路径：用 OCCT cut（简单孔）或 threadBrep + cut（螺丝孔）
 */
async function executeDrillBrep(
  ctx: OpContext,
  direction: Vec3,
  faceNormal: Vec3,
): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeDrill] no kernel')

  const kernel = brepChain.kernel
  const upstreamSolid = brepChain.solidCache.get(stmt.inputs[0])
  if (!upstreamSolid) {
    // 不变量错误：链活跃时上游必有 solid，缺失即 bug
    throw new Error(`[executeDrill] upstream solid not found for statement "${stmt.id}" (input: ${stmt.inputs[0]}) — invariant violation: chain is active but upstream solid is missing`)
  }

  const holeType = args.holeType as 'simple' | 'screw' | undefined

  // 世界坐标 → 局部坐标（cad.load 返回的几何体在原始文件坐标系中）
  const localPosition = worldToLocalPosition(
    args.position as [number, number, number],
    brepChain?.partTransform,
  )

  if (holeType === 'screw') {
    // 螺丝孔：底孔 + 内螺纹
    return executeScrewHoleBrep(ctx, upstreamSolid, direction, faceNormal, localPosition)
  }

  // 简单圆柱孔
  const resultSolid = drillBrep(kernel, upstreamSolid, {
    diameter: args.diameter as number,
    depth: args.depth as number,
    position: localPosition,
    direction,
    faceNormal,
    holeType: 'simple',
  })
  brepChain.solidCache.set(asPartName(stmt.id), resultSolid)
  return solidToShape(kernel, resultSolid, undefined, brepChain, asPartName(stmt.id))
}

/**
 * BREP 螺丝孔：底孔（圆柱 cut）+ 内螺纹（threadBrep + cut）
 */
async function executeScrewHoleBrep(
  ctx: OpContext,
  upstreamSolid: ShapeHandle,
  direction: Vec3,
  faceNormal: Vec3,
  localPosition: [number, number, number],
): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeScrewHole] no kernel')

  const kernel = brepChain.kernel
  const diameter = args.diameter as number
  const depth = args.depth as number
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
  const screwSystem = (args.screwSystem as 'metric' | 'imperial') ?? 'metric'
  const screwSpecIdx = (args.screwSpecIdx as number) ?? 5 // M6 default
  const screwThread = (args.screwThread as 'coarse' | 'fine' | 'custom') ?? 'coarse'
  const spec = getScrewSpec(screwSystem, screwSpecIdx)
  const pitch = threadToPitchMm(screwSystem, spec, screwThread)

  if (pitch > 0) {
    // 构造内螺纹
    const threadSolid = threadBrep(kernel, {
      radius: diameter / 2,
      pitch,
      height: depth > 0 ? depth : 20, // 通孔时给足够长度
      inward: true,
    })

    // 将螺纹定位到孔的位置和方向
    const dir = new THREE.Vector3(...direction).normalize()
    const fn = new THREE.Vector3(...faceNormal)
    if (dir.dot(fn) > 0) dir.negate()

    // 螺纹沿 Z 轴构造（从 Z=0 到 Z=height），需要旋转到钻孔方向并平移到孔位置
    const zAxis = new THREE.Vector3(0, 0, 1)
    const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, dir)
    const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quat)
    const transMatrix = new THREE.Matrix4().makeTranslation(localPosition[0], localPosition[1], localPosition[2])
    const fullMatrix = new THREE.Matrix4().multiplyMatrices(transMatrix, rotMatrix)

    const positionedThread = kernel.transform(threadSolid, matrixToArray(fullMatrix))
    kernel.release(threadSolid)

    // cut
    const finalResult = kernel.cut(result, positionedThread)
    kernel.release(result)
    kernel.release(positionedThread)

    brepChain.solidCache.set(asPartName(stmt.id), finalResult)
    return solidToShape(kernel, finalResult, undefined, brepChain, asPartName(stmt.id))
  }

  // 无螺纹，只有底孔
  brepChain.solidCache.set(asPartName(stmt.id), result)
  return solidToShape(kernel, result, undefined, brepChain, asPartName(stmt.id))
}

/**
 * Mesh 路径：用 manifold-3d mesh-CSG
 */
async function executeDrillMesh(
  shape: Shape,
  args: Record<string, unknown>,
  direction: Vec3,
  faceNormal: Vec3,
  partTransform?: { position: [number, number, number]; scale?: [number, number, number] },
): Promise<Shape> {
  // Mesh 路径：cad.load 返回的 shape 在原始文件坐标系中（无居中偏移、无单位缩放），
  // 而 position 是世界坐标（用户点击位置，含 mesh.position 居中偏移和单位缩放）。
  // 需要将 position 从世界坐标转换为局部坐标，与 shape 对齐。
  const localPos = worldToLocalPosition(
    args.position as [number, number, number],
    partTransform,
  )

  // UI 参数（diameter, depth, tolerance）使用世界空间单位（mm），
  // 但 cad.load 返回的 shape 在原始文件坐标系中（系统可能猜测 STL 单位为非 mm）。
  // 需要将这些参数除以缩放因子，转换为局部坐标系的单位。
  const scale = partTransform?.scale
  const unitScale = scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1)
    ? scale[0]  // 均匀缩放，取 x 分量
    : 1

  return cad.drill(shape, {
    diameter: (args.diameter as number) / unitScale,
    depth: (args.depth as number) / unitScale,
    type: (args.depth as number) > 0 ? 'blind' : 'through',
    position: localPos,
    direction,
    faceNormal,
    tolerance: (args.tolerance as number | undefined) !== undefined ? (args.tolerance as number) / unitScale : undefined,
    holeType: args.holeType as 'simple' | 'screw' | undefined,
    screwSystem: args.screwSystem as string | undefined,
    screwSpecIdx: args.screwSpecIdx as number | undefined,
    screwThread: args.screwThread as string | undefined,
    screwHead: args.screwHead as string | undefined,
  })
}
