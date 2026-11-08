/**
 * ops/fai_drill_tapper — 双串攻丝孔（BREP 链）。
 *
 * 钉住的不变量（plan 2026-11-08-fai-drill-tapper.md，Q1–Q4 拍板）：
 * 1. 两串各表一职：drill 串 → 底孔几何；tap 串 → 螺纹规格（PMI）；
 * 2. PMI 恒产出（攻丝孔 op 的本义）；公差等级缺省不补——串内 '-6H' 才有（Q3）；
 * 3. 通孔 + 攻丝定深合法（Q2）：贯穿底孔上的 ↓8 丝段；
 * 4. 跨串校验显式 E_ARG：底孔 ≥ 公称大径 / 通丝配盲孔 / 丝深超孔深；
 * 5. 由串推导的键显式给出 → E_ARG（同一事实禁止两个来源）。
 *
 * 运行：npx vitest run test/extra/ops/fai-drill-tapper.test.ts
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
import { fromBrep, brepOf, compound, isCompoundLike } from '../../../src/shape'
import type { CompoundShape } from '../../../src/shape'
import { solidToShape } from '../../../src/brep/brep-ops'
import type { Shape } from '../../../src/mesh/types'
import { fai_drill } from '../../../src/extra/ops/fai_drill'
import { fai_drill_tapper, assertTapperParams } from '../../../src/extra/ops/fai_drill_tapper'
import { pmiThreads } from '../../../src/api/pmi/query'

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

/** 40×40×20 的块，以原点为中心（makeBox 从原点起，需平移）。 */
function block(): Shape {
  const h = kernel.translate(kernel.makeBox(40, 40, 20), -20, -20, -10)
  return fromBrep(solidToShape(kernel, h), { solid: h })
}

function volumeOf(shape: Shape): number {
  return kernel.getVolume(brepOf(shape) as BrepHandle)
}

function faceCountOf(shape: Shape): number {
  return kernel.getSubShapes(brepOf(shape) as BrepHandle, 'face').length
}

/** 从上表面 (z=+10) 沿 -Z 攻丝孔。 */
async function tap(
  shape: Shape,
  drill: string,
  tapSpec: string,
  extra?: Record<string, unknown>,
): Promise<Shape> {
  return (await fai_drill_tapper(shape, {
    position: [0, 0, 10], direction: 'z', drill, tap: tapSpec, ...extra,
  })) as Shape
}

describe('fai_drill_tapper — 两串各表一职（几何 = fai_drill simple 同径）', () => {
  it("通+通：'Ø2.5 完全贯穿' + 'M3-6H 完全贯穿'，几何 ≡ simple Φ2.5 通孔", async () => {
    const r = await tap(block(), 'Ø2.5 完全贯穿', 'M3-6H 完全贯穿')
    const plain = (await fai_drill(block(), {
      position: [0, 0, 10], direction: 'z', diameter: 2.5, depth: 0, holeType: 'simple',
    })) as Shape
    expect(volumeOf(r)).toBeCloseTo(volumeOf(plain), 6)
    expect(faceCountOf(r)).toBe(faceCountOf(plain))
  })

  it("盲+盲：'Ø2.5 深12' 几何 ≡ simple Φ2.5×12", async () => {
    const r = await tap(block(), 'Ø2.5 深12', 'M3-6H ↓8')
    const plain = (await fai_drill(block(), {
      position: [0, 0, 10], direction: 'z', diameter: 2.5, depth: 12, holeType: 'simple',
    })) as Shape
    expect(volumeOf(r)).toBeCloseTo(volumeOf(plain), 6)
    expect(faceCountOf(r)).toBe(faceCountOf(plain))
  })

  it('中文关键词与英文在几何上等价（完全贯穿 ≡ THRU、深12 ≡ ↓12、⌀/逗号小数）', async () => {
    const cn = await tap(block(), '⌀2,5 深12', 'M3-6H')
    const en = await tap(block(), 'Ø2.5 ↓12', 'M3-6H')
    expect(volumeOf(cn)).toBeCloseTo(volumeOf(en), 6)
    expect(faceCountOf(cn)).toBe(faceCountOf(en))
  })
})

describe('fai_drill_tapper — PMI 恒产出（Q3：公差缺省不补）', () => {
  it("通+通：label 'M3-6H 通（底孔 Φ2.5 通，攻丝）'，axis 朝下", async () => {
    const r = await tap(block(), 'Ø2.5 完全贯穿', 'M3-6H 完全贯穿')
    const items = pmiThreads(r)
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.thread.specLabel).toBe('M3')
    expect(item.thread.toleranceClass).toBe('6H')
    expect(item.thread.depth).toBe(0)
    expect(item.pilot).toEqual({ diameter: 2.5, depth: 0 })
    expect(item.process).toBe('tapped')
    expect(item.label).toBe('M3-6H 通（底孔 Φ2.5 通，攻丝）')
    expect(item.axis.direction).toEqual([0, 0, -1])
  })

  it("盲+定长丝：label 'M3-6H ↓8（底孔 Φ2.5 ↓12，攻丝）'", async () => {
    const r = await tap(block(), 'Ø2.5 深12', 'M3-6H ↓8')
    const item = pmiThreads(r)[0]!
    expect(item.pilot).toEqual({ diameter: 2.5, depth: 12 })
    expect(item.thread.depth).toBe(8)
    expect(item.label).toBe('M3-6H ↓8（底孔 Φ2.5 ↓12，攻丝）')
  })

  it("盲+同深（tap 无深度后缀）：丝深回落孔深 12", async () => {
    const r = await tap(block(), 'Ø2.5 深12', 'M3-6H')
    const item = pmiThreads(r)[0]!
    expect(item.thread.depth).toBe(12)
    expect(item.label).toBe('M3-6H ↓12（底孔 Φ2.5 ↓12，攻丝）')
  })

  it("通+定长丝（Q2）：贯穿底孔上的 ↓8 丝段，label 'M3-6H ↓8（底孔 Φ2.5 通，攻丝）'", async () => {
    const r = await tap(block(), 'Ø2.5 完全贯穿', 'M3-6H ↓8')
    const item = pmiThreads(r)[0]!
    expect(item.pilot).toEqual({ diameter: 2.5, depth: 0 })
    expect(item.thread.depth).toBe(8)
    expect(item.label).toBe('M3-6H ↓8（底孔 Φ2.5 通，攻丝）')
  })

  it("无公差（Q3）：tap 'M3' 仍产 PMI，toleranceClass 缺省不补 6H", async () => {
    const r = await tap(block(), 'Ø2.5 完全贯穿', 'M3')
    const items = pmiThreads(r)
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.thread.toleranceClass).toBeUndefined()
    expect(item.label).toBe('M3 通（底孔 Φ2.5 通，攻丝）')
  })

  it("管螺纹：'Ø8.7 深20' + 'PT1/8'，PMI 无公差等级", async () => {
    const r = await tap(block(), 'Ø8.7 深20', 'PT1/8')
    const item = pmiThreads(r)[0]!
    expect(item.thread.specLabel).toBe('PT1/8')
    expect(item.thread.toleranceClass).toBeUndefined()
    expect(item.pilot).toEqual({ diameter: 8.7, depth: 20 })
    expect(item.label).toBe('PT1/8 ↓20（底孔 Φ8.7 ↓20，攻丝）')
  })

  it("handedness:'left' 写入 PMI 并呈现在 label（' LH'）", async () => {
    const r = await tap(block(), 'Ø2.5 完全贯穿', 'M3-6H', { handedness: 'left' })
    const item = pmiThreads(r)[0]!
    expect(item.thread.handedness).toBe('left')
    expect(item.label).toBe('M3-6H 通 LH（底孔 Φ2.5 通，攻丝）')
  })

  it('英制：底孔 Φ5.1 + 1/4"-20-2B', async () => {
    const r = await tap(block(), '⌀5.1 深15', '1/4"-20-2B')
    const item = pmiThreads(r)[0]!
    expect(item.thread.specLabel).toBe('1/4"-20')
    expect(item.thread.toleranceClass).toBe('2B')
    expect(item.label).toBe('1/4"-20-2B ↓15（底孔 Φ5.1 ↓15，攻丝）')
  })
})

describe('fai_drill_tapper — 跨串校验（E_ARG，绝不静默取舍）', () => {
  it('底孔直径 ≥ 公称大径 → E_ARG', async () => {
    await expect(tap(block(), 'Ø3 完全贯穿', 'M3-6H')).rejects.toThrow(/no thread form is left to tap/)
  })

  it('tap 串 THRU 配盲孔钻串 → E_ARG', async () => {
    await expect(tap(block(), 'Ø2.5 深12', 'M3-6H THRU')).rejects.toThrow(/through thread needs a through pilot hole/)
  })

  it('盲丝丝深超过孔深 → E_ARG', async () => {
    await expect(tap(block(), 'Ø2.5 深8', 'M3-6H ↓12')).rejects.toThrow(/cannot run deeper than the drilled hole/)
  })

  it('由串推导的键显式给出 → E_ARG（diameter/depth/threadDepth/threadClass/holeType/旧三键/tolerance）', async () => {
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M3-6H', { depth: 10 })).rejects.toThrow(/E_ARG/)
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M3-6H', { diameter: 2.5 })).rejects.toThrow(/E_ARG/)
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M3-6H', { threadDepth: 8 })).rejects.toThrow(/E_ARG/)
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M3-6H', { threadClass: '6H' })).rejects.toThrow(/E_ARG/)
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M3-6H', { holeType: 'tapped' })).rejects.toThrow(/E_ARG/)
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M3-6H', { screwSpecIdx: 5 })).rejects.toThrow(/E_ARG/)
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M3-6H', { tolerance: 0.1 })).rejects.toThrow(/E_ARG/)
  })

  it("handedness 非法值 → E_ARG", async () => {
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M3-6H', { handedness: 'upside' })).rejects.toThrow(/E_ARG/)
  })

  it('position 非 vec3 → E_ARG（assertVec3）', async () => {
    await expect(fai_drill_tapper(block(), {
      position: [0, 0], direction: 'z', drill: 'Ø2.5 完全贯穿', tap: 'M3-6H',
    })).rejects.toThrow()
  })

  it('assertTapperParams：drill/tap 缺失或非字符串 → E_ARG（防御层）', () => {
    expect(() => assertTapperParams({ tap: 'M3-6H' })).toThrow(/E_ARG/)
    expect(() => assertTapperParams({ drill: 'Ø2.5' })).toThrow(/E_ARG/)
    expect(() => assertTapperParams({ drill: '', tap: 'M3-6H' })).toThrow(/E_ARG/)
    expect(() => assertTapperParams({ drill: 2.5, tap: 'M3-6H' })).toThrow(/E_ARG/)
  })
})

describe('fai_drill_tapper — 解析失败显式报错（E_THREAD_SPEC）', () => {
  it("drill 串裸第二数字（'Ø2.5 10'，GOTCHA）→ E_THREAD_SPEC", async () => {
    await expect(tap(block(), 'Ø2.5 10', 'M3-6H')).rejects.toThrow(/E_THREAD_SPEC/)
  })

  it("drill 串无直径符号（'2.5 完全贯穿'）→ E_THREAD_SPEC", async () => {
    await expect(tap(block(), '2.5 完全贯穿', 'M3-6H')).rejects.toThrow(/E_THREAD_SPEC/)
  })

  it("tap 串表外（'M99'）→ E_THREAD_SPEC", async () => {
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M99')).rejects.toThrow(/E_THREAD_SPEC/)
  })

  it("tap 串注入载荷（'M3; DROP TABLE parts'）→ E_THREAD_SPEC", async () => {
    await expect(tap(block(), 'Ø2.5 完全贯穿', 'M3; DROP TABLE parts')).rejects.toThrow(/E_THREAD_SPEC/)
  })
})

describe('fai_drill_tapper — 放置词汇与 compound（faceNormal / partIndex / handedness / face）', () => {
  it("faceNormal:[0,0,-1] + direction:'normal'：底面起钻，PMI axis 朝上，几何 ≡ 顶面同径", async () => {
    const bottom = await fai_drill_tapper(block(), {
      position: [0, 0, -10], faceNormal: [0, 0, -1], direction: 'normal',
      drill: 'Ø2.5 完全贯穿', tap: 'M3-6H',
    })
    const top = await tap(block(), 'Ø2.5 完全贯穿', 'M3-6H')
    expect(volumeOf(bottom as Shape)).toBeCloseTo(volumeOf(top), 6)
    const item = pmiThreads(bottom as Shape)[0]!
    expect(item.axis.direction).toEqual([0, 0, 1])
  })

  it('partIndex：compound 输入按成员替换，PMI 只落在被改成员上', async () => {
    const c = compound([block(), block()])
    const r = await fai_drill_tapper(c, {
      position: [0, 0, 10], direction: 'z',
      drill: 'Ø2.5 完全贯穿', tap: 'M3-6H', partIndex: 1,
    })
    expect(isCompoundLike(r)).toBe(true)
    const out = r as CompoundShape
    expect(out.children).toHaveLength(2)
    expect(pmiThreads(out.children[0]!)).toHaveLength(0)
    expect(pmiThreads(out.children[1]!)).toHaveLength(1)
    expect(pmiThreads(out.children[1]!)[0]!.label).toBe('M3-6H 通（底孔 Φ2.5 通，攻丝）')
  })

  it("handedness:'left'（直呼调用点）写入 PMI", async () => {
    const r = await fai_drill_tapper(block(), {
      position: [0, 0, 10], direction: 'z',
      drill: 'Ø2.5 完全贯穿', tap: 'M3-6H', handedness: 'left',
    })
    expect(pmiThreads(r as Shape)[0]!.thread.handedness).toBe('left')
  })

  it('face：无命名上下文的裸形状上给 FaceTopoRef → 显式报错（不静默回落）', async () => {
    await expect(fai_drill_tapper(block(), {
      position: [0, 0, 10], direction: 'normal',
      drill: 'Ø2.5 完全贯穿', tap: 'M3-6H',
      face: { kind: 'face', origin: 's1', role: 'top' },
    })).rejects.toThrow(/E_TOPO_NOT_FOUND|no naming context/)
  })
})
