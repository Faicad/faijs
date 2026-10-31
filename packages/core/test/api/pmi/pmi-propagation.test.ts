/**
 * PMI 跨 op 存活 —— 标注一旦加上就一直在，几何怎么变都不丢。
 *
 * 规则（2026-10-31 用户定）：**pmi 数据有了就一直在，不能丢，也不需要因为
 * 几何变更而拷贝或其他处理**。
 *
 * 实现落点：`api/pmi/registry.ts` 按零件名存标注，查询时沿血缘图聚合。几何 op
 * 既不需要继承也不需要拦截——产物 Shape 上根本没有 `pmi` 字段，但
 * `pmiOf(product)` 能把上游的标注都回溯出来。
 *
 * 引用不会失效的原因：`TopoRef.origin` 是语句级因果坐标（`StmtId`），
 * `resolveViaLineage` 沿血缘回走到当前 part 重算 hash。
 *
 * 运行：npx vitest run test/api/pmi/pmi-propagation.test.ts
 */

// ─── OCCT stdout 噪声过滤 ───
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
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'
import { hostPorts } from '../../support/host-env'
import type { PmiItem, PmiThreadHole } from '../../../src/api/pmi/types'
import type { Shape } from '../../../src/mesh/types'
import type { ShapePmiMethods } from '../../../src/api/pmi/methods'
import { projectViewSvg } from '../../../src/api/view/view-projection'

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
}, 120000)

function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(hostPorts('node'), 'brep', { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

/** 从执行结果的 PMI 行里取某个零件的标注。 */
function pmiOfPart(r: ExecutionResult, part: string): readonly PmiItem[] {
  return r.pmi?.find((e) => e.part === part)?.items ?? []
}

function kindsOf(items: readonly PmiItem[]): string[] {
  return items.map((i) => i.kind)
}

/** 钻一个 M6 攻丝孔（建模即标注：同一语句产出 threadHole）。 */
const TAP = (pos: string): string =>
  `part0 = cad.fai_drill(part0, { position: ${pos}, direction: 'z', holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })`

describe('标注之后继续建模 — 标注不丢', () => {
  it('translate 之后 datum 仍在', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
part0.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(part0, 5) })
part0 = cad.translate(part0, { offset: [10, 0, 0] })
`)
    expect(r.failedAt).toBeUndefined()
    expect(kindsOf(pmiOfPart(r, 'part0'))).toEqual(['datum'])
  })

  it('fillet 之后 datum 仍在（面只是被切角，身份不变）', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
part0.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(part0, 5) })
part0 = cad.fillet(part0, { edges: [cad.edgeRef(part0, 1)], radius: 2 })
`)
    expect(r.failedAt).toBeUndefined()
    expect(kindsOf(pmiOfPart(r, 'part0'))).toEqual(['datum'])
  })

  it('union 之后两侧标注都在', async () => {
    const r = await exec(`
let a = cad.box(40, 40, 20)
a.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(a, 5) })
let b = cad.box(20, 20, 40)
b.addSurfaceFinish({ target: cad.faceRef(b, 5), parameter: 'Ra', value: 3.2 })
let c = cad.union(a, b)
`)
    expect(r.failedAt).toBeUndefined()
    expect(kindsOf(pmiOfPart(r, 'c')).sort()).toEqual(['datum', 'surfaceFinish'])
  })

  it('链式多 op（translate → fillet → union）之后全在', async () => {
    const r = await exec(`
let a = cad.box(40, 40, 20)
a.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(a, 5) })
a.addNote({ text: '未注公差按 GB/T 1804-m' })
a = cad.translate(a, { offset: [5, 0, 0] })
a = cad.fillet(a, { edges: [cad.edgeRef(a, 1)], radius: 2 })
let b = cad.box(10, 10, 10)
let c = cad.union(a, b)
`)
    expect(r.failedAt).toBeUndefined()
    expect(kindsOf(pmiOfPart(r, 'c')).sort()).toEqual(['datum', 'note'])
  })
})

describe('钻孔与倒角的顺序自由（用户指出的核心场景）', () => {
  it('fai_drill(tapped) 之后再 fillet 不报错，threadHole 仍在', async () => {
    const r = await exec(`
let part0 = cad.box(60, 60, 20)
${TAP('[15, 15, 20]')}
part0 = cad.fillet(part0, { edges: [cad.edgeRef(part0, 1)], radius: 3 })
`)
    expect(r.failedAt).toBeUndefined()
    const taps = pmiOfPart(r, 'part0').filter((i) => i.kind === 'threadHole') as PmiThreadHole[]
    expect(taps).toHaveLength(1)
    expect(taps[0]!.axis.origin).toEqual([15, 15, 20])
  })

  it('先倒角后钻孔也成立（顺序可反）', async () => {
    const r = await exec(`
let part0 = cad.box(60, 60, 20)
part0 = cad.fillet(part0, { edges: [cad.edgeRef(part0, 1)], radius: 3 })
${TAP('[15, 15, 20]')}
`)
    expect(r.failedAt).toBeUndefined()
    expect(kindsOf(pmiOfPart(r, 'part0'))).toEqual(['threadHole'])
  })

  it('连续钻两个攻丝孔，两条标注都累积', async () => {
    const r = await exec(`
let part0 = cad.box(60, 60, 20)
${TAP('[15, 15, 20]')}
${TAP('[45, 45, 20]')}
`)
    expect(r.failedAt).toBeUndefined()
    const taps = pmiOfPart(r, 'part0').filter((i) => i.kind === 'threadHole') as PmiThreadHole[]
    expect(taps).toHaveLength(2)
    expect(taps.map((t) => t.axis.origin)).toEqual([
      [15, 15, 20],
      [45, 45, 20],
    ])
  })

  it('攻丝之后 union 也不报错，标注跟着主体走', async () => {
    const r = await exec(`
let part0 = cad.box(60, 60, 20)
${TAP('[15, 15, 20]')}
let extra = cad.box(10, 10, 10)
part0 = cad.union(part0, extra)
`)
    expect(r.failedAt).toBeUndefined()
    expect(kindsOf(pmiOfPart(r, 'part0'))).toEqual(['threadHole'])
  })
})

describe('subtract — 被减掉那侧不跟过来', () => {
  it('主体标注保留，且不因 B 侧未标注而减少', async () => {
    const r = await exec(`
let a = cad.box(40, 40, 20)
a.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(a, 5) })
let b = cad.box(10, 10, 10)
let c = cad.subtract(a, b)
`)
    expect(r.failedAt).toBeUndefined()
    expect(kindsOf(pmiOfPart(r, 'c'))).toEqual(['datum'])
  })
})

describe('逐零件隔离 — 标注不串到无关零件', () => {
  it('独立新建的零件看不到别人的标注', async () => {
    const r = await exec(`
let a = cad.box(40, 40, 20)
a.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(a, 5) })
let b = cad.box(10, 10, 10)
`)
    expect(kindsOf(pmiOfPart(r, 'a'))).toEqual(['datum'])
    expect(pmiOfPart(r, 'b')).toEqual([])
  })
})

describe('clearPmi — 清空并砍断上游继承', () => {
  it('clearPmi() 之后聚合为空', async () => {
    const r = await exec(`
let a = cad.box(40, 40, 20)
a.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(a, 5) })
let b = cad.translate(a, { offset: [5, 0, 0] })
b.clearPmi()
`)
    expect(r.failedAt).toBeUndefined()
    expect(pmiOfPart(r, 'b')).toEqual([])
  })

  it('clearPmi() 之后重新标注，只看到新的', async () => {
    const r = await exec(`
let a = cad.box(40, 40, 20)
a.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(a, 5) })
a.addNote({ text: '旧注释' })
a.clearPmi()
a.addNote({ text: '新注释' })
`)
    const items = pmiOfPart(r, 'a')
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('note')
  })
})

describe('getPmi() 与渲染 — 读的都是聚合结果', () => {
  it('getPmi() 在 op 产物上返回继承来的标注', async () => {
    const r = await exec(`
let a = cad.box(40, 40, 20)
a.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(a, 5) })
let b = cad.translate(a, { offset: [5, 0, 0] })
`)
    expect(r.failedAt).toBeUndefined()
    const b = r.outputs.get('b' as never) as never as Shape & ShapePmiMethods
    expect(b.getPmi().items).toHaveLength(1)
  })

  it('projectView 在 op 产物上渲染出继承来的标注', async () => {
    const r = await exec(`
let a = cad.box(40, 40, 20)
a.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceRef(a, 5) })
let b = cad.translate(a, { offset: [100, 0, 0] })
`)
    expect(r.failedAt).toBeUndefined()
    const b = r.outputs.get('b' as never) as never as Shape
    const out = projectViewSvg(b, 'front')
    expect(out.pmi?.count).toBe(1)
    expect(out.svg).toContain('data-layer="pmi"')
    expect(out.svg).toContain('datum-box')
    // 零件平移到 x∈[99,141]，标注必须跟着走（不是留在原点）
    expect(out.svg).toMatch(/viewBox="9[0-9]/)
  })
})
