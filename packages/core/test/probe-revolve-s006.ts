/**
 * Probe: exact revolve repair on the REAL s006 screw profile (with the head
 * fillet arc). The degenerate slant edge (4.999,0)->(5,-138) is substituted
 * with margin vertical + jogs; the arc and all other edges are exact.
 *
 * Expected repaired volume = truth saved Revolve = 15328.403620
 * Run: npx tsx test/probe-revolve-s006.ts   (cwd=packages/core)
 */
import { initOcctWasm } from '../src/occt-kernel/occtKernel'

const SQ2 = Math.SQRT1_2

async function main(): Promise<void> {
  const k = await initOcctWasm()

  // global coords: sketch local (x, y) -> global (0, x, y); revolve around Z
  const v = (y: number, z: number): number => k.makeVertex(0, y, z)
  const line = (a: number, b: number): number => k.makeEdge(a, b)

  const pSlantTop = v(4.999, 0) // degenerate slant start
  const pFar = v(5, -138) // slant end (max radius station)
  const arcStart = v(8, 9.97229)
  const arcMid = v(7.97229 + 0.02771 * SQ2, 9.97229 + 0.02771 * SQ2)
  const arcEnd = v(7.97229, 10)

  const MARGIN = 1e-4
  const vIn0 = v(4.999 - MARGIN, 0)
  const vIn1 = v(4.999 - MARGIN, -138)

  const chain: number[] = []
  const addSeg = (a: number, b: number): void => {
    const pa = k.vertexPosition(a)
    const pb = k.vertexPosition(b)
    if (Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) > 1e-9) chain.push(line(a, b))
  }
  addSeg(pSlantTop, vIn0) // jog at min station
  addSeg(vIn0, vIn1) // margin vertical
  addSeg(vIn1, pFar) // jog at max station
  addSeg(pFar, v(5, -168.5)) // shank
  addSeg(v(5, -168.5), v(3.5, -170)) // chamfer
  addSeg(v(3.5, -170), v(0, -170)) // tip
  addSeg(v(0, -170), v(0, 10)) // axis
  addSeg(v(0, 10), arcEnd) // head top
  chain.push(k.makeArcEdge(k.vertexPosition(arcStart), k.vertexPosition(arcMid), k.vertexPosition(arcEnd)))
  addSeg(arcStart, v(8, 0)) // head side
  addSeg(v(8, 0), pSlantTop) // head bottom

  const wire = k.makeWire(chain)
  const face = k.makeFace(wire)
  const revMod = k.revolve(face, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, Math.PI * 2)
  console.log('modified revolve volume =', k.getVolume(revMod))

  const frustum = k.translate(k.makeCone(5.0, 4.999, 138), 0, 0, -138)
  const repaired = k.fuse(revMod, frustum)
  const rv = k.getVolume(repaired)
  const truth = 15328.40362
  console.log('repaired volume =', rv)
  console.log('truth           =', truth, ' delta =', rv - truth)

  const faces = k.getSubShapes(repaired, 'face')
  for (let i = 0; i < faces.length; i++) {
    console.log(`  face[${i}] surfaceType=${k.surfaceType(faces[i]!)}`)
  }
}

void main().catch((e) => {
  console.error('PROBE FAILED', e)
  process.exit(1)
})
