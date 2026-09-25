// A3 standalone crash repro — run with tsx/node to capture the native crash
// signal (abort/OOM message) on stderr outside the vitest worker.
import { createRuntime } from '../src/index'
import { createNodePorts } from '../src/node'
import { initOcctWasm } from '../src/occt-kernel/occtKernel'

await initOcctWasm()
const runtime = createRuntime(createNodePorts(), 'brep')
const L_TOP = `{ kind: 'line', x1: 0, y1: 1078.6061879890412, x2: -554.9340000000001, y2: 1078.6061879890412 }`
const A1 = `{ kind: 'arc', cx: -554.934, cy: 1576.61, radius: 498.00381201095877, startAngle: -1.570796326794897, endAngle: -2.7126514609372734, ccw: false, x1: -554.9340000000001, y1: 1078.606187989041, x2: -1007.8219663923912, y2: 1369.4861561905275 }`
const L2 = `{ kind: 'line', x1: -1007.8219663923912, y1: 1369.4861561905275, x2: -1073.395535969475, y2: 1512.8664644575629 }`
const A2 = `{ kind: 'arc', cx: 1494.060356088772, cy: 2687.0670894166183, radius: 2823.221008939762, startAngle: -2.7126514609372743, endAngle: 2.8740556782240416, ccw: false, x1: -1073.395535969475, y1: 1512.8664644575629, x2: -1228.724391685866, y2: 3433.4048699186155 }`
const L3 = `{ kind: 'line', x1: -1228.724391685866, y1: 3433.4048699186155, x2: -779.3228279419842, y2: 5072.908798776252 }`
const A3 = `{ kind: 'arc', cx: 0, cy: 4859.289977025418, radius: 808.0699667465105, startAngle: 2.8740556782240416, endAngle: 1.5707963267948966, ccw: false, x1: -779.3228279419842, y1: 5072.908798776252, x2: 4.94800149131611e-14, y2: 5667.359943771929 }`
const L4 = `{ kind: 'line', x1: 4.94800149131611e-14, y1: 5667.359943771929, x2: 0, y2: 1078.6061879890412 }`

console.log('running s1+revolve...')
const result = await runtime.execute(`
  const part1 = cad.sketch({ contours: [{ segments: [${L_TOP},${A1},${L2},${A2},${L3},${A3},${L4}], closed: true }] })
  const part3 = cad.revolve(part1, { axis: [0,0,1], at: [0,0,0], angle: 6.283185307179586 })
`, { topology: 'auto' })
console.log('failedAt:', result.failedAt?.message ?? 'ok')
runtime.dispose()
process.exit(0)
