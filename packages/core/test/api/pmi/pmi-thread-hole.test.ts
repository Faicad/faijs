/**
 * 螺纹孔 PMI（PmiThreadHole）—— 数据模型 / 显示文本 / 查询 / 传播。
 *
 * 钉住的核心契约：
 * 1. 一条 `PmiThreadHole` **同时**承载底孔（原始几何）与螺纹（后加工攻丝），
 *    两者不是两个条目（用户要求："它们是整体"）。
 * 2. `formatThreadHole` 把两类信息一次显示出来。
 * 3. `carryPmi` 让多孔场景不互相覆盖（第二个孔不会冲掉第一个孔的标注）。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-thread-and-technotes-design.md §3
 */

import { describe, it, expect } from 'vitest'
import { solid, type SolidShape } from '../../../src/shape'
import { attachPmiMethods, appendPmiItem } from '../../../src/api/pmi/methods'
import { pmiItems, pmiOn, pmiThreads } from '../../../src/api/pmi/query'
import { threadHole, type PmiThreadHole } from '../../../src/api/pmi/types'
import { formatThreadHole, formatThreadSpec } from '../../../src/api/pmi/text'
import SYMBOL_TABLE from '../../../src/lang/symbol-table.generated'
import type { FaceTopoRef } from '../../../src/topology/naming/types'

// ── fixtures ──

function makeShape(): SolidShape {
  return solid({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })
}

/** M6-6H ↓14 攻丝，底孔 Φ5 ↓16（用户给的样例）。 */
function tappedM6(overrides: Partial<Omit<PmiThreadHole, 'kind'>> = {}): PmiThreadHole {
  return threadHole({
    thread: {
      standard: 'metric',
      nominalDiameter: 6,
      pitch: 1,
      toleranceClass: '6H',
      depth: 14,
      specLabel: 'M6',
    },
    pilot: { diameter: 5, depth: 16 },
    axis: { origin: [10, 10, 30], direction: [0, 0, -1] },
    process: 'tapped',
    ...overrides,
  })
}

const holeWall: FaceTopoRef = {
  kind: 'face',
  origin: 's7' as never,
  role: 'hole:0',
  hint: { kind: 'face', surfaceType: 'cylinder', normal: [0, 0, 1] },
}

describe('PmiThreadHole — 一条标注两类信息', () => {
  it('工厂只补 kind，两组信息原样保留', () => {
    const item = tappedM6()
    expect(item.kind).toBe('threadHole')
    expect(item.pilot).toEqual({ diameter: 5, depth: 16 })
    expect(item.thread.nominalDiameter).toBe(6)
    expect(item.thread.toleranceClass).toBe('6H')
    expect(item.thread.depth).toBe(14)
    expect(item.process).toBe('tapped')
  })

  it('全部可选字段（count / target / label）都写上时原样保留', () => {
    // 直写字面量（不走 fixture 覆盖）——也是 API 覆盖门禁的 L2 调用点。
    const item = threadHole({
      thread: { standard: 'metric', nominalDiameter: 6, pitch: 1, toleranceClass: '6H', depth: 14, specLabel: 'M6' },
      pilot: { diameter: 5, depth: 16, drillPointAngle: 118 },
      axis: { origin: [0, 0, 10], direction: [0, 0, -1] },
      process: 'tapped',
      count: 4,
      target: holeWall,
      label: '4×M6-6H ↓14（底孔 Φ5 ↓16，攻丝）',
    })
    expect(item.count).toBe(4)
    expect(item.target).toBe(holeWall)
    expect(item.label).toBe('4×M6-6H ↓14（底孔 Φ5 ↓16，攻丝）')
    expect(formatThreadHole(item)).toBe('4×M6-6H ↓14（底孔 Φ5 ↓16，攻丝）')
    expect(item.pilot.drillPointAngle).toBe(118)
  })

  it('JSON 往返不丢任何一组', () => {
    const round = JSON.parse(JSON.stringify(tappedM6())) as PmiThreadHole
    expect(round).toEqual(tappedM6())
  })

  it('Shape 实例方法 addThreadHole 可链式挂载', () => {
    const s = makeShape() as SolidShape & ReturnType<typeof attachPmiMethods>
    const ret = s.addThreadHole({ ...tappedM6() } as Omit<PmiThreadHole, 'kind'>)
    expect(ret).toBe(s)
    expect(pmiThreads(s)).toHaveLength(1)
    expect(pmiThreads(s)[0]!.pilot.diameter).toBe(5)
  })
})

describe('formatThreadHole — 底孔 + 螺纹一起显示', () => {
  it('攻丝孔：螺纹与底孔同时出现', () => {
    expect(formatThreadHole(tappedM6())).toBe('M6-6H ↓14（底孔 Φ5 ↓16，攻丝）')
  })

  it('数量前缀', () => {
    expect(formatThreadHole(tappedM6({ count: 4 }))).toBe('4×M6-6H ↓14（底孔 Φ5 ↓16，攻丝）')
  })

  it('无公差等级时不显示连字符', () => {
    const item = threadHole({
      thread: { standard: 'metric', nominalDiameter: 8, depth: 20, specLabel: 'M8' },
      pilot: { diameter: 6.8, depth: 22 },
      axis: { origin: [0, 0, 0], direction: [0, 0, -1] },
      process: 'tapped',
    })
    expect(formatThreadHole(item)).toBe('M8 ↓20（底孔 Φ6.8 ↓22，攻丝）')
  })

  it('建模螺纹：不写底孔组，改标"实体螺纹"', () => {
    const item = threadHole({
      thread: { standard: 'metric', nominalDiameter: 6, pitch: 1, depth: 10, specLabel: 'M6' },
      pilot: { diameter: 6, depth: 10 },
      axis: { origin: [0, 0, 0], direction: [0, 0, -1] },
      process: 'modeled',
    })
    expect(formatThreadHole(item)).toBe('M6 ↓10（实体螺纹）')
  })

  it('左旋标记', () => {
    const item = tappedM6({
      thread: {
        standard: 'metric', nominalDiameter: 6, toleranceClass: '6H',
        depth: 12, handedness: 'left', specLabel: 'M6',
      },
    })
    expect(formatThreadHole(item)).toBe('M6-6H ↓12 LH（底孔 Φ5 ↓16，攻丝）')
  })

  it('通孔（depth=0）写作"通"，不写 ↓0', () => {
    const item = threadHole({
      thread: { standard: 'metric', nominalDiameter: 6, toleranceClass: '6H', depth: 0, specLabel: 'M6' },
      pilot: { diameter: 5, depth: 0 },
      axis: { origin: [0, 0, 0], direction: [0, 0, -1] },
      process: 'tapped',
    })
    expect(formatThreadHole(item)).toBe('M6-6H 通（底孔 Φ5 通，攻丝）')
  })

  it('formatThreadSpec：标签优先，细牙由标签表达（不自动拼螺距），管螺纹不冒充 G 代号', () => {
    expect(formatThreadSpec({ standard: 'metric', nominalDiameter: 6, depth: 10, specLabel: 'M6' })).toBe('M6')
    expect(formatThreadSpec({ standard: 'metric', nominalDiameter: 8, pitch: 1, depth: 10, specLabel: 'M8×1' })).toBe('M8×1')
    // 管螺纹的规格号是 1/8" 这类**代号**，与基准平面大径没有换算关系：
    // 拿大径硬拼会得到 'G9.728' 这种查不到的写法，所以缺 specLabel 时只如实给直径数值
    // （同口径见 test/extra/ops/fai-drill-pipe.test.ts「pipe 缺 specLabel 时不冒充 G 代号」）。
    expect(formatThreadSpec({ standard: 'pipe', nominalDiameter: 12.7, pitch: 1.814, depth: 10 })).toBe('12.7')
    expect(formatThreadSpec({ standard: 'pipe', nominalDiameter: 9.728, pitch: 0.907, depth: 10, specLabel: 'PT1/8' })).toBe('PT1/8')
  })
})

describe('查询：threadHole 与既有类型并存', () => {
  it('pmiItems 按 kind 过滤，pmiThreads 是精确类型封装', () => {
    const s = makeShape() as SolidShape & ReturnType<typeof attachPmiMethods>
    s.addGeneralNote({ items: [{ text: '未注公差按 GB/T 1804-m' }] })
    s.addThreadHole({ ...tappedM6() } as Omit<PmiThreadHole, 'kind'>)
    expect(pmiItems(s)).toHaveLength(2)
    expect(pmiItems(s, { kind: 'threadHole' })).toHaveLength(1)
    expect(pmiThreads(s)[0]!.kind).toBe('threadHole')
  })

  it('pmiOn 能按 target 命中（BREP 链的面引用）', () => {
    const s = makeShape() as SolidShape & ReturnType<typeof attachPmiMethods>
    s.addThreadHole({ ...tappedM6({ target: holeWall }) } as Omit<PmiThreadHole, 'kind'>)
    expect(pmiOn(s, holeWall)).toHaveLength(1)
  })

  it('mesh 链没有 target 时 pmiOn 不误命中，但 axis 仍在', () => {
    const s = makeShape() as SolidShape & ReturnType<typeof attachPmiMethods>
    s.addThreadHole({ ...tappedM6() } as Omit<PmiThreadHole, 'kind'>)
    expect(pmiOn(s, holeWall)).toHaveLength(0)
    expect(pmiThreads(s)[0]!.axis.origin).toEqual([10, 10, 30])
  })
})

describe('同一零件多次标注 — 累积不覆盖', () => {
  it('连续追加两条，条目按时间累积', () => {
    const s = makeShape()
    appendPmiItem(s, tappedM6())
    appendPmiItem(s, tappedM6({ axis: { origin: [20, 10, 30], direction: [0, 0, -1] } }))
    const items = pmiThreads(s)
    expect(items).toHaveLength(2)
    expect(items[1]!.axis.origin).toEqual([20, 10, 30])
  })
})

describe('cad 命名空间与符号表', () => {
  it('pmiThreads / formatThreadHole 进符号表（check() 认得出）', () => {
    expect(SYMBOL_TABLE).toHaveProperty('pmiThreads')
    expect(SYMBOL_TABLE).toHaveProperty('formatThreadHole')
    expect(SYMBOL_TABLE).toHaveProperty('pmiItems')
  })
})
