/**
 * GOTCHA (2026-11-19, faijs-sand3d M1 feedback): a TS library function may call
 * `defineOp` functions internally, and those nested calls share the outer
 * statement's anchor. This test pins the *observable* contract: two consecutive
 * `cad.subtract` calls inside one library function must produce a usable Shape
 * and must not raise `INVALID_SHAPE_ID: subShapeHashes` or
 * `E_TOPO_NOT_FOUND: input shape has no role table`.
 *
 * Why: faijs-sand3d reported those two errors when `hole`/`pocket`/`tube`
 * called `cadExtrude` + `cadSubtract` back to back. The documented intent
 * (`define-op.ts`, "nested calls ... correctly skip") says nesting is allowed;
 * this probe decides whether the defect is in faijs or in the caller's use.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime } from '../../src/cad-runtime/runtime'
import { CONTRACT_VERSION } from '../../src/runtime-state'
import { box } from '../../src/api/primitives'
import { subtract } from '../../src/api/boolean'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { HostPorts } from '../../src/cad-runtime/ports'
import type { Shape } from '../../src/mesh/types'

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const nestedLib = {
  contractVersion: CONTRACT_VERSION,
  async subtractTwice(a: Shape, b: Shape): Promise<Shape> {
    const first = await subtract(a, b)
    return await subtract(first, await box(4, 4, 40))
  },
  async boxThenSubtract(a: Shape): Promise<Shape> {
    const tool = await box(4, 4, 40)
    return await subtract(a, tool)
  },
}

describe('GOTCHA: nested defineOp calls inside a TS library function', () => {
  beforeAll(async () => {
    await initOcctWasm()
  }, 120000)

  it('two consecutive subtract calls produce a live Shape', async () => {
    const rt = createRuntime(ports(), 'brep', { mylib: nestedLib as never })
    const result = await rt.execute(
      [
        'let part0 = cad.box(20, 20, 20)',
        'let part1 = mylib.subtractTwice(part0, cad.box(4, 4, 40))',
      ].join('\n'),
    )
    expect(result.failedAt).toBeUndefined()
    expect(result.outputs.has('part1' as never)).toBe(true)
  })

  it('a library-created tool plus subtract keeps the result usable', async () => {
    const rt = createRuntime(ports(), 'brep', { mylib: nestedLib as never })
    const result = await rt.execute(
      [
        'let part0 = cad.box(20, 20, 20)',
        'let part1 = mylib.boxThenSubtract(part0)',
      ].join('\n'),
    )
    expect(result.failedAt).toBeUndefined()
    expect(result.outputs.has('part1' as never)).toBe(true)
  })
})