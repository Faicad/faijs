/**
 * @vitest-environment node
 *
 * occt S4 视图与导出族探针（长期保留，可重复跑）——方案 §3.4.7 校正注（视图导出族
 * 已据实测从「中立（扩 projectView/projectSheet）」校正为「occt 平台 op」，直调 occt
 * 原生 toSVG / toMultiviewSVG / toPNG / toMultiviewPNG）。
 *
 * 4 个导出返回字符串 / Uint8Array，走 `api/view-export/index.ts` 的普通函数形态 +
 * `assertEngineFor('<op>', ['occt'])` 引擎守卫（与 api/export-brep.ts / api/shape-type
 * 同口径）。
 *
 * 本文件钉住两条事实：
 *   A. 单个命名视图 / 多视图能渲染出非空 SVG 字符串与非空 PNG 字节（box 验证）；
 *   B. 非 occt 引擎下每个导出在触碰内核前抛 E_BREP_UNSUPPORTED（可切换性不破）；
 *   C. mesh-only 形状（无 BREP 柄）报 E_SHAPE_TYPE_NO_BREP。
 *
 * Run: npx vitest run test/api/occt-s4b-view-export.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  initOcctWasm,
} from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { solidToShape } from '../../src/brep/brep-ops'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { fromBrep, solid } from '../../src/shape'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { Shape } from '../../src/mesh/types'
import {
  toSVG, toMultiviewSVG, toPNG, toMultiviewPNG,
} from '../../src/api/view-export'

let backends: Backends
// fixture：必须在 beforeAll（configureBackends 之后）构造，describe 收集期尚不能触碰内核。
let box: Shape

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
  await initOcctWasm()
  const brep = await getBrepEngine()
  backends = {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepCapabilities: brep.capabilities, brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
  configureBackends(backends)

  box = adopt(getBrepApi().makeBox(10, 10, 10))
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

/** 内核句柄 → 可进导出的 faijs Shape（登记 brep 槽，导出经 brepOf 取回）。 */
function adopt(h: BrepHandle): Shape {
  return fromBrep(solidToShape(getBrepApi(), h), { solid: h })
}

describe('视图与导出族 — 渲染输出非空（方案 §3.4.7）', () => {
  it('A. toSVG：单命名视图输出非空 SVG 字符串（含 <svg）', () => {
    const svg = toSVG(box, 'iso')
    expect(typeof svg).toBe('string')
    expect(svg.length).toBeGreaterThan(0)
    expect(svg).toContain('<svg')
  })

  it('A. toMultiviewSVG：多视图图纸输出非空 SVG 字符串（含 <svg）', () => {
    const sheet = toMultiviewSVG(box)
    expect(typeof sheet).toBe('string')
    expect(sheet.length).toBeGreaterThan(0)
    expect(sheet).toContain('<svg')
  })

  it('A. toPNG：单命名视图栅格化为非空 PNG 字节', async () => {
    const png = await toPNG(box, 'iso')
    expect(png).toBeInstanceOf(Uint8Array)
    expect(png.length).toBeGreaterThan(0)
    // PNG 文件头：89 50 4E 47
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    expect(png[2]).toBe(0x4e)
    expect(png[3]).toBe(0x47)
  })

  it('A. toMultiviewPNG：多视图栅格化为非空 PNG 字节', async () => {
    const sheet = await toMultiviewPNG(box)
    expect(sheet).toBeInstanceOf(Uint8Array)
    expect(sheet.length).toBeGreaterThan(0)
    expect(sheet[0]).toBe(0x89)
    expect(sheet[1]).toBe(0x50)
    expect(sheet[2]).toBe(0x4e)
    expect(sheet[3]).toBe(0x47)
  })

  it('B. 引擎守卫：非 occt 引擎下每个导出在触碰内核前抛 E_BREP_UNSUPPORTED', async () => {
    configureBackends({
      ...backends,
      config: { ...backends.config, brepEngineId: 'brepkit' },
    } as unknown as Backends)
    try {
      expect(() => toSVG(box, 'iso')).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => toMultiviewSVG(box)).toThrow(/E_BREP_UNSUPPORTED/)
      await expect(toPNG(box, 'iso')).rejects.toThrow(/E_BREP_UNSUPPORTED/)
      await expect(toMultiviewPNG(box)).rejects.toThrow(/E_BREP_UNSUPPORTED/)
    } finally {
      configureBackends(backends)
    }
  })

  it('C. mesh-only 形状（无 BREP 柄）报 E_SHAPE_TYPE_NO_BREP，而非穿透到 occt', async () => {
    const meshOnly = solid({ positions: new Float32Array([]), indices: new Uint32Array([]) })
    expect(() => toSVG(meshOnly, 'iso')).toThrow(/E_SHAPE_TYPE_NO_BREP/)
    expect(() => toMultiviewSVG(meshOnly)).toThrow(/E_SHAPE_TYPE_NO_BREP/)
    // 异步变体：assertEngineFor 通过（occt）后，occtHandleOf 同步抛 E_SHAPE_TYPE_NO_BREP，
    // 经 async 函数转为 Promise 拒绝。
    await expect(toPNG(meshOnly, 'iso')).rejects.toThrow(/E_SHAPE_TYPE_NO_BREP/)
    await expect(toMultiviewPNG(meshOnly)).rejects.toThrow(/E_SHAPE_TYPE_NO_BREP/)
  })
})
