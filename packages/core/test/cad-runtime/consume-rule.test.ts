/**
 * consume-rule — 语言级消费规则测试（方案 2026-11-08 §9）
 *
 * 覆盖：
 * - `collectCtxReads` / `collectCtxWrites` 的读/写区分（变换后 `__ctx.<name>` 形态）；
 * - `ConsumeTracker` 的世代语义（写者清除 tombstone）；
 * - DirectExecutor 集成：warn 收集、error 抛 `E_USE_AFTER_CONSUME`、keep 豁免、
 *   自赋值不算消费、测量查询（R3）不消费。
 *
 * 判定真源是 `live-shapes.lineConsumes`（本测试不改它的口径，只验证接线）。
 */

import { describe, it, expect } from 'vitest'
import { DirectExecutor } from '../../src/cad-runtime/direct-executor'
import { extractMetadata } from '../../src/lang/metadata-extractor'
import { collectCtxReads, collectCtxWrites, ConsumeTracker } from '../../src/cad-runtime/consume-rule'
import { ParseError } from '../../src/lang/parse-error'

/** 结构上的 shape（positions + indices，与 runtime.isShapeLike 同构）。 */
function fakeShape(): Record<string, unknown> {
  return { positions: new Float32Array([0, 0, 0]), indices: new Uint32Array([0, 1, 2]) }
}

/** 最小 cad 命名空间（只需让 ctx 里出现几何值/非几何值；消费判定读源码形态）。 */
const fakeCad = {
  box: () => fakeShape(),
  sphere: () => fakeShape(),
  subtract: () => fakeShape(),
  union: () => fakeShape(),
  // 真实 cad.assembly 返回装配描述对象（非几何：无 positions/indices、非 compound），
  // 于是 R3 判"输出全非几何 → 不消费"。这里必须照实模拟，否则测的是假 API。
  assembly: () => ({ kind: 'assembly', name: 'asm', members: [] }),
  // 派生后仍产出**几何**的 op（fai_drill 等）——这类才是真的消费输入。
  drill: () => fakeShape(),
  volume: () => 1000,
}

interface RunResult {
  violations: Array<{ name: string; consumeLine: number; useLine: number }>
  error?: ParseError
  ctxKeys: string[]
}

/**
 * 用真实 DirectExecutor 跑一遍脚本（vm 后端 + 假 cad 命名空间）。
 * @param code - .fai.js 源码
 * @param mode - 规则档位；'off' 表示完全不传 consumeRule
 * @returns 违规列表 / 抛出的 ParseError / 结束时 ctx 键
 */
async function run(code: string, mode: 'off' | 'warn' | 'error'): Promise<RunResult> {
  const meta = extractMetadata(code)
  const de = new DirectExecutor({ namespaces: { cad: fakeCad as never } })
  const violations: RunResult['violations'] = []
  const consumeRule =
    mode === 'off'
      ? undefined
      : {
          mode,
          lines: meta.lines,
          keep: {
            declared: () => meta.keep,
            functionBody: () => undefined,
          },
          onViolation: (v: { name: string; consumeLine: number; useLine: number }) => {
            violations.push({ name: v.name, consumeLine: v.consumeLine, useLine: v.useLine })
          },
        }
  try {
    const outcome = await de.execute(code, consumeRule ? { consumeRule } : {})
    return { violations, ctxKeys: outcome.ctxKeys }
  } catch (err) {
    return { violations, error: err as ParseError, ctxKeys: [] }
  }
}

describe('collectCtxReads / collectCtxWrites', () => {
  it('读与写分开：写目标是写，不重复算读', () => {
    const body = '__ctx.p0 = await __ns.cad.subtract(__ctx.a, __ctx.b)'
    expect([...collectCtxReads(body)].sort()).toEqual(['a', 'b'])
    expect([...collectCtxWrites(body)].sort()).toEqual(['p0'])
  })

  it('自赋值：同一行里 a 既是读也是写——读集合含 a，写集合也含 a', () => {
    const body = '__ctx.a = await __ns.cad.subtract(__ctx.a, __ctx.b)'
    expect(collectCtxReads(body).has('a')).toBe(true)
    expect(collectCtxWrites(body).has('a')).toBe(true)
  })

  it('排除比较运算（=== / =>）不被当成写', () => {
    const body = '__ctx.x = __ctx.a === __ctx.b ? __ctx.a : __ctx.b'
    expect(collectCtxWrites(body).has('a')).toBe(false)
    expect(collectCtxReads(body).has('a')).toBe(true)
  })
})

describe('ConsumeTracker 世代语义', () => {
  it('消费后 preCheck 报违规，写者开新世代后不再报', () => {
    const t = new ConsumeTracker()
    t.commitWrite('a', 1)
    t.markConsumed('a', 3)
    expect(t.isConsumed('a')).toBe(true)
    const v1 = t.preCheck(new Set(['a']), 4)
    expect(v1).toHaveLength(1)
    expect(v1[0]).toMatchObject({ name: 'a', producerLine: 1, consumeLine: 3, useLine: 4 })
    // 重赋值 → 新世代，可再次引用
    t.commitWrite('a', 6)
    expect(t.isConsumed('a')).toBe(false)
    expect(t.preCheck(new Set(['a']), 7)).toHaveLength(0)
  })

  it('同世代重复消费保留首次消费行', () => {
    const t = new ConsumeTracker()
    t.markConsumed('a', 3)
    t.markConsumed('a', 5)
    expect(t.preCheck(new Set(['a']), 9)[0].consumeLine).toBe(3)
  })

  it('reset 清空违规与账本', () => {
    const t = new ConsumeTracker()
    t.markConsumed('a', 2)
    t.preCheck(new Set(['a']), 3)
    t.reset()
    expect(t.violations).toHaveLength(0)
    expect(t.isConsumed('a')).toBe(false)
  })
})

describe('DirectExecutor + consumeRule', () => {
  const consumedLater = [
    'let a = cad.box(10, 10, 10)',
    'let b = cad.sphere({ radius: 3 })',
    'let c = cad.subtract(a, b)',
    'let d = cad.union(a)',
  ].join('\n')

  it('warn 档：消费后再引用收进违规清单，但执行不中断', async () => {
    const r = await run(consumedLater, 'warn')
    expect(r.error).toBeUndefined()
    expect(r.violations).toEqual([{ name: 'a', consumeLine: 3, useLine: 4 }])
  })

  it('error 档：抛 ParseError(E_USE_AFTER_CONSUME)，带违规行号', async () => {
    const r = await run(consumedLater, 'error')
    expect(r.error).toBeInstanceOf(ParseError)
    expect(r.error!.code).toBe('E_USE_AFTER_CONSUME')
    expect(r.error!.line).toBe(4)
    expect(r.error!.message).toContain('line 3')
  })

  it('off 档（不传 consumeRule）：无违规、行为与改前一致', async () => {
    const r = await run(consumedLater, 'off')
    expect(r.error).toBeUndefined()
    expect(r.violations).toHaveLength(0)
  })

  it('keep 豁免：keep 的件被布尔消费后再引用不报错', async () => {
    const code = [
      'let a = cad.box(10, 10, 10)',
      'let b = cad.sphere({ radius: 3 })',
      'a.keep()',
      'let c = cad.subtract(a, b)',
      'let d = cad.union(a)',
    ].join('\n')
    const r = await run(code, 'error')
    expect(r.error).toBeUndefined()
    expect(r.violations).toHaveLength(0)
  })

  it('自赋值 a = a.subtract(b)：a 可继续用，b 被消费后再用报错', async () => {
    const okCode = [
      'let a = cad.box(10, 10, 10)',
      'let b = cad.sphere({ radius: 3 })',
      'a = cad.subtract(a, b)',
      'let d = cad.union(a)',
    ].join('\n')
    const ok = await run(okCode, 'error')
    expect(ok.error).toBeUndefined()

    const badCode = `${okCode}\nlet e = cad.union(b)`
    const bad = await run(badCode, 'error')
    expect(bad.error!.code).toBe('E_USE_AFTER_CONSUME')
    expect(bad.error!.line).toBe(5)
  })

  it('R3：纯测量语句不消费输入（volume 之后 a 仍可用）', async () => {
    const code = [
      'let a = cad.box(10, 10, 10)',
      'let v = cad.volume(a)',
      'let d = cad.union(a)',
    ].join('\n')
    const r = await run(code, 'error')
    expect(r.error).toBeUndefined()
  })

  it('装配成员不算消费：R3（输出非几何）——不是白名单，是既有判定', async () => {
    const code = [
      'let a = cad.box(10, 10, 10)',
      'let b = cad.sphere({ radius: 3 })',
      'let asm = cad.assembly({ members: [a, b] })',
      'let d = cad.union(a)',
    ].join('\n')
    const r = await run(code, 'error')
    expect(r.error).toBeUndefined()
    expect(r.violations).toHaveLength(0)
  })

  it('派生型但产出几何的 op 照样消费（drill：输出是 shape → R5 命中）', async () => {
    const code = [
      'let a = cad.box(10, 10, 10)',
      'let d0 = cad.drill(a)',
      'let d = cad.union(a)',
    ].join('\n')
    const r = await run(code, 'error')
    expect(r.error!.code).toBe('E_USE_AFTER_CONSUME')
    expect(r.error!.line).toBe(3)
  })

  it('R2：无赋值裸调用不消费（保留 = 已有语义）', async () => {
    const code = [
      'let a = cad.box(10, 10, 10)',
      'cad.union(a)',
      'let d = cad.union(a)',
    ].join('\n')
    const r = await run(code, 'error')
    expect(r.error).toBeUndefined()
  })
})
