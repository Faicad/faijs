/**
 * Probe: exact revolve repair v2 — margin trick.
 *
 * The degenerate slant edge (4.999,0)->(5,-138) is replaced by a vertical at
 * r_min - margin (STRICTLY inside the exact frustum) + jog at the far
 * station. No tangential contacts remain: the fuse is a clean glue.
 *
 * Expected exact volume = frustum(4.999,5,138) + cyl(5,22) = 12564.2031
 * Run: npx tsx test/probe-revolve-repair.ts   (cwd=packages/core)
 */
import type { ShapeHandle } from 'occt-wasm'
import { initOcctWasm } from '../src/occt-kernel/occtKernel'

async function main(): Promise<void> {
  const k = await initOcctWasm()

  // profile: (4.999,0) -> (5,-138) [degenerate slant] -> (5,-160) -> (0,-160) -> (0,0)
  const pts: [number, number, number][] = [
    [0, 4.999, 0],
    [0, 5, -138],
    [0, 5, -160],
    [0, 0, -160],
    [0, 0, 0],
  ]
  const verts = pts.map((p) => k.makeVertex(p[0], p[1], p[2]))
  const mk = (a: number, b: number): ShapeHandle => k.makeEdge(verts[a]!, verts[b]!)
  const edges: ShapeHandle[] = [mk(0, 1), mk(1, 2), mk(2, 3), mk(3, 4), mk(4, 0)]
  const wire = k.makeWire(edges)
  const face = k.makeFace(wire)

  // ── collapsed reference ──
  const rev0 = k.revolve(face, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, Math.PI * 2)
  console.log('collapsed revolve volume =', k.getVolume(rev0))

  // ── wire surgery with margin: vertical at 4.9989 ──
  const MARGIN = 1e-4
  const rIn = 4.999 - MARGIN
  const v0 = k.makeVertex(0, rIn, 0)
  const v1 = k.makeVertex(0, rIn, -138)
  const segs: ShapeHandle[] = []
  const addSeg = (a: ShapeHandle, b: ShapeHandle): void => {
    const pa = k.vertexPosition(a)
    const pb = k.vertexPosition(b)
    if (Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) > 1e-9) segs.push(k.makeEdge(a, b))
  }
  // jog (4.999,0)->(4.9989,0) ; vertical ; jog (4.9989,-138)->(5,-138) ; then rest
  addSeg(verts[0]!, v0)
  addSeg(v0, v1)
  addSeg(v1, verts[1]!)
  for (let i = 1; i < edges.length; i++) segs.push(edges[i]!)
  const modWire = k.makeWire(segs)
  const modFace = k.makeFace(modWire)
  const revMod = k.revolve(modFace, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, Math.PI * 2)
  console.log('modified revolve volume =', k.getVolume(revMod))

  // ── exact frustum: r=5.0 at z=-138 -> r=4.999 at z=0 ──
  const frustum = k.translate(k.makeCone(5.0, 4.999, 138), 0, 0, -138)
  console.log('frustum volume =', k.getVolume(frustum))

  // ── fuse ──
  const repaired = k.fuse(revMod, frustum)
  const rv = k.getVolume(repaired)
  const exact = Math.PI * (138 / 3) * (4.999 * 4.999 + 4.999 * 5 + 25) + Math.PI * 25 * 22
  console.log('repaired volume =', rv)
  console.log('exact expected  =', exact, ' delta =', rv - exact)

  const faces = k.getSubShapes(repaired, 'face')
  for (let i = 0; i < faces.length; i++) {
    console.log(`  repaired face[${i}] surfaceType=${k.surfaceType(faces[i]!)}`)
  }
}

void main().catch((e) => {
  console.error('PROBE FAILED', e)
  process.exit(1)
})
