// W2 type-2 probe (Wall-Hung-Toilets): reproduce `edge ordinal 32 out of range`
// and dump the topology of the fillet base (part7 = subtract(part3, part6)) so we
// can see whether the upstream extrude (arcs) or boolean is collapsing edges.
// Usage: npx tsx packages/core/scripts/probe-w2-toilets.ts [zip]
import { readFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { createRuntime } from '../src/index.js'
import { createNodePorts } from '../src/node.js'
import { initOcctWasm } from '../src/occt-kernel/occtKernel.js'
import { getBrepApi } from '../src/brep/handle-bridge.js'
import { brepOf } from '../src/shape.js'

const ZIP = process.argv[2] ?? 'D:/Faicad/fcstd-port/.tmp-wallhung-reconv.fai.zip'

const members = unzipSync(new Uint8Array(readFileSync(ZIP)))
const full = strFromU8(members['model/Body.fai.js']!)
// Truncate to s7 (part7) so we can inspect the fillet base without the fillet
// itself failing. part7 = subtract(part3, part6).
const lines = full.split('\n')
const idx7 = lines.findIndex((l) => l.startsWith('let Pocket ='))
const code = lines.slice(0, idx7 + 1).join('\n')
console.log(`truncated to line ${idx7 + 1} (let Pocket); total ${lines.length} lines`)

function dump(label: string, shape: unknown) {
  const kernel = getBrepApi()!
  const solid = brepOf(shape as object)
  if (!solid) { console.log(`  ${label}: NO BREP`); return }
  const faces = kernel.getSubShapes(solid, 'face')
  const edges = kernel.getSubShapes(solid, 'edge')
  console.log(`  ${label}: faces=${faces.length} edges=${edges.length}`)
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i]!
    const st = kernel.surfaceType(f)
    const c = kernel.surfaceCenterOfMass(f)
    const n = kernel.surfaceNormal(f, 0.5, 0.5)
    console.log(`    face${i + 1}: type=${st} center=(${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)}) n=(${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)})`)
  }
}

await initOcctWasm()
const scratch = join('D:/Faicad/faijs/.tmp-w2-toilets')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
const runtime = createRuntime(createNodePorts({ assetsDir: scratch }), 'brep')
try {
  const result = await runtime.execute(code, { topology: 'auto' })
  if (result.failedAt) {
    console.log('EXEC FAILED:', result.failedAt.message)
  } else {
    console.log('EXEC OK')
  }
  const outputs = result.outputs as Map<string, unknown> | undefined
  if (outputs && typeof outputs.get === 'function') {
    for (const v of ['Pad001', 'Pocket_cut', 'Pocket'] as const) {
      const s = outputs.get(v)
      if (s) dump(v, s)
      else console.log(`  ${v}: not in outputs`)
    }
  } else {
    console.log('  no outputs map')
  }
} finally {
  runtime.dispose()
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(0)
