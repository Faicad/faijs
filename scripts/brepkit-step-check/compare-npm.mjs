// brepkit-wasm (npm package) vs occt-wasm STEP consistency probe.
//
// Both kernels are driven purely from JS via their npm packages:
//   - brepkit-wasm@3.4.18  (BrepKernel from 'brepkit-wasm')
//   - occt-wasm@3.8.4      (OcctKernel from 'occt-wasm')
//
// Each case builds the same solid in both kernels, exports STEP, and
// compares: volume, surface area, bbox, STEP entity census, file size,
// plus cross-import (each kernel reading the other's STEP).
//
// Usage: node scripts/brepkit-step-check/compare-npm.mjs <out-dir>

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const OUT = resolve(process.argv[2] ?? './tmp/brepkit-step-check/npm-out')
mkdirSync(join(OUT, 'bk'), { recursive: true })
mkdirSync(join(OUT, 'oc'), { recursive: true })

// ── kernel init ──
const { BrepKernel } = await import('brepkit-wasm')
const { OcctKernel } = await import('occt-wasm')
const bk = new BrepKernel()
const occtWasmPath = require.resolve('occt-wasm/dist/occt-wasm.wasm')
const occt = await OcctKernel.init({ wasm: readFileSync(occtWasmPath) })
console.log('both kernels initialized')

// ── 4x4 row-major helpers for brepkit transformSolid ──
function mat4Translation(x, y, z) {
  return new Float64Array([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1])
}
function mat4RotationX(a) {
  const c = Math.cos(a), s = Math.sin(a)
  return new Float64Array([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1])
}

// ── case builders: each returns { bk: () => handle, oc: () => handle, cleanupBk, cleanupOc } ──
// All cases match the geometry defined in the original probe (see manifest notes):
//   box 10×20×30 centered; cyl r5 h20 (origin & centered); sphere r7.5 centered;
//   cone r1=5 r2=2 h15 origin; torus R10 r4 centered; 10×10×10 box − cyl r3 h10;
//   two 10×10×10 boxes fused (overlap 5 in z); 8×8×8 box ∩ cyl r6 h8 (z 0..8);
//   cyl r5 h20 centered, rotated 30° about X.
const cases = {
  C01_box_centered: {
    bk: () => {
      const s = bk.makeBox(10, 20, 30)
      bk.transformSolid(s, mat4Translation(-5, -10, -15))
      return s
    },
    oc: () => occt.makeBoxFromCorners({ x: -5, y: -10, z: -15 }, { x: 5, y: 10, z: 15 }),
  },
  C02_cylinder_origin: {
    bk: () => bk.makeCylinder(5, 20),
    oc: () => occt.makeCylinder(5, 20),
  },
  C03_cylinder_centered: {
    bk: () => {
      const s = bk.makeCylinder(5, 20)
      bk.transformSolid(s, mat4Translation(0, 0, -10))
      return s
    },
    oc: () => {
      const s = occt.makeCylinder(5, 20)
      const t = occt.translate(s, 0, 0, -10)
      occt.release(s)
      return t
    },
  },
  C04_sphere_centered: {
    bk: () => bk.makeSphere(7.5, 32),
    oc: () => occt.makeSphere(7.5),
  },
  C05_cone_origin: {
    bk: () => bk.makeCone(5, 2, 15),
    oc: () => occt.makeCone(5, 2, 15),
  },
  C06_torus_centered: {
    bk: () => bk.makeTorus(10, 4, 4),
    oc: () => occt.makeTorus(10, 4),
  },
  C07_box_cut_cylinder: {
    bk: () => {
      const b = bk.makeBox(10, 10, 10)
      bk.transformSolid(b, mat4Translation(-5, -5, -5))
      const c = bk.makeCylinder(3, 10)
      const r = bk.cut(b, c)
      return r
    },
    oc: () => {
      const b = occt.makeBoxFromCorners({ x: -5, y: -5, z: -5 }, { x: 5, y: 5, z: 5 })
      const c = occt.makeCylinder(3, 10)
      const r = occt.cut(b, c)
      occt.release(b)
      occt.release(c)
      return r
    },
  },
  C08_fuse_two_boxes: {
    bk: () => {
      const b1 = bk.makeBox(10, 10, 10)
      bk.transformSolid(b1, mat4Translation(-5, -5, -5))
      const b2 = bk.makeBox(10, 10, 10)
      bk.transformSolid(b2, mat4Translation(0, 0, 5))
      return bk.fuse(b1, b2)
    },
    oc: () => {
      const b1 = occt.makeBoxFromCorners({ x: -5, y: -5, z: -5 }, { x: 5, y: 5, z: 5 })
      // match brepkit side: makeBox(10,10,10) + translate(0,0,5) → x 0..10, y 0..10, z 5..15
      const b2 = occt.makeBoxFromCorners({ x: 0, y: 0, z: 5 }, { x: 10, y: 10, z: 15 })
      const r = occt.fuse(b1, b2)
      occt.release(b1)
      occt.release(b2)
      return r
    },
  },
  C09_common_box_cylinder: {
    bk: () => {
      const b = bk.makeBox(8, 8, 8)
      bk.transformSolid(b, mat4Translation(-4, -4, -4))
      const c = bk.makeCylinder(6, 8)
      return bk.intersect(b, c)
    },
    oc: () => {
      const b = occt.makeBoxFromCorners({ x: -4, y: -4, z: -4 }, { x: 4, y: 4, z: 4 })
      const c = occt.makeCylinder(6, 8)
      const r = occt.common(b, c)
      occt.release(b)
      occt.release(c)
      return r
    },
  },
  C10_cylinder_rotated: {
    bk: () => {
      const s = bk.makeCylinder(5, 20)
      bk.transformSolid(s, mat4Translation(0, 0, -10))
      bk.transformSolid(s, mat4RotationX(Math.PI / 6))
      return s
    },
    oc: () => {
      const s = occt.makeCylinder(5, 20)
      const t = occt.translate(s, 0, 0, -10)
      occt.release(s)
      const r = occt.rotate(t, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, Math.PI / 6)
      occt.release(t)
      return r
    },
  },
}

function stepCensus(text) {
  const counts = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*#\d+\s*=\s*([A-Z_]+)\(/)
    if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1
  }
  return counts
}

const SURFACE_ENTITIES = ['PLANE', 'CYLINDRICAL_SURFACE', 'CONICAL_SURFACE', 'SPHERICAL_SURFACE', 'TOROIDAL_SURFACE', 'B_SPLINE_SURFACE_WITH_KNOTS']

const results = []
for (const [name, builders] of Object.entries(cases)) {
  const row = { case: name }
  const stepFiles = {}
  try {
    // ── brepkit side ──
    const t0 = Date.now()
    const bkSolid = builders.bk()
    const bkVol = bk.volume(bkSolid, 0.01)
    const bkArea = bk.surfaceArea(bkSolid, 0.01)
    const bkBbox = Array.from(bk.boundingBox(bkSolid))
    const bkStepBytes = bk.exportStep(bkSolid)
    const bkStep = new TextDecoder().decode(bkStepBytes)
    stepFiles.bk = `${name}.step`
    writeFileSync(join(OUT, `bk/${name}.step`), bkStepBytes)
    row.brepkit = {
      ms: Date.now() - t0,
      volume: bkVol,
      area: bkArea,
      bbox: bkBbox,
      bytes: bkStepBytes.length,
      census: stepCensus(bkStep),
    }
    // ── occt side ──
    const t1 = Date.now()
    const ocSolid = builders.oc()
    const ocVol = occt.getVolume(ocSolid)
    const ocArea = occt.getSurfaceArea(ocSolid)
    const ocBbox = occt.getBoundingBox(ocSolid, false)
    const ocStep = occt.exportStep(ocSolid)
    occt.release(ocSolid)
    stepFiles.oc = `${name}.step`
    writeFileSync(join(OUT, `oc/${name}.step`), ocStep)
    row.occt = {
      ms: Date.now() - t1,
      volume: ocVol,
      area: ocArea,
      bbox: [ocBbox.xmin, ocBbox.ymin, ocBbox.zmin, ocBbox.xmax, ocBbox.ymax, ocBbox.zmax],
      bytes: ocStep.length,
      census: stepCensus(ocStep),
    }
  } catch (e) {
    row.error = String(e)
    results.push(row)
    console.log(`[ERR] ${name}: ${e}`)
    continue
  }
  results.push(row)
  console.log(`[ok] ${name}  bk=${row.brepkit.ms}ms oc=${row.occt.ms}ms  volDiff=${Math.abs(row.brepkit.volume - row.occt.volume).toExponential(3)}`)
}

// ── cross-import ──
mkdirSync(join(OUT, 'bk'), { recursive: true })
mkdirSync(join(OUT, 'oc'), { recursive: true })
const ximport = []
for (const row of results) {
  if (row.error) continue
  const name = row.case
  // occt reads brepkit STEP
  let ocReadsBk = null, ocReadsBkErr = null
  try {
    const s = occt.importStep(readFileSync(join(OUT, `bk/${name}.step`)))
    ocReadsBk = { solids: 1, volume: occt.getVolume(s) }
    occt.release(s)
  } catch (e) {
    ocReadsBkErr = String(e)
  }
  // brepkit reads occt STEP
  let bkReadsOc = null, bkReadsOcErr = null
  try {
    const ids = bk.importStep(new Uint8Array(readFileSync(join(OUT, `oc/${name}.step`))))
    const vols = []
    for (const id of ids) vols.push(bk.volume(id, 0.01))
    bkReadsOc = { solids: ids.length, volumes: vols }
  } catch (e) {
    bkReadsOcErr = String(e)
  }
  ximport.push({ case: name, occt_reads_brepkit: ocReadsBk, occt_reads_brepkit_error: ocReadsBkErr, brepkit_reads_occt: bkReadsOc, brepkit_reads_occt_error: bkReadsOcErr })
}

// ── summary ──
const report = { generated: new Date().toISOString(), results, ximport }
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))

const MAXREL = 1e-4
console.log('\n=== SUMMARY (rel tolerance 1e-4) ===')
for (const r of results) {
  if (r.error) { console.log(`FAIL  ${r.case}: ${r.error}`); continue }
  const bv = r.brepkit.volume, ov = r.occt.volume
  const ba = r.brepkit.area, oa = r.occt.area
  const volRel = Math.abs(bv - ov) / Math.max(1e-12, Math.abs(bv))
  const areaRel = Math.abs(ba - oa) / Math.max(1e-12, Math.abs(ba))
  const bboxOk = r.brepkit.bbox.every((v, i) => Math.abs(v - r.occt.bbox[i]) < 1e-5)
  const census = {}
  for (const ent of SURFACE_ENTITIES) {
    const b = r.brepkit.census[ent] ?? 0
    const o = r.occt.census[ent] ?? 0
    if (b !== 0 || o !== 0) census[ent] = { brepkit: b, occt: o, match: b === o }
  }
  const surfOk = Object.values(census).every((c) => c.match)
  const status = volRel < MAXREL && areaRel < MAXREL && surfOk && bboxOk ? 'PASS' : 'DIFF'
  console.log(`${status}  ${r.case}  volRel=${volRel.toExponential(2)}  areaRel=${areaRel.toExponential(2)}  bbox=${bboxOk ? 'ok' : 'MISMATCH'}`)
  for (const [ent, c] of Object.entries(census)) {
    if (!c.match) console.log(`      surface mismatch: ${ent}  brepkit=${c.brepkit}  occt=${c.occt}`)
  }
}
console.log('\n=== CROSS-IMPORT ===')
for (const x of ximport) {
  const a = x.occt_reads_brepkit ? `vol=${x.occt_reads_brepkit.volume.toFixed(6)}` : `ERR: ${x.occt_reads_brepkit_error}`
  const b = x.brepkit_reads_occt ? `solids=${x.brepkit_reads_occt.solids} vols=[${x.brepkit_reads_occt.volumes.map((v) => v.toFixed(6)).join(', ')}]` : `ERR: ${x.brepkit_reads_occt_error}`
  console.log(`${x.case}\n  occt  <- brepkit: ${a}\n  brepkit <- occt:   ${b}`)
}
