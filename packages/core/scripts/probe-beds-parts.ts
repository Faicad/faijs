/**
 * Beds per-part solid probe: open a converted .fai.zip through the unified
 * container reader (openContainer), materialize the module graph + assets from
 * the returned loader, run the active model entry, and introspect every
 * statement output (shapeType / solids / volume) to locate the solids(10vs6)
 * parity gap.
 *
 * usage: tsx probe-beds-parts.ts <product.fai.zip>
 */
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openContainer } from '../../fcstd/src/container-read.js'
import { CadRuntime } from '../src/cad-runtime/runtime.js'
import { initOcctWasm } from '../src/occt-kernel/occtKernel.js'
import { createApiNamespaceWithEditorOps } from '../src/test-support/editor-ops.js'
import { createNodePorts, createFsProjectLoader } from '../src/node-host/index.js'
import { getBrepApi } from '../src/brep/handle-bridge.js'
import { brepOf } from '../src/shape.js'
import type { Shape } from '../src/mesh/types.js'

const zipPath = process.argv[2] ?? 'D:/Faicad/fcstd-port/out/per-file/b2eaf2953852-Beds/product.fai.zip'
const zipBytes = new Uint8Array(readFileSync(zipPath))
const { manifest, activeModel, loader, assets } = openContainer(zipBytes)
if (!activeModel) {
  console.log('container has no active model (and no models[0])')
  process.exit(1)
}
const scratch = mkdtempSync(join(tmpdir(), 'beds-probe-'))
// materialize the module graph (entry + dependencies) from the loader, plus
// assets, into the scratch dir; relative imports resolve via projectLoader.
for (const moduleKey of loader.listModules()) {
  const p = join(scratch, 'model', moduleKey)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, await loader.readSource(moduleKey))
}
for (const [name, bytes] of Object.entries(assets)) {
  mkdirSync(join(scratch, 'assets'), { recursive: true })
  writeFileSync(join(scratch, 'assets', `${name}.brp`), Buffer.from(bytes))
}

await initOcctWasm()
const ports = {
  ...createNodePorts({ assetsDir: join(scratch, 'assets') }),
  projectLoader: createFsProjectLoader(scratch),
}
const rt = new CadRuntime(ports, 'brep', {
  cad: createApiNamespaceWithEditorOps(),
})

const code = readFileSync(join(scratch, activeModel.entry), 'utf-8')
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
