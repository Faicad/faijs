/**
 * Mesh → CAD 实体重建管线。
 *
 * 移植自 SketchForge-3D 项目的 `cadModifier.worker.ts` 中的 mesh 路径
 * (ported from SketchForge-3D cadModifier.worker.ts).
 *
 * 核心流程：
 * 1. 三角网格 → ASCII STL 文本 → OCCT importStl
 * 2. 首次修复 fixShape
 * 3. 若 isSolid → 直接愈合管线（healSolid + fixFaceOrientations + removeDegenerateEdges + unifySameDomain）
 * 4. 若失败 → 面缝合管线（多容差 sewAndSolidify 循环）
 *
 * 与 occtWasmKernel.ts 中已有的 meshesToStep() 相比，此管线更健壮：
 * - 使用 importStl（而非逐三角形 buildTriFace）
 * - 多阶段愈合（fixShape → healSolid → fixFaceOrientations → removeDegenerateEdges → unifySameDomain）
 * - 多容差面缝合回退（1e-5 → 1e-4 → 1e-3 → 1e-2）
 * - isValid 验证
 */

import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'

// ─── 验证 ───

/**
 * Validate whether an OCCT shape is a legal topology.
 * Calls kernel.isValid() to check: solid closedness, each edge belongs to exactly
 * two faces, consistent face orientation, etc.
 *
 * @param kernel - the initialized OCCT kernel
 * @param shape - the shape to validate
 * @returns true when the shape is valid, false otherwise
 */
export function cadShapeIsValid(kernel: BrepEngineApi, shape: BrepHandle): boolean {
  try {
    return kernel.isValid(shape)
  } catch {
    return false
  }
}

// ─── STL 序列化 ───

/**
 * Serialize triangle mesh data as ASCII STL text.
 *
 * OCCT's importStl accepts a string input, so ASCII STL can be built directly
 * without any File/Blob dependency.
 *
 * Each triangle emits a facet block containing a normal and three vertex
 * coordinates. The normal is computed via cross product and normalized (OCCT
 * recomputes normals after import; this is only temporary).
 *
 * @param positions - vertex array [x0,y0,z0, x1,y1,z1, ...]
 * @param indices - triangle index array [i0,i1,i2, i3,i4,i5, ...]
 * @returns the ASCII STL text
 */
export function meshToAsciiStl(positions: Float32Array, indices: Uint32Array): string {
  if (!positions || positions.length === 0 || !indices || indices.length === 0) {
    throw new Error('The selected object has no mesh data')
  }

  const lines: string[] = ['solid mesh_reconstruct']

  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const ai = indices[offset] * 3
    const bi = indices[offset + 1] * 3
    const ci = indices[offset + 2] * 3

    const ax = positions[ai], ay = positions[ai + 1], az = positions[ai + 2]
    const bx = positions[bi], by = positions[bi + 1], bz = positions[bi + 2]
    const cx = positions[ci], cy = positions[ci + 1], cz = positions[ci + 2]

    // 叉积计算面法线
    const abx = bx - ax, aby = by - ay, abz = bz - az
    const acx = cx - ax, acy = cy - ay, acz = cz - az
    let nx = aby * acz - abz * acy
    let ny = abz * acx - abx * acz
    let nz = abx * acy - aby * acx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length; ny /= length; nz /= length

    lines.push(
      `facet normal ${nx} ${ny} ${nz}`,
      ' outer loop',
      `  vertex ${ax} ${ay} ${az}`,
      `  vertex ${bx} ${by} ${bz}`,
      `  vertex ${cx} ${cy} ${cz}`,
      ' endloop',
      'endfacet',
    )
  }

  lines.push('endsolid mesh_reconstruct')
  return lines.join('\n')
}

// ─── 重建管线 ───

/**
 * Rebuild a CAD solid from a triangle mesh.
 *
 * Full flow:
 * 1. mesh → ASCII STL → OCCT importStl
 * 2. fixShape base repair
 * 3. if isSolid → direct healing pipeline
 * 4. on failure → multi-tolerance face-sewing pipeline
 *
 * @param kernel - the initialized OCCT kernel
 * @param positions - vertex array [x0,y0,z0, x1,y1,z1, ...]
 * @param indices - triangle index array [i0,j0,k0, i1,j1,k1, ...]
 * @returns the reconstructed solid shape handle (caller is responsible for releasing)
 * @throws if the mesh is open or non-manifold
 */
export function reconstructSolidFromMesh(
  kernel: BrepEngineApi,
  positions: Float32Array,
  indices: Uint32Array,
): BrepHandle {
  // 步骤①: 三角网格 → ASCII STL → OCCT 导入
  const stlText = meshToAsciiStl(positions, indices)
  const imported = kernel.importStl(stlText)

  // 步骤②: 首次修复
  let shape = kernel.fixShape(imported)

  // 步骤③: 若已是 Solid → 直接愈合管线
  if (kernel.isSolid(shape)) {
    try {
      shape = kernel.healSolid(shape, 1e-4)
      shape = kernel.fixFaceOrientations(shape)
      shape = kernel.removeDegenerateEdges(shape)
      shape = kernel.unifySameDomain(shape)
    } catch {
      // 愈合失败 → 降级到面缝合
    }
    if (kernel.isSolid(shape) && cadShapeIsValid(kernel, shape)) {
      kernel.release(imported)
      return shape
    }
  }

  // 步骤④: 面缝合管线（多容差尝试）
  const faces = kernel.getSubShapes(imported, 'face')
  if (faces.length === 0) {
    kernel.release(imported)
    throw new Error('The selected object has no closed faces')
  }

  for (const tolerance of [1e-5, 1e-4, 1e-3, 1e-2]) {
    try {
      let candidate = kernel.sewAndSolidify(faces, tolerance)
      candidate = kernel.fixShape(candidate)
      if (kernel.isSolid(candidate)) candidate = kernel.healSolid(candidate, tolerance)
      candidate = kernel.fixFaceOrientations(candidate)
      candidate = kernel.removeDegenerateEdges(candidate)
      candidate = kernel.unifySameDomain(candidate)
      if (kernel.isSolid(candidate) && cadShapeIsValid(kernel, candidate)) {
        kernel.release(imported)
        return candidate
      }
      // 未通过验证，释放候选
      try { kernel.release(candidate) } catch { /* ignore */ }
    } catch {
      // 尝试下一个更大的容差
    }
  }

  kernel.release(imported)
  throw new Error('The selected mesh is open or non-manifold. Repair it before converting to CAD.')
}

// ─── 便捷导出 ───

/**
 * Rebuild a CAD solid from a triangle mesh and export it as a STEP string.
 *
 * Internally calls reconstructSolidFromMesh, then exportStep.
 * The returned STEP uses a BREP representation (ADVANCED_FACE + exact surfaces)
 * rather than a faceted representation (POLYGONAL_FACE).
 *
 * @param kernel - the initialized OCCT kernel
 * @param positions - vertex array
 * @param indices - triangle index array
 * @returns the STEP file content string
 */
export function meshToStepBrep(
  kernel: BrepEngineApi,
  positions: Float32Array,
  indices: Uint32Array,
): string {
  const solid = reconstructSolidFromMesh(kernel, positions, indices)
  try {
    return kernel.exportStep(solid)
  } finally {
    kernel.release(solid)
  }
}
