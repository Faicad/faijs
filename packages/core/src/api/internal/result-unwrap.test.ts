/**
 * Unit tests — the Result→throw statement boundary (D1) and the engine-
 * recognizable `OpError` carrier.
 *
 * P0 regression context: `unwrapResult` used to throw a plain `Error`, which
 * `runWithFailureHandling` re-threw out of `execute()` — a library `err`
 * never reached `ExecutionResult.failedAt`. These tests pin the carrier class
 * and the message contract (`[faijs/brepjs-compat] <op>: <CODE>: <message>`).
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import { isResultLike, OpError, toOpError, unwrapResult } from './result-unwrap'

describe('isResultLike', () => {
  it('recognizes Ok/Err records structurally, nothing else', () => {
    expect(isResultLike({ ok: true, value: 1 })).toBe(true)
    expect(isResultLike({ ok: false, error: { code: 'X' } })).toBe(true)
    expect(isResultLike({ ok: 1 })).toBe(false)
    expect(isResultLike(null)).toBe(false)
    expect(isResultLike('ok')).toBe(false)
    expect(isResultLike({ value: 1 })).toBe(false)
  })
})

describe('unwrapResult', () => {
  it('passes non-Result products through untouched', () => {
    const solid = { wrapped: { type: 'solid' } }
    expect(unwrapResult(solid, 'op')).toBe(solid)
    expect(unwrapResult(42, 'op')).toBe(42)
  })

  it('unwraps Ok → .value', () => {
    expect(unwrapResult({ ok: true, value: { n: 7 } }, 'op')).toEqual({ n: 7 })
  })

  it('Err → throws OpError carrying op, code, and the [faijs/brepjs-compat] message', () => {
    let caught: unknown
    try {
      unwrapResult(
        { ok: false, error: { code: 'UNKNOWN_REGION', message: "region 'x' not found" } },
        'addCutout',
      )
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(OpError)
    const opErr = caught as OpError
    expect(opErr.op).toBe('addCutout')
    expect(opErr.code).toBe('UNKNOWN_REGION')
    expect(opErr.message).toBe("[faijs/brepjs-compat] addCutout: UNKNOWN_REGION: region 'x' not found")
  })

  it('Err without a code falls back to E_OP_FAILED', () => {
    try {
      unwrapResult({ ok: false, error: {} }, 'op')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(OpError)
      expect((e as OpError).code).toBe('E_OP_FAILED')
      expect((e as OpError).message).toBe('[faijs/brepjs-compat] op: E_OP_FAILED: operation failed')
    }
  })
})

describe('toOpError (impl exceptions stay plain Errors — bugs propagate)', () => {
  it('wraps a thrown Error with the [faijs/op] prefix, keeping its code', () => {
    const src = Object.assign(new Error('bad input'), { code: 'E_BAD' })
    const out = toOpError('myOp', src)
    expect(out).not.toBeInstanceOf(OpError)
    expect(out.message).toBe('[faijs/op] myOp: E_BAD: bad input')
  })

  it('wraps a non-Error throw as E_OP_FAILED', () => {
    const out = toOpError('myOp', 'boom')
    expect(out).not.toBeInstanceOf(OpError)
    expect(out.message).toBe('[faijs/op] myOp: E_OP_FAILED: boom')
  })
})
