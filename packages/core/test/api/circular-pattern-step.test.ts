/**
 * circular-pattern-step.test — angleStep 语义回归 + GOTCHA 留档
 *
 * 契约（2026-11-14）：`circularPattern(shape, axis, count, angleStep?, center?)` —
 * `count` 份（含原件）位于 `0, step, …, (count−1)·step`；`angleStep` 单位度，缺省 `360/count`。
 * 断言方式：与「原件 + 手工 rotate k·step」融合结果逐轴比对 bbox（不依赖 box 居中等隐含假设，
 * 也不绑定旋转方向）。
 */

// ─── OCCT stdout 噪声过滤（与 brep-operations-g4 同口径）───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { solidToShape } from '../../src/brep/brep-ops'
import { getSolidBoundingBox } from '../../src/brep/brep-utils'
import { fromBrep, brepOf } from '../../src/shape'
import { circularPattern } from '../../src/api/replicate'
import { circularPatternBrep } from '../../src/api/brep-operations/patternFns'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { Shape } from '../../src/mesh/types'

let kernel: BrepEngineApi

beforeAll(async () => {
  await registerOcctBrepEngine()
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  kernel = getBrepApi()
}, 120000)

const R = 40
const CENTER = { x: 0, y: 0, z: 0 }
const AXIS_Z = { x: 0, y: 0, z: 1 }

function boxAtRadius(): BrepHandle {
  const b = kernel.makeBox(4, 4, 4)
  return kernel.translate(b, R, 0, 0)
}

function rotateBy(base: BrepHandle, deg: number): BrepHandle {
  return kernel.rotate(base, { point: CENTER, direction: AXIS_Z }, (deg * Math.PI) / 180)
}

function toShape(): Shape {
  const solid = boxAtRadius()
  return fromBrep(solidToShape(kernel, solid), { solid }) as Shape
}

/** 手工基线：原件 + k 份按 `sign·k·step` 旋转后融合。 */
function manualArc(stepDeg: number, count: number, sign: 1 | -1): BrepHandle {
  const base = boxAtRadius()
  const parts: BrepHandle[] = [base]
  for (let k = 1; k < count; k++) parts.push(rotateBy(base, sign * k * stepDeg))
  return kernel.fuseAll(parts)
}

type BBox = { min: number[]; max: number[] }

function bboxOf(h: BrepHandle): BBox {
  // 注意：内核 `getBoundingBox` 返回的是平铺字段 `{xmin,ymin,zmin,xmax,ymax,zmax}`，
  // 不是 `{min,max}` 数组；`getSolidBoundingBox` 才是数组形态（GOTCHA）。
  const bb = getSolidBoundingBox(kernel, h)
  return { min: bb.min as number[], max: bb.max as number[] }
}

function bbClose(a: BBox, b: BBox): boolean {
  return [0, 1, 2].every(
    (i) => Math.abs(a.min[i] - b.min[i]) < 1e-6 && Math.abs(a.max[i] - b.max[i]) < 1e-6,
  )
}

/** 断言几何等于「0°/step 弧」（旋转方向两向都接受）。 */
function expectMatchesArc(h: BrepHandle, stepDeg: number, count: number): void {
  const got = bboxOf(h)
  const candidates = [manualArc(stepDeg, count, 1), manualArc(stepDeg, count, -1)].map(bboxOf)
  expect(candidates.some((c) => bbClose(got, c))).toBe(true)
}

/** 每份副本 bbox 中心的极角（相对原件，取绝对值；方向由 axis 决定）。 */
function stepAnglesAbs(copies: BrepHandle[], baseDeg: number): number[] {
  return copies.map((h) => {
    const bb = bboxOf(h)
    const deg = (Math.atan2((bb.min[1] + bb.max[1]) / 2, (bb.min[0] + bb.max[0]) / 2) * 180) / Math.PI
    return Math.abs(((deg - baseDeg + 540) % 360) - 180)
  })
}

describe('内核层（occt）：angleStep 就是步距', () => {
  it('angleStep=30 / count=4 → 各份极角 0/30/60/90', () => {
    const s = boxAtRadius()
    const baseDeg = (Math.atan2(0, 1) * 0) / 1 // 见下行：原件极角由 bbox 现算
    const obb = bboxOf(s)
    const b0 = (Math.atan2((obb.min[1] + obb.max[1]) / 2, (obb.min[0] + obb.max[0]) / 2) * 180) / Math.PI
    void baseDeg
    const copies = kernel.circularPattern(s, CENTER, AXIS_Z, 30, 4)
    expect(copies).toHaveLength(4)
    const angles = stepAnglesAbs(copies, b0)
    ;[0, 30, 60, 90].forEach((want, i) => expect(angles[i]).toBeCloseTo(want, 4))
  })

  it('GOTCHA：把「总角度 90」当步距传 90 给 count=4 会得到 22.5° 步距，而不是 90°', () => {
    // 旧 API 的 `fullAngle` 按 count × step 解释：想表达「4 份、相邻 30°」而填 90，
    // 实际下发的步距是 90/4 = 22.5，孔位全错。正确填法是 angleStep = 30。
    const s = boxAtRadius()
    const obb = bboxOf(s)
    const b0 = (Math.atan2((obb.min[1] + obb.max[1]) / 2, (obb.min[0] + obb.max[0]) / 2) * 180) / Math.PI
    const copies = kernel.circularPattern(s, CENTER, AXIS_Z, 22.5, 4)
    const angles = stepAnglesAbs(copies, b0)
    ;[0, 22.5, 45, 67.5].forEach((want, i) => expect(angles[i]).toBeCloseTo(want, 4))
    expect(angles[1]).not.toBeCloseTo(30, 1)
  })
})

describe('脚本面 circularPattern：缺省与弧段', () => {
  it('缺省 angleStep = 360/count：count=4 与手工 0/90/180/270 一致', async () => {
    const shape = toShape()
    const p = await circularPattern(shape, [0, 0, 1], 4)
    expectMatchesArc(brepOf(p) as unknown as BrepHandle, 90, 4)
  })

  it('弧段 angleStep=30 / count=2 → 覆盖 30° 弧（旧口径 30/count=15° 对不上）', async () => {
    const shape = toShape()
    const p = await circularPattern(shape, [0, 0, 1], 2, 30)
    expectMatchesArc(brepOf(p) as unknown as BrepHandle, 30, 2)
  })

  it('非法步距在 count>1 时抛出（0 / 360 / -400）', async () => {
    const shape = toShape()
    await expect(circularPattern(shape, [0, 0, 1], 4, 0)).rejects.toThrow(/angleStep/)
    await expect(circularPattern(shape, [0, 0, 1], 4, 360)).rejects.toThrow(/angleStep/)
    await expect(circularPattern(shape, [0, 0, 1], 4, -400)).rejects.toThrow(/angleStep/)
  })

  it('count=1 时不校验步距，返回与原件相同的几何', async () => {
    const shape = toShape()
    const one = await circularPattern(shape, [0, 0, 1], 1, 0)
    expect(bbClose(bboxOf(brepOf(one) as unknown as BrepHandle), bboxOf(boxAtRadius()))).toBe(true)
  })
})

describe('兼容面 circularPatternBrep：同一 angleStep 口径', () => {
  it('angleStep=30 / count=2 与手工 30° 弧一致', () => {
    const s = boxAtRadius()
    const r = circularPatternBrep({ wrapped: s }, [0, 0, 1], 2, 30, [0, 0, 0])
    expect(r.ok).toBe(true)
    expectMatchesArc((r as { ok: true; value: BrepHandle }).value, 30, 2)
  })

  it('对象形态 { shape, axis, count, angleStep, center } 与位置形态等价', () => {
    const s1 = boxAtRadius()
    const s2 = boxAtRadius()
    const positional = circularPatternBrep({ wrapped: s1 }, [0, 0, 1], 4, 45, [0, 0, 0])
    const objectForm = circularPatternBrep({
      shape: { wrapped: s2 },
      axis: [0, 0, 1],
      count: 4,
      angleStep: 45,
      center: [0, 0, 0],
    })
    expect(positional.ok).toBe(true)
    expect(objectForm.ok).toBe(true)
    const bbA = bboxOf((positional as { ok: true; value: BrepHandle }).value)
    const bbB = bboxOf((objectForm as { ok: true; value: BrepHandle }).value)
    expect(bbClose(bbA, bbB)).toBe(true)
    expectMatchesArc((positional as { ok: true; value: BrepHandle }).value, 45, 4)
  })

  it('非法步距 → PATTERN_INVALID_STEP', () => {
    const s = boxAtRadius()
    const r = circularPatternBrep({ wrapped: s }, [0, 0, 1], 4, 360)
    expect((r as { ok: false; error: { code: string } }).ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('PATTERN_INVALID_STEP')
  })
})
