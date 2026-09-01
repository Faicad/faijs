/**
 * execute / append / update — 代码文本执行入口契约测试
 *
 * 三接口收敛改造（2026-08-31）：
 * ① execute(code) 全量执行
 * ② append(code, opts) — code 只含「最新的一行或多行」（UI 生成的代码）；
 *    全部视为新语句执行，输入从持久 ctx 解析；前缀缺失 → AppendPrefixError
 * ③ update(oldCode, newCode, opts) — 传参数修改前后的两份代码；
 *    变更点判定（位置 id 配对 + 自身 key 比较）→ 下游闭包重算；
 *    无变更 → 零执行
 *
 * 用 mesh 模式（不依赖 occt-wasm 初始化，manifold 路径快速执行）。
 */

import { describe, it, expect } from 'vitest'
import { CadRuntime, AppendPrefixError } from './runtime'
import { createInternalStdlib } from '@faicad/faijs-stdlib/internal-stdlib'
import type { HostPorts } from './ports'
import { parseScript } from '../lang/parser'
import { asPartName } from '../identity'
import { computeContentKey } from './content-key'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function makeRuntime(): CadRuntime {
  return new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
}

const CODE = [
  'let part0 = cad.box({ size: 20 })',
  'let part1 = cad.sphere({ radius: 10 })',
  'let part2 = cad.union(part0, part1)',
].join('\n')

const CODE2 = [
  'let part0 = cad.box({ size: 20 })',
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

describe('execute(code): 全量形态与 IR 内部版本对照', () => {
  it('同一代码文本，outputs 内容 key 一致', async () => {
    const { script } = parseScript(CODE)
    const baseline = makeRuntime()
    const baselineResult = await baseline.executeIR(script)

    const codeRt = makeRuntime()
    const codeResult = await codeRt.execute(CODE)

    expect(await resultFingerprint(codeRt, codeResult))
      .toEqual(await resultFingerprint(baseline, baselineResult))
    expect(codeResult.terminals.map((t) => t.id))
      .toEqual(baselineResult.terminals.map((t) => t.id))
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
    await rt.execute('let part0 = cad.box({ size: 20 })')
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
    await rt.execute('let part0 = cad.box({ size: 20 })')
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
    await rt.execute('let part0 = cad.box({ size: 20 })')
    const result = await rt.append('let part1 = cad.sphere({ radius: 10 })')
    expect(result.outputs.has(asPartName('part0'))).toBe(true)
    expect(result.outputs.has(asPartName('part1'))).toBe(true)
  })

  it('append 非法代码 → ParseError 直接抛出（宿主可见）', async () => {
    const rt = makeRuntime()
    await expect(rt.append('let part0 = cad.box(')).rejects.toThrow()
  })
})

describe('update(oldCode, newCode, opts): 双代码 diff 增量重算', () => {
  it('参数修改（改 args）→ 变更语句 + 下游闭包重算，几何与全量一致', async () => {
    const oldCode = CODE2
    const newCode = [
      'let part0 = cad.box({ size: 40 })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0] })',
    ].join('\n')
    const executed: string[] = []
    const rt = makeRuntime()
    await rt.execute(oldCode)
    const result = await rt.update(oldCode, newCode, {
      beforeStatement: (stmtId) => executed.push(stmtId),
    })

    // 闭包重算：box（改参数）+ translate（下游依赖）都执行
    expect(executed.sort()).toEqual(['s1', 's2'])

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })

  it('无变更（两份代码相同）→ 零执行，结果与全量一致', async () => {
    const executed: string[] = []
    const rt = makeRuntime()
    await rt.execute(CODE2)
    const result = await rt.update(CODE2, CODE2, {
      beforeStatement: (stmtId) => executed.push(stmtId),
    })
    expect(executed).toEqual([])

    const fullRt = makeRuntime()
    const full = await fullRt.execute(CODE2)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })

  it('删除语句 → 输出被 reconcile 移除，零执行', async () => {
    const executed: string[] = []
    const rt = makeRuntime()
    await rt.execute(CODE)
    const result = await rt.update(
      CODE,
      CODE.split('\n').slice(0, 2).join('\n'),
      { beforeStatement: (stmtId) => executed.push(stmtId) },
    )
    expect(result.outputs.has(asPartName('part2'))).toBe(false)
    expect(result.outputs.has(asPartName('part0'))).toBe(true)
    expect(result.outputs.has(asPartName('part1'))).toBe(true)
    expect(executed).toEqual([])
  })

  it('新增语句 → 新输出出现并执行', async () => {
    const executed: string[] = []
    const rt = makeRuntime()
    await rt.execute(CODE.split('\n').slice(0, 2).join('\n'))
    const result = await rt.update(
      CODE.split('\n').slice(0, 2).join('\n'),
      CODE,
      { beforeStatement: (stmtId) => executed.push(stmtId) },
    )
    expect(result.outputs.has(asPartName('part2'))).toBe(true)
    expect(executed).toEqual(['s3'])
  })

  it('级联闭包：编辑 box（s1）→ 依赖它的 union（s3）一并重算，sphere（s2）不执行', async () => {
    const executed: string[] = []
    const rt = makeRuntime()
    await rt.execute(CODE)
    const newCode = [
      'let part0 = cad.box({ size: 40 })',
      'let part1 = cad.sphere({ radius: 10 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')
    const result = await rt.update(CODE, newCode, {
      beforeStatement: (stmtId) => executed.push(stmtId),
    })
    // box 改参数 → stale；union 经 deps 级联 → stale；sphere 不变 → 不执行
    expect(executed.sort()).toEqual(['s1', 's3'])

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })

  it('参数行修改（const 字面量）→ 依赖参数的语句重算', async () => {
    const oldCode = ['const size = 20', 'let part0 = cad.box({ size: size })'].join('\n')
    const newCode = ['const size = 40', 'let part0 = cad.box({ size: size })'].join('\n')
    const executed: string[] = []
    const rt = makeRuntime()
    await rt.execute(oldCode)
    const result = await rt.update(oldCode, newCode, {
      beforeStatement: (stmtId) => executed.push(stmtId),
    })
    // box（s2）因参数变化重算；参数语句 s1 无赋值，不触发 beforeStatement
    expect(executed).toEqual(['s2'])

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })
})

// ── ExprIR 增量（控制流放松方案 Phase 1：编辑表达式 → key 变 → 重算） ──

describe('ExprIR 增量（§5.4 箭头包装 / §6.2 key）', () => {
  const CODE_EXPR = [
    'let part0 = cad.box({ size: 20 })',
    'let part1 = cad.box({ size: part0 ? 30 : 10 })',
  ].join('\n')

  it('编辑 ExprIR 表达式文本 → 语句重算；未改 → 零重算', async () => {
    const rt = makeRuntime()
    await rt.execute(CODE_EXPR)

    // 改表达式分支值：part0 ? 30 : 10 → part0 ? 40 : 10
    const newCode = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: part0 ? 40 : 10 })',
    ].join('\n')
    const executed: string[] = []
    const result = await rt.update(CODE_EXPR, newCode, {
      beforeStatement: (stmtId) => executed.push(stmtId),
    })
    // s2（part1）因 key 变化重算；s1（part0）不变
    expect(executed).toEqual(['s2'])

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })

  it('ExprIR 引用的上游变量变化 → 经 deps 级联重算（refs 进 deps）', async () => {
    const rt = makeRuntime()
    await rt.execute(CODE_EXPR)
    // 改 part0 的 size：part0 内容变化 → part1 的 deps（part0）变化 → part1 级联重算
    const newCode = [
      'let part0 = cad.box({ size: 40 })',
      'let part1 = cad.box({ size: part0 ? 30 : 10 })',
    ].join('\n')
    const executed: string[] = []
    const result = await rt.update(CODE_EXPR, newCode, {
      beforeStatement: (stmtId) => executed.push(stmtId),
    })
    expect(executed.sort()).toEqual(['s1', 's2'])

    const fullRt = makeRuntime()
    const full = await fullRt.execute(newCode)
    expect(await resultFingerprint(rt, result)).toEqual(await resultFingerprint(fullRt, full))
  })
})
