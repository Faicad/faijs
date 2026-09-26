import { describe, expect, it } from 'vitest'
import { createNodePorts } from '../node'
import { getBackends } from '../runtime-state'
import { runtimeLineage } from '../topology/naming/lineage'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { createEditorRuntime } from '../test-support/editor-ops'

const SQUARE = `{ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
], closed: true }] }`

describe('probe revolve roles', () => {
  it('dumps part-key table vs live per-face hashes', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    const code = `
      const part0 = cad.profile(${SQUARE})
      const part1 = cad.revolve(part0, { axis: [0, 0, 1], at: [0, 0, 0], angle: 6.283185307179586 })
    `
    await runtime.execute(code, { topology: 'auto' })
    const kernel = getBackends().kernel.brep as BrepEngineApi
    const byPart = (runtimeLineage as unknown as { outputTablesByPart: Map<string, unknown> }).outputTablesByPart
    for (const [p, t] of byPart) {
      console.log('partTable', p, JSON.stringify([...(t as Map<string, unknown>).entries()]))
    }
    const oh = (runtimeLineage as unknown as { outputHandles: Map<string, unknown> }).outputHandles
    for (const [k, h] of oh) {
      const faces = kernel.getSubShapes(h as never, 'face')
      const hashes = kernel.subShapeHashes(h as never, 'face', 2147483647)
      console.log('stmt', k, 'faces', faces.length, 'hashes', hashes)
    }
    runtime.dispose()
    expect(true).toBe(true)
  })
})
