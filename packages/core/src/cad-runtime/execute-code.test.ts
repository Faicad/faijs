/**
 * execute / append / update — 代码文本执行入口契约测试
 *
 * 三接口：
 * ① execute(code) 全量执行
 * ② append(code, opts) — code 只含「最新的一行或多行」（UI 生成的代码）；
 *    全部视为新语句执行，输入从持久 ctx 解析；前缀缺失 → AppendPrefixError
 * ③ update(oldCode, newCode, opts) — direct 路径 R3 语义：清 ctx 全量重跑新文本；
 *    几何结果与全量 execute 一致
 *
 * 用 mesh 模式（不依赖 occt-wasm 初始化，manifold 路径快速执行）。
 */

import { describe, it, expect } from 'vitest'
import { CadRuntime, AppendPrefixError } from './runtime'
import { createApiNamespace } from '../api/api-namespace'
import type { HostPorts } from './ports'
import { asPartName } from '../identity'
import { computeContentKey } from './content-key'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function makeRuntime(): CadRuntime {
  return new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
}

const CODE = [
  'let part0 = cad.box(20, 20, 20, { centered: true })',
  'let part1 = cad.sphere({ radius: 10 })',
  'let part2 = cad.union(part0, part1)',
].join('\n')

const CODE2 = [
  'let part0 = cad.box(20, 20, 20, { centered: true })',
  'let part1 = cad.translate(part0, { offset: [1, 0, 0] })',
].join('\n')

/** 归一化结果：outputs 中 mesh 几何的内容 key 集合（几何一致性判定） */
async function resultFingerprint(rt: CadRuntime, result: Awaited<ReturnType<CadRuntime['execute']>>) {
  const keys: string[] = []
  for (const [name, shape] of result.outputs) {
    // keep-syntax §5.1：outputs 含 compound（无 mesh，无法算内容 key）——跳过
    if (!('positions' in shape) || !('indices' in shape)) continue
    keys.push(`${name}:${computeContentKey(shape.positions, shape.indices)}`)
  }
  keys.sort()
  return keys
}

describe('execute(code): 全量形态与几何产出', () => {
  it('同一代码文本两次执行，outputs 内容 key 一致', async () => {
    const rt1 = makeRuntime()
    const result1 = await rt1.execute(CODE)
    const rt2 = makeRuntime()
    const result2 = await rt2.execute(CODE)

    expect(await resultFingerprint(rt1, result1))
      .toEqual(await resultFingerprint(rt2, result2))
    expect(result1.terminals.map((t) => t.id))
      .toEqual(result2.terminals.map((t) => t.id))
  })
})

describe('append(code, opts): 只传新增语句文本', () => {
  it('先执行前两条，再 append 第三条（仅新行文本）→ 与全量结果一致', async () => {
    const fullRt = makeRuntime()
    const full = await fullRt.execute(CODE)

    const rt = makeRuntime()
    await rt.execute(CODE.split('\n').slice(0, 2).join('\n'))
    const result = await rt.append(CODE.split('\n').slice(2).join('\n'))

    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
    expect(result.outputs.has(asPartName('part0'))).toBe(true)
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
  })

  it('append 多语句：新行间互相引用，全部执行', async () => {
    const rt = makeRuntime()
    await rt.execute('let part0 = cad.box(20, 20, 20, { centered: true })')
    const result = await rt.append([
      'let part1 = cad.sphere({ radius: 10 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'))

    expect(result.outputs.has(asPartName('part1'))).toBe(true)
    expect(result.outputs.has(asPartName('part2'))).toBe(true)

    const fullRt = makeRuntime()
    const full = await fullRt.execute(CODE)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })

  it('append 引用此前已执行的 part（单 runtime 跨语句引用）→ 正常命中', async () => {
    const rt = makeRuntime()
    await rt.execute('let part0 = cad.box(20, 20, 20, { centered: true })')
    const result = await rt.append('let part1 = cad.translate(part0, { offset: [1, 2, 3] })')
    expect(result.outputs.has(asPartName('part1'))).toBe(true)
    expect(result.terminals.some((t) => String(t.id) === 'part1')).toBe(true)
  })

  it('append 前缀缺失（引用未执行过的变量）→ AppendPrefixError', async () => {
    const rt = makeRuntime()
    try {
      await rt.append('let part2 = cad.union(part0, part1)')
      expect.unreachable('append should have thrown AppendPrefixError')
    } catch (err) {
      expect(err).toBeInstanceOf(AppendPrefixError)
      expect((err as AppendPrefixError).missingVar).toBe('part0')
      expect((err as AppendPrefixError).statementId).toBeDefined()
    }
  })

  it('append 后持久 ctx 完整：旧语句输出仍出现在结果中（不 reconcile 清空）', async () => {
    const rt = makeRuntime()
    await rt.execute('let part0 = cad.box(20, 20, 20, { centered: true })')
    const result = await rt.append('let part1 = cad.sphere({ radius: 10 })')
    expect(result.outputs.has(asPartName('part0'))).toBe(true)
    expect(result.outputs.has(asPartName('part1'))).toBe(true)
  })

  it('append 非法代码 → ParseError 直接抛出（宿主可见）', async () => {
    const rt = makeRuntime()
    await expect(rt.append('let part0 = cad.box(')).rejects.toThrow()
  })
})

describe('update(oldCode, newCode, opts): 全量重跑（R3 语义）', () => {
  it('参数修改 → 全量重跑，几何与全量 execute 一致', async () => {
    const oldCode = CODE2
    const newCode = [
      'let part0 = cad.box(40, 40, 40, { centered: true })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0] })',
    ].join('\n')
    const rt = makeRuntime()
    await rt.execute(oldCode)
    const result = await rt.update(oldCode, newCode)

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })

  it('无变更 → 全量重跑，结果与全量 execute 一致', async () => {
    const rt = makeRuntime()
    await rt.execute(CODE2)
    const result = await rt.update(CODE2, CODE2)

    const fullRt = makeRuntime()
    const full = await fullRt.execute(CODE2)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })

  it('删除语句 → 输出被移除', async () => {
    const rt = makeRuntime()
    await rt.execute(CODE)
    const result = await rt.update(
      CODE,
      CODE.split('\n').slice(0, 2).join('\n'),
    )
    expect(result.outputs.has(asPartName('part2'))).toBe(false)
    expect(result.outputs.has(asPartName('part0'))).toBe(true)
    expect(result.outputs.has(asPartName('part1'))).toBe(true)
  })

  it('新增语句 → 新输出出现', async () => {
    const rt = makeRuntime()
    await rt.execute(CODE.split('\n').slice(0, 2).join('\n'))
    const result = await rt.update(
      CODE.split('\n').slice(0, 2).join('\n'),
      CODE,
    )
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
  })

  it('级联闭包：编辑 box → union 也重算，几何与全量一致', async () => {
    const rt = makeRuntime()
    await rt.execute(CODE)
    const newCode = [
      'let part0 = cad.box(40, 40, 40, { centered: true })',
      'let part1 = cad.sphere({ radius: 10 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')
    const result = await rt.update(CODE, newCode)

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })

  it('参数行修改（const 字面量）→ 全量重跑，几何与全量一致', async () => {
    const oldCode = ['const size = 20', 'let part0 = cad.box(size, size, size, { centered: true })'].join('\n')
    const newCode = ['const size = 40', 'let part0 = cad.box(size, size, size, { centered: true })'].join('\n')
    const rt = makeRuntime()
    await rt.execute(oldCode)
    const result = await rt.update(oldCode, newCode)

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })
})

// ── 表达式增量（direct 路径：全量重跑，几何一致性验证） ──

describe('表达式编辑：全量重跑一致性', () => {
  const CODE_EXPR = [
    'let part0 = cad.box(20, 20, 20, { centered: true })',
    'let part1 = cad.box(part0 ? 30 : 10, part0 ? 30 : 10, part0 ? 30 : 10, { centered: true })',
  ].join('\n')

  it('编辑表达式分支值 → 全量重跑，几何与全量一致', async () => {
    const rt = makeRuntime()
    await rt.execute(CODE_EXPR)

    const newCode = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0 ? 40 : 10, part0 ? 40 : 10, part0 ? 40 : 10, { centered: true })',
    ].join('\n')
    const result = await rt.update(CODE_EXPR, newCode)

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })

  it('上游变量变化 → 全量重跑，几何与全量一致', async () => {
    const rt = makeRuntime()
    await rt.execute(CODE_EXPR)
    const newCode = [
      'let part0 = cad.box(40, 40, 40, { centered: true })',
      'let part1 = cad.box(part0 ? 30 : 10, part0 ? 30 : 10, part0 ? 30 : 10, { centered: true })',
    ].join('\n')
    const result = await rt.update(CODE_EXPR, newCode)

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })
})
