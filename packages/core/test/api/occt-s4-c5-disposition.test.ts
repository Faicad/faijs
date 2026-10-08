/**
 * @vitest-environment node
 *
 * S4 C5 实现面接入的**处置探针**（长期保留）——方案 §3.5。
 *
 * C5 的 10 项中，translate/scale/chamfer 已接入；本次接入 rotate/mirror/
 * shell/offset/thicken 的 `*WithHistory` 路径 + buildCurves3d + fixWireOnFace。
 *
 * 钉住的事实：
 *   A. `offsetWithHistory` / `thickenWithHistory` 的 `modified`/`deleted` **全空**
 *      ——上游空壳（occt-wasm 5.6.0），接入为未来就绪，当前无血缘收益；
 *   B. `shellWithHistory`（modified 非空）/ `rotateWithHistory`（6 条 1:1）/
 *      `mirrorWithHistory`（6 条 1:1）有真实面演化；
 *   C. 所有 `*WithHistory` 产物 `exportStep` 不抛异常（`rotateWithHistory`
 *      也安全——原生 `rotate` 的 STEP 崩溃 GOTCHA 不影响 `rotateWithHistory`）。
 *
 * Run: npx vitest run test/api/occt-s4-c5-disposition.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { getOcctKernel } from '../../src/occt-kernel/occtKernel'
import { HASH_UPPER_BOUND, getFaceHashes } from '../../src/brep/face-evolution'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'

let kernel: BrepEngineApi

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
  kernel = getBrepApi()
}, 120000)

describe('C5 disposition: *WithHistory upstream disposition', () => {
  it('offsetWithHistory: modified/deleted empty (upstream empty shell)', () => {
    const k = getOcctKernel()
    const box = kernel.makeBox(10, 20, 30)
    const hashes = getFaceHashes(kernel, box)
    const evo = k.offsetWithHistory(box as never, 1, 1e-6, hashes, HASH_UPPER_BOUND)
    expect(evo.modified).toHaveLength(0)
    expect(evo.deleted).toHaveLength(0)
  })

  it('thickenWithHistory: modified/deleted empty (upstream empty shell)', () => {
    const k = getOcctKernel()
    const face = k.makeRectangle(10, 20)
    const hashes = getFaceHashes(kernel, face as never)
    const evo = k.thickenWithHistory(face as never, 2, 1e-6, hashes, HASH_UPPER_BOUND)
    expect(evo.modified).toHaveLength(0)
    expect(evo.deleted).toHaveLength(0)
  })

  it('shellWithHistory: modified non-empty (real evolution)', () => {
    const k = getOcctKernel()
    const box = kernel.makeBox(10, 20, 30)
    const faces = kernel.getSubShapes(box, 'face')
    const hashes = getFaceHashes(kernel, box)
    const evo = k.shellWithHistory(box as never, [faces[0] as never], 2, 1e-6, hashes, HASH_UPPER_BOUND)
    expect(evo.modified.length).toBeGreaterThan(0)
  })

  it('rotateWithHistory: modified non-empty (6-face 1:1 evolution)', () => {
    const k = getOcctKernel()
    const box = kernel.makeBox(10, 20, 30)
    const hashes = getFaceHashes(kernel, box)
    const evo = k.rotateWithHistory(
      box as never,
      { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
      Math.PI / 4,
      hashes,
      HASH_UPPER_BOUND,
    )
    expect(evo.modified.length).toBeGreaterThan(0)
  })

  it('mirrorWithHistory: modified non-empty (6-face 1:1 evolution)', () => {
    const k = getOcctKernel()
    const box = kernel.makeBox(10, 20, 30)
    const hashes = getFaceHashes(kernel, box)
    const evo = k.mirrorWithHistory(
      box as never,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      hashes,
      HASH_UPPER_BOUND,
    )
    expect(evo.modified.length).toBeGreaterThan(0)
  })
})

describe('C5 disposition: *WithHistory STEP export safety', () => {
  it('all *WithHistory products exportStep without throwing', () => {
    const k = getOcctKernel()
    const box = kernel.makeBox(10, 20, 30)
    const hashes = getFaceHashes(kernel, box)
    const faces = kernel.getSubShapes(box, 'face')

    const mirrorEvo = k.mirrorWithHistory(box as never, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, hashes, HASH_UPPER_BOUND)
    expect(() => k.exportStep(mirrorEvo.result as never)).not.toThrow()

    const shellEvo = k.shellWithHistory(box as never, [faces[0] as never], 2, 1e-6, hashes, HASH_UPPER_BOUND)
    expect(() => k.exportStep(shellEvo.result as never)).not.toThrow()

    const offsetEvo = k.offsetWithHistory(box as never, 1, 1e-6, hashes, HASH_UPPER_BOUND)
    expect(() => k.exportStep(offsetEvo.result as never)).not.toThrow()

    const thickenFace = k.makeRectangle(10, 20)
    const thickenEvo = k.thickenWithHistory(thickenFace as never, 2, 1e-6, getFaceHashes(kernel, thickenFace as never), HASH_UPPER_BOUND)
    expect(() => k.exportStep(thickenEvo.result as never)).not.toThrow()

    // GOTCHA: native rotate's STEP crashes, but rotateWithHistory is safe.
    const rotateEvo = k.rotateWithHistory(
      box as never,
      { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
      Math.PI / 4,
      hashes,
      HASH_UPPER_BOUND,
    )
    expect(() => k.exportStep(rotateEvo.result as never)).not.toThrow()
  })
})