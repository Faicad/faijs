/**
 * mesh 钻孔 API
 *
 * 提取来源：
 * - engine/components/drill-hole/DrillHoleCore.ts (executeDrillHoleOnGeometry)
 * - engine/version-store/executors/DrillCommandExecutor.ts (executeDrillOnGeometryData)
 *
 * DrillCommandExecutor 已是最纯的入口（typed arrays 输入输出），
 * mesh 直接复用其几何计算逻辑。
 */

import * as THREE from 'three'
import {
  buildHoleGeometry,
  computeThroughHoleDimensions,
  computeBlindHoleCenter,
  positionHoleGeometry,
} from './drill-hole/DrillHoleCore'
import {
  computeBoolean,
  geoToManifoldMesh,
} from '../boolean/csg-backend'
import { getScrewSpec } from '../primitives/screw/screw-db'
import type { Shape, DrillParams } from './types'

/**
 * Drill a hole into a world-space shape, cutting the hole geometry out with a
 * CSG subtract.
 *
 * @param shape - the world-space shape to drill into.
 * @param params - drill parameters (position, direction, depth, hole type, screw details).
 * @returns the drilled shape in world space.
 */
export async function drill(shape: Shape, params: DrillParams): Promise<Shape> {
  const position = new THREE.Vector3(...params.position)
  const faceNormal = new THREE.Vector3(...params.faceNormal)

  // 1. 计算钻孔方向：direction 是 Vec3，确保朝向材料内部
  const direction = new THREE.Vector3(...params.direction).normalize()
  if (direction.dot(faceNormal) > 0) {
    direction.negate()
  }

  // 2. 从输入几何计算 bbox（世界空间）
  const bbox = new THREE.Box3()
  const posVec = new THREE.Vector3()
  for (let i = 0; i < shape.positions.length; i += 3) {
    posVec.set(shape.positions[i], shape.positions[i + 1], shape.positions[i + 2])
    bbox.expandByPoint(posVec)
  }
  const bboxSize = bbox.getSize(new THREE.Vector3())
  const bboxMax = Math.max(bboxSize.x, bboxSize.y, bboxSize.z)

  // 3. 钳制深度
  const depth = params.depth ?? 0
  const safeDepth = Math.max(0, Math.min(depth, bboxMax))

  // 4. 计算孔高和中心
  let holeHeight: number
  let holeCenter: THREE.Vector3

  if (safeDepth === 0) {
    // 通孔：按 bbox 裁剪
    const dims = computeThroughHoleDimensions(position, direction, bbox)
    holeHeight = dims.height + 0.2 // 0.1mm each side
    holeCenter = dims.center
  } else {
    // 盲孔
    holeHeight = safeDepth
    holeCenter = computeBlindHoleCenter(position, direction, safeDepth)

    // 螺丝孔带头部时调整中心
    if (params.holeType === 'screw' && params.screwHead && params.screwHead !== 'none') {
      const system = (params.screwSystem as 'metric' | 'imperial') ?? 'metric'
      const specIdx = params.screwSpecIdx ?? 4
      const spec = getScrewSpec(system, specIdx)
      const headHeight = spec.dia
      holeCenter.add(direction.clone().normalize().multiplyScalar(headHeight / 2))
    }
  }

  // 5. 构建孔几何（Z-up，居中于原点）
  const drillHoleParams = {
    diameter: params.diameter,
    depth: depth,
    holeType: params.holeType ?? 'simple',
    direction: 'normal' as const,
    tolerance: params.tolerance ?? 0.3,
    snapEnabled: true,
    screwSystem: (params.screwSystem as 'metric' | 'imperial') ?? 'metric',
    screwSpecIdx: params.screwSpecIdx ?? 4,
    screwThread: (params.screwThread as 'coarse' | 'fine' | 'none') ?? 'coarse',
    screwHead: (params.screwHead as 'hex' | 'chc' | 'none') ?? 'none',
    screwPitchCustom: 0,
    screwLength: 0,
  }
  const holeGeo = buildHoleGeometry(drillHoleParams, holeHeight)

  // 6. 定位孔几何到世界空间
  const holeGeoWorld = positionHoleGeometry(holeGeo, direction, holeCenter)

  // 7. 转换为 ManifoldMeshData
  const holeManifold = geoToManifoldMesh(holeGeoWorld)

  // 8. CSG subtract
  const result = await computeBoolean([shape, holeManifold], 'subtract')

  // 9. 清理
  holeGeo.dispose()
  holeGeoWorld.dispose()

  return result
}
