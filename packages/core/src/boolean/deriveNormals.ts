import { deriveCreasedNormalsData } from './creased-normals'
import type { Shape } from '../mesh/types'

/**
 * 统一的法线派生函数（折边法线）。
 *
 * 取代散落在各处的 `geometry.computeVertexNormals()`。后者在**索引（共享顶点）
 * 几何**上会把相邻三角面的法线取平均 → 棱边被"磨圆"。这正是钻孔/布尔/分割操作后
 * model visual anomalies after drilling/boolean/split operations.
 *
 * 算法本体在 `./creased-normals`（零依赖移植 three 的 toCreasedNormals；本文件只是
 * Shape ↔ 数据的薄适配）。场景内核（scene-kernel）消费同算法的数据版
 * `deriveCreasedNormalsData`——经 `@faicad/faijs/env-agnostic` 导出、不 import three，
 * 避免经依赖包间接引入第二份 three（weapp 方案 §1.1.1）：
 * 锐边处"裂开"法线 → 锐边保持锐利，仅对近共面 / 真实曲面（如钻孔内壁）平滑。
 * 输入若是索引几何会被展开为非索引（单条法线属性无法在共享顶点上表达锐边），
 * 因此返回的几何**可能是非索引的**——这是预期且正确的表示，且与 STL 源零件
 * 本就是非索引一致，使各格式往返统一。
 *
 * 约定：项目中所有"需要派生法线"之处（操作结果、STL/3MF 导入）都经此函数，
 * 不得再直接调用 `computeVertexNormals()`。
 * @param shape - the indexed shape to derive creased (folded) normals for.
 * @param creaseAngleDeg - the dihedral-angle threshold in degrees above which normals are split (default 60).
 * @returns a Shape with creased normals applied; it may be non-indexed (sequential indices).
 */
export function deriveNormals(shape: Shape, creaseAngleDeg = 60): Shape {
  const positions = shape.positions
  const indices = shape.indices

  const result = deriveCreasedNormalsData({
    positions,
    // creased-normals expects Uint32Array | null; our indices are already Uint32Array.
    indices: indices.length > 0 ? indices : null,
    creaseAngleDeg,
  })

  // creased-normals always returns non-indexed output; build sequential indices.
  const vertCount = result.positions.length / 3
  const seq = new Uint32Array(vertCount)
  for (let i = 0; i < vertCount; i++) seq[i] = i

  return {
    positions: result.positions,
    indices: seq,
    normals: result.normals,
  }
}
