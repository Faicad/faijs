/**
 * ops/fai_drill — Phase 4 BREP 语义防回归（plan 2026-11-07 §4-4）。
 *
 * - #12（U7）：`tolerance` 在 BREP 链生效——simple/tapped 半径 +tolerance/2；
 *   缺省 = 名义孔径（不再是 mesh 的缺省 0.3）；screw 孔不吃 tolerance
 *   （底孔+牙型配对，扩孔会破坏 pilot/depth 关系）。
 * - #14（U9）：screw 孔内螺纹语义修正——牙根贴底孔壁（嵌 0.3 进空腔）、
 *   牙顶**向外**升到公称大径（旧实现 inward 齿尖指向空腔，只有 0.3mm
 *   嵌入带切到材料＝"0.3mm 浅槽"缺陷）；legacy screw `diameter` 可省
 *   （表反算底孔，与 tapped/描述串同一缺省）；底孔 ≥ 公称 → E_ARG。
 *
 * 运行：npx vitest run test/extra/ops/fai-drill-brep-semantics.test.ts
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
import { solidToShape, drillBrep } from '../../../src/brep/brep-ops'
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

function block(sx: number, sy: number, sz: number): Shape {
  const h = kernel.translate(kernel.makeBox(sx, sy, sz), -sx / 2, -sy / 2, -sz / 2)
  return fromBrep(solidToShape(kernel, h), { solid: h })
}

function volumeOf(shape: Shape): number {
  return kernel.getVolume(brepOf(shape) as BrepHandle)
}

async function drill(shape: Shape, params: Record<string, unknown>): Promise<Shape> {
  return (await fai_drill(shape, params)) as Shape
}

/** 40×40×20 块钻 Φ10 通孔后的体积：removed = π·r²·20（孔贯穿整块）。 */
function drilledVolume(holeRadius: number): number {
  return 40 * 40 * 20 - Math.PI * holeRadius * holeRadius * 20
}

describe('#12（U7）tolerance 在 BREP simple 链生效', () => {
  it('缺省 tolerance：孔径 = 名义 Φ10（不是 mesh 的缺省 +0.3）', async () => {
    const r = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 10, depth: 0,
    })
    expect(volumeOf(r)).toBeCloseTo(drilledVolume(5), 0)
  })

  it('tolerance:0.3 → 半径 +0.15（Φ10.3）；tolerance:0.6 → Ø10.6', async () => {
    const t03 = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 10, depth: 0, tolerance: 0.3,
    })
    expect(volumeOf(t03)).toBeCloseTo(drilledVolume(5.15), 0)
    const t06 = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 10, depth: 0, tolerance: 0.6,
    })
    expect(volumeOf(t06)).toBeCloseTo(drilledVolume(5.3), 0)
  })

  it('tapped 链同样吃 tolerance（simple/tapped 共用 computeDrillGeometry）', async () => {
    const t = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'tapped',
      screwSpecIdx: 5, depth: 0, tolerance: 0.3,
    })
    // M6 攻丝底孔 Φ5（表反算），tolerance 0.3 → Φ5.3
    expect(volumeOf(t)).toBeCloseTo(drilledVolume(2.65), 0)
  })

  it('screw 孔不吃 tolerance：给不给 0.3 体积逐位一致（pilot/牙型配对不可扩孔）', async () => {
    const plain = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'screw',
      screwSpecIdx: 10, diameter: 14, depth: 0,
    })
    const tol = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'screw',
      screwSpecIdx: 10, diameter: 14, depth: 0, tolerance: 0.3,
    })
    expect(volumeOf(plain)).toBeCloseTo(volumeOf(tol), 6)
  })

  it('drillBrep 直呼（L2 覆盖）：tolerance 字面调用点，半径 +tolerance/2', () => {
    // 直呼 drillBrep（不经 fai_drill）：tolerance 键须在调用点字面可见（L2 API 覆盖门禁）
    const box = kernel.translate(kernel.makeBox(40, 40, 20), -20, -20, -10)
    const drilled = drillBrep(kernel, box, {
      diameter: 10, depth: 0,
      position: [0, 0, 10],
      direction: [0, 0, -1],
      faceNormal: [0, 0, 1],
      tolerance: 0.3,
      holeType: 'simple',
    })
    expect(kernel.getVolume(drilled)).toBeCloseTo(drilledVolume(5.15), 0)
  })
})

describe('#14（U9）screw 孔内螺纹：底孔壁起牙、牙顶到公称大径', () => {
  it('牙真切到公称带：Φ[7.4, 8.0] 环带内材料被螺旋槽切除（旧"0.3 浅槽"只到 7.3）', async () => {
    const drilled = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'screw',
      screwSpecIdx: 10, diameter: 14, depth: 0,
    })
    // 环带探针：外圆柱 r=8、内圆柱 r=7.4，z ∈ [-10, 10]（与块同界）
    const outer = kernel.translate(kernel.makeCylinder(8, 20), 0, 0, -10)
    const inner = kernel.translate(kernel.makeCylinder(7.4, 20), 0, 0, -10)
    const ring = kernel.cut(outer, inner)
    kernel.release(outer)
    kernel.release(inner)
    const ringVol = kernel.getVolume(ring)
    const common = kernel.common(brepOf(drilled) as BrepHandle, ring)
    const commonVol = kernel.getVolume(common)
    kernel.release(ring)
    kernel.release(common)
    // 旧缺陷：槽最深 7.3 < 7.4 → common ≈ ring（无缺口）；
    // 新语义：槽切穿 7.4→8.0 带 → common 比 ring 少 ≈60mm³。阈值 545 居中。
    expect(commonVol).toBeLessThan(545)
    expect(commonVol).toBeGreaterThan(ringVol - 200)
  })

  it('legacy screw `diameter` 可省：表反算底孔 Φ14，PMI pilot=14', async () => {
    const r = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'screw',
      screwSpecIdx: 10, depth: 0,
    })
    const explicit = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'screw',
      screwSpecIdx: 10, diameter: 14, depth: 0,
    })
    expect(volumeOf(r)).toBeCloseTo(volumeOf(explicit), 6)
    const threads = pmiThreads(r)
    expect(threads).toHaveLength(1)
    expect(threads[0]!.pilot.diameter).toBeCloseTo(14, 6)
    expect(threads[0]!.thread.nominalDiameter).toBe(16)
  })

  it('描述串 screw 与 legacy 等价：thread:"M16" + holeType:screw ≡ 旧三键', async () => {
    const desc = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', thread: 'M16', holeType: 'screw', depth: 0,
    })
    const legacy = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'screw',
      screwSpecIdx: 10, diameter: 14, depth: 0,
    })
    expect(volumeOf(desc)).toBeCloseTo(volumeOf(legacy), 6)
  })

  it('screw 体积 < 同径 simple 光孔（螺旋槽在底孔之外再切材料）', async () => {
    const screw = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'screw',
      screwSpecIdx: 10, diameter: 14, depth: 0,
    })
    const simple = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 14, depth: 0,
    })
    // 切除量 = 螺旋槽带。定量判别 old/new 由上面的环带探针承担（loft 的弦垂
    // 让理想三角形面积失真——12 段/圈时牙顶在段间下垂到 r≈8·cos15°≈7.73，
    // 实测 deficit ≈ 0.21×环带，与旧"0.3 浅槽"的理论值同量级，体积带分不出
    // 新旧）；此处只钉两件事：槽真的多切了材料（>50mm³）、没切穿整个环带。
    const deficit = volumeOf(simple) - volumeOf(screw)
    const annulus = Math.PI * (8 * 8 - 7 * 7) * 20
    expect(deficit).toBeGreaterThan(50)
    expect(deficit).toBeLessThan(0.45 * annulus)
  })

  it('底孔 ≥ 公称大径 → E_ARG（没有牙型可建模，显式报错不静默）', async () => {
    await expect(
      drill(block(40, 40, 20), {
        position: [0, 0, 10], direction: 'z', holeType: 'screw',
        screwSpecIdx: 10, diameter: 16, depth: 0,
      }),
    ).rejects.toThrow(/E_ARG.*smaller than the nominal/)
  })
})
