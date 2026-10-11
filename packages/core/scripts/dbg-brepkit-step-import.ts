// One-off verification: local brepkit2 kernel (with SURFACE_CURVE reader fix)
// must import the occt-written fixture box_boss.step without error.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { setBrepkitWasmInitFn } from '../src/brepkit-kernel/brepkitWasm.ts'
import { registerBrepkitBrepEngine } from '../src/brep/engine/adapters/brepkit.ts'
import { getBrepEngine } from '../src/brep/engine/registry.ts'
import { getBrepApi } from '../src/brep/handle-bridge.ts'
import { configureBackends, CONTRACT_VERSION } from '../src/runtime-state.ts'

configureBackends({
  contractVersion: CONTRACT_VERSION,
  config: { mode: 'brep' },
  kernel: { brep: null },
  events: { emit: () => undefined },
} as never)

const PKG = 'C:/my/Faicad/brepkit2/crates/wasm/pkg'
setBrepkitWasmInitFn(async () => {
  // node entry of the dual-target pkg (CJS glue, zero-eval safe).
  const mod = await import(pathToFileURL(`${PKG}/brepkit_wasm_node.cjs`).href)
  if (!mod?.BrepKernel) throw new Error('local pkg has no BrepKernel export')
  return new mod.BrepKernel()
})

await registerBrepkitBrepEngine()
// hosts wire registry → backends.kernel.brep at assembly; dbg script does the same.
const engine = await getBrepEngine()
configureBackends({
  contractVersion: CONTRACT_VERSION,
  config: { mode: 'brep', brepEngineId: 'brepkit' },
  kernel: { brep: engine.primitives },
  events: { emit: () => undefined },
} as never)
const kernel = getBrepApi()
const buffer = readFileSync(new URL('../../fixtures/data/box_boss.step', import.meta.url))
const top = kernel.importStep(buffer)
const solids = kernel.getSubShapes(top, 'solid')
console.log('solids:', solids.length)
if (solids.length >= 1) {
  const v = kernel.getVolume(solids[0]!)
  console.log('volume:', v)
  if (!(v > 0)) throw new Error('expected volume > 0')
}
console.log('OK: local brepkit kernel imports occt-written STEP with SURFACE_CURVE')
