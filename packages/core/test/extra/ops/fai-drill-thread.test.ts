/**
 * ops/fai_drill — 描述性螺纹建模 `thread: 'M16-6H↧18'`（BREP 链）。
 *
 * 钉住的不变量（plan 2026-11-07 §3，D2/D4/D10）：
 * 1. 一个键即完整规格：底孔按表反算（M16 → Φ14），缺省通孔；
 * 2. PMI 产出条件（描述串路径）：串内公差后缀（-6H）或显式 threadClass 才产出，
 *    'M4×0.7' 无 PMI——描述路径不默认 6H；旧三键路径始终产出（U12 对照）；
 * 3. 互斥显式报错（E_ARG），绝不静默优先级；
 * 4. 串内 ↧/↓ 后缀 = 孔深；与显式 depth / threadClass 同给报错。
 *
 * 运行：npx vitest run test/extra/ops/fai-drill-thread.test.ts
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

/** 从上表面 (z=+10) 沿 -Z 钻孔。 */
async function drill(shape: Shape, params: Record<string, unknown>): Promise<Shape> {
  return (await fai_drill(shape, { position: [0, 0, 10], direction: 'z', ...params })) as Shape
}

describe('fai_drill — thread 一个键即完整规格（U2）', () => {
  it("thread:'M16'：通孔，底孔 Φ14 表反算，几何与同径 simple 一致，无 PMI", async () => {
    // 直呼 fai_drill（不经 drill 助手）：thread 键须在调用点字面可见（L2 API 覆盖门禁）
    const described = (await fai_drill(block(), {
      position: [0, 0, 10], direction: 'z', thread: 'M16',
    })) as Shape
    const plain = await drill(block(), { diameter: 14, depth: 0, holeType: 'simple' })
    expect(volumeOf(described)).toBeCloseTo(volumeOf(plain), 6)
    expect(faceCountOf(described)).toBe(faceCountOf(plain))
    // 串内无公差后缀、无显式 threadClass → 不产出 PMI（D10）
    expect(pmiThreads(described)).toHaveLength(0)
  })

  it("thread:'M16' + depth:24：盲孔几何与 simple Φ14×24 一致，仍无 PMI", async () => {
    const described = await drill(block(), { thread: 'M16', depth: 24 })
    const plain = await drill(block(), { diameter: 14, depth: 24, holeType: 'simple' })
    expect(volumeOf(described)).toBeCloseTo(volumeOf(plain), 6)
    expect(faceCountOf(described)).toBe(faceCountOf(plain))
    expect(pmiThreads(described)).toHaveLength(0)
  })

  it("thread:'M16' 大小写/空格容忍（'m16'、'M 16'）几何一致", async () => {
    const a = await drill(block(), { thread: 'm16' })
    const b = await drill(block(), { thread: 'M 16' })
    expect(volumeOf(a)).toBeCloseTo(volumeOf(b), 6)
  })
})

describe('fai_drill — PMI 产出条件（D10 / U15）', () => {
  it("'M4 X 0.7 - 6H'：PMI 产出，公差来自串，specLabel 不含公差与深度", async () => {
    const r = await drill(block(), { thread: 'M4 X 0.7 - 6H' })
    const items = pmiThreads(r)
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.thread.standard).toBe('metric')
    expect(item.thread.specLabel).toBe('M4×0.7')
    expect(item.thread.toleranceClass).toBe('6H')
    expect(item.thread.pitch).toBeCloseTo(0.7, 9)
    expect(item.pilot.diameter).toBe(3.3)
    expect(item.process).toBe('tapped')
  })

  it("'M4×0.7'：串内无公差后缀 → 只出几何，无 PMI", async () => {
    const r = await drill(block(), { thread: 'M4×0.7' })
    expect(pmiThreads(r)).toHaveLength(0)
  })

  it("'M4×0.7' + 显式 threadClass:'6H'：PMI 产出（公差来自显式参数）", async () => {
    const r = await drill(block(), { thread: 'M4×0.7', threadClass: '6H' })
    const items = pmiThreads(r)
    expect(items).toHaveLength(1)
    expect(items[0]!.thread.toleranceClass).toBe('6H')
    expect(items[0]!.thread.specLabel).toBe('M4×0.7')
  })

  it("旧三键路径不受 D10 影响：始终产出 PMI、metric 缺省 6H（U12 对照）", async () => {
    const r = await drill(block(), { holeType: 'tapped', screwSpecIdx: 5, depth: 10 })
    const items = pmiThreads(r)
    expect(items).toHaveLength(1)
    expect(items[0]!.thread.toleranceClass).toBe('6H')
  })
})

describe('fai_drill — 深度后缀与显式参数（D10 / U16 / U5）', () => {
  it("'M16-6H↧18'：depth=18 盲孔 + PMI，label 齐全", async () => {
    const r = await drill(block(), { thread: 'M16-6H↧18' })
    const items = pmiThreads(r)
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.pilot).toEqual({ diameter: 14, depth: 18 })
    expect(item.thread.depth).toBe(18)
    expect(item.thread.toleranceClass).toBe('6H')
    expect(item.label).toBe('M16-6H ↓18（底孔 Φ14 ↓18，攻丝）')
  })

  it("'M16-6H' + depth:24 + threadDepth:20（U5）", async () => {
    const r = await drill(block(), { thread: 'M16-6H', depth: 24, threadDepth: 20 })
    const item = pmiThreads(r)[0]!
    expect(item.pilot).toEqual({ diameter: 14, depth: 24 })
    expect(item.thread.depth).toBe(20)
    expect(item.label).toBe('M16-6H ↓20（底孔 Φ14 ↓24，攻丝）')
  })

  it("'M16↧18' + depth:20 同给 → E_ARG", async () => {
    await expect(drill(block(), { thread: 'M16↧18', depth: 20 })).rejects.toThrow(/E_ARG/)
  })

  it("'M16-6H' + threadClass:'7H' 同给 → E_ARG", async () => {
    await expect(drill(block(), { thread: 'M16-6H', threadClass: '7H' })).rejects.toThrow(/E_ARG/)
  })
})

describe('fai_drill — 互斥与合法组合（D4 / U4 / U13）', () => {
  it('thread 与旧三键同给 → E_ARG', async () => {
    await expect(drill(block(), { thread: 'M16', screwSpecIdx: 10 })).rejects.toThrow(/E_ARG/)
    await expect(drill(block(), { thread: 'M16', screwSystem: 'metric' })).rejects.toThrow(/E_ARG/)
    await expect(drill(block(), { thread: 'M16', screwThread: 'coarse' })).rejects.toThrow(/E_ARG/)
  })

  it("thread + holeType:'simple' → E_ARG（规格对光孔无意义）", async () => {
    await expect(drill(block(), { thread: 'M16', holeType: 'simple' })).rejects.toThrow(/E_ARG/)
  })

  it("thread:'M3' + holeType:'tapped' 同给合法（等同缺省）：底孔 Φ2.5", async () => {
    const r = await drill(block(), { thread: 'M3', holeType: 'tapped' })
    const plain = await drill(block(), { diameter: 2.5, depth: 0, holeType: 'simple' })
    expect(volumeOf(r)).toBeCloseTo(volumeOf(plain), 6)
    expect(faceCountOf(r)).toBe(faceCountOf(plain))
  })

  it("thread:'M3' + holeType:'screw' 同给合法：建模螺纹（底孔表反算，几何含牙）", async () => {
    const r = await drill(block(), { thread: 'M3', holeType: 'screw', depth: 10 })
    const plain = await drill(block(), { diameter: 2.5, depth: 10, holeType: 'simple' })
    // 牙切进孔壁 ⇒ 体积小于同径 simple
    expect(volumeOf(r)).toBeLessThan(volumeOf(plain) - 1e-3)
  })

  it("thread:'PT1/8' + holeType:'screw' → 锥管牙型未实现报错", async () => {
    await expect(drill(block(), { thread: 'PT1/8', holeType: 'screw' })).rejects.toThrow(/锥管牙型未实现/)
  })

  it('thread 非字符串 → E_ARG', async () => {
    await expect(drill(block(), { thread: 16 })).rejects.toThrow(/E_ARG/)
  })
})

describe('fai_drill — 解析失败显式报错（D3 / E_THREAD_SPEC）', () => {
  it("thread:'M99' 表外 → E_THREAD_SPEC", async () => {
    await expect(drill(block(), { thread: 'M99' })).rejects.toThrow(/E_THREAD_SPEC/)
  })

  it("thread:'NPT1/2' 不支持 → E_THREAD_SPEC", async () => {
    await expect(drill(block(), { thread: 'NPT1/2' })).rejects.toThrow(/E_THREAD_SPEC/)
  })

  it("thread:'PT1/8-6H' pipe 带公差后缀 → E_THREAD_SPEC", async () => {
    await expect(drill(block(), { thread: 'PT1/8-6H' })).rejects.toThrow(/E_THREAD_SPEC/)
  })
})

describe('fai_drill — 描述串与旧三键等价（U12）', () => {
  it("三键 M16 与 thread:'M16' 的几何完全一致（体积/面数）", async () => {
    const threeKey = await drill(block(), {
      holeType: 'tapped', screwSystem: 'metric', screwSpecIdx: 10, screwThread: 'coarse',
    })
    const described = await drill(block(), { thread: 'M16' })
    expect(volumeOf(described)).toBeCloseTo(volumeOf(threeKey), 6)
    expect(faceCountOf(described)).toBe(faceCountOf(threeKey))
    // 旧路径 PMI 的底孔 = 描述串路径反算的底孔
    expect(pmiThreads(threeKey)[0]!.pilot.diameter).toBe(14)
  })
})

describe('fai_drill — THRU 通孔关键词（OCR 白名单 L2）', () => {
  it("thread:'M16 THRU'：通孔几何 ≡ thread:'M16'（深度缺省即通孔），无 PMI", async () => {
    const a = await drill(block(), { thread: 'M16 THRU' })
    const b = await drill(block(), { thread: 'M16' })
    expect(volumeOf(a)).toBeCloseTo(volumeOf(b), 6)
    expect(faceCountOf(a)).toBe(faceCountOf(b))
    expect(pmiThreads(a)).toHaveLength(0)
  })

  it("thread:'M16-6H THRU' + depth:20 同给 → E_ARG（通孔无深度）", async () => {
    await expect(drill(block(), { thread: 'M16-6H THRU', depth: 20 })).rejects.toThrow(/E_ARG/)
  })

  it("thread:'M16 18 DEEP'：盲孔几何 ≡ thread:'M16↧18'", async () => {
    const a = await drill(block(), { thread: 'M16 18 DEEP' })
    const b = await drill(block(), { thread: 'M16↧18' })
    expect(volumeOf(a)).toBeCloseTo(volumeOf(b), 6)
    expect(faceCountOf(a)).toBe(faceCountOf(b))
  })
})
