/**
 * install-smoke-consumer — executed inside the isolated install directory.
 *
 * One sketch through the full solve pipeline: a rectangle with horizontal +
 * length constraints, solved by planegcs. Asserts the solved geometry matches
 * the analytical answer and prints a JSON summary on stdout.
 *
 * This file is NOT compiled by tsc (lives outside src/) and NOT included in the
 * tarball — it is copied into the temp install dir by the test harness.
 */
import { solveSketch } from '@faicad/faijs-sketch'
import { createNodePlanegcsSolver } from '@faicad/faijs-sketch/node'

const solver = await createNodePlanegcsSolver()

const geoms = [
  { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 },
  { tag: 'right', kind: 'line', x1: 40, y1: 0, x2: 40, y2: 30 },
  { tag: 'top', kind: 'line', x1: 40, y1: 30, x2: 0, y2: 30 },
  { tag: 'left', kind: 'line', x1: 0, y1: 30, x2: 0, y2: 0 },
]
const constraints = [
  { kind: 'horizontal', of: { tag: 'bottom' } },
  { kind: 'horizontal', of: { tag: 'top' } },
  { kind: 'vertical', of: { tag: 'left' } },
  { kind: 'vertical', of: { tag: 'right' } },
  { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
  { kind: 'coincident', a: { tag: 'right', at: 'end' }, b: { tag: 'top', at: 'start' } },
  { kind: 'coincident', a: { tag: 'top', at: 'end' }, b: { tag: 'left', at: 'start' } },
  { kind: 'coincident', a: { tag: 'left', at: 'end' }, b: { tag: 'bottom', at: 'start' } },
  { kind: 'length', of: { tag: 'bottom' }, value: 50 },
  { kind: 'length', of: { tag: 'left' }, value: 40 },
]

const out = await solveSketch(geoms, constraints, { solver })

if (!out.converged) {
  console.error('SOLVE FAILED:', out.reason)
  process.exit(1)
}

const bottom = out.geoms[0]
const left = out.geoms[3]
const bottomLen = Math.hypot(bottom.x2 - bottom.x1, bottom.y2 - bottom.y1)
const leftLen = Math.hypot(left.x2 - left.x1, left.y2 - left.y1)

const summary = {
  converged: out.converged,
  status: out.status,
  bottomLen,
  leftLen,
  bottomLenOk: Math.abs(bottomLen - 50) < 1e-4,
  leftLenOk: Math.abs(leftLen - 40) < 1e-4,
}

console.log(JSON.stringify(summary))

if (!summary.bottomLenOk || !summary.leftLenOk) {
  console.error('GEOMETRY MISMATCH:', JSON.stringify(summary))
  process.exit(1)
}