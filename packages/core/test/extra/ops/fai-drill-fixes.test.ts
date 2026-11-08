/**
 * ops/fai_drill — Phase 2 易修项防回归（plan 2026-11-07 §4-3a/3b）。
 *
 * - #1：threadBrep `sectionsPerTurn` 默认 = 12（JSDoc 曾误写 20）；
 * - #2：`ScrewThread` 类型含 'custom'（类型谎言修正）；
 * - #4：BREP 链 custom pitch 生效（`screwThread:'custom'` + `screwPitchCustom`
 *   不再回落粗牙）；
 * - #6：通孔建模螺纹高度取 bbox 推导（不再硬编码 20mm）——通孔(60) 的螺纹
 *   面数必须多于盲孔(25)，旧代码该断言反向失败；
 * - #8：旧三键 imperial 攻丝孔 PMI 缺省公差等级 '2B'（显式 threadClass 优先）；
 * - #9：`handedness` 进 PMI（仅标注；几何左旋不在本期），非法值 E_ARG。
 *
 * 运行：npx vitest run test/extra/ops/fai-drill-fixes.test.ts
 */

// ─── OCCT stdout 噪声过滤（与其它 brep 测试同策略） ───
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
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine } from '../../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../../src/runtime-state'
import { getBrepApi } from '../../../src/brep/handle-bridge'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import type { BrepHandle } from '../../../src/brep/engine/types'
import { fromBrep, brepOf } from '../../../src/shape'
import { solidToShape } from '../../../src/brep/brep-ops'
import type { Shape } from '../../../src/mesh/types'
import { fai_drill } from '../../../src/extra/ops/fai_drill'
import { pmiThreads } from '../../../src/api/pmi/query'
import { threadBrep } from '../../../src/api/brep-operations/threadFns'
import type { ScrewThread } from '../../../src/extra/mesh/drill-hole/drill-types'

let kernel: BrepEngineApi

beforeAll(async () => {
  await registerOcctBrepEngine()
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  kernel = getBrepApi()
}, 120000)

function block(sx: number, sy: number, sz: number): Shape {
  const h = kernel.translate(kernel.makeBox(sx, sy, sz), -sx / 2, -sy / 2, -sz / 2)
  return fromBrep(solidToShape(kernel, h), { solid: h })
}

function volumeOf(shape: Shape): number {
  return kernel.getVolume(brepOf(shape) as BrepHandle)
}

function faceCountOf(shape: Shape): number {
  return kernel.getSubShapes(brepOf(shape) as BrepHandle, 'face').length
}

async function drill(shape: Shape, params: Record<string, unknown>): Promise<Shape> {
  return (await fai_drill(shape, params)) as Shape
}

describe('#1 threadBrep sectionsPerTurn 默认 = 12（GOTCHA：JSDoc 曾误写 20）', () => {
  it('缺省与显式 sectionsPerTurn:12 几何一致；与 20 不一致', () => {
    const common = { radius: 6, pitch: 2, height: 4 } as const
    const dflt = threadBrep(kernel, { ...common })
    const explicit12 = threadBrep(kernel, { ...common, sectionsPerTurn: 12 })
    const explicit20 = threadBrep(kernel, { ...common, sectionsPerTurn: 20 })
    const vDflt = kernel.getVolume(dflt)
    expect(vDflt).toBeCloseTo(kernel.getVolume(explicit12), 6)
    expect(Math.abs(vDflt - kernel.getVolume(explicit20))).toBeGreaterThan(1e-6)
    kernel.release(dflt)
    kernel.release(explicit12)
    kernel.release(explicit20)
  })
})

describe('#2 ScrewThread 类型含 custom', () => {
  it("'custom' 是合法 ScrewThread（编译期由 typecheck 保证，运行期断言在场）", () => {
    const variants: ScrewThread[] = ['coarse', 'fine', 'custom', 'none']
    expect(variants).toContain('custom')
  })
})

describe('#4 BREP 链 custom pitch 生效（不再回落粗牙）', () => {
  it("screwThread:'custom'+screwPitchCustom:1 与粗牙(2.0)几何不同", async () => {
    const b = block(40, 40, 20)
    // 直呼 fai_drill（不经 drill 助手）：screwPitchCustom 键须在调用点字面可见（L2 API 覆盖门禁）
    const custom = (await fai_drill(b, {
      position: [0, 0, 10], direction: 'z', holeType: 'screw', diameter: 14,
      screwSpecIdx: 10, screwThread: 'custom', screwPitchCustom: 1.0, depth: 12,
    })) as Shape
    const coarse = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'screw', diameter: 14,
      screwSpecIdx: 10, screwThread: 'coarse', depth: 12,
    })
    // #4 缺陷形态：custom 回落粗牙 → 两几何逐位相同。
    // #14 后体积不再能判别——牙深由 (公称−底孔)/2 决定（两例同为 1.0），
    // 齿宽随螺距等比缩放（0.42·P），填充率尺度不变 → 切除量几乎相同；
    // 改用面数：pitch 1 的牙数是 pitch 2 的两倍 → 螺旋面数显著更多。
    expect(faceCountOf(custom)).toBeGreaterThan(faceCountOf(coarse) * 1.5)
  })

  it('描述串与 screwPitchCustom 互斥：thread + screwPitchCustom → E_ARG', async () => {
    await expect(
      drill(block(40, 40, 20), {
        position: [0, 0, 10], direction: 'z', thread: 'M16', screwPitchCustom: 1.5,
      }),
    ).rejects.toThrow(/E_ARG/)
  })
})

describe('#6 通孔建模螺纹高度 = bbox 推导（不硬编码 20）', () => {
  it('60 高块通孔螺纹面数 > 盲孔 25 的螺纹面数（旧代码该关系反向）', async () => {
    const through = await drill(block(40, 40, 60), {
      position: [0, 0, 30], direction: 'z', holeType: 'screw', diameter: 14,
      screwSpecIdx: 10, depth: 0,
    })
    const blind = await drill(block(40, 40, 60), {
      position: [0, 0, 30], direction: 'z', holeType: 'screw', diameter: 14,
      screwSpecIdx: 10, depth: 25,
    })
    // 旧代码：通孔螺纹高 20（面数 ≈ 10 牙圈 × 12 段）< 盲孔 25（≈ 12.5 圈）→ 反向失败。
    // 新代码：通孔 = 60.2（≈ 30 圈）> 盲孔 25。
    expect(faceCountOf(through)).toBeGreaterThan(faceCountOf(blind))
  })

  it('通孔螺纹真的切了牙：体积 < 同径 simple 光孔', async () => {
    const screw = await drill(block(40, 40, 60), {
      position: [0, 0, 30], direction: 'z', holeType: 'screw', diameter: 14,
      screwSpecIdx: 10, depth: 0,
    })
    const simple = await drill(block(40, 40, 60), {
      position: [0, 0, 30], direction: 'z', diameter: 14, depth: 0,
    })
    expect(volumeOf(screw)).toBeLessThan(volumeOf(simple))
  })
})

describe('#8 imperial 攻丝孔 PMI 缺省公差等级 2B', () => {
  it('旧三键 imperial：toleranceClass=2B，label 含 2B', async () => {
    const r = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'tapped',
      screwSystem: 'imperial', screwSpecIdx: 4, depth: 10,
    })
    const threads = pmiThreads(r)
    expect(threads).toHaveLength(1)
    expect(threads[0]!.thread.toleranceClass).toBe('2B')
    expect(threads[0]!.label).toContain('2B')
  })

  it('显式 threadClass 优先于缺省 2B', async () => {
    const r = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'tapped',
      screwSystem: 'imperial', screwSpecIdx: 4, threadClass: '3B', depth: 10,
    })
    expect(pmiThreads(r)[0]!.thread.toleranceClass).toBe('3B')
  })

  it("描述串 '1/4\"'（无公差后缀）仍不产出 PMI（D10 不默认）", async () => {
    const r = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', thread: '1/4"', depth: 10,
    })
    expect(pmiThreads(r)).toHaveLength(0)
  })
})

describe('#9 handedness 进 PMI（仅标注）', () => {
  it("旧三键 metric + handedness:'left'：PMI handedness=left，label 含 LH", async () => {
    // 直呼 fai_drill（不经 drill 助手）：handedness 键须在调用点字面可见（L2 API 覆盖门禁）
    const r = (await fai_drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'tapped',
      screwSpecIdx: 5, handedness: 'left', depth: 10,
    })) as Shape
    const threads = pmiThreads(r)
    expect(threads[0]!.thread.handedness).toBe('left')
    expect(threads[0]!.label).toContain('LH')
  })

  it("描述串 'M16-6H' + handedness:'left'：PMI handedness=left", async () => {
    const r = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', thread: 'M16-6H', handedness: 'left', depth: 10,
    })
    expect(pmiThreads(r)[0]!.thread.handedness).toBe('left')
  })

  it('缺省 handedness：PMI 无 handedness，label 无 LH', async () => {
    const r = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'tapped', screwSpecIdx: 5, depth: 10,
    })
    const threads = pmiThreads(r)
    expect(threads[0]!.thread.handedness).toBeUndefined()
    expect(threads[0]!.label).not.toContain('LH')
  })

  it("handedness:'up' → E_ARG", async () => {
    await expect(
      drill(block(40, 40, 20), {
        position: [0, 0, 10], direction: 'z', holeType: 'tapped', screwSpecIdx: 5,
        handedness: 'up', depth: 10,
      }),
    ).rejects.toThrow(/E_ARG/)
  })
})
