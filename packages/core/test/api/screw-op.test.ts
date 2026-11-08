/**
 * api/screw — 描述性规格键 `spec: 'M16'`（U6，plan 2026-11-07 §3.5，D1）。
 *
 * 钉住的不变量：
 * 1. spec 一个键即完整规格：解析出 system/specIdx/pitch 后走既有路径
 *    （BREP 实现零改动）；'M16' 缺省粗牙；
 * 2. 描述路径与等价旧参数产出完全一致的几何（体积逐位相等）；
 * 3. 互斥显式报错（E_ARG）：spec 不可与 system/specIdx/pitchCustom 或
 *    thread（'none' 除外）同给；pipe 规格不支持；解析失败 E_THREAD_SPEC。
 *
 * #13（U8）：牙型统一——crest（牙顶）= 公称大径（M16 → Ø16，不再是
 * nominal+1.2P）；bbox 与体积带按此断言。
 *
 * 运行：npx vitest run test/api/screw-op.test.ts
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
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { getBrepApi } from '../../src/brep/handle-bridge'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'
import { fromBrep, brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import { screw, assertScrewParams } from '../../src/api/screw'

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

function volumeOf(shape: Shape): number {
  return kernel.getVolume(brepOf(shape) as BrepHandle)
}

/** π·r²·L：理论圆柱体积（边界带断言用）。 */
function cylinderVolume(r: number, length: number): number {
  return Math.PI * r * r * length
}

async function screwShape(params: Record<string, unknown>): Promise<Shape> {
  return (await screw(params)) as Shape
}

describe('screw — spec 一个键即完整规格（U6）', () => {
  it("spec:'M16'：合法实体，体积落在 [牙根圆柱, 公称圆柱] 带内（#13 牙型统一）", async () => {
    // 直呼 screw（不经 screwShape 助手）：spec 键须在调用点字面可见（L2 API 覆盖门禁）
    const s = (await screw({ spec: 'M16', length: 40 })) as Shape
    expect(s).toBeDefined()
    const v = volumeOf(s)
    expect(v).toBeGreaterThan(0)
    // 下界：牙根圆柱（Φ16 − 2×1.2 = Φ13.6）完整存在
    expect(v).toBeGreaterThan(cylinderVolume(6.8, 40))
    // 上界：牙顶包络 = 公称大径 Ø16（#13：crest=公称，不再是 nominal+1.2P）
    expect(v).toBeLessThan(cylinderVolume(8, 40))
  })

  it("spec:'M16' 与旧参数 {system:'metric', specIdx:10} 体积逐位相等（缺省粗牙）", async () => {
    const described = await screwShape({ spec: 'M16', length: 40 })
    const legacy = await screwShape({ system: 'metric', specIdx: 10, length: 40 })
    expect(volumeOf(described)).toBeCloseTo(volumeOf(legacy), 6)
  })

  it("spec:'M16×1.5' 与旧参数 {thread:'fine'} 体积逐位相等；且与粗牙不同", async () => {
    const fineDescribed = await screwShape({ spec: 'M16×1.5', length: 40 })
    const fineLegacy = await screwShape({ system: 'metric', specIdx: 10, thread: 'fine', length: 40 })
    const coarse = await screwShape({ system: 'metric', specIdx: 10, length: 40 })
    const vFine = volumeOf(fineDescribed)
    expect(vFine).toBeCloseTo(volumeOf(fineLegacy), 6)
    // 牙型不同 → 体积必然不同（螺距 1.5 vs 2）
    expect(Math.abs(vFine - volumeOf(coarse))).toBeGreaterThan(1)
  })

  it("spec:'M16-6g'（外螺纹公差后缀）：解析通过，几何与 'M16' 一致", async () => {
    const withClass = await screwShape({ spec: 'M16-6g', length: 40 })
    const plain = await screwShape({ spec: 'M16', length: 40 })
    expect(volumeOf(withClass)).toBeCloseTo(volumeOf(plain), 6)
  })

  it("spec:'M16' + thread:'none'：无牙光杆，体积 == 公称圆柱", async () => {
    const s = await screwShape({ spec: 'M16', thread: 'none', length: 40 })
    expect(volumeOf(s)).toBeCloseTo(cylinderVolume(8, 40), 1)
  })

  it("spec:'1/4\"-20' 与 '1/4\"'（缺省粗牙 = 20 TPI）等价，且与旧参数一致", async () => {
    const tpi = await screwShape({ spec: '1/4"-20', length: 20 })
    const bare = await screwShape({ spec: '1/4"', length: 20 })
    const legacy = await screwShape({ system: 'imperial', specIdx: 4, length: 20 })
    expect(volumeOf(tpi)).toBeCloseTo(volumeOf(bare), 6)
    expect(volumeOf(tpi)).toBeCloseTo(volumeOf(legacy), 6)
  })
})

describe('screw — #13 牙型统一：大径 = 公称（U8）', () => {
  it("spec:'M16'：bbox 径向 = 公称 Ø16（±0.05），不再是 nominal+1.2P", async () => {
    // head 缺省 'none' → bbox 即螺纹包络（hex/chc 头会超出公称）
    const s = await screwShape({ spec: 'M16', length: 40 })
    const bb = kernel.getBoundingBox(brepOf(s) as BrepHandle)
    expect(bb.xmax).toBeCloseTo(8, 1)
    expect(bb.xmin).toBeCloseTo(-8, 1)
    expect(bb.ymax).toBeCloseTo(8, 1)
    expect(bb.ymin).toBeCloseTo(-8, 1)
  })

  it("spec:'M16×1.5'：细牙同断言——bbox 仍是公称 Ø16，牙根随螺距收窄", async () => {
    const coarse = await screwShape({ spec: 'M16', length: 40 })
    const fine = await screwShape({ spec: 'M16×1.5', length: 40 })
    const bbFine = kernel.getBoundingBox(brepOf(fine) as BrepHandle)
    expect(bbFine.xmax).toBeCloseTo(8, 1)
    // 细牙牙浅（0.6×1.5=0.9 < 0.6×2=1.2）→ 牙间空隙占比更小 → 体积更大
    expect(volumeOf(fine)).toBeGreaterThan(volumeOf(coarse))
  })

  it('体积带下界 = 牙根圆柱：体积 > π·(6.8)²·40 且留 5% 余量（牙真的在杆上）', async () => {
    const s = await screwShape({ spec: 'M16', length: 40 })
    // 牙根圆柱 + 全牙填充之间；下界留 5% 保证牙材料占实（若 threadBrep 退化
    // 为空/独立体未 fuse，体积会贴住下界）
    expect(volumeOf(s)).toBeGreaterThan(cylinderVolume(6.8, 40) * 1.05)
  })
})

describe('screw — spec 互斥与报错（E_ARG / E_THREAD_SPEC）', () => {
  it('spec + system / specIdx / pitchCustom / thread(≠none) → E_ARG', () => {
    expect(() => assertScrewParams({ spec: 'M16', system: 'metric', length: 40 })).toThrow(/E_ARG/)
    expect(() => assertScrewParams({ spec: 'M16', specIdx: 10, length: 40 })).toThrow(/E_ARG/)
    expect(() => assertScrewParams({ spec: 'M16', pitchCustom: 1.5, length: 40 })).toThrow(/E_ARG/)
    expect(() => assertScrewParams({ spec: 'M16', thread: 'fine', length: 40 })).toThrow(/E_ARG/)
    expect(() => assertScrewParams({ spec: 'M16', thread: 'coarse', length: 40 })).toThrow(/E_ARG/)
  })

  it("spec:'M16' + thread:'none' / 单独 spec 合法（不抛）", () => {
    expect(() => assertScrewParams({ spec: 'M16', length: 40 })).not.toThrow()
    expect(() => assertScrewParams({ spec: 'M16', thread: 'none', length: 40 })).not.toThrow()
  })

  it("spec:'PT1/8'（管螺纹）→ E_ARG：screw 仅支持 metric/imperial", () => {
    expect(() => assertScrewParams({ spec: 'PT1/8', length: 40 })).toThrow(/E_ARG.*pipe/)
  })

  it("spec:'M99'（超表）→ E_THREAD_SPEC", () => {
    expect(() => assertScrewParams({ spec: 'M99', length: 40 })).toThrow(/E_THREAD_SPEC/)
  })

  it('op 边界：报错经 toOpFailure 包装后消息仍含 E_ARG / E_THREAD_SPEC', async () => {
    await expect(screwShape({ spec: 'M16', system: 'metric', length: 40 })).rejects.toThrow(/E_ARG/)
    await expect(screwShape({ spec: 'M99', length: 40 })).rejects.toThrow(/E_THREAD_SPEC/)
    await expect(screwShape({ spec: 'M16' })).rejects.toThrow(/length/)
  })
})
