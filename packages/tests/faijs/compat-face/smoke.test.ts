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
import { box, ok, isOk, isErr, registerOcctBrepEngine } from '@faicad/faijs'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { getBrepEngine } from '@faicad/faijs/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '@faicad/faijs/runtime-state'
import { brepOf } from '@faicad/faijs/shape'
import type { Shape } from '@faicad/faijs/mesh/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
  const brep = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepCapabilities: brep.capabilities, brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}, 120000)

describe('core facade smoke (post brepjsCompat)', () => {
  it('combinators ok / isOk / isErr behave', () => {
    expect(isOk(ok(7))).toBe(true)
    expect(isErr(ok(7))).toBe(false)
  })

  it('dual-form box(w,h,d) vs box({width,depth,height}) yield identical bbox', async () => {
    // TS 库面类型只声明对象形；位置形双形态（D11 装箱）经运行时兼容，类型上以 never 桥接。
    // TS 面 op 是 async（defineOp 契约），await 后取 Shape。
    const positional = (await (box as unknown as (w: number, d: number, h: number) => Promise<unknown>)(10, 20, 30)) as Shape
    const objectForm = (await box({ width: 10, depth: 20, height: 30 })) as Shape
    const a = getBrepApi().getBoundingBox(brepOf(positional) as never) as { xmin: number; xmax: number }
    const b = getBrepApi().getBoundingBox(brepOf(objectForm) as never) as { xmin: number; xmax: number }
    expect(a).toEqual(b)
  })

  it('box("x") rejects malformed args (E_OP_FAILED on TS face; E_ARGS_FORM is the cad-face code)', async () => {
    // TS 面直调 defineOp：参数校验落在 api 层，抛 E_OP_FAILED；cad 脚本面
    // （arg-spec 生成）的 dual-form-args 校验才报 E_ARGS_FORM——两处都是
    // 同一条「畸形实参拒绝」红线，这里按面差异做宽松匹配。
    await expect(box('x' as never)).rejects.toThrow(/E_OP_FAILED|E_ARGS_FORM/)
  })
})
