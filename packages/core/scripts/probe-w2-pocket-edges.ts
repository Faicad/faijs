import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { createRuntime } from '../src/index.ts'
import { createNodePorts } from '../src/node.ts'
import { initOcctWasm } from '../src/occt-kernel/occtKernel.ts'
import { getBrepApi } from '../src/brep/handle-bridge.ts'
import { brepOf } from '../src/shape.ts'

const ZIP = 'D:/Faicad/fcstd-port/out/per-file/5014c64785f6-Wall-Hung-Toilets/product.fai.zip'
const members = unzipSync(new Uint8Array(readFileSync(ZIP)))
const code = strFromU8(members['model/Body.fai.js'])
// cut at the fillet statement
const cut = code.split('\n').findIndex((l) => l.includes('cad.fillet('))
const pre = code.split('\n').slice(0, cut).join('\n')
await initOcctWasm()
const runtime = createRuntime(createNodePorts(), 'brep')
try {
  const result = await runtime.execute(pre, { topology: 'auto' })
  if (result.failedAt) { console.log('EXEC FAILED:', result.failedAt.message); process.exit(1) }
  const shape = result.outputs.get('Pocket')
  const kernel = getBrepApi()
  const solid = brepOf(shape)
  const edges = kernel.getSubShapes(solid, 'edge')
  const faces = kernel.getSubShapes(solid, 'face')
  console.log('Pocket edges:', edges.length, 'faces:', faces.length)
  const bb = kernel.getBoundingBox(solid)
  console.log('Pocket bbox:', bb)
} finally { runtime.dispose() }
process.exit(0)
