// A2 probe (Beds.FCStd): run the real generated model up to the fillet's base
// (part28) and report WHICH faces of that base are covered by the part's role
// table — the decisive question behind
// `edgeRef: adjacent face ordinal 2 has no role lineage`.
//
// Pairs with probe-a2-edgeref.ts (synthetic square extrusion, which is fully
// covered: {bottom,top,wall:0..3}). Beds' profile contains ARCS, so the
// extrusion has cylindrical wall faces — the hypothesis is that coverage
// breaks there.
//
// Usage: npx tsx packages/core/scripts/probe-a2-beds.ts
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { createRuntime } from '../src/index.js'
import { createNodePorts } from '../src/node.js'
import { initOcctWasm } from '../src/occt-kernel/occtKernel.js'
import { runtimeLineage } from '../src/topology/naming/lineage.js'
import { getBrepApi } from '../src/brep/handle-bridge.js'
import { brepOf } from '../src/shape.js'
import { HASH_UPPER_BOUND } from '../src/brep/face-evolution.js'

const ZIP = 'D:/Faicad/fcstd-port/out/per-file/Beds/product.fai.zip'
const BASE_VAR = process.argv[2] ?? 'part28'

const members = unzipSync(new Uint8Array(readFileSync(ZIP)))
const full = strFromU8(members['model/main.fai.js']!)
// Cut everything from the fillet statement onwards (the fillet is the op that
// fails); keep the base chain intact.
const cut = full.split('\n').findIndex((l) => l.includes('cad.fillet('))
if (cut < 0) throw new Error('no cad.fillet statement found')
const code = full.split('\n').slice(0, cut).join('\n')
console.log(`running ${cut - 2} statements; base var = ${BASE_VAR}`)

// Materialize `assets/` the same way tools/run-sweep-worker.ts does.
const scratch = join('D:/Faicad/faijs/.tmp-a2-probe')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(join(scratch, 'assets'), { recursive: true })
for (const [name, bytes] of Object.entries(members)) {
  if (!name.startsWith('assets/')) continue
  writeFileSync(join(scratch, name), Buffer.from(bytes))
}

await initOcctWasm()
const runtime = createRuntime(createNodePorts({ assetsDir: join(scratch, 'assets') }), 'brep')
try {
  const result = await runtime.execute(code, { topology: 'auto' })
  if (result.failedAt) {
    console.log('EXEC FAILED:', result.failedAt.message)
    process.exit(1)
  }
  const shape = (result.outputs as Map<string, unknown>).get(BASE_VAR) as object | undefined
  if (!shape) throw new Error(`${BASE_VAR} not produced`)
  const table = runtimeLineage.tableOfPart(BASE_VAR as never)
  const roles = table ? [...table.entries()].map(([o, m]) => `${o}={${[...m.keys()].join(',')}}`) : []
  console.log(`role table: size=${table?.size ?? 0} entries=[${roles.join(' | ')}]`)

  const kernel = getBrepApi()!
  const solid = brepOf(shape)!
  const hashes = Array.from(kernel.subShapeHashes(solid, 'face', HASH_UPPER_BOUND))
  const covered = new Set<number>()
  for (const m of table?.values() ?? []) {
    for (const hs of m.values()) for (const h of hs) covered.add(h)
  }
  const faceHandles = kernel.getSubShapes(solid, 'face')
  for (let i = 0; i < faceHandles.length; i++) {
    const f = faceHandles[i]!
    const st = kernel.surfaceType(f)
    const uv = kernel.uvBounds(f)
    const n = kernel.surfaceNormal(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
    const len = Math.hypot(n.x, n.y, n.z)
    console.log(
      `  face ${i + 1}: type=${st} normal=(${n.x.toFixed(3)},${n.y.toFixed(3)},${n.z.toFixed(3)}) |n|=${len.toFixed(3)} covered=${covered.has(hashes[i]!)}`,
    )
  }
  const missing = hashes.map((h, i) => ({ ordinal: i + 1, hash: h })).filter((r) => !covered.has(r.hash))
  console.log(`faces=${hashes.length} covered=${hashes.length - missing.length} uncovered=${missing.length}`)
  console.log(`uncovered ordinals: ${missing.map((m) => m.ordinal).join(', ')}`)
  for (const [origin, m] of table ?? []) {
    console.log(`  origin ${origin}: ${[...m.entries()].map(([r, hs]) => `${r}->[${hs.join(',')}]`).join(' ')}`)
  }
} finally {
  runtime.dispose()
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(0)
