/**
 * Probe (case8 §3.9 / A1-B3): native `pipe` vs `sweepPipeShell` across spine shapes,
 * annular section behaviour, and the `revolve(face, <2π)` product type.
 *
 * Run: npx tsx test/probe-case8-pipe-gap.ts   (cwd = packages/core)
 *
 * Nothing here asserts — it prints facts. The facts that turned into gates live in
 * test/api/sweep-kernel-behavior.test.ts (K1–K9) and test/api/sweep-hollow-pipe.test.ts.
 */
import { initOcctWasm } from '../src/occt-kernel/occtKernel'

/* eslint-disable @typescript-eslint/no-explicit-any */
type H = any

const PI = Math.PI

function report(tag: string, h: H, note = ''): void {
  const k = (globalThis as any).__k
  let type = '?'
  let vol = NaN
  let box: any = null
  let err = ''
  try { type = k.getShapeType(h) } catch (e) { err = String(e) }
  try { vol = k.getVolume(h) } catch (e) { err = String(e) }
  try { box = k.getBoundingBox(h) } catch (e) { err = String(e) }
  const size = box
    ? [box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin].map((v: number) => +v.toFixed(4))
    : null
  const boxStr = box
    ? `[${[box.xmin, box.ymin, box.zmin].map((v: number) => +v.toFixed(3)).join(',')}]..[${[box.xmax, box.ymax, box.zmax].map((v: number) => +v.toFixed(3)).join(',')}]`
    : 'null'
  console.log(
    `${tag.padEnd(34)} type=${String(type).padEnd(9)} vol=${Number.isFinite(vol) ? vol.toFixed(2).padStart(10) : 'NaN'.padStart(10)} size=${JSON.stringify(size)} bbox=${boxStr}${note ? '  // ' + note : ''}${err ? '  ERR=' + err : ''}`,
  )
}

async function main(): Promise<void> {
  const k: any = await initOcctWasm()
  ;(globalThis as any).__k = k

  // ── sections ───────────────────────────────────────────────────────────────
  const circleWire = (r: number): H =>
    k.makeWire([k.makeCircleEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, r)])
  const circleFace = (r: number): H => k.makeFace(circleWire(r))
  const squareWire = (a: number): H => {
    const h = a / 2
    const pts = [
      [-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0],
    ]
    const verts = pts.map((p) => k.makeVertex(p[0], p[1], p[2]))
    const edges = verts.map((v: H, i: number) => k.makeEdge(v, verts[(i + 1) % 4]))
    return k.makeWire(edges)
  }
  const squareFace = (a: number): H => {
    const h = a / 2
    const pts = [
      [-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0],
    ]
    const verts = pts.map((p) => k.makeVertex(p[0], p[1], p[2]))
    const edges = verts.map((v: H, i: number) => k.makeEdge(v, verts[(i + 1) % 4]))
    return k.makeFace(k.makeWire(edges))
  }
  /** Annular section: outer disc with an inner hole wire (case8's Ø17.3/Ø13.3). */
  const annulusFace = (rOut: number, rIn: number): H => {
    const outerEdge = k.makeCircleEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, rOut)
    const innerEdge = k.makeCircleEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, rIn)
    const disc = k.makeFace(k.makeWire([outerEdge]))
    return k.addHolesInFace(disc, [k.makeWire([innerEdge])])
  }

  // ── spines (all start at origin, tangent +Z at the start point) ────────────
  const wireOf = (pts: number[][]): H => {
    const verts = pts.map((p) => k.makeVertex(p[0], p[1], p[2]))
    const edges: H[] = []
    for (let i = 0; i < verts.length - 1; i++) edges.push(k.makeEdge(verts[i], verts[i + 1]))
    return k.makeWire(edges)
  }

  const spineStraight = wireOf([[0, 0, 0], [0, 0, 40]])
  // 90° polyline: +Z 20 then +Y 20 (bend at (0,0,20))
  const spinePolyline = wireOf([[0, 0, 0], [0, 0, 20], [0, 20, 20]])
  // 90° arc R10 in the YZ plane, tangent +Z at start, centre (0,-10,0)
  //   arc length = π/2·10 = 15.7079
  const spineArc = k.makeWire([
    k.makeArcEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: -2.9289, z: 7.0711 }, { x: 0, y: -10, z: 10 }),
  ])

  console.log('=======================================================================')
  console.log('P1 · native pipe vs sweepPipeShell (circle Ø12 / square 8×8)')
  console.log('=======================================================================')
  const circle12 = circleFace(6)
  const circle12w = circleWire(6)
  const square8 = k.makeFace(squareWire(8))
  const square8w = squareWire(8)

  for (const [spineName, spine, pathLen] of [
    ['straight z0..40', spineStraight, 40],
    ['polyline 90 (20+20)', spinePolyline, 40],
    ['arc 90 R10', spineArc, PI / 2 * 10],
  ] as [string, H, number][]) {
    const expectCircle = PI * 36 * pathLen
    console.log(`--- spine: ${spineName}   expect circle Ø12 ≈ ${expectCircle.toFixed(2)}`)
    report(`${spineName} | pipe(face) Ø12`, k.pipe(circle12, spine))
    report(`${spineName} | simplePipe(face) Ø12`, k.simplePipe(circle12, spine))
    report(`${spineName} | sweepShell(wire,ff) Ø12`, k.sweepPipeShell(circle12w, spine, false, false))
    report(`${spineName} | pipe(wire) Ø12`, k.pipe(circle12w, spine))
  }

  // square 8×8, only the straight spine has a clean analytic truth (3200 @ len 50)
  const spineStraight50 = wireOf([[0, 0, 0], [0, 0, 50]])
  console.log('--- spine: straight z0..50   expect square 8×8 = 3200')
  report('straight50 | pipe(face) sq8', k.pipe(square8, spineStraight50))
  report('straight50 | sweepShell(wire) sq8', k.sweepPipeShell(square8w, spineStraight50, false, false))

  // ── P2 · annular section ───────────────────────────────────────────────────
  console.log('=======================================================================')
  console.log('P2 · annular section Ø17.3/Ø13.3 along straight z0..100 (expect 9614.1)')
  console.log('=======================================================================')
  const annulus = annulusFace(8.65, 6.65)
  const ringArea = PI * (8.65 * 8.65 - 6.65 * 6.65)
  const spineStraight100 = wireOf([[0, 0, 0], [0, 0, 100]])
  console.log(`ring area = ${ringArea.toFixed(4)}   expect vol@100 = ${(ringArea * 100).toFixed(2)}`)
  report('straight100 | pipe(face) annulus', k.pipe(annulus, spineStraight100))
  try {
    report('straight100 | sweepShell(wire) annulus', k.sweepPipeShell(annulus, spineStraight100, false, false))
  } catch (e) {
    console.log(`straight100 | sweepShell(face) annulus   REFUSED: ${String(e).slice(0, 90)}`)
  }

  // ── P1b · polyline approximation of an arc (case8's actual spine shape) ────
  console.log('=======================================================================')
  console.log('P1b · polyline-as-arc: does a densely sampled arc survive pipe?')
  console.log('=======================================================================')
  const arcPoly = (radius: number, segs: number, cx = 0, cy = 0): H => {
    // arc in the YZ plane, centre (0, cy, cz), tangent +Z at the origin
    // param: y = cy + radius*sin(t), z = radius*(1-cos(t))  (t from 0..π/2)
    const cz = 0
    const pts: number[][] = []
    for (let i = 0; i <= segs; i++) {
      const t = (PI / 2) * (i / segs)
      pts.push([cx, cy + radius * Math.sin(t), cz + radius * (1 - Math.cos(t))])
    }
    return wireOf(pts)
  }
  for (const [radius, segs, label] of [[10, 16, 'R10 / 16 seg'], [36.35, 40, 'R36.35 / 40 seg (case8)']] as [number, number, string][]) {
    const spineP = arcPoly(radius, segs)
    const arcLen = (PI / 2) * radius
    console.log(`--- ${label}   expect circle Ø12 ≈ ${(PI * 36 * arcLen).toFixed(2)}`)
    report(`${label} | pipe(face) Ø12`, k.pipe(circle12, spineP))
    report(`${label} | sweepShell(wire) Ø12`, k.sweepPipeShell(circle12w, spineP, false, false))
    const annLen = arcLen
    console.log(`    expect annulus ≈ ${(ringArea * annLen).toFixed(2)}`)
    report(`${label} | pipe(face) annulus`, k.pipe(annulus, spineP))
  }

  // ── P2b · true arc spine at case8's radius, annular section ────────────────
  console.log('=======================================================================')
  console.log('P2b · true arc R36.35 + annulus (case8 geometry, smooth spine)')
  console.log('=======================================================================')
  const r = 36.35
  const arc36 = k.makeWire([
    k.makeArcEdge(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -r + r * Math.cos(PI / 4), z: r * Math.sin(PI / 4) },
      { x: 0, y: -r, z: r },
    ),
  ])
  const arc36Len = (PI / 2) * r
  console.log(`expect annulus ≈ ${(ringArea * arc36Len).toFixed(2)}   (arc len ${arc36Len.toFixed(3)})`)
  report('true arc R36.35 | pipe(face) annulus', k.pipe(annulus, arc36))
  report('true arc R36.35 | sweepShell(wire) Ø12', k.sweepPipeShell(circle12w, arc36, false, false))

  // ── P3 · revolve: the deciding variable is whether the section plane CONTAINS
  //        the axis, not the angle ────────────────────────────────────────────
  console.log('=======================================================================')
  console.log('P3 · revolve — plane-contains-axis vs plane-perpendicular-to-axis')
  console.log('=======================================================================')
  const discArea = PI * 8.65 * 8.65
  const disc = (normal: H, center: H): H =>
    k.makeFace(k.makeWire([k.makeCircleEdge(center, normal, 8.65)]))

  // A · section in XY (normal +Z), axis = Z, centre offset 10 → axis ⟂ plane, not through it
  const diskXY = disc({ x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 0 })
  // B · section in XZ (normal +Y), centre (10,0,0) → the Z axis LIES IN this plane
  const diskXZ = disc({ x: 0, y: 1, z: 0 }, { x: 10, y: 0, z: 0 })

  const runs: [string, H, H, number][] = [
    ['A  XY disc, axis Z (⟂ plane)', diskXY, { x: 0, y: 0, z: 1 }, 182],
    ['B  XZ disc, axis Z (in plane)', diskXZ, { x: 0, y: 0, z: 1 }, 182],
    ['B  XZ disc, axis Z (in plane)', diskXZ, { x: 0, y: 0, z: 1 }, 360],
    ['C  XZ disc, axis Y (⟂ plane)', diskXZ, { x: 0, y: 1, z: 0 }, 182],
  ]
  for (const [label, face, dir, deg] of runs) {
    try {
      const h = k.revolve(face, { point: { x: 0, y: 0, z: 0 }, direction: dir }, (deg * PI) / 180)
      const expect = discArea * 10 * ((deg * PI) / 180)
      report(label + `  ${deg}°`, h, `expect(Pappus) ≈ ${expect.toFixed(1)}`)
    } catch (e) {
      console.log(`${label}  ${deg}°   FAILED: ${String(e).slice(0, 110)}`)
    }
  }

  console.log('=======================================================================')
  console.log('done')
}

void main().catch((e) => {
  console.error('PROBE FAILED', e)
  process.exit(1)
})
