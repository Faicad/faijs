// A3 probe: revolve minimal repro (FCBL_tree_entourage statement 2 shape)
import { createRuntime } from '../src/index.js'

const rt = createRuntime()
const cad = rt.cad

const p0 = await cad.sketch({
  contours: [
    {
      segments: [
        { kind: 'line', x1: 0, y1: 0, x2: -250, y2: 0 },
        { kind: 'line', x1: -250, y1: 0, x2: -163.759169, y2: 279.505623 },
        { kind: 'line', x1: -163.759169, y1: 279.505623, x2: -136.318743, y2: 765.591374 },
        { kind: 'line', x1: -136.318743, y1: 765.591374, x2: -136.318743, y2: 1500 },
        { kind: 'line', x1: -136.318743, y1: 1500, x2: 0, y2: 1500 },
        { kind: 'line', x1: 0, y1: 1500, x2: 0, y2: 0 },
      ],
      closed: true,
    },
  ],
})
console.log('sketch ok', p0 !== undefined)
const r = await cad.revolve(p0, { axis: [0, 0, 1], at: [0, 0, 0], angle: 6.283185307179586 })
console.log('revolve ok', r !== undefined)
process.exit(0)
