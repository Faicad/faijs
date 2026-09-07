/**
 * P21 smoke test — BREP-TS compatibility surface (brepjsCompat).
 *
 * The brepjsCompat module projects the vendored BREP TS tree onto a stable surface so
 * library authors can write upstream-style calls. This test covers the two
 * behaviours the plan gates on:
 *
 *   1. the facade exports the `brepjsCompat` namespace and its result combinators
 *      (`fuse`/`isErr`/`ok`/`Sketcher` are each exercised once), and fusing two
 *      boxes yields an `ok` result (`isOk == true`);
 *   2. the dual-form `box` sample: positional `box(10, 20, 30)` and object-form
 *      `box(10, 20, 30, { centered: true })` produce identical geometry (equal bbox),
 *      and a malformed call (`box('x')`) throws with the shared `E_ARGS_FORM`.
 */

import { describe, expect, it } from 'vitest'
import { brepjsCompat } from '@faicad/faijs'
import { useKernelBeforeAll } from '../p5-vendored-surface/kernel-setup'

useKernelBeforeAll()

describe('brepjsCompat facade smoke', () => {
  it('exercises fuse / isErr / ok / Sketcher once and reports ok on a fuse', () => {
    const { fuse, isErr, ok, Sketcher, isOk } = brepjsCompat
    // one call, one shape per combinator
    const boxA = brepjsCompat.box(10, 20, 30)
    const boxB = brepjsCompat.box({ width: 10, depth: 20, height: 30 })
    expect(boxA).toBeTruthy()
    const result = fuse(boxA, boxB)
    expect(isOk(result)).toBe(true)
    expect(isErr(result)).toBe(false)
    expect(ok(7)).toMatchObject({ ok: true })
    // Sketcher is a stateful DSL entry point; constructing one must not throw
    const s = new (Sketcher as new (plane?: unknown) => unknown)('XY')
    expect(s).toBeTruthy()
  })

  it('dual-form box(w,h,d) vs box({width,depth,height}) yield identical bbox', () => {
    const positional = brepjsCompat.box(10, 20, 30)
    const objectForm = brepjsCompat.box({ width: 10, depth: 20, height: 30 })
    const a = brepjsCompat.getBounds(positional)
    const b = brepjsCompat.getBounds(objectForm)
    expect(a).toEqual(b)
  })

  it('box("x") throws the shared E_ARGS_FORM', () => {
    expect(() => (brepjsCompat.box as (plain: unknown) => unknown)('x')).toThrow(/E_ARGS_FORM/)
  })
})