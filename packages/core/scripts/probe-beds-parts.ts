/**
 * Beds per-part solid probe: materialize the converted .fai.zip, run the full
 * main.fai.js, and introspect every statement output (shapeType / solids /
 * volume) to locate the solids(10vs6) parity gap.
 *
 * usage: tsx probe-beds-parts.ts <product.fai.zip>
 */
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { CadRuntime } from '../src/cad-runtime/runtime.js'
import { initOcctWasm } from '../src/occt-kernel/occtKernel.js'
import { createApiNamespaceWithEditorOps } from '../src/test-support/editor-ops.js'
import { createNodePorts } from '../src/node-host/index.js'
import { getBrepApi } from '../src/brep/handle-bridge.js'
import { brepOf } from '../src/shape.js'
import type { Shape } from '../src/mesh/types.js'

const zipPath = process.argv[2] ?? 'D:/Faicad/fcstd-port/out/per-file/b2eaf2953852-Beds/product.fai.zip'
const zipBytes = new Uint8Array(readFileSync(zipPath))
const scratch = mkdtempSync(join(tmpdir(), 'beds-probe-'))
const members = unzipSync(zipBytes)
let mainPath: string | null = null
for (const [name, bytes] of Object.entries(members)) {
  if (name.startsWith('model/') && name.endsWith('.fai.js')) {
    const p = join(scratch, name.slice('model/'.length))
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, strFromU8(bytes))
    if (p.endsWith('main.fai.js')) mainPath = p
  }
  if (name.startsWith('assets/')) {
    mkdirSync(join(scratch, 'assets'), { recursive: true })
    writeFileSync(join(scratch, name), Buffer.from(bytes))
  }
}
if (!mainPath) {
  console.log('no model/main.fai.js in container')
  process.exit(1)
}

await initOcctWasm()
const ports = createNodePorts({ assetsDir: join(scratch, 'assets') })
const rt = new CadRuntime(ports, 'brep', {
  cad: createApiNamespaceWithEditorOps(),
})

const code = readFileSync(mainPath, 'utf-8')
const result = await rt.execute(code)
if (result.failedAt) {
  console.log(`EXEC FAILED at ${result.failedAt.callee}: ${result.failedAt.message}`)
  process.exit(1)
}

const k = getBrepApi()
let totalSolids = 0
for (const name of result.outputs.keys()) {
  const s = result.outputs.get(name) as Shape | undefined
  if (!s) continue
  const h = brepOf(s)
  try {
    const st = String(k.shapeType(h as never))
    const solids = k.getSubShapes(h as never, 'solid' as never)
    let vol = 'n/a'
    try { vol = Number(k.getVolume(h as never)).toFixed(1) } catch { vol = 'ERR' }
    if (st === 'solid' || st === 'compound') totalSolids += solids.length
    console.log(`${name}: ${st} solids=${solids.length} vol=${vol}`)
  } catch (e) {
    console.log(`${name}: introspect ERR ${e instanceof Error ? e.message : String(e)}`)
  }
}
console.log(`TOTAL solids (solid/compound parts): ${totalSolids}`)
process.exit(0)
