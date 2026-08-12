import { BufferGeometry } from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * 统一的法线派生函数（折边法线）。
 *
 * 取代散落在各处的 `geometry.computeVertexNormals()`。后者在**索引（共享顶点）
 * 几何**上会把相邻三角面的法线取平均 → 棱边被"磨圆"。这正是钻孔/布尔/分割操作后
 * 模型视觉异常的根因（见 docs/plans/2026-08-10-operation-result-material-consistency-design.md）。
 *
 * `toCreasedNormals` 只在二面角大于 `creaseAngleDeg` 的边处"裂开"法线 → 锐边保持锐利，
 * 仅对近共面 / 真实曲面（如钻孔内壁）平滑。它内部会把索引几何 `toNonIndexed()`
 * （单条法线属性无法在共享顶点上表达锐边），因此返回的几何**可能是非索引的**——
 * 这是预期且正确的表示，且与 STL 源零件本就是非索引一致，使各格式往返统一。
 *
 * 约定：项目中所有"需要派生法线"之处（操作结果、STL/3MF 导入）都经此函数，
 * 不得再直接调用 `computeVertexNormals()`。
 */
export function deriveNormals(geometry: BufferGeometry, creaseAngleDeg = 60): BufferGeometry {
  const creaseAngle = (creaseAngleDeg * Math.PI) / 180
  return toCreasedNormals(geometry, creaseAngle)
}
