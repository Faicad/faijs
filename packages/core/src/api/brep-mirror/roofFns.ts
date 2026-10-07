/**
 * Self-hosted compat-op implementation — roof
 * (core-decouple Phase 3, §5.4; G4).
 *
 * @platform occt
 *
 * 迁移自 brepjs `operations/roofFns.ts`（含 pure-TS straightSkeleton，
 * 见同目录 straightSkeleton.ts）。适配：
 *  - getEdges → kernel.getSubShapes(handle, 'edge')
 *  - curveStartPoint → kernel.curvePointAtParam(edge, 0)
 *  - isValidSolid → kernel.isSolid（sew 兜底路径的闭合校验近似）
 *  - Result/BrepError 用 core 面；输出 Result<BrepHandle>
 * 守卫与错误码保持 brepjs：ROOF_FAILED / STRAIGHT_SKELETON_FAILED。
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { ok, err, type Result } from '../../result/result'
import { kernelError, BrepErrorCode } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import { brepHandleOf } from './brepHelpers'
import { computeStraightSkeleton, type SkPoint2D } from './straightSkeleton'

const ROOF_PARAMS = { name: 'roof', params: ['shape', 'options'], formClass: 'A' as FormClass }

// ---------------------------------------------------------------------------
// Helpers（照抄 brepjs roofFns.ts）
// ---------------------------------------------------------------------------

function extractPolygon(kernel: ReturnType<typeof getBrepApi>, wire: BrepHandle): SkPoint2D[] {
  const edges = kernel.getSubShapes(wire, 'edge')
  const pts = edges.map((e) => {
    const pt = kernel.curvePointAtParam(e, 0)
    return { x: pt.x, y: pt.y }
  })
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (
    pts.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    Math.abs(first.x - last.x) < 1e-10 &&
    Math.abs(first.y - last.y) < 1e-10
  ) {
    pts.pop()
  }
  return pts
}

/** Fan-triangulate a convex polygon into triangles (index triples). */
function fanTriangulate(count: number): Array<[number, number, number]> {
  const tris: Array<[number, number, number]> = []
  for (let i = 1; i < count - 1; i++) {
    tris.push([0, i, i + 1])
  }
  return tris
}

/** Signed area cross product for three 2D points (positive = CCW). */
function cross2d(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/** Check if point (px,py) is strictly inside triangle (a,b,c). */
function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = cross2d(ax, ay, bx, by, px, py)
  const d2 = cross2d(bx, by, cx, cy, px, py)
  const d3 = cross2d(cx, cy, ax, ay, px, py)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/** Ear-clip triangulate a simple polygon（照抄 brepjs，含 CW→CCW 归一）。 */
function earClipTriangulate(poly: SkPoint2D[]): Array<[number, number, number]> {
  const n = poly.length
  if (n < 3) return []
  if (n === 3) return [[0, 1, 2]]

  let area2 = 0
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    if (a && b) area2 += a.x * b.y - b.x * a.y
  }
  if (area2 < 0) {
    const tris = earClipTriangulate([...poly].reverse())
    return tris.map(([a, b, c]) => [n - 1 - a, n - 1 - b, n - 1 - c])
  }

  const tris: Array<[number, number, number]> = []
  const idx = poly.map((_, i) => i)
  const isEar = (prev: number, curr: number, next: number): boolean => {
    const a = poly[prev]
    const b = poly[curr]
    const c = poly[next]
    if (!a || !b || !c) return false
    if (cross2d(a.x, a.y, b.x, b.y, c.x, c.y) <= 0) return false
    for (let j = 0; j < n; j++) {
      const p = poly[j]
      if (!p || j === prev || j === curr || j === next) continue
      if (pointInTriangle(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y)) return false
    }
    return true
  }

  while (idx.length > 3) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const prev = idx[(i - 1 + idx.length) % idx.length]
      const curr = idx[i]
      const next = idx[(i + 1) % idx.length]
      if (prev === undefined || curr === undefined || next === undefined) continue
      if (isEar(prev, curr, next)) {
        tris.push([prev, curr, next])
        idx.splice(i, 1)
        clipped = true
        break
      }
    }
    if (!clipped) break
  }
  if (idx.length === 3) {
    const [a, b, c] = idx
    if (a !== undefined && b !== undefined && c !== undefined) tris.push([a, b, c])
  }
  return tris
}

/** Convert skeleton faces into 3D triangular kernel faces（照抄 brepjs）。 */
function buildSkeletonTriFaces(
  skeleton: { faces: Array<{ vertices: SkPoint2D[]; heights: number[] }> },
  tanAngle: number,
  kernel: ReturnType<typeof getBrepApi>,
): BrepHandle[] {
  const triFaces: BrepHandle[] = []
  for (const skFace of skeleton.faces) {
    const verts3d: Array<[number, number, number]> = skFace.vertices.map(
      (v: SkPoint2D, i: number): [number, number, number] => [
        v.x,
        v.y,
        (skFace.heights[i] ?? 0) * tanAngle,
      ],
    )

    const tris = fanTriangulate(verts3d.length)

    for (const [ai, bi, ci] of tris) {
      const va = verts3d[ai]
      const vb = verts3d[bi]
      const vc = verts3d[ci]
      if (!va || !vb || !vc) continue

      const abx = vb[0] - va[0]
      const aby = vb[1] - va[1]
      const abz = vb[2] - va[2]
      const acx = vc[0] - va[0]
      const acy = vc[1] - va[1]
      const acz = vc[2] - va[2]
      const nx = aby * acz - abz * acy
      const ny = abz * acx - abx * acz
      const nz = abx * acy - aby * acx
      const areaSq = nx * nx + ny * ny + nz * nz
      if (areaSq < 1e-20) continue

      const triFace = kernel.buildTriFace({ x: va[0], y: va[1], z: va[2] }, { x: vb[0], y: vb[1], z: vb[2] }, { x: vc[0], y: vc[1], z: vc[2] })
      if (triFace !== null) triFaces.push(triFace)
    }
  }
  return triFaces
}

// ---------------------------------------------------------------------------
// roof — 平面 wire → 直骨架屋顶实体（brepjs roofFns.ts#roof）
// ---------------------------------------------------------------------------

/**
 * Roof — planar wire to straight-skeleton roof solid (brepjs roofFns.ts#roof).
 *
 * @param args - Resolved arguments (wire, roof options).
 * @returns The generated roof solid as a `BrepHandle`.
 */
export function roofBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, options] = resolveArgs(args, ROOF_PARAMS)
  const kernel = getBrepApi()
  const wire = brepHandleOf(shape)
  const angle = ((options as { angle?: number } | undefined)?.angle ?? 45) * (Math.PI / 180)
  const tanAngle = Math.tan(angle)

  try {
    const polygon = extractPolygon(kernel, wire)
    if (polygon.length < 3) {
      return err(
        kernelError(BrepErrorCode.ROOF_FAILED, 'Wire must have at least 3 edges for roof generation'),
      )
    }

    const skeletonResult = computeStraightSkeleton(polygon)
    if (!skeletonResult.ok) return skeletonResult
    const skeleton = skeletonResult.value
    if (skeleton.faces.length === 0) {
      return err(
        kernelError(BrepErrorCode.ROOF_FAILED, 'Straight skeleton computation produced no faces'),
      )
    }

    const triFaces: BrepHandle[] = buildSkeletonTriFaces(skeleton, tanAngle, kernel)

    // Bottom face（z=0，ear-clip 支持凹多边形）
    for (const [ai, bi, ci] of earClipTriangulate(polygon)) {
      const pa = polygon[ai]
      const pb = polygon[bi]
      const pc = polygon[ci]
      if (!pa || !pb || !pc) continue
      const va: [number, number, number] = [pa.x, pa.y, 0]
      const vb: [number, number, number] = [pb.x, pb.y, 0]
      const vc: [number, number, number] = [pc.x, pc.y, 0]
      const triFace = kernel.buildTriFace({ x: va[0], y: va[1], z: va[2] }, { x: vc[0], y: vc[1], z: vc[2] }, { x: vb[0], y: vb[1], z: vb[2] })
      if (triFace !== null) triFaces.push(triFace)
    }

    if (triFaces.length === 0) {
      return err(
        kernelError(BrepErrorCode.ROOF_FAILED, 'No valid triangular faces could be built'),
      )
    }

    try {
      const solid = kernel.sewAndSolidify(triFaces, 1e-6)
      const fixed = kernel.fixShape(solid)
      if (fixed !== solid) kernel.release(solid)
      return ok(fixed)
    } catch (solidifyErr) {
      try {
        const sewn = kernel.sew(triFaces, 1e-6)
        if (kernel.isSolid(sewn)) return ok(sewn)
        return err(
          kernelError(BrepErrorCode.ROOF_FAILED, 'Sew fallback produced invalid solid', solidifyErr),
        )
      } catch (sewErr) {
        return err(kernelError(BrepErrorCode.ROOF_FAILED, 'Failed to sew roof faces', sewErr))
      }
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError(BrepErrorCode.ROOF_FAILED, `Roof generation failed: ${raw}`, e))
  }
}
