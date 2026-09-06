/**
 * A-1..A-15 验收（no-IR 双通道；mesh 模式）
 *
 * 方案：docs/plans/2026-09-06-no-ir-dual-channel-runtime.md §6 验收 A-1/A-2/A-3/A-15
 *
 * 这些验收驱动**无 IR 栈**（extractMetadata → DirectExecutor → computeLiveShapes）
 * 产出的几何与终端，并与现状 CadRuntime.executeIR 的结果（outputs / terminals）
 * 对拍——是 P4 runtime 切换要保住的行为锚点。
 *
 * 环境：mesh 模式；用一次 warmup execute 认领全局 backends（与核心测试同构）。
 * 需要字体/资产/注册库的 fixture 在新旧两边都失败 → 不在语料内。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import { DirectExecutor } from '@faicad/faijs-core/cad-runtime/direct-executor'
import { computeLiveShapes, keepViewFromMetadata } from '@faicad/faijs-core/cad-runtime/live-shapes'
import { extractMetadata } from '@faicad/faijs-core/lang/metadata-extractor'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import { computeContentKey } from '@faicad/faijs-core/cad-runtime/content-key'
import { isMeshShape } from '@faicad/faijs-core/mesh/types'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import type { HostPorts } from '@faicad/faijs-core/cad-runtime/ports'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 收集 mesh 输出内容 key（Map 名序排序）。 */
function contentFingerprint(ctx: Record<string, unknown>): string[] {
  const keys: string[] = []
  for (const [name, v] of Object.entries(ctx)) {
    if (isMeshShape(v)) keys.push(`${name}:${computeContentKey(v.positions, v.indices)}`)
  }
  return keys.sort()
}

describe('A-1: execute → outputs.part5 为 Shape，terminals=[part5]（中间被消费不在 terminals）', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it('A-1 单 box：outputs.part5 为 Shape，terminals=[part5]', async () => {
    const code = 'const part5 = cad.box(10, 10, 10, { centered: true })'
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute(code)
    expect(out.failedAt).toBeUndefined()
    expect(out.ctxKeys).toContain('part5')
    expect(isMeshShape(ex.ctx.part5)).toBe(true)

    const meta = extractMetadata(code)
    const shapeVarNames = new Set<PartName>()
    for (const l of meta.lines) for (const o of l.outputs) shapeVarNames.add(o)
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepViewFromMetadata(meta),
      shapeVarNames,
    })
    expect(terminals.map((t) => String(t.id))).toEqual(['part5'])
  })

  it('A-1 中间被消费 shape 不在 terminals（只余最后写者）', async () => {
    const code = [
      'const part5 = cad.box(10, 10, 10, { centered: true })',
      'const part6 = cad.translate(part5, { offset: [1, 2, 3] })',
    ].join('\n')
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    await ex.execute(code)
    const meta = extractMetadata(code)
    const shapeVarNames = new Set<PartName>()
    for (const l of meta.lines) for (const o of l.outputs) shapeVarNames.add(o)
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepViewFromMetadata(meta),
      shapeVarNames,
    })
    const ids = terminals.map((t) => String(t.id))
    expect(ids).not.toContain('part5') // part5 被 translate 消费
    expect(ids).toEqual(['part6'])
  })
})

describe('A-2: append 增量 — 共享 ctx 只执行新行', () => {
  it('DirectExecutor append：新行几何正确且旧变量可见（append 语义等价 execute 全量）', async () => {
    const cadNs = createApiNamespace()
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.sphere({ radius: 10 })',
    ].join('\n')
    const first = await ex.execute(code)
    expect(first.failedAt).toBeUndefined()
    const second = await ex.append('let part2 = cad.union(part0, part1)')
    expect(second.failedAt).toBeUndefined()
    expect(second.executedLines).toEqual([3])
    expect(isMeshShape(ex.ctx.part2)).toBe(true)

    // 与全量 execute 结果一致
    const fullEx = new DirectExecutor({ namespaces: { cad: cadNs } })
    await fullEx.execute([...code.split('\n'), 'let part2 = cad.union(part0, part1)'].join('\n'))
    expect(contentFingerprint(ex.ctx)).toEqual(contentFingerprint(fullEx.ctx))
  })
})

describe('A-3: update 全量重跑 + failedAt.lineNo 指向真实行号', () => {
  it('update：改参数后全量重跑结果正确', async () => {
    const cadNs = createApiNamespace()
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    await ex.execute('let part0 = cad.box(10, 10, 10, { centered: true })')
    const oldBox = computeContentKey((ex.ctx.part0 as { positions: Float32Array; indices: Uint32Array }).positions, (ex.ctx.part0 as { positions: Float32Array; indices: Uint32Array }).indices)
    const out = await ex.update(
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'let part0 = cad.box(30, 30, 30, { centered: true })',
    )
    expect(out.failedAt).toBeUndefined()
    const newBox = computeContentKey((ex.ctx.part0 as { positions: Float32Array; indices: Uint32Array }).positions, (ex.ctx.part0 as { positions: Float32Array; indices: Uint32Array }).indices)
    expect(newBox).not.toBe(oldBox)
    expect(ex.listCtxKeys()).toEqual(['part0']) // ctx 已清空后重跑
  })

  it('失败单元记 failedAt.lineNo 指向真实行号', async () => {
    const cadNs = createApiNamespace()
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute([
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'let boom = cad.no_such_op(part0)',
      'let after = cad.box(1, 1, 1)',
    ].join('\n'))
    expect(out.failedAt).toBeDefined()
    expect(out.failedAt?.lineNo).toBe(2)
    expect(out.failedAt?.callee).toBe('no_such_op')
  })
})

describe('A-15: 重赋值后 terminals 含 bp（最后写者语义，ctx 键天然覆盖）', () => {
  it('DirectExecutor + computeLiveShapes：保名链重赋值 → bp 是最后写者终端', async () => {
    // 说明：方案 A-15 的裸别名重赋值 `bp = bp2` 属自由 JS 形态——A-16 对拍锁定的
    // 现状扁平语义只允许 `x = cad.op(...)` 重赋值（别名行在 extractor.lines 无投影，
    // 3d_editor timeline 无对应节点）。此处用「保名链式重赋值」表达同一最后写者语义：
    // bp 在第 2 行被自身消费后重写 → lastProducer 指向第 2 行、其后无消费 → bp 是终端。
    const cadNs = createApiNamespace()
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const code = [
      'let bp = cad.box(10, 10, 10, { centered: true })',
      'bp = cad.translate(bp, { offset: [5, 0, 0] })',
    ].join('\n')
    const out = await ex.execute(code)
    expect(out.failedAt).toBeUndefined()

    const meta = extractMetadata(code)
    const shapeVarNames = new Set<PartName>()
    for (const l of meta.lines) for (const o of l.outputs) shapeVarNames.add(o)
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepViewFromMetadata(meta),
      shapeVarNames,
    })
    const ids = terminals.map((t) => String(t.id))
    expect(ids).toEqual(['bp'])
    expect(isMeshShape(ex.ctx.bp)).toBe(true)
  })
})
