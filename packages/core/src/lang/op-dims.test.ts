/**
 * op-dims-threading.test.ts — unit-system P4 (D8) declaration threading.
 *
 * P4 wires the `opDims` option through `codeToArgs` and `CadRuntime.check/execute`
 * so the P6 `dimension` pass has a complete declaration surface. Field values are
 * declared via `defineOp({ paramDims, retDim })` and surfaced by `dualOpMetaOf`.
 *
 * These assertions pin the THREADING (the surface), not the P6 rejection rules
 * (which land with the dimension pass). opDims affects nothing until P6 reads it.
 */
import { describe, expect, it } from 'vitest'
import { extractMetadata } from './metadata-extractor'
import { codeToArgs } from './code-to-args'
import { dualOpMetaOf, defineOp } from '../define-op'
import type { BrepHandle } from '../brep/engine/types'

describe('opDims option accepts dimension declarations (P4/D8)', () => {
  it('extractMetadata accepts opDims without changing non-dimension output', () => {
    const withDims = extractMetadata('const p = cad.box(10, 20, 30)\n', {
      opDims: { 'cad.box': { paramDims: { width: 'length', depth: 'length', height: 'length' }, retDim: undefined } },
    })
    const without = extractMetadata('const p = cad.box(10, 20, 30)\n')
    expect(withDims.lines.length).toBe(without.lines.length)
    expect(withDims.lines[0].positional).toEqual(without.lines[0].positional)
  })

  it('codeToArgs forwards opDims without changing bounds the parse result', () => {
    const withOpts = codeToArgs('const p = cad.box(10, 20, 30)', {
      namespaces: ['cad'],
      opDims: { 'cad.box': { paramDims: { width: 'length', depth: 'length', height: 'length' } } },
    })
    const bare = codeToArgs('const p = cad.box(10, 20, 30)', { namespaces: ['cad'] })
    expect(withOpts.positional).toEqual(bare.positional)
    expect(withOpts.args).toEqual(bare.args)
  })

  it('dualOpMetaOf surfaces paramDims/retDim for threaded ops to consume', () => {
    const op = defineOp({
      brep: () => 1 as unknown as BrepHandle,
      naming: { kind: 'unmodeled', reason: 'test' },
      paramDims: { radius: 'length' },
      retDim: 'length',
    })
    expect(dualOpMetaOf(op)?.paramDims).toEqual({ radius: 'length' })
    expect(dualOpMetaOf(op)?.retDim).toBe('length')
  })
})