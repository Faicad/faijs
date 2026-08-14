/**
 * Primitive → CAD 实体转换。
 *
 * 将本项目的各种 primitive（cube, sphere, cylinder, cone, wedge, screw）
 * 转换为 OCCT CAD 实体（Solid），并支持导出为 BREP 格式的 STEP 文件。
 *
 * 两条路径：
 *
 * 1. **直接构造路径**（primitive path）：
 *    对于有 OCCT 直接对应的基本体（cube, sphere, cylinder, cone, wedge），
 *    直接调用 OCCT 构造函数（makeBox, makeSphere, makeCylinder, makeCone）
 *    或用 extrude 从 2D 轮廓构造（wedge）。
 *    产出精确 BREP——平面是 PLANE，圆柱面是 CYLINDRICAL_SURFACE，等。
 *
 * 2. **Mesh 重建路径**（mesh path）：
 *    对于无 OCCT 直接对应的复杂形状（screw, text），从 THREE.js BufferGeometry
 *    提取三角网格，经 meshReconstruct.ts 的多阶段愈合管线重建为 Solid。
 *    产出仍为 BREP，但曲面由多个小三角平面近似（faceted）。在本项目里，默认brep模型不包含此类近似的到的模型。
 *
 * 坐标系：本项目 primitive 为 Z-up（经过 ROT_Y_TO_Z 旋转），
 * OCCT 默认也是 Z-up，因此直接对应，无需额外轴转换。
 */

import type * as THREE from 'three'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { PrimitiveType } from './types'
import { reconstructSolidFromMesh } from '../occt-kernel/meshReconstruct'
import type {
  BoxParams,
  SphereParams,
  CylinderParams,
  ConeParams,
  WedgeParams,
} from '../mesh/types'

// ─── 辅助：从 BufferGeometry 提取网格数据 ───

/**
 * 从 THREE.BufferGeometry 提取 positions + indices，供 mesh 重建路径使用。
 *
 * 处理 indexed 和 non-indexed 几何体。
 * 对 non-indexed 几何体自动创建顺序索引。
 */
export function extractMeshData(geo: THREE.BufferGeometry): {
  positions: Float32Array
  indices: Uint32Array
} {
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute
  if (!posAttr) throw new Error('Geometry has no position attribute')

  const positions = new Float32Array(posAttr.array)

  const idxAttr = geo.getIndex()
  let indices: Uint32Array
  if (idxAttr) {
    indices = new Uint32Array(idxAttr.array)
  } else {
    // Non-indexed: create sequential indices
    indices = new Uint32Array(posAttr.count)
    for (let i = 0; i < posAttr.count; i++) indices[i] = i
  }

  return { positions, indices }
}

// ─── 直接构造路径 ───

/** 应用 center 偏移到 OCCT solid（如果有 center 参数）。 */
function applyCenter(kernel: OcctKernel, solid: ShapeHandle, center?: [number, number, number]): ShapeHandle {
  if (!center) return solid
  const translated = kernel.translate(solid, center[0], center[1], center[2])
  kernel.release(solid)
  return translated
}

/**
 * 用 OCCT 直接构造一个立方体 Solid。
 *
 * 接收完整 BoxParams：size 可以是 number（等边）或 Vec3 [w, h, d]。
 *
 * 与 mesh 路径一致性：mesh 侧 BoxGeometry(w, h, d) 经 ROT_Y_TO_Z 后
 * 轴变为 X=w, Y=d, Z=h（Y/Z 互换），因此 OCCT 的 corners 也按此映射。
 */
function cubeToCadSolid(kernel: OcctKernel, params: BoxParams): ShapeHandle {
  let w: number, h: number, d: number
  if (Array.isArray(params.size)) {
    [w, h, d] = params.size
  } else {
    w = h = d = params.size
  }
  // ROT_Y_TO_Z swaps Y and Z: mesh final dims are X=w, Y=d, Z=h
  const solid = kernel.makeBoxFromCorners(
    { x: -w / 2, y: -d / 2, z: -h / 2 },
    { x: w / 2, y: d / 2, z: h / 2 },
  )
  return applyCenter(kernel, solid, params.center)
}

/**
 * 用 OCCT 直接构造一个球体 Solid。
 *
 * 接收完整 SphereParams：radius 是球体半径，segments 不影响 BREP（仅影响 mesh 离散化）。
 */
function sphereToCadSolid(kernel: OcctKernel, params: SphereParams): ShapeHandle {
  const solid = kernel.makeSphere(params.radius)
  return applyCenter(kernel, solid, params.center)
}

/**
 * 用 OCCT 直接构造一个圆柱体 Solid。
 *
 * 接收完整 CylinderParams：radius/height 独立指定，segments 不影响 BREP。
 *
 * OCCT 的 makeCylinder 创建从 Z=0 到 Z=height 的圆柱体，
 * 需要平移使其以原点为中心。
 */
function cylinderToCadSolid(kernel: OcctKernel, params: CylinderParams): ShapeHandle {
  const solid = kernel.makeCylinder(params.radius, params.height)
  // 平移使圆柱以原点为中心（OCCT 从 Z=0 创建，需下移 height/2）
  const centered = kernel.translate(solid, 0, 0, -params.height / 2)
  kernel.release(solid)
  return applyCenter(kernel, centered, params.center)
}

/**
 * 用 OCCT 直接构造一个圆锥体 Solid。
 *
 * 接收完整 ConeParams：radiusBottom/radiusTop/height 独立指定，segments 不影响 BREP。
 *
 * OCCT 的 makeCone(r1, r2, height) 中 r1=底半径、r2=顶半径。
 */
function coneToCadSolid(kernel: OcctKernel, params: ConeParams): ShapeHandle {
  const solid = kernel.makeCone(params.radiusBottom, params.radiusTop, params.height)
  // 平移使圆锥以原点为中心
  const centered = kernel.translate(solid, 0, 0, -params.height / 2)
  kernel.release(solid)
  return applyCenter(kernel, centered, params.center)
}

/**
 * 用 OCCT 从 2D 梯形轮廓拉伸构造楔形体 Solid。
 *
 * 支持全参数（width/height/angle/length），向后兼容旧式 { size: number }。
 *
 * 参数（来自 WedgePanel.buildWedgeGeometry）：
 * - 底边宽度 width（沿 Y）
 * - 高度 height（沿 Z）
 * - 底边与斜边的夹角 angleDeg
 * - 拉伸总长 length（沿 X，从 -length/2 到 +length/2）
 *
 * 构造步骤：
 * 1. 在 YZ 平面创建梯形 wire（4 个顶点，4 条边）
 * 2. 从 wire 创建 planar face
 * 3. 沿 X 轴拉伸
 * 4. 平移使 X 方向居中
 */
function wedgeToCadSolid(kernel: OcctKernel, params: WedgeParams): ShapeHandle {
  const width = params.width                    // 底边长度（沿 Y）
  const height = params.height                  // 梯形高（沿 Z）
  const angleDeg = params.angle                 // 底边与斜边的夹角
  const length = params.length                  // 拉伸总长（沿 X）
  const angleRad = (angleDeg * Math.PI) / 180
  const halfExtrude = length / 2
  const hw = width / 2

  // 上边半宽 = 底边半宽 - 高 / tan(角度)
  const halfTopWidth = Math.max(0, hw - height / Math.tan(angleRad))

  // 在 YZ 平面创建梯形 wire（X=0）
  const edges: ShapeHandle[] = [
    kernel.makeLineEdge(
      { x: 0, y: -hw, z: 0 },
      { x: 0, y: hw, z: 0 },
    ),
    kernel.makeLineEdge(
      { x: 0, y: hw, z: 0 },
      { x: 0, y: halfTopWidth, z: height },
    ),
    kernel.makeLineEdge(
      { x: 0, y: halfTopWidth, z: height },
      { x: 0, y: -halfTopWidth, z: height },
    ),
    kernel.makeLineEdge(
      { x: 0, y: -halfTopWidth, z: height },
      { x: 0, y: -hw, z: 0 },
    ),
  ]

  const wire = kernel.makeWire(edges)
  const face = kernel.makeFace(wire)
  const extruded = kernel.extrude(face, 2 * halfExtrude, 0, 0)
  // 平移使 X 方向居中
  const centered = kernel.translate(extruded, -halfExtrude, 0, 0)

  // 释放中间句柄
  for (const e of edges) kernel.release(e)
  kernel.release(wire)
  kernel.release(face)
  kernel.release(extruded)

  return applyCenter(kernel, centered, params.center)
}

// ─── 统一入口 ───

/**
 * 转换结果：包含 CAD 实体句柄和所使用的路径类型。
 */
export interface PrimitiveToBrepResult {
  /** CAD 实体句柄（调用方负责释放） */
  solid: ShapeHandle
  /** 使用的构造路径 */
  path: 'primitive' | 'mesh'
  /** primitive 类型 */
  type: PrimitiveType | 'screw' | 'text'
}

/** 所有基本体参数的联合类型 */
export type PrimitiveParams = BoxParams | SphereParams | CylinderParams | ConeParams | WedgeParams

/**
 * 将旧的 size 数字转换为对应类型的完整 params（向后兼容）。
 *
 * - cube: { size: size }
 * - wedge:   { width: size, height: size/2, angle: 60, length: 50 }
 * - sphere:     { radius: size / 2 }
 * - cylinder:   { radius: size / 2, height: size }
 * - cone:       { radiusBottom: size / 2, radiusTop: 0, height: size }
 */
function sizeToParams(type: PrimitiveType | 'screw' | 'text', size: number): PrimitiveParams {
  switch (type) {
    case 'cube':
      return { size }
    case 'sphere':
      return { radius: size / 2 }
    case 'cylinder':
      return { radius: size / 2, height: size }
    case 'cone':
      return { radiusBottom: size / 2, radiusTop: 0, height: size }
    case 'wedge':
      return { width: size, height: size / 2, angle: 60, length: 50 }
    default:
      return { size }
  }
}

/**
 * 将本项目的 primitive 转换为 OCCT CAD 实体。
 *
 * - cube, sphere, cylinder, cone, wedge：使用 OCCT 直接构造（精确 BREP）
 * - screw, text：使用 mesh 重建路径（faceted BREP）
 *
 * @param kernel  已初始化的 OCCT 内核
 * @param type    primitive 类型
 * @param params  完整参数对象（BoxParams 等），或 size 数字（向后兼容，默认 20mm）
 * @returns CAD 实体 + 路径信息
 */
export function primitiveToBrepSolid(
  kernel: OcctKernel,
  type: PrimitiveType | 'screw' | 'text',
  params?: PrimitiveParams | number,
): PrimitiveToBrepResult {
  const fullParams = typeof params === 'number' || params === undefined
    ? sizeToParams(type, params ?? 20)
    : params

  switch (type) {
    case 'cube':
      return { solid: cubeToCadSolid(kernel, fullParams as BoxParams), path: 'primitive', type }

    case 'sphere':
      return { solid: sphereToCadSolid(kernel, fullParams as SphereParams), path: 'primitive', type }

    case 'cylinder':
      return { solid: cylinderToCadSolid(kernel, fullParams as CylinderParams), path: 'primitive', type }

    case 'cone':
      return { solid: coneToCadSolid(kernel, fullParams as ConeParams), path: 'primitive', type }

    case 'wedge':
      return { solid: wedgeToCadSolid(kernel, fullParams as WedgeParams), path: 'primitive', type }

    case 'screw':
    case 'text': {
      // Mesh 重建路径：从 THREE.js 几何体提取网格数据
      // 对于 screw/text，调用方应使用 geometryToBrepSolid
      throw new Error(
        `${type} requires geometry data — use geometryToBrepSolid() instead`,
      )
    }

    default:
      throw new Error(`Unsupported primitive type: ${type}`)
  }
}

/**
 * 从 THREE.BufferGeometry 通过 mesh 重建路径创建 CAD 实体。
 *
 * 适用于无法直接构造的复杂形状（screw, text, SVG extrude 等）。
 *
 * @param kernel  已初始化的 OCCT 内核
 * @param geo     THREE.js BufferGeometry
 * @returns CAD 实体 + 路径信息
 */
export function geometryToBrepSolid(
  kernel: OcctKernel,
  geo: THREE.BufferGeometry,
): PrimitiveToBrepResult {
  const { positions, indices } = extractMeshData(geo)
  const solid = reconstructSolidFromMesh(kernel, positions, indices)
  return { solid, path: 'mesh', type: 'screw' }
}

/**
 * 将 CAD 实体导出为 BREP 格式的 STEP 字符串。
 *
 * OCCT 的 exportStep 产出标准 ISO-10303-21 STEP 文件，
 * 使用 ADVANCED_FACE + 精确曲面（PLANE, CYLINDRICAL_SURFACE 等），
 * 而非 faceted 表示（POLYGONAL_FACE）。
 *
 * @param kernel  已初始化的 OCCT 内核
 * @param solid   CAD 实体句柄
 * @returns STEP 文件内容字符串
 */
export function brepSolidToStep(kernel: OcctKernel, solid: ShapeHandle): string {
  return kernel.exportStep(solid)
}

/**
 * 便捷方法：将 primitive 直接转换为 STEP 字符串。
 *
 * 内部调用 primitiveToBrepSolid + brepSolidToStep，自动管理句柄生命周期。
 *
 * @param kernel  已初始化的 OCCT 内核
 * @param type    primitive 类型
 * @param params  完整参数对象，或 size 数字（向后兼容，默认 20mm）
 * @returns STEP 文件内容字符串 + 使用的路径
 */
export function primitiveToBrepStep(
  kernel: OcctKernel,
  type: PrimitiveType,
  params?: PrimitiveParams | number,
): { step: string; path: 'primitive' | 'mesh' } {
  const result = primitiveToBrepSolid(kernel, type, params)
  try {
    const step = brepSolidToStep(kernel, result.solid)
    return { step, path: result.path }
  } finally {
    kernel.release(result.solid)
  }
}
