/**
 * Loft solid probe (Beds s13/s25 loft statements).
 * Question: does `cad.loft` over cad.profile faces produce a SOLID or a SHELL?
 * Sections taken verbatim from Beds out/per-file product main.fai.js.
 */
import { CadRuntime } from '../src/cad-runtime/runtime.js'
import { initOcctWasm } from '../src/occt-kernel/occtKernel.js'
import { createApiNamespaceWithEditorOps } from '../src/test-support/editor-ops.js'
import { getBrepApi } from '../src/brep/handle-bridge.js'
import { brepOf } from '../src/shape.js'
import type { Shape } from '../src/mesh/types.js'

await initOcctWasm()
const rt = new CadRuntime({ events: { emit: () => {} } } as never, 'auto', {
  cad: createApiNamespaceWithEditorOps(),
})

const sketch257 = `cad.profile({ contours: [{ segments: [
  { kind: 'line', x1: -694, y1: -935, x2: -664, y2: -935 },
  { kind: 'line', x1: -664, y1: -935, x2: -664, y2: -965 },
  { kind: 'line', x1: -664, y1: -965, x2: -674, y2: -965 },
  { kind: 'arc', cx: -674, cy: -945, radius: 20, startAngle: -1.5707963267948966, endAngle: 3.141592653589793, ccw: false, x1: -674, y1: -965, x2: -694, y2: -945 },
  { kind: 'line', x1: -694, y1: -945, x2: -694, y2: -935 },
], closed: true }] })`

const sketch258 = `cad.profile({ contours: [{ segments: [
  { kind: 'line', x1: -694, y1: -915, x2: -644, y2: -915 },
  { kind: 'line', x1: -644, y1: -915, x2: -644, y2: -965 },
  { kind: 'line', x1: -644, y1: -965, x2: -664, y2: -965 },
  { kind: 'arc', cx: -664, cy: -935, radius: 30, startAngle: -1.5707963267948966, endAngle: 3.141592653589793, ccw: false, x1: -664, y1: -965, x2: -694, y2: -935 },
  { kind: 'line', x1: -694, y1: -935, x2: -694, y2: -915 },
], closed: true }] })`

const code = `let part11 = ${sketch257}
let part12 = ${sketch258}
let part13 = cad.loft([part11, part12])
`

const result = await rt.execute(code)
if (result.failedAt) {
  console.log(`EXEC FAILED at ${result.failedAt.callee}: ${result.failedAt.message}`)
  process.exit(1)
}

const k = getBrepApi()
for (const name of ['part11', 'part12', 'part13']) {
  const s = result.outputs.get(name) as Shape | undefined
  if (!s) {
    console.log(`${name}: NO OUTPUT`)
    continue
  }
  const h = brepOf(s)
  try {
    const st = k.shapeType(h as never)
    const solids = k.getSubShapes(h as never, 'solid' as never)
    const faces = k.getSubShapes(h as never, 'face' as never)
    const shells = k.getSubShapes(h as never, 'shell' as never)
    let vol = 'n/a'
    try { vol = String(k.getVolume(h as never)) } catch { vol = 'ERR' }
    console.log(`${name}: shapeType=${String(st)} solids=${solids.length} shells=${shells.length} faces=${faces.length} volume=${vol}`)
  } catch (e) {
    console.log(`${name}: introspect ERR ${e instanceof Error ? e.message : String(e)}`)
  }
}

process.exit(0)
