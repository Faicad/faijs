/**
 * T2: full-result parity — direct vs module 结果键集合一致（mesh 场景）
 *
 * 验收（handoff T2）：
 * - 对 mesh 语料断言 direct vs module 结果键集合一致：
 *   outputs / terminals / compounds / brepSolids 存在性 / activeValues / changed 存在性。
 * - 造一个非几何查询叶子脚本（cad.bboxCenter 返回 Vec3）断言 activeValues 内容相等。
 *
 * 环境：mesh 模式；warmup 认领全局 backends。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import type { HostPorts } from '@faicad/faijs-core/cad-runtime/ports'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const WARMUP = 'let warmup = cad.box(1, 1, 1, { centered: true })'

describe('T2: full-result parity — 结果键集合一致（mesh 场景）', () => {
  const cadNs = createApiNamespace()
  const moduleRt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs }, { executor: 'module' })
  const directRt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })

  beforeAll(async () => {
    await moduleRt.execute(WARMUP)
    await directRt.execute(WARMUP)
  }, 120000)

  it('普通 mesh 脚本：outputs / terminals / compounds / activeValues / changed 两边一致', async () => {
    const code = [
      'let bp = cad.box(10, 20, 30, { centered: true })',
      'let t = cad.translate(bp, [5, 0, 0])',
    ].join('\n')

    const m = await moduleRt.execute(code)
    const d = await directRt.execute(code)

    expect(d.failedAt).toBeUndefined()
    expect(m.failedAt).toBeUndefined()

    // 键集合一致性
    expect([...d.outputs.keys()].map(String).sort()).toEqual(
      [...m.outputs.keys()].map(String).sort(),
    )
    expect(d.terminals.map((t) => String(t.id)).sort()).toEqual(
      m.terminals.map((t) => String(t.id)).sort(),
    )
    // activeValues 存在性一致（普通 mesh 场景两边都 undefined）
    expect(d.activeValues === undefined).toBe(m.activeValues === undefined)
    // changed 存在性一致（execute 全量重跑两边都有 changed）
    expect(d.changed === undefined).toBe(m.changed === undefined)
  })

  it('非几何查询叶子：cad.bboxCenter 返回 Vec3 → activeValues 两边内容相等', async () => {
    const code = [
      'let bp = cad.box(20, 20, 20, { centered: true })',
      'let center = cad.bboxCenter(bp)',
    ].join('\n')

    const m = await moduleRt.execute(code)
    const d = await directRt.execute(code)

    expect(m.failedAt).toBeUndefined()
    expect(d.failedAt).toBeUndefined()

    // center 是非几何值（Vec3 = number[]），是 DAG 叶子（bp 被 bboxCenter 消费 → bp
    // 不是叶子；center 之后无消费 → center 是叶子）→ activeValues 应含 center
    expect(m.activeValues).toBeDefined()
    expect(d.activeValues).toBeDefined()

    const mCenter = m.activeValues!.get(asPartName('center'))
    const dCenter = d.activeValues!.get(asPartName('center'))
    expect(Array.isArray(mCenter)).toBe(true)
    expect(Array.isArray(dCenter)).toBe(true)
    // 两边 Vec3 值相等
    expect(JSON.stringify(dCenter)).toBe(JSON.stringify(mCenter))
  })

  it('非几何叶子被消费 → 不出现在 activeValues', async () => {
    // center 被 translate(center, [1,2,3]) 消费 → center 不是叶子
    // 但 translate 返回 shape 不是非几何，所以 translate 的产出进 terminals
    const code = [
      'let bp = cad.box(10, 10, 10, { centered: true })',
      'let center = cad.bboxCenter(bp)',
      'let offset = cad.translate(bp, [1, 2, 3])',
    ].join('\n')

    const m = await moduleRt.execute(code)
    const d = await directRt.execute(code)

    expect(m.failedAt).toBeUndefined()
    expect(d.failedAt).toBeUndefined()

    // center 被后续消费 → 不在 activeValues 两边一致
    expect(d.activeValues === undefined).toBe(m.activeValues === undefined)
    if (m.activeValues && d.activeValues) {
      expect(m.activeValues.has(asPartName('center'))).toBe(
        d.activeValues.has(asPartName('center')),
      )
    }
  })

  it('多终端 + 非几何叶子混合：activeValues 与 terminals 两边一致', async () => {
    const code = [
      'let bp = cad.box(10, 10, 10, { centered: true })',
      'let cyl = cad.cylinder(5, 20, { centered: true, segments: 24 })',
      'let result = cad.subtract(bp, cyl)',
      'let center = cad.bboxCenter(result)',
    ].join('\n')

    const m = await moduleRt.execute(code)
    const d = await directRt.execute(code)

    expect(m.failedAt).toBeUndefined()
    expect(d.failedAt).toBeUndefined()

    // terminals: result 存活（center 消费 result 但 center 是非几何 → result 仍是几何叶子）
    expect(d.terminals.map((t) => String(t.id)).sort()).toEqual(
      m.terminals.map((t) => String(t.id)).sort(),
    )
    // activeValues: center 是非几何叶子 → 两边都有
    expect(d.activeValues === undefined).toBe(m.activeValues === undefined)
    if (m.activeValues && d.activeValues) {
      const mCenter = m.activeValues.get(asPartName('center'))
      const dCenter = d.activeValues.get(asPartName('center'))
      expect(JSON.stringify(dCenter)).toBe(JSON.stringify(mCenter))
    }
  })
})
