/**
 * mesh 拉伸 API
 *
 * 提取来源：engine/boolean/extrude-helpers.ts (buildExtrudeParts)
 * 已是纯数据函数（ManifoldMeshData 输入输出），直接包装。
 *
 * 拉伸语义（三段模型）：
 * - back（下半）：沿法线 N 平移 offsetBack
 * - middle（中段）：平面处的截面沿 N 挤出 L
 * - front（上半）：沿法线 N 平移 offsetFront
 * 其中 offsetFront - offsetBack === length 恒成立。
 */

import { computeBoolean } from '../boolean/csg-backend'
import { buildExtrudeParts } from '../boolean/extrude-helpers'
import type { ManifoldMeshData } from '../boolean/csg-backend'
import type { Shape, ExtrudeParams } from './types'

/**
 * 执行拉伸：在切割平面处将模型切开，中段沿法线挤出 length。
 *
 * 输入：世界空间 Shape + 拉伸参数
 * 输出：世界空间 Shape（拉伸结果，三段 union 为单体）
 */
export async function extrude(shape: Shape, params: ExtrudeParams): Promise<Shape> {
  const mode = params.mode ?? 'centered'

  const { front, back, extruded } = await buildExtrudeParts(
    shape as ManifoldMeshData,
    params.normal,
    params.originOffset,
    params.length,
    mode,
  )

  // Union 三段为单体
  const meshesToUnion: ManifoldMeshData[] = []
  for (const part of [front, extruded, back]) {
    if (!part || part.indices.length === 0) continue
    meshesToUnion.push(part)
  }

  if (meshesToUnion.length === 0) {
    throw new Error('No valid geometry to extrude')
  }

  if (meshesToUnion.length === 1) {
    return meshesToUnion[0]
  }

  return computeBoolean(meshesToUnion, 'union')
}
