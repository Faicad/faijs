// brepkit vs occt-wasm STEP consistency probe (JS side).
//
// Rebuilds the same 10 test solids in occt-wasm, exports each to STEP,
// then compares against the brepkit probe output (manifest.json + STEP
// files) produced by the Rust probe binary.
//
// Usage: node scripts/brepkit-step-check/compare.mjs <brepkit-out-dir> <occt-out-dir>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { OcctKernel } from 'occt-wasm'
import { readFileSync as readFile } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const OUT_BK = resolve(process.argv[2] ?? './brepkit-out')
const OUT_OC = resolve(process.argv[3] ?? './occt-out')
mkdirSync(OUT_OC, { recursive: true })

const manifest = JSON.parse(readFileSync(join(OUT_BK, 'manifest.json'), 'utf8'))

// ── occt-wasm kernel init (same path resolution as faijs occtKernel) ──
const wasmPath = require.resolve('occt-wasm/dist/occt-wasm.wasm')
const wasmBinary = readFile(wasmPath).buffer.slice(0)
const kernel = await OcctKernel.init({ wasm: wasmBinary })
console.log('occt-wasm kernel initialized')

// ── geometry builders (mirroring the Rust probe) ──
function centerBox(k, dx, dy, dz) {
  const s = k.makeBoxFromCorners({ x: -dx / 2, y: -dy / 2, z: -dz / 2 }, { x: dx / 2, y: dy / 2, z: dz / 2 })
  return s
}
function translate(k, s, dx, dy, dz) {
  const t = k.translate(s, dx, dy, dz)
  k.release(s)
  return t
}

const builders = {
  C01_box_centered: () => centerBox(kernel, 10, 20, 30),
  C02_cylinder_origin: () => kernel.makeCylinder(5, 20),
  C03_cylinder_centered: () => translate(kernel.makeCylinder(5, 20), 0, 0, -10),
  C04_sphere_centered: () => kernel.makeSphere(7.5),
  C05_cone_origin: () => kernel.makeCone(5, 2, 15),
  C06_torus_centered: () => kernel.makeTorus(10, 4),
  C07_box_cut_cylinder: () => {
    const b = centerBox(kernel, 10, 10, 10)
    const c = kernel.makeCylinder(3, 10)
    const r = kernel.cut(b, c)
    kernel.release(b)
    kernel.release(c)
    return r
  },
  C08_fuse_two_boxes: () => {
    const b1 = centerBox(kernel, 10, 10, 10)
    const b2 = translate(kernel.makeBox(10, 10, 10), 0, 0, 10) // base at z=5 → spans 5..15; overlap 5..10 with b1 (which spans -5..5)
    const r = kernel.fuse(b1, b2)
    kernel.release(b1)
    kernel.release(b2)
    return r
  },
  C09_common_box_cylinder: () => {
    const b = centerBox(kernel, 8, 8, 8)
    const c = kernel.makeCylinder(6, 8) // z 0..8, box z -4..4
    const r = kernel.common(b, c)
    kernel.release(b)
    kernel.release(c)
    return r
  },
  C10_cylinder_rotated: () => {
    const c = translate(kernel.makeCylinder(5, 20), 0, 0, -10)
    const r = kernel.rotate(c, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, Math.PI / 6)
    kernel.release(c)
    return r
  },
}

// ── STEP text census (entity type counts) ──
function stepCensus(text) {
  const counts = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*#\d+\s*=\s*([A-Z_]+)\(/)
    if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1
  }
  return counts
}

const SURFACE_TO_ENTITY = {
  plane: 'PLANE',
  cylinder: 'CYLINDRICAL_SURFACE',
  cone: 'CONICAL_SURFACE',
  sphere: 'SPHERICAL_SURFACE',
  torus: 'TOROIDAL_SURFACE',
}

const results = []
for (const [name, bk] of Object.entries(manifest)) {
  const t0 = Date.now()
  let solid
  try {
    solid = builders[name]()
  } catch (e) {
    results.push({ case: name, occt: 'BUILD_ERROR', error: String(e) })
    continue
  }
  let step, vol, area, bbox, ok
  try {
    step = kernel.exportStep(solid)
    vol = kernel.getVolume(solid)
    area = kernel.getSurfaceArea(solid)
    bbox = kernel.getBoundingBox(solid, false)
    ok = true
  } catch (e) {
    kernel.release(solid)
    results.push({ case: name, occt: 'EXPORT_ERROR', error: String(e) })
    continue
  }
  kernel.release(solid)
  const file = `${name}.step`
  writeFileSync(join(OUT_OC, file), step)
  const census = stepCensus(step)

  const row = {
    case: name,
    ms: Date.now() - t0,
    volume: { brepkit: bk.volume, occt: Number(vol).toFixed(6), diff: Math.abs(vol - parseFloat(bk.volume)).toExponential(3) },
    area: { brepkit: bk.area, occt: Number(area).toFixed(6), diff: Math.abs(area - parseFloat(bk.area)).toExponential(3) },
    bbox: {
      brepkit: bk.bbox,
      occt: [bbox.xmin, bbox.ymin, bbox.zmin, bbox.xmax, bbox.ymax, bbox.zmax].map((v) => Number(v).toFixed(6)),
    },
    surfaces: {},
    step_bytes: { brepkit: bk.bytes, occt: step.length },
    step_lines: { brepkit: bk.step_lines, occt: step.split('\n').length },
  }
  for (const [surface, entity] of Object.entries(SURFACE_TO_ENTITY)) {
    const want = bk.faces[surface] ?? 0
    const got = census[entity] ?? 0
    row.surfaces[surface] = { expected: want, occt_step: got, match: want === got }
  }
  results.push(row)
  console.log(`[ok] ${name}  vol_diff=${row.volume.diff}  area_diff=${row.area.diff}`)
}

// ── cross-import: each kernel reading the other's STEP ──
const ximport = []
for (const name of Object.keys(manifest)) {
  // occt reading brepkit STEP
  const bkStep = readFileSync(join(OUT_BK, `${name}.step`), 'utf8')
  let ocVol = null, ocErr = null
  try {
    const s = kernel.importStep(bkStep)
    ocVol = kernel.getVolume(s)
    kernel.release(s)
  } catch (e) {
    ocErr = String(e)
  }
  // brepkit reading occt STEP (via Rust round-trip manifest if present)
  const ocStepPath = join(OUT_OC, `${name}.step`)
  ximport.push({ case: name, occt_reads_brepkit: ocVol !== null ? Number(ocVol).toFixed(6) : null, occt_reads_brepkit_error: ocErr })
}

const report = {
  generated: new Date().toISOString(),
  results,
  ximport,
}
writeFileSync(join(OUT_OC, 'report.json'), JSON.stringify(report, null, 2))
console.log(`\nreport -> ${join(OUT_OC, 'report.json')}`)

// ── summary table ──
const MAXDIFF = 1e-4
console.log('\n=== SUMMARY (rel tolerance 1e-4) ===')
for (const r of results) {
  if (!r.volume) {
    console.log(`FAIL  ${r.case}: ${r.occt} ${r.error ?? ''}`)
    continue
  }
  const vd = parseFloat(r.volume.diff)
  const ad = parseFloat(r.area.diff)
  const volRel = vd / Math.max(1e-12, parseFloat(r.volume.brepkit))
  const areaRel = ad / Math.max(1e-12, parseFloat(r.area.brepkit))
  const surfOk = Object.values(r.surfaces).every((s) => s.match)
  const bb = r.bbox.brepkit
  const bo = r.bbox.occt
  const bboxOk = bb.every((v, i) => Math.abs(parseFloat(v) - parseFloat(bo[i])) < 1e-5)
  const status = volRel < MAXDIFF && areaRel < MAXDIFF && surfOk && bboxOk ? 'PASS' : 'DIFF'
  console.log(`${status}  ${r.case}  volRel=${volRel.toExponential(2)}  areaRel=${areaRel.toExponential(2)}  surfaces=${surfOk ? 'ok' : 'MISMATCH'}  bbox=${bboxOk ? 'ok' : 'MISMATCH'}`)
}
console.log('\n=== CROSS-IMPORT (occt-wasm reads brepkit STEP) ===')
for (const x of ximport) {
  console.log(`${x.occt_reads_brepkit ?? 'FAIL'}  ${x.case}${x.occt_reads_brepkit_error ? '  err=' + x.occt_reads_brepkit_error : ''}`)
}
