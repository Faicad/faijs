/**
 * Assembly.importStep() 装配元数据往返 —— 审计 §3.5 E3b。
 *
 * 真值冻结自一次性 CadQuery 2.8.0 捕获
 * （`tests/ref-harness/step-metadata-probe.py`，不进 CI，见审计 §5.1）；夹具也是
 * 那次捕获再生成的（`packages/fixtures/data/step-metadata/`，别手改 STEP）。
 *
 * 三条断言对应三类会被"只比几何"的 parity 永久看不见的东西：
 *   1. 装配名 + 成员名 + 成员颜色（importStep 之前走 loadBrep，全丢）
 *   2. 成员位姿已烘焙（上游把它存在 `loc` 里，faijs 的载波没有 loc 字段）
 *   3. **非装配 STEP 必须抛错**，不能退化成匿名单成员
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { brepOf } from '@faicad/faijs/shape'
import type { Shape } from '@faicad/faijs/mesh/types'
import { setupNativeKernel } from './gear-test-harness'
import { importStep } from './assembly/save'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): string =>
  resolve(here, '../../fixtures/data/step-metadata', name)

beforeAll(async () => {
  await setupNativeKernel()
})

function k(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/** BREP metrics of a member's shape (volume + axis-aligned bounds). */
function metrics(s: Shape): { volume: number; bbox: number[] } {
  const kernel = k()
  // BrepHandle ↔ ShapeHandle are runtime-identical; the brands only differ at
  // the platform boundary (same conversion the port does internally).
  const h = brepOf(s) as unknown as ShapeHandle
  const bb = kernel.getBoundingBox(h)
  return {
    volume: kernel.getVolume(h),
    bbox: [bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax],
  }
}

describe('importStep: assembly metadata round trip', () => {
  it('keeps the assembly name and both member names', async () => {
    const asm = await importStep(fixture('cq-assembly-two-parts.step'))
    expect(asm.name).toBe('top_level')
    expect(asm.members.map((m) => m.name)).toEqual(['cube_1', 'cyl_1'])
  })

  it('keeps member colours (CadQuery green/blue -> ISO predefined names in STEP)', async () => {
    const asm = await importStep(fixture('cq-assembly-two-parts.step'))
    // These arrive as DRAUGHTING_PRE_DEFINED_COLOUR('green'/'blue') in the file.
    expect(asm.members[0].color).toEqual([0, 1, 0])
    expect(asm.members[1].color).toEqual([0, 0, 1])
  })

  it('bakes the component placement into the member shape', async () => {
    const asm = await importStep(fixture('cq-assembly-two-parts.step'))
    // Frozen from the capture: cube_1 is a 10³ box at the origin.
    const cube = metrics(asm.members[0].shape)
    expect(cube.volume).toBeCloseTo(1000, 7)
    expect(cube.bbox.map((v) => +v.toFixed(6))).toEqual([-5, -5, -5, 5, 5, 5])
    // cyl_1 carries Location((0,0,-10)) upstream; the placement must be applied
    // here, because CqAssembly has no `loc` field to carry it separately.
    const cyl = metrics(asm.members[1].shape)
    expect(cyl.volume).toBeCloseTo(196.3495408, 6)
    expect(cyl.bbox.map((v) => +v.toFixed(6))).toEqual([-2.5, -2.5, -15, 2.5, 2.5, -5])
  })

  it('reads named and RGB colours in the same file', async () => {
    const asm = await importStep(fixture('cq-predefined-colours.step'))
    const byName = Object.fromEntries(asm.members.map((m) => [m.name, m.color]))
    expect(Object.keys(byName).sort()).toEqual(['half', 'lime', 'navy', 'odd', 'pure_red'])
    // pure_red (1,0,0) and lime (0,1,0) are written as predefined NAMES.
    expect(byName.pure_red).toEqual([1, 0, 0])
    expect(byName.lime).toEqual([0, 1, 0])
    // These three are not predefined, so they stay COLOUR_RGB (OCCT float32 round trip).
    expect(byName.half![0]).toBeCloseTo(0.5, 7)
    expect(byName.navy![2]).toBeCloseTo(0.5, 7)
    expect(byName.odd![0]).toBeCloseTo(0.123, 7)
    expect(byName.odd![1]).toBeCloseTo(0.456, 7)
    expect(byName.odd![2]).toBeCloseTo(0.789, 7)
  })
})

describe('importStep: non-assembly STEP is rejected', () => {
  it('throws instead of degrading to an anonymous single member', async () => {
    // GOTCHA: upstream raises ValueError("Step file does not contain an assembly").
    // The previous faijs implementation returned a single `part_1` member instead,
    // silently dropping the fact that the file declares no assembly at all.
    await expect(importStep(fixture('cq-plain-shape.step'))).rejects.toThrow(
      /does not contain an assembly/,
    )
  })
})
