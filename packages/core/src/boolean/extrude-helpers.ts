/**
 * 拉伸（extrude）几何工具集 —— 从 ExtrudeRenderer.tsx 抽出的纯几何函数。
 *
 * 拉伸的语义（三段模型）：在切割平面把模型切开，得到
 *   - back（下半）：沿法线 N 平移 offsetBack
 *   - middle（中段）：平面处的截面沿 N 挤出 L，落在 [offsetBack, offsetBack + L]
 *   - front（上半）：沿法线 N 平移 offsetFront
 * 其中 offsetFront - offsetBack === L 恒成立（见 computeExtrudeOffsets）。
 *
 * 本模块只负责「全分辨率、几何正确」的那条路径（预览提交 / 无预览直接执行）。
 * 交互期的快速预览走 engine/components/extrude-preview-nosplit.ts（不 split 原模型）。
 *
 * 放在 engine/boolean/ 下的约束：**不得 import stores**（保持与 csg.ts 同层的纯度）。
 * 平面参数（normal / originOffset）由调用方用 computePlaneParams 算好后传入。
 */
import * as THREE from 'three'
import { computeSplit } from '../boolean/csg-backend'
import type { ManifoldMeshData } from '../boolean/csg-backend'

/** 与 extrude-store 的 ExtrusionMode 结构兼容（此处不 import store，避免层级倒置）。 */
export type ExtrudeOffsetMode = 'centered' | 'forward' | 'backward'

/** slice 法取薄片的厚度（沿法线），随后按 L/SLICE_THICKNESS 拉伸。 */
export const SLICE_THICKNESS = 0.2

/**
 * The three mesh parts produced by an extrude operation.
 */
export interface ExtrudeParts {
  front: ManifoldMeshData | null
  back: ManifoldMeshData | null
  extruded: ManifoldMeshData | null
}

/**
 * 三段的位移量。不变量：front - back === length。
 * - centered：平面居中，上下各推 L/2
 * - forward：只推上半 L，下半不动
 * - backward：只拉下半 -L，上半不动
 * @param mode - the offset mode ('centered', 'forward', or 'backward').
 * @param length - the extrusion length L (mm).
 * @returns the front and back displacement amounts, with front - back === length.
 */
export function computeExtrudeOffsets(
  mode: ExtrudeOffsetMode,
  length: number,
): { front: number; back: number } {
  switch (mode) {
    case 'forward':
      return { front: length, back: 0 }
    case 'backward':
      return { front: 0, back: -length }
    case 'centered':
    default:
      return { front: length / 2, back: -length / 2 }
  }
}

/**
 * 由 computePlaneParams 的 (normal, originOffset) 构造 THREE 世界平面。
 *
 * 约定：平面方程为 `N · p = originOffset`；THREE.Plane 用 `N · p + constant = 0`，
 * 故 constant = -originOffset。THREE 裁剪保留 distanceToPoint >= 0 的一侧（法线正侧）。
 * @param normal - the cutting plane normal as a 3-component array.
 * @param originOffset - the plane equation origin offset along the normal.
 * @returns a THREE.Plane and its normalized normal vector.
 */
export function makeWorldPlane(
  normal: [number, number, number],
  originOffset: number,
): { plane: THREE.Plane; normalVec: THREE.Vector3 } {
  const normalVec = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize()
  return {
    plane: new THREE.Plane(normalVec.clone(), -originOffset),
    normalVec,
  }
}

/**
 * 全分辨率构建拉伸三段（世界空间进、世界空间出）。
 *
 * 这是**提交路径的唯一真相**：预览无论用什么近似手段，执行时都走这里重算，
 * so preview geometry errors do not pollute the final model.
 *
 * @param worldMesh   世界空间的源网格（局部几何 × matrixWorld）
 * @param normal      切割平面法线（单位向量）
 * @param originOffset 平面方程 N·p = originOffset 的右端
 * @param length      拉伸长度 L
 * @param mode        三段位移模式
 * @returns the split front, back, and extruded middle mesh parts.
 */
export async function buildExtrudeParts(
  worldMesh: ManifoldMeshData,
  normal: [number, number, number],
  originOffset: number,
  length: number,
  mode: ExtrudeOffsetMode,
): Promise<ExtrudeParts> {
  const { front: offsetFront, back: offsetBack } = computeExtrudeOffsets(mode, length)
  // 拉伸方向 D 恒等于切割平面法线 N
  const D: [number, number, number] = [normal[0], normal[1], normal[2]]

  // 1. 平面处切开 → front / back
  const splitResult = await computeSplit(worldMesh, normal, originOffset)
  let front: ManifoldMeshData | null = splitResult.front
  let back: ManifoldMeshData | null = splitResult.back
  let extruded: ManifoldMeshData | null = null

  // 2. 从 front 再切一片厚 SLICE_THICKNESS 的薄壳
  const capSplit = await computeSplit(splitResult.front, normal, originOffset + SLICE_THICKNESS)

  // 3. 薄壳以平面为锚点沿 N 放大 L/SLICE_THICKNESS → 占据 [originOffset, originOffset+L]
  if (capSplit.back && capSplit.back.indices.length > 0) {
    extruded = scaleMeshAlongNormal(capSplit.back, D, originOffset, length / SLICE_THICKNESS)
  }

  // 4. 三段各自沿 D 位移；中段起点对齐 back 侧
  if (front) front = offsetMesh(front, D, offsetFront)
  if (back) back = offsetMesh(back, D, offsetBack)
  if (extruded) extruded = offsetMesh(extruded, D, offsetBack)

  return { front, back, extruded }
}

/**
 * 沿法线方向按 scaleFactor 缩放每个顶点到平面的有向距离。
 * 平面上的顶点不动，离面顶点按比例外推。
 * @param mesh - the source mesh data to scale.
 * @param normal - the plane normal (unit vector).
 * @param planeOffset - the plane offset along the normal.
 * @param scaleFactor - the scaling factor applied to each vertex's signed distance to the plane.
 * @returns the scaled mesh data (positions rewritten, indices unchanged).
 */
export function scaleMeshAlongNormal(
  mesh: ManifoldMeshData,
  normal: [number, number, number],
  planeOffset: number,
  scaleFactor: number,
): ManifoldMeshData {
  const out = new Float32Array(mesh.positions)
  for (let i = 0; i < out.length; i += 3) {
    const d = out[i] * normal[0] + out[i + 1] * normal[1] + out[i + 2] * normal[2] - planeOffset
    const delta = d * scaleFactor - d
    out[i] += normal[0] * delta
    out[i + 1] += normal[1] * delta
    out[i + 2] += normal[2] * delta
  }
  return { positions: out, indices: mesh.indices }
}

/**
 * 整体沿 direction 平移 distance（distance 为 0 时原样返回，不拷贝）。
 * @param mesh - the source mesh data to translate.
 * @param direction - the translation direction (not necessarily unit length).
 * @param distance - the translation distance (mm); 0 returns the mesh unchanged.
 * @returns the translated mesh data (positions rewritten, indices unchanged).
 */
export function offsetMesh(
  mesh: ManifoldMeshData,
  direction: [number, number, number],
  distance: number,
): ManifoldMeshData {
  if (distance === 0) return mesh
  const dx = direction[0] * distance
  const dy = direction[1] * distance
  const dz = direction[2] * distance
  const out = new Float32Array(mesh.positions)
  for (let i = 0; i < out.length; i += 3) {
    out[i] += dx
    out[i + 1] += dy
    out[i + 2] += dz
  }
  return { positions: out, indices: mesh.indices }
}
