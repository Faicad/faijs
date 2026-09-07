/**
 * T2/T5: full-result — direct 执行结果验证（module 路径已删除）
 *
 * T5 后：不再做 direct vs module 对拍。
 * 改为 direct-only 行为验证：outputs/terminals/compounds/activeValues/
 * changed 在 mesh 场景下正确产出。
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

describe('T2/T5: full-result direct 执行 — 结果键集合验证（mesh 场景）', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })

  beforeAll(async () => {
    await rt.execute(WARMUP)
  }, 120000)

  it('普通 mesh 脚本：outputs / terminals / compounds 正确产出', async () => {
    const code = [
      'let bp = cad.box(10, 20, 30, { centered: true })',
      'let t = cad.translate(bp, [5, 0, 0])',
    ].join('\n')

    const result = await rt.execute(code)

    expect(result.failedAt).toBeUndefined()

    // outputs 含 bp 和 t
    expect([...result.outputs.keys()].map(String).sort()).toEqual(['bp', 't'])
    // terminals: bp 被 translate 消费 → 只剩 t
    expect(result.terminals.map((t) => String(t.id)).sort()).toEqual(['t'])
    // compounds: 普通 mesh 无 compound
    expect(result.compounds === undefined || result.compounds.size === 0).toBe(true)
  })

  it('非几何查询叶子：cad.bboxCenter 返回 Vec3 → activeValues 含非几何叶子', async () => {
    const code = [
      'let bp = cad.box(20, 20, 20, { centered: true })',
      'let center = cad.bboxCenter(bp)',
    ].join('\n')

    const result = await rt.execute(code)

    expect(result.failedAt).toBeUndefined()

    // center 是非几何值（Vec3 = number[]），是 DAG 叶子（bp 被 bboxCenter 消费 → bp
    // 不是叶子；center 之后无消费 → center 是叶子）→ activeValues 应含 center
    expect(result.activeValues).toBeDefined()

    const center = result.activeValues!.get(asPartName('center'))
    expect(Array.isArray(center)).toBe(true)
  })

  it('非几何叶子未被消费 → 出现在 activeValues', async () => {
    // center = bboxCenter(bp) is a non-geometric leaf (Vec3).
    // translate(bp, ...) consumes bp (a shape), not center.
    // center has no downstream consumer → it IS a leaf → appears in activeValues.
    const code = [
      'let bp = cad.box(10, 10, 10, { centered: true })',
      'let center = cad.bboxCenter(bp)',
      'let offset = cad.translate(bp, [1, 2, 3])',
    ].join('\n')

    const result = await rt.execute(code)

    expect(result.failedAt).toBeUndefined()

    // center is a non-geometric leaf → should be in activeValues
    expect(result.activeValues).toBeDefined()
    if (result.activeValues) {
      expect(result.activeValues.has(asPartName('center'))).toBe(true)
    }
  })

  it('多终端 + 非几何叶子混合：activeValues 与 terminals 正确', async () => {
    const code = [
      'let bp = cad.box(10, 10, 10, { centered: true })',
      'let cyl = cad.cylinder(5, 20, { centered: true, segments: 24 })',
      'let result = cad.subtract(bp, cyl)',
      'let center = cad.bboxCenter(result)',
    ].join('\n')

    const result = await rt.execute(code)

    expect(result.failedAt).toBeUndefined()

    // terminals: subtract 的 mesh 实现调用了 keepHidden(bp, cyl) →
    // bp/cyl 保留为终端（hidden=true），result 也是终端。
    // center 是非几何叶子 → 不进 terminals。
    const termIds = result.terminals.map((t) => String(t.id)).sort()
    expect(termIds).toContain('result')
    expect(termIds).toContain('bp')
    expect(termIds).toContain('cyl')

    // activeValues: center 是非几何叶子 → 应存在
    expect(result.activeValues).toBeDefined()
    if (result.activeValues) {
      const center = result.activeValues.get(asPartName('center'))
      expect(center).toBeDefined()
    }
  })
})
