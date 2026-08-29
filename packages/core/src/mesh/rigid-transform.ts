/**
 * Rigid transform application (engine-side, P6).
 *
 * Applies a face_mate assembly transform to mesh vertices (bake).
 * Math is identical to stdlib/compound.applyTransform and brep/brep-ops
 * applyTransformBrep (p' = R·(p − pivot) + pivot + translation).
 *
 * Ownership (engine-library-contract.md §10.1): constraint solving lives in the
 * library (solveFaceMate); applying the solved transform to member geometry is
 * done by the engine during replay (F2: libraries must not query/mutate the DAG).
 * This module is the engine-side vertex transform — it must not depend on any
 * stdlib module (E-b: module-executor must not import stdlib/compound).
 * Public API is unchanged: stdlib/compound still re-exports applyTransform.
 */

import type { Shape } from './types'

/** Matrix × vector (3x3 * 3). */
function mat3MulVec(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

/** Apply the transform to a mesh shape (rotate about pivot, then translate). */
export function applyTransform(
  shape: Shape,
  quaternion: [number, number, number, number],
  pivot: [number, number, number],
  translation: [number, number, number],
  rotationMatrix: number[],
): Shape {
  const positions = shape.positions
  const newPositions = new Float32Array(positions.length)

  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i] - pivot[0]
    const py = positions[i + 1] - pivot[1]
    const pz = positions[i + 2] - pivot[2]

    const rotated = mat3MulVec(rotationMatrix, [px, py, pz])

    newPositions[i] = rotated[0] + pivot[0] + translation[0]
    newPositions[i + 1] = rotated[1] + pivot[1] + translation[1]
    newPositions[i + 2] = rotated[2] + pivot[2] + translation[2]
  }

  return {
    positions: newPositions,
    indices: shape.indices,
  }
}
