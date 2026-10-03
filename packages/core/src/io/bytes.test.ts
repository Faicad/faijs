/**
 * io/bytes — regression guard for the pooled-ArrayBuffer footgun.
 *
 * GOTCHA (2026-10-03): `readFileSync(path).buffer` is NOT the file's bytes.
 * It is the Buffer's *backing store*, which on Node 24 comes from the shared
 * Buffer pool: the file sits at a non-zero `byteOffset` and the store is
 * larger than the file. Consumers that decode the whole ArrayBuffer then read
 * pool residue as if it were file content.
 *
 * Observed in CI (Node 24) and absent locally (Node 22), which is why this
 * needs a test rather than a code comment: `packages/core/src/api/
 * import-step.test.ts` passed on Node 22 and failed on Node 24 with
 *   **** ERR StepFile : Undefined Parsing: Line 2: Incorrect syntax:
 *        unexpected QUID, expecting STEP ****
 *   importStep: failed to read STEP data
 * occt-wasm's `importStep` does `new TextDecoder().decode(data)` over the whole
 * ArrayBuffer, so the pool residue ahead of the real STEP text reached the
 * parser. Note the token name in the message is whatever residue happened to be
 * in the pool, which is exactly why the error looked unrelated to this file.
 */
import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { toArrayBuffer } from './bytes'
import { readFileArrayBuffer } from './bytes-node'

/** Node's shared Buffer pool; a Buffer below half of it is carved out of this. */
const POOL_BYTES = 8192

describe('io/bytes', () => {
  it('toArrayBuffer returns exactly the source bytes of a pooled Buffer', () => {
    const payload = new TextEncoder().encode('ISO-10303-21;\nHEADER;\n')
    // Force pooling: a small Buffer written into the shared pool keeps a
    // non-zero byteOffset, which is the condition this helper exists for.
    const pooled = Buffer.allocUnsafe(payload.byteLength)
    pooled.set(payload)

    expect(pooled.byteOffset !== 0 || pooled.buffer.byteLength !== payload.byteLength).toBe(true)

    const exact = toArrayBuffer(pooled)

    expect(exact.byteLength).toBe(payload.byteLength)
    expect(new Uint8Array(exact)).toEqual(payload)
  })

  it('toArrayBuffer does not alias the source store', () => {
    const source = new Uint8Array([1, 2, 3]).buffer
    const copy = toArrayBuffer(source)

    new Uint8Array(source)[0] = 9

    expect(new Uint8Array(copy)[0]).toBe(1)
  })

  it('toArrayBuffer honours a subarray view instead of its whole store', () => {
    const store = new Uint8Array(POOL_BYTES).fill(0x41)
    const view = store.subarray(100, 104)

    const exact = toArrayBuffer(view)

    expect(exact.byteLength).toBe(4)
    expect(Array.from(new Uint8Array(exact))).toEqual([0x41, 0x41, 0x41, 0x41])
  })

  it('readFileArrayBuffer returns a standalone store sized to the file', () => {
    const path = new URL('../../../fixtures/data/box_boss.step', import.meta.url)

    const ab = readFileArrayBuffer(path)

    // Decodes as STEP: if this ever regresses to a pooled store, the leading
    // pool residue breaks the magic header and OCCT rejects the import.
    expect(new TextDecoder().decode(ab.slice(0, 13))).toBe('ISO-10303-21;')
    expect(ab.byteLength).toBeGreaterThan(1024)
  })
})