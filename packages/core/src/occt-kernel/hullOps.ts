/**
 * Convex hull operations for the faijs occt kernel（第一方模块）。
 *
 * 2026-09-25 core-decouple Phase 2 §5.1：最小闭包移植——算法复制自 brepjs
 * `src/kernel/occtWasm/hullOps.ts` + `src/kernel/occtWasm/constructionOps.ts#buildSolidFromFaces`，
 * BREP 重建改为 core 的 occt-wasm 原生直调（`buildTriFace` / `sewAndSolidify` /
 * `fixFaceOrientations` / `release`，occt-wasm index.d.ts 形态——ShapeHandle[]、
 * Vec3 对象），**不 import brepjs**。occt-wasm 无原生 hull（Phase 0 实证），
 * 故不直调原生 hull；QuickHull 由 `./hullGeometry` 承担。
 */

import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { BrepHandle } from '../brep/engine/types'
import { quickHull, type Vec3 } from './hullGeometry'

/**
 * 由点集构造凸包实体（brepjs 原语义：quickHull → 三角面 → 缝合 → 修复朝向 → solid）。
 *
 * @throws 点数不足 4 或退化（面 < 4）——与 brepjs 原实现一致。
 */
export function hullFromPoints(
  k: OcctKernel,
  points: Vec3[],
  tolerance: number,
): BrepHandle {
  if (points.length < 4) throw new Error('hullFromPoints: need at least 4 points')
  const { points: hullPoints, faces } = quickHull(points, tolerance)
  if (faces.length < 4) throw new Error('hullFromPoints: degenerate hull (fewer than 4 faces)')

  // Build triangle faces, sew them, and solidify（brepjs buildSolidFromFaces 原逻辑）。
  const faceIds: ShapeHandle[] = []
  for (const [i0, i1, i2] of faces) {
    const p0 = hullPoints[i0]
    const p1 = hullPoints[i1]
    const p2 = hullPoints[i2]
    if (!p0 || !p1 || !p2) continue
    faceIds.push(k.buildTriFace(p0, p1, p2))
  }
  try {
    const sewn0 = k.sewAndSolidify(faceIds, tolerance)
    const sewn = k.fixFaceOrientations(sewn0)
    // fixFaceOrientations returns a fresh slot; release the pre-fix intermediate.
    if (sewn !== sewn0) k.release(sewn0)
    return sewn as unknown as BrepHandle
  } finally {
    // Each buildTriFace is a fresh arena slot consumed into the sewn solid
    // (shared refcounted TShape); release the triangles once sewing is done.
    for (const id of faceIds) k.release(id)
  }
}
