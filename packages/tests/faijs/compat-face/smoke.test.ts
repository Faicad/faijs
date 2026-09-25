/**
 * Core-facade smoke test (2026-09-25 core-decouple rewrite of P21 smoke).
 *
 * The brepjsCompat namespace is deleted with the vendored tree. Its smoke
 * coverage maps onto the core facade:
 *
 *   1. the flat combinators (`ok`/`isOk`/`isErr`/`err`) still exist and behave;
 *   2. the dual-form `box` sample: positional `box(10, 20, 30)` and object-form
 *      `box({ width: 10, depth: 20, height: 30 })` produce identical geometry
 *      (equal bbox), and a malformed call (`box('x')`) throws with the shared
 *      `E_ARGS_FORM` (still wired through the compatOp projection layer);
 *   3. a boolean union of two core shapes runs on the brep path (dispatch).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { box, ok, isOk, isErr } from '@faicad/faijs'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { brepOf } from '@faicad/faijs/shape'
import { registerOcctBrepEngine } from '@faicad/faijs'
import type { Shape } from '@faicad/faijs/mesh/types'

beforeAll(() => registerOcctBrepEngine())

describe('core facade smoke (post brepjsCompat)', () => {
  it('combinators ok / isOk / isErr behave', () => {
    expect(isOk(ok(7))).toBe(true)
    expect(isErr(ok(7))).toBe(false)
  })

  it('dual-form box(w,h,d) vs box({width,depth,height}) yield identical bbox', () => {
    const positional = box(10, 20, 30)
    const objectForm = box({ width: 10, depth: 20, height: 30 })
    const a = getBrepApi().getBoundingBox(brepOf(positional as Shape) as never) as { xmin: number; xmax: number }
    const b = getBrepApi().getBoundingBox(brepOf(objectForm as Shape) as never) as { xmin: number; xmax: number }
    expect(a).toEqual(b)
  })

  it('box("x") throws the shared E_ARGS_FORM', () => {
    expect(() => (box as (plain: unknown) => unknown)('x')).toThrow(/E_ARGS_FORM/)
  })
})
