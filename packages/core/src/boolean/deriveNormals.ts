import { BufferGeometry, BufferAttribute } from 'three'
import { deriveCreasedNormalsData } from '../mesh/creased-normals'

/**
 * 统一的法线派生函数（折边法线）。
 *
 * 取代散落在各处的 `geometry.computeVertexNormals()`。后者在**索引（共享顶点）
 * 几何**上会把相邻三角面的法线取平均 → 棱边被"磨圆"。这正是钻孔/布尔/分割操作后
 * model visual anomalies after drilling/boolean/split operations.
 *
 * 算法本体在 `../mesh/creased-normals`（零依赖移植 three 的 toCreasedNormals）：
 * 锐边处"裂开"法线 → 锐边保持锐利，仅对近共面 / 真实曲面（如钻孔内壁）平滑。
 * 输入若是索引几何会被展开为非索引（单条法线属性无法在共享顶点上表达锐边），
 * 因此返回的几何**可能是非索引的**——这是预期且正确的表示，且与 STL 源零件
 * 本就是非索引一致，使各格式往返统一。
 *
 * 约定：项目中所有"需要派生法线"之处（操作结果、STL/3MF 导入）都经此函数，
 * 不得再直接调用 `computeVertexNormals()`。
 * @param geometry - the indexed geometry to derive creased (folded) normals for.
 * @param creaseAngleDeg - the dihedral-angle threshold in degrees above which normals are split (default 60).
 * @returns a BufferGeometry with creased normals applied; it may be non-indexed.
 */
export function deriveNormals(geometry: BufferGeometry, creaseAngleDeg = 60): BufferGeometry {
  const posAttr = geometry.getAttribute('position') as BufferAttribute | undefined
  if (!posAttr) {
    throw new Error('[deriveNormals] geometry has no position attribute')
  }
  const indexAttr = geometry.getIndex()
  const positions = posAttr.array as Float32Array
  const indices = indexAttr ? (indexAttr.array as ArrayLike<number>) : null

  const result = deriveCreasedNormalsData({
    positions,
    // creased-normals expects Uint32Array | null; widen typed index arrays.
    indices: indices ? new Uint32Array(indices) : null,
    creaseAngleDeg,
  })

  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(result.positions, 3))
  out.setAttribute('normal', new BufferAttribute(result.normals, 3, false))
  return out
}
