/**
 * meshdata/ops — 作用在 Shape / 原始数组上的纯函数几何操作（L1 容器操作）。
 *
 * 替代 three `BufferGeometry` 的少量方法面（`toNonIndexed`、`computeVertexNormals`、
 * `applyMatrix4`/`translate`、`clone`、merge）——**纯函数集，不给对外 `Shape` 挂方法**
 * （与设计 §3.3 一致）。不重复 `mesh/query.ts` 已有的 `boundingBox`/`volume` 等查询。
 */

import { Vec3, type MatrixLike } from '../../math3d'
import type { Shape } from '../types'
import { weldMesh, type MeshData } from './weld'

export type { MatrixLike }

/**
 * Weld raw positions+indices into a mesh Shape (same behaviour as the old
 * `geoToManifoldMesh` on a position-only geometry).
 * @param positions - flat position array (x, y, z, ...).
 * @param indices - triangle index array into `positions`.
 * @param extra - optional extra Shape fields to attach (e.g. `faceRanges`).
 * @returns the welded Shape.
 */
export function shapeFromMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  extra?: Partial<Shape>,
): Shape {
  const mesh = weldMesh(positions, indices)
  return { positions: mesh.positions, indices: mesh.indices, ...extra }
}

/**
 * Expand an indexed Shape to non-indexed (each triangle gets its own vertices),
 * mirroring three `BufferGeometry.toNonIndexed`.
 * @param shape - the indexed shape.
 * @returns a non-indexed copy of the shape.
 */
export function toNonIndexed(shape: Shape): MeshData {
  const positions = shape.positions
  const indices = shape.indices
  const out = new Float32Array(indices.length * 3)
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] * 3
    out[i * 3] = positions[v]
    out[i * 3 + 1] = positions[v + 1]
    out[i * 3 + 2] = positions[v + 2]
  }
  const seq = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) seq[i] = i
  return { positions: out, indices: seq }
}

/**
 * Apply a 4x4 matrix to a Shape's vertices (bakes the transform).
 * @param shape - the source shape.
 * @param m - column-major 4x4 matrix.
 * @returns a new shape with transformed vertices (indices/other fields preserved).
 */
export function transformShape(shape: Shape, m: MatrixLike): Shape {
  const out = new Float32Array(shape.positions.length)
  const v = new Vec3()
  for (let i = 0; i < shape.positions.length; i += 3) {
    v.set(shape.positions[i], shape.positions[i + 1], shape.positions[i + 2])
    v.applyMatrix4(m)
    out[i] = v.x
    out[i + 1] = v.y
    out[i + 2] = v.z
  }
  return { ...shape, positions: out }
}

/**
 * Translate a Shape's vertices by (x, y, z).
 * @param shape - the source shape.
 * @param x - X offset.
 * @param y - Y offset.
 * @param z - Z offset.
 * @returns a new shape with translated vertices.
 */
export function translateShape(shape: Shape, x: number, y: number, z = 0): Shape {
  if (x === 0 && y === 0 && z === 0) return { ...shape }
  const out = new Float32Array(shape.positions)
  for (let i = 0; i < out.length; i += 3) {
    out[i] += x
    out[i + 1] += y
    out[i + 2] += z
  }
  return { ...shape, positions: out }
}

/**
 * Compute per-vertex normals with three `BufferGeometry.computeVertexNormals`
 * semantics (face normals averaged across shared vertices).
 *
 * **折边红线提醒**：在索引（共享顶点）几何上这会把棱边"磨圆"——core 的派生法线
 * 一律走 `boolean/creased-normals.ts`（`deriveNormals`）。本函数只为替换 three 的
 * **罕见**直调用点而保留，返回纯数据，不改变 Shape。
 * @param shape - the source shape.
 * @returns a Float32Array of per-vertex normals.
 */
export function computeVertexNormals(shape: Shape): Float32Array {
  const positions = shape.positions
  const indices = shape.indices
  const normals = new Float32Array(positions.length)
  const pA = new Vec3()
  const pB = new Vec3()
  const pC = new Vec3()
  const cb = new Vec3()
  const ab = new Vec3()

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    pA.set(positions[a], positions[a + 1], positions[a + 2])
    pB.set(positions[b], positions[b + 1], positions[b + 2])
    pC.set(positions[c], positions[c + 1], positions[c + 2])
    cb.subVectors(pC, pB)
    ab.subVectors(pA, pB)
    cb.cross(ab)
    normals[a] += cb.x
    normals[a + 1] += cb.y
    normals[a + 2] += cb.z
    normals[b] += cb.x
    normals[b + 1] += cb.y
    normals[b + 2] += cb.z
    normals[c] += cb.x
    normals[c + 1] += cb.y
    normals[c + 2] += cb.z
  }

  const v = new Vec3()
  for (let i = 0; i < normals.length; i += 3) {
    v.set(normals[i], normals[i + 1], normals[i + 2]).normalize()
    normals[i] = v.x
    normals[i + 1] = v.y
    normals[i + 2] = v.z
  }
  return normals
}

/**
 * Merge several Shapes into one indexed Shape (position + index concatenation,
 * mirroring the old `mergeBufferGeometries`).
 * @param shapes - the shapes to merge.
 * @returns the merged Shape.
 */
export function mergeShapes(shapes: Shape[]): Shape {
  if (shapes.length === 1) {
    const s = shapes[0]
    return { positions: new Float32Array(s.positions), indices: new Uint32Array(s.indices) }
  }
  let posLen = 0
  let idxLen = 0
  for (const s of shapes) {
    posLen += s.positions.length
    idxLen += s.indices.length
  }
  const positions = new Float32Array(posLen)
  const indices = new Uint32Array(idxLen)
  let po = 0
  let io = 0
  let vertexOffset = 0
  for (const s of shapes) {
    positions.set(s.positions, po)
    po += s.positions.length
    for (let i = 0; i < s.indices.length; i++) indices[io + i] = s.indices[i] + vertexOffset
    io += s.indices.length
    vertexOffset += s.positions.length / 3
  }
  return { positions, indices }
}