// A2 probe (Beds.FCStd, statement 32): why does `cad.edgeRef` fail on a
// sketch → extrude → place chain with "adjacent face ordinal N has no role
// lineage"?
//
// Question under test: is the part's RoleTable EMPTY (chain root produced no
// role entries) or merely INCOMPLETE (roles present, but this face's hash is
// not covered)? The error text cannot tell them apart, and the two have
// completely different fixes.
//
// Control arm: a `cad.box` chain root, which DOES get a semantic role table.
//
// Usage: npx tsx packages/core/scripts/probe-a2-edgeref.ts
import { createRuntime } from '../src/index.js'
import { createNodePorts } from '../src/node.js'
import { initOcctWasm } from '../src/occt-kernel/occtKernel.js'
import { runtimeLineage } from '../src/topology/naming/lineage.js'

await initOcctWasm()

const SQUARE = `{ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
], closed: true }] }`

function dump(label: string, part: string): void {
  const table = runtimeLineage.tableOfPart(part as never)
  const roles = table ? [...table.entries()].map(([o, m]) => `${o}={${[...m.keys()].join(',')}}`) : []
  console.log(`${label}: table=${table ? 'present' : 'MISSING'} size=${table?.size ?? 0} entries=[${roles.join(' | ')}]`)
}

const runtime = createRuntime(createNodePorts(), 'brep')
try {
  const result = await runtime.execute(`
    const b = cad.box({ width: 10, depth: 10, height: 10, at: [0,0,0], centered: false })
    const s = cad.sketch(${SQUARE})
    const e = cad.extrude(s, [0, 0, 10])
    const p = cad.place(e, { rotation: [0,0,0,1], position: [0,0,10] })
  `, { topology: 'auto' })
  console.log('execute failedAt:', result.failedAt?.message ?? '(none)')
  dump('box', 'b')
  dump('sketch', 's')
  dump('extrude', 'e')
  dump('place(extrude)', 'p')

  for (const [part, label] of [['b', 'box'], ['e', 'extrude'], ['p', 'place']] as const) {
    const r = await runtime.execute(`
      const x = cad.edgeRef(${part}, 1)
    `, { topology: 'auto' })
    console.log(`edgeRef(${label},1): ${r.failedAt ? 'FAILED -> ' + r.failedAt.message : 'OK'}`)
  }
} finally {
  runtime.dispose()
}
process.exit(0)
