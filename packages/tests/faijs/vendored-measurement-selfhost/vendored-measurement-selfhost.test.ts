/**
 * @vitest-environment node
 *
 * vendored-measurement-selfhost — core-decouple Phase 2 迁移的测量面对拍
 *
 * 原 `measurement-parity.test.ts`（core 内）的「vendored 测量面」用例随
 * `api/occt-kernel-bridge.ts` 删除迁至此处：core 不再注入 vendored kernel
 * registry，本套件自行装配（`OcctWasmAdapter.fromKernel(host 单例)` →
 * register → freeze，D10 单实例语义由该单例保证），再对拍：
 *   1. vendored measureFns 数值（volume/volumeProps/surfaceProps 与解析值一致）；
 *   2. core 生成 op 面全链路（measureArea/measureVolume/measureLength 经
 *      compat 投影 → vendored → 数值）。
 *
 * 数值钉住与核心侧一致：20×10×5 盒 → 体积 1000 / 面积 700；measureLength 走
 * occt getLength 对 solid 按「边-面」计数（12 条边总长 140 的 2 倍 = 280）。
 *
 * Run: npx vitest run faijs/vendored-measurement-selfhost
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel as getHostKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { getBrepEngine } from '@faicad/faijs/brep/engine/registry'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import { OcctWasmAdapter } from '@faicad/faijs-brepjs/kernel/occtWasm/occtWasmAdapter'
import { handle as occtWasmHandleView } from '@faicad/faijs-brepjs/kernel/occtWasm/helpers'
import {
  registerKernel,
  freezeKernels,
  getKernel,
  getActiveKernelId,
  syncRegistryFromGlobal,
  syncRegistryToGlobal,
} from '@faicad/faijs-brepjs/kernel/index'
import {
  measureVolume as vendoredMeasureVolume,
  measureVolumeProps,
  measureSurfaceProps,
} from '@faicad/faijs-brepjs/measurement/measureFns'
import { fromHandle } from '@faicad/faijs/brep/handle-bridge'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { measureArea, measureLength, measureVolume } from '@faicad/faijs/api/generated/measurement'
import { configureBackends } from '@faicad/faijs/runtime-state'

const BOX_VOLUME = 20 * 10 * 5 // 1000
const BOX_AREA = 2 * (20 * 10 + 20 * 5 + 10 * 5) // 700

let api: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
  // core-decouple Phase 2：core 不再注入——tests 自装配 vendored registry（幂等）。
  syncRegistryFromGlobal()
  if (getActiveKernelId() === null) {
    const adapter = OcctWasmAdapter.fromKernel(getHostKernel() as never)
    registerKernel('occt-wasm', adapter)
    freezeKernels()
  }
  syncRegistryToGlobal()
  configureBackends({
    contractVersion: 1,
    config: { mode: 'brep', brepCapabilities: {}, brepEngineId: 'occt' },
    kernel: {
      brep: { meshShape: () => ({ positions: [0, 0, 0], indices: [0] }) } as never,
      csg: undefined,
      sdf: undefined,
    },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: {} as never,
  })
  api = (await getBrepEngine()).primitives
}, 120000)

describe('vendored 测量面：occt 自装配下数值与解析值一致', () => {
  it('measureVolume / measureVolumeProps：体积 1000、质心 (10,5,2.5)', () => {
    const box = api.makeBox(20, 10, 5)
    try {
      const h = { wrapped: occtWasmHandleView('solid' as never, box as never) }
      const v = vendoredMeasureVolume(h as never)
      expect(v.ok).toBe(true)
      expect((v as { ok: true; value: number }).value).toBeCloseTo(BOX_VOLUME, -1)

      const props = measureVolumeProps(h as never)
      expect(props.ok).toBe(true)
      const vp = props as unknown as { ok: true; value: { volume: number; centerOfMass: readonly number[] } }
      expect(vp.value.volume).toBeCloseTo(BOX_VOLUME, -1)
      expect(vp.value.centerOfMass[0]).toBeCloseTo(10, 1)
      expect(vp.value.centerOfMass[1]).toBeCloseTo(5, 1)
      expect(vp.value.centerOfMass[2]).toBeCloseTo(2.5, 1)
    } finally {
      api.release(box)
    }
  })

  it('measureSurfaceProps：面积 700', () => {
    const box = api.makeBox(20, 10, 5)
    try {
      const h = { wrapped: occtWasmHandleView('solid' as never, box as never) }
      const sp = measureSurfaceProps(h as never)
      expect(sp.ok).toBe(true)
      expect((sp as { ok: true; value: { area: number } }).value.area).toBeCloseTo(BOX_AREA, -1)
    } finally {
      api.release(box)
    }
  })
})

describe('core 生成 op 面：自装配 vendored 后全链路可用', () => {
  it('measureArea / measureVolume / measureLength 经 compat 投影返回数值', () => {
    const box = api.makeBox(20, 10, 5)
    try {
      const shape = fromHandle(box as BrepHandle)
      expect(measureArea(shape)).toBeCloseTo(BOX_AREA, -1)
      expect(measureVolume(shape)).toBeCloseTo(BOX_VOLUME, -1)
      // occt getLength 对 solid 按「边-面」计数（每条边计入两个相邻面）：
      // 20×10×5 盒 12 条边总长 140，实测 2×140 = 280。数值钉住（vendored
      // measureLinearProps 走 kernel.length 直通，无归一化）。
      expect(measureLength(shape)).toBeCloseTo(280, -1)
    } finally {
      api.release(box)
    }
  })
})
