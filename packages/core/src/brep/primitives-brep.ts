/**
 * mesh BREP 基本体 API — 使用 OCCT 精确实体构造
 *
 * See docs/api-contract.md §8 (dual-path geometry contract: BREP / Mesh).
 *
 * 与 `primitives.ts`（mesh 路径）的对照：
 * - mesh 路径：THREE 参数几何 → geoToManifoldMesh → Shape（三角网格近似）
 * - BREP 路径：OCCT 精确实体 → meshShape 三角化 → Shape（显示用 mesh，但底层是精确 BREP）
 *
 * 两条路径返回的 Shape 都是 { positions, indices }，显示管线一致。
 * 差异仅在：BREP 路径的 Shape 由 OCCT 精确实体三角化得到，曲面精度更高；
 * 且导出 STEP 时可短路为原生 ADVANCED_FACE（而非 faceted 重建）。
 *
 * segments 参数的处理：
 * - mesh 路径：segments 直接控制 THREE 几何体的分段数
 * - BREP 路径：segments 转换为 angularDeflection（≈2π/segments）控制 OCCT 三角化精度
 *   BREP 实体本身是精确的，segments 只影响显示 mesh 的精度
 *
 * 坐标系：Z-up、毫米，与 mesh 路径一致。
 */

import { getBrepEngine } from './engine/registry'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import type { BrepHandle } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'
import type {
  Shape,
  BoxParams,
  SphereParams,
  CylinderParams,
  ConeParams,
  WedgeParams,
} from '../mesh/types'
import { clampNRad } from '../mesh/types'

// ─── 内部工具 ───

/**
 * 将 segments 数转换为 OCCT meshShape 的 angularDeflection。
 *
 * segments=32 → angularDeflection≈2π/32≈0.196 rad
 * segments 越大，三角化越精细。
 */
function segmentsToAngularDeflection(segments?: number): number {
  const segs = segments ?? 32
  return (2 * Math.PI) / Math.max(3, segs)
}

/**
 * 用 OCCT 构造 BREP 实体并三角化为 Shape。
 *
 * 内部流程：注册表取当前 BREP 引擎 → primitiveToBrepSolid（引擎精确构造）→ meshShape → release → Shape
 *
 * @param type      primitive 类型（cube/sphere/cylinder/cone/wedge）
 * @param params    完整参数对象
 * @param segments  可选分段数（影响三角化精度，不影响 BREP 实体精度）
 * @returns Shape（三角化 mesh，供显示用）
 */
async function brepToShape(
  type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'wedge',
  params: BoxParams | SphereParams | CylinderParams | ConeParams | WedgeParams,
  segments?: number,
): Promise<Shape> {
  const kernel: BrepEngineApi = (await getBrepEngine()).primitives

  // 用升级后的 primitiveToBrepSolid 构造 OCCT 精确实体
  const result = primitiveToBrepSolid(kernel, type, params)
  const solid: BrepHandle = result.solid

  try {
    // 三角化为显示 mesh
    const angularDeflection = segmentsToAngularDeflection(segments)
    const mesh = kernel.meshShape(solid, {
      linearDeflection: 0.1,
      angularDeflection,
    })

    // 返回 Shape（与 mesh 路径格式一致）
    return {
      positions: new Float32Array(mesh.positions),
      indices: new Uint32Array(mesh.indices),
    }
  } finally {
    kernel.release(solid)
  }
}

// ─── BREP 创建 API ───

/** 用 OCCT 精确实体创建立方体，三角化为 Shape */
export async function boxBrep(params: BoxParams): Promise<Shape> {
  return brepToShape('cube', params)
}

/** 用 OCCT 精确实体创建球体，三角化为 Shape */
export async function sphereBrep(params: SphereParams): Promise<Shape> {
return brepToShape('sphere', params, clampNRad(params.nRad ?? params.segments))
}

/** 用 OCCT 精确实体创建圆柱体，三角化为 Shape */
export async function cylinderBrep(params: CylinderParams): Promise<Shape> {
return brepToShape('cylinder', params, clampNRad(params.nRad ?? params.segments))
}

/** 用 OCCT 精确实体创建圆锥体，三角化为 Shape */
export async function coneBrep(params: ConeParams): Promise<Shape> {
return brepToShape('cone', params, clampNRad(params.nRad ?? params.segments))
}

/** 用 OCCT 精确实体创建楔形体，三角化为 Shape */
export async function wedgeBrep(params: WedgeParams): Promise<Shape> {
  return brepToShape('wedge', params)
}
