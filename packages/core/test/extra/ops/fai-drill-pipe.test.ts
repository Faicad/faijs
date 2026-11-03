/**
 * ops/fai_drill — `screwSystem:'pipe'`（55° 锥管螺纹 PT/R/BSPT）行为验证。
 *
 * 钉住的四条不变量：
 * 1. **`tapped` + pipe 的几何与同参数 `simple` 逐项相同**——攻丝孔只钻底孔，
 *    螺纹（PT1/8）不进实体几何，与 M3/M4 完全同形；
 * 2. **PMI 一条含两类信息**，且 `standard:'pipe'`、`specLabel:'PT1/8'`、
 *    公称直径取基准平面大径 9.728、螺距 0.907——不是 NPT 的 10.242；
 * 3. **底孔缺省取表内标准攻丝底孔 8.4**（不是「大径 − 螺距」= 8.82），
 *    但显式 `diameter`（图纸值）优先；
 * 4. **`holeType:'screw'` + pipe 直接报错**——锥管牙型未实现，静默降级比报错危险。
 *
 * 运行：npx vitest run test/extra/ops/fai-drill-pipe.test.ts
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
import { formatThreadSpec } from '../../../src/api/pmi/text'
import { getPipeSpec, PIPE_SPECS } from '../../../src/primitives/screw/screw-db'

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

/** 40×40×20 的块（z ∈ [-10, 10]）。 */
function block(): Shape {
  const h = kernel.makeBox(40, 40, 20)
  return fromBrep(solidToShape(kernel, h), { solid: h })
}

function volumeOf(shape: Shape): number {
  return kernel.getVolume(brepOf(shape) as BrepHandle)
}

function faceCountOf(shape: Shape): number {
  return kernel.getSubShapes(brepOf(shape) as BrepHandle, 'face').length
}

/** 从上表面 (z=+10) 沿 -Z 钻一个盲孔。 */
async function drill(shape: Shape, params: Record<string, unknown>): Promise<Shape> {
  return (await fai_drill(shape, { position: [0, 0, 10], direction: 'z', ...params })) as Shape
}

describe('PIPE_SPECS — 55° 锥管螺纹表（ISO 7-1 / JIS B 0203）', () => {
  it('PT1/8 的基准平面大径与螺距是 9.728 / 0.907（不是 NPT 的 10.242）', () => {
    expect(getPipeSpec(0)).toMatchObject({ majorDia: 9.728, pitch: 0.907, label: 'PT1/8' })
  })

  it('索引越界夹取到合法区间（与 getScrewSpec 同口径）', () => {
    expect(getPipeSpec(-5)).toEqual(PIPE_SPECS[0])
    expect(getPipeSpec(99)).toEqual(PIPE_SPECS[PIPE_SPECS.length - 1])
  })

  it('标准攻丝底孔是表值，不等于「大径 − 螺距」', () => {
    const pt18 = getPipeSpec(0)
    expect(pt18.pilotDia).toBe(8.4)
    // 「大径 − 螺距」只是近似（8.821），表值才是 Rc 标准底孔
    expect(Math.round((pt18.majorDia - pt18.pitch) * 1000) / 1000).not.toBe(pt18.pilotDia)
  })
})

describe('fai_drill — pipe 的几何只有底孔（与 simple 同形）', () => {
  it('tapped+pipe 与同参数 simple 的几何完全一致（体积/面数）', async () => {
    const plain = await drill(block(), { diameter: 8.8, depth: 20, holeType: 'simple' })
    const pipe = await drill(block(), {
      diameter: 8.8, depth: 20, holeType: 'tapped', screwSystem: 'pipe', screwSpecIdx: 0,
    })
    expect(volumeOf(pipe)).toBeCloseTo(volumeOf(plain), 6)
    expect(faceCountOf(pipe)).toBe(faceCountOf(plain))
  })
})

describe('fai_drill — pipe 的 PMI 一条含两类信息', () => {
  it('standard=pipe、公称直径取基准平面大径、标签 PT1/8', async () => {
    const part = await drill(block(), {
      diameter: 8.8, depth: 20, holeType: 'tapped', screwSystem: 'pipe', screwSpecIdx: 0,
      threadDepth: 20, threadClass: '6H',
    })
    const items = pmiThreads(part)
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.pilot).toEqual({ diameter: 8.8, depth: 20 })
    expect(item.thread.standard).toBe('pipe')
    expect(item.thread.nominalDiameter).toBe(9.728)
    expect(item.thread.pitch).toBe(0.907)
    expect(item.thread.specLabel).toBe('PT1/8')
    expect(item.thread.toleranceClass).toBe('6H')
    expect(item.thread.depth).toBe(20)
    expect(item.process).toBe('tapped')
    expect(item.label).toBe('PT1/8-6H ↓20（底孔 Φ8.8 ↓20，攻丝）')
  })

  it('diameter 省略时取表内标准攻丝底孔 8.4（不是大径 − 螺距的 8.821）', async () => {
    const part = await drill(block(), {
      depth: 16, holeType: 'tapped', screwSystem: 'pipe', screwSpecIdx: 0,
    })
    expect(pmiThreads(part)[0]!.pilot.diameter).toBe(8.4)
  })

  it('无 threadClass 时不冒用 metric 的 6H', async () => {
    const part = await drill(block(), {
      diameter: 8.8, depth: 20, holeType: 'tapped', screwSystem: 'pipe', screwSpecIdx: 0,
    })
    const item = pmiThreads(part)[0]!
    expect(item.thread.toleranceClass).toBeUndefined()
    expect(item.label).toBe('PT1/8 ↓20（底孔 Φ8.8 ↓20，攻丝）')
  })

  it('pipe 缺 specLabel 时不冒充 G 代号（退回直径数值）', () => {
    expect(formatThreadSpec({ standard: 'pipe', nominalDiameter: 9.728, depth: 20 })).toBe('9.728')
  })
})

describe('fai_drill — screw + pipe 直接报错', () => {
  it('holeType:screw 需要建模锥管牙，未实现 → 抛错而不是静默按 imperial 查表', async () => {
    await expect(drill(block(), {
      diameter: 8.8, depth: 10, holeType: 'screw', screwSystem: 'pipe', screwSpecIdx: 0,
    })).rejects.toThrow(/管螺纹/)
  })
})
