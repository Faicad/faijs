// 探针：L1 splitByPlane 两半体积（Phase 6.1 诊断，保留）
import { initOcctWasm } from '../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../src/brep/engine/adapters/occt'
import { getBrepApi } from '../src/brep/handle-bridge'
import { getBrepEngine } from '../src/brep/engine/registry'
import { configureBackends } from '../src/runtime-state'
await initOcctWasm()
await registerOcctBrepEngine()
const prim = (await getBrepEngine()).primitives
configureBackends({
  contractVersion: 1,
  config: { mode: 'brep', brepEngineId: 'occt' },
  kernel: { brep: prim, csg: undefined, sdf: undefined },
  fonts: undefined,
})
const k = getBrepApi() as any
const box = k.makeBox(20, 20, 20, { x: 0, y: 0, z: 0 })
const { positive, negative } = k.splitByPlane(box, { x: 10, y: 10, z: 10 }, { x: 0, y: 0, z: 1 })
console.log('vol box=', k.getVolume(box))
console.log('vol pos=', k.getVolume(positive), 'vol neg=', k.getVolume(negative))
