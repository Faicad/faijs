/**
 * ops/fai_drill — `holeType:'tapped'`（攻丝孔）行为验证（BREP 链）。
 *
 * 钉住的三条不变量（来自用户 2026-10-31 的纠正）：
 * 1. **`screw` 是真的钻螺纹孔**——它切出螺旋牙，几何体积与 `simple` 不同，
 *    所以"螺纹不是实体几何"只对 `tapped` 成立，对 `screw` 不成立。
 * 2. **`tapped` 的几何只有底孔**——与同参数 `simple` 的几何逐项相同（体积/面数）。
 * 3. **`tapped` 的 PMI 同时含底孔与螺纹**——一个 `PmiThreadHole` 两个分组，
 *    且 BREP 链能给出孔壁 `FaceTopoRef`。
 *
 * 运行：npx vitest run test/extra/ops/fai-drill-tapped.test.ts
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
import { formatThreadHole } from '../../../src/api/pmi/text'

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

/**
 * 40×40×20 的块，**以原点为中心**（x,y ∈ [-20,20]，z ∈ [-10,10]），留给盲孔足够材料。
 *
 * ⚠ `kernel.makeBox(dx,dy,dz)` 造的是**从原点起**的盒子（0..dx 等），不是居中盒子。
 * 早期这里直接用 makeBox，孔心落在盒子棱上：刀具只有 1/4 落在料内（体积少 3/4），
 * 落在 z=-10 的底面孔更是整支刀在料外（切除体积 0）——"方向对/错"根本测不出来。
 */
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

/** 从上表面 (z=+10) 沿 -Z 钻一个盲孔（op 是 async，等待落定）。 */
async function drill(shape: Shape, params: Record<string, unknown>): Promise<Shape> {
  return (await fai_drill(shape, { position: [0, 0, 10], direction: 'z', ...params })) as Shape
}

describe('fai_drill — tapped 的几何只有底孔', () => {
  it('tapped 与同参数 simple 的几何完全一致（体积/面数）', async () => {
    const plain = await drill(block(), { diameter: 5, depth: 16, holeType: 'simple' })
    const tapped = await drill(block(), { diameter: 5, depth: 16, holeType: 'tapped', screwSpecIdx: 5, threadDepth: 14 })
    expect(volumeOf(tapped)).toBeCloseTo(volumeOf(plain), 6)
    expect(faceCountOf(tapped)).toBe(faceCountOf(plain))
  })

  it('diameter 省略时按「公称直径 − 螺距」反算底孔（M6 → Φ5）', async () => {
    const tapped = await drill(block(), { holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })
    const explicit = await drill(block(), { diameter: 5, depth: 16, holeType: 'simple' })
    expect(volumeOf(tapped)).toBeCloseTo(volumeOf(explicit), 6)
    expect(pmiThreads(tapped)[0]!.pilot.diameter).toBe(5)
  })
})

describe('fai_drill — screw 是真的钻螺纹孔（与 tapped 相反）', () => {
  it('screw 的几何与同直径 simple 不同（真的切了牙）', async () => {
    const plain = await drill(block(), { diameter: 5, depth: 10, holeType: 'simple' })
    const screw = await drill(block(), {
      diameter: 5, depth: 10, holeType: 'screw', screwSpecIdx: 5, screwThread: 'coarse',
    })
    // 螺旋牙把孔壁挖得更深 ⇒ 体积更小（差异远大于浮点噪声）
    expect(volumeOf(screw)).toBeLessThan(volumeOf(plain) - 1e-3)
  })

  it('screw 也产出螺纹孔标注，但 process=modeled', async () => {
    const screw = await drill(block(), {
      diameter: 6, depth: 10, holeType: 'screw', screwSpecIdx: 5, threadDepth: 8,
    })
    const items = pmiThreads(screw)
    expect(items).toHaveLength(1)
    expect(items[0]!.process).toBe('modeled')
    expect(items[0]!.thread.depth).toBe(8)
    expect(formatThreadHole(items[0]!)).toContain('实体螺纹')
  })
})

describe('fai_drill — tapped 的 PMI 一条含两类信息', () => {
  it('底孔与螺纹同属一个条目，并带 BREP 孔壁引用', async () => {
    const tapped = await drill(block(), {
      holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14, threadClass: '6H',
    })
    const items = pmiThreads(tapped)
    expect(items).toHaveLength(1)
    const item = items[0]!
    // 原始几何
    expect(item.pilot).toEqual({ diameter: 5, depth: 16 })
    // 后加工攻丝
    expect(item.thread.nominalDiameter).toBe(6)
    expect(item.thread.pitch).toBe(1)
    expect(item.thread.toleranceClass).toBe('6H')
    expect(item.thread.depth).toBe(14)
    expect(item.thread.specLabel).toBe('M6')
    // 定位
    expect(item.axis.origin).toEqual([0, 0, 10])
    expect(item.axis.direction).toEqual([0, 0, -1])
    // BREP 链额外给出孔壁面引用（mesh 链没有）
    expect(item.target).toBeDefined()
    expect(item.target!.kind).toBe('face')
    expect(item.target!.role).toMatch(/^hole:/)
    // 显示文本两类信息齐全
    expect(item.label).toBe('M6-6H ↓14（底孔 Φ5 ↓16，攻丝）')
    expect(formatThreadHole(item)).toBe(item.label)
  })

  it('threadDepth 超过底孔深度时被夹到底孔深度（孔底不留负光底）', async () => {
    const tapped = await drill(block(), { holeType: 'tapped', screwSpecIdx: 5, depth: 12, threadDepth: 20 })
    expect(pmiThreads(tapped)[0]!.thread.depth).toBe(12)
  })

  it('默认 6H（metric 内螺纹）', async () => {
    const tapped = await drill(block(), { holeType: 'tapped', screwSpecIdx: 5, depth: 10 })
    expect(pmiThreads(tapped)[0]!.thread.toleranceClass).toBe('6H')
    expect(pmiThreads(tapped)[0]!.thread.depth).toBe(10)
  })

  it('threadDepth / threadClass 走 op 入参（直写实参，不经 helper 展开）', async () => {
    const tapped = (await fai_drill(block(), {
      position: [0, 0, 10],
      direction: 'z',
      holeType: 'tapped',
      screwSpecIdx: 5,
      depth: 16,
      threadDepth: 11,
      threadClass: '7H',
    })) as Shape
    const item = pmiThreads(tapped)[0]!
    expect(item.thread.depth).toBe(11)
    expect(item.thread.toleranceClass).toBe('7H')
    expect(item.label).toBe('M6-7H ↓11（底孔 Φ5 ↓16，攻丝）')
  })

  it('多次钻孔后标注累积（第二孔不冲掉第一孔）', async () => {
    let p = block()
    p = await drill(p, { position: [-8, 0, 10], holeType: 'tapped', screwSpecIdx: 5, depth: 12, threadDepth: 9 })
    p = await drill(p, { position: [0, 0, 10], holeType: 'tapped', screwSpecIdx: 5, depth: 12, threadDepth: 9 })
    p = await drill(p, { position: [8, 0, 10], holeType: 'tapped', screwSpecIdx: 5, depth: 12, threadDepth: 9 })
    const items = pmiThreads(p)
    expect(items).toHaveLength(3)
    expect(items.map((i) => i.axis.origin[0])).toEqual([-8, 0, 8])
  })

  it('simple 孔不产出螺纹标注', async () => {
    const plain = await drill(block(), { diameter: 5, depth: 10, holeType: 'simple' })
    expect(pmiThreads(plain)).toHaveLength(0)
  })
})

/**
 * 方向定号：`direction:'normal'` 给的是**面外法向**（指向空腔），几何链内部按
 * 「朝向材料内部」取反，PMI 必须记同一支向量——否则标注说"孔朝外"、几何朝内。
 * 历史缺陷：底面开孔（面法向 −Z）时 PMI 记成 −Z，而孔实际往 +Z 钻进法兰。
 */
describe('fai_drill — 方向定号：几何与 PMI 用同一支向量', () => {
  /** 从块底面 (z=-10) 开孔：面外法向 −Z，`'normal'` 即"沿法向进入材料"= +Z。 */
  async function fromBottom(params: Record<string, unknown>): Promise<Shape> {
    return (await fai_drill(block(), {
      position: [0, 0, -10], faceNormal: [0, 0, -1], direction: 'normal', ...params,
    })) as Shape
  }

  it('底面 normal 孔真的往 +Z 钻：切除体积 ≈ 圆柱体积', async () => {
    const solid = await fromBottom({ diameter: 3.3, depth: 8, holeType: 'simple' })
    const removed = volumeOf(block()) - volumeOf(solid)
    const cylinder = Math.PI * (3.3 / 2) ** 2 * 8
    // 若方向定号错（钻到 z<-10 的空气里），removed ≈ 0
    expect(removed / cylinder).toBeGreaterThan(0.98)
    expect(removed / cylinder).toBeLessThan(1.02)
  })

  it('底面 normal 的 PMI 轴向 = +Z（与几何一致）', async () => {
    const tapped = await fromBottom({ depth: 8, holeType: 'tapped', screwSpecIdx: 5, threadDepth: 6 })
    const item = pmiThreads(tapped)[0]!
    expect(item.axis.origin).toEqual([0, 0, -10])
    expect(item.axis.direction).toEqual([0, 0, 1])
  })

  it('顶面默认法向 + normal 仍向下钻（既有行为不变）', async () => {
    const tapped = await fai_drill(block(), {
      position: [0, 0, 10], direction: 'normal', depth: 8, holeType: 'tapped', screwSpecIdx: 5, threadDepth: 6,
    }) as Shape
    expect(pmiThreads(tapped)[0]!.axis.direction).toEqual([0, 0, -1])
  })
})
