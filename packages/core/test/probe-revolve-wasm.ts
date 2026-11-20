/**
 * Probe: repair the collapsed near-degenerate cone in k.revolve output via an
 * exact boolean patch. Trapezoid profile (4.999,0)->(5,-138) slant revolved
 * around Z; the sweep canonicalizes the cone to an (inconsistent) cylinder.
 * Patch = cyl(5,138) minus frustum(4.999->5.0,138), placed z[-138,0], CUT
 * from the revolve result. Expected exact volume:
 *   frustum(4.999,5,138) + cyl(5,22) = 10836.3271 + 1727.8760 = 12564.2031
 * Run: npx tsx test/probe-revolve-wasm.ts   (cwd=packages/core)
 */
import type { ShapeHandle } from 'occt-wasm'
import { initOcctWasm } from '../src/occt-kernel/occtKernel'

async function main(): Promise<void> {
  const k = await initOcctWasm()

  const pts: [number, number, number][] = [
    [0, 4.999, 0],
    [0, 5, -138],
    [0, 5, -160],
    [0, 0, -160],
    [0, 0, 0],
  ]
  const verts = pts.map((p) => k.makeVertex(p[0], p[1], p[2]))
  const edges: ShapeHandle[] = []
  for (let i = 0; i < verts.length; i++) {
    edges.push(k.makeEdge(verts[i]!, verts[(i + 1) % verts.length]!))
  }
  const wire = k.makeWire(edges)
  const face = k.makeFace(wire)
  const rev = k.revolve(face, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, Math.PI * 2)
  console.log('collapsed revolve volume =', k.getVolume(rev))

  // patch = cyl(5,138) - frustum(4.999->5.0,138), both spanning z[-138,0]
  const cyl5 = k.translate(k.makeCylinder(5, 138), 0, 0, -138)
  // makeCone(r1,r2,h): r1 at z=0, r2 at z=h — want r=5.0 at z=-138 and 4.999 at z=0
  const frustum = k.translate(k.makeCone(5.0, 4.999, 138), 0, 0, -138)
  console.log('frustum volume =', k.getVolume(frustum), '(expect 10836.3271)')
  const patch = k.cut(cyl5, frustum)
  console.log('patch volume =', k.getVolume(patch), '(expect ~2.1676)')

  const repaired = k.cut(rev, patch)
  const rv = k.getVolume(repaired)
  console.log('repaired volume =', rv)
  const exact = Math.PI * (138 / 3) * (4.999 * 4.999 + 4.999 * 5 + 25) + Math.PI * 25 * 22
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
