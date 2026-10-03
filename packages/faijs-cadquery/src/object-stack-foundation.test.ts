/**
 * P3-0 · 对象栈地基守卫 —— `Workplane` 的 `objects` 栈与派生的 `shape` 视图。
 *
 * 方案：`docs/plans/2026-10-03-cadquery-object-stack-p3-plan.md` §3.1 / §3.4。
 *
 * 本文件是**地基守卫**，不含任何 CadQuery 真值断言（那些属于 P3-1 起，随
 * `tests/ref-harness/object-stack-probe.py` 的一次性捕获一起冻结）。它锁的是
 * P3 自己引入的机制，防止后续批次把「栈是真源、`shape` 是派生」这个不变式
 * 悄悄破坏 —— 那类破坏**没有任何症状**，只会让多对象语义静默退化回单对象。
 *
 * 背景（GOTCHA）：P3 之前 `shape` 是**唯一存储**，`objects` 根本不存在。把它
 * 降级为派生字段是本次改造的核心风险：只要有一处绕过唯一的派生点直接写
 * `.shape`，栈与视图就永久脱节，且所有镜像用例照样 PASS（STEP 只看 `val()`
 * = `objects[0]`）。所以守卫必须是**结构性的**（扫源码），不能只测行为。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setupNativeKernel } from './gear-test-harness'
import { Workplane, box, union, val, vals, split } from './workplane'

beforeAll(async () => {
  await setupNativeKernel()
})

const SRC = fileURLToPath(new URL('./workplane.ts', import.meta.url))

describe('P3-0 · 载体不变式', () => {
  it('空载体的栈为空、派生 shape 为 null', () => {
    const wp = Workplane('XY')
    expect(wp.objects).toEqual([])
    expect(wp.shape).toBeNull()
  })

  it('单对象时 shape === objects[0]', async () => {
    const wp = await box(Workplane('XY'), 2, 3, 4)
    expect(wp.objects).toHaveLength(1)
    expect(wp.shape).toBe(wp.objects[0])
  })

  it('后续 op 继承栈：shape 仍与 objects[0] 逐位相同', async () => {
    const a = await box(Workplane('XY'), 1, 1, 1)
    const b = await union(a, await box(Workplane('XY'), 1, 1, 1))
    expect(b.objects[0]).toBe(b.shape)
    // 栈引用是 immutable 语义：a 的载体没有被 b 改写。
    expect(a.objects[0]).not.toBe(b.objects[0])
  })

  it('val()/vals() 读的是栈（vals 长度 === objects 长度）', async () => {
    const wp = await box(Workplane('XY'), 1, 1, 1)
    expect(val(wp)).toBe(wp.objects[0])
    expect(vals(wp)).toEqual(wp.objects)
  })

  it('P3-4 之前栈只承载单对象（这是当前批次的边界，不是终态）', async () => {
    // 记录当前真实状态，避免有人误以为多对象已落地。P3-2 起本断言会失败，
    // 那时把它改成「至少 1 个」并同步更新本文件头部的批次说明。
    const wp = await box(Workplane('XY'), 1, 1, 1)
    expect(wp.objects.length).toBeLessThanOrEqual(1)
  })
})

describe('P3-0 · 结构性守卫（源码级）', () => {
  const src = readFileSync(SRC, 'utf8')
  const lines = src.split('\n')

  /** JSDoc / 行注释里的行不算可执行代码（文档本身会引用这些模式）。 */
  const isCode = (line: string): boolean => !/^\s*(\*|\/\/|\/\*)/.test(line)

  it('clone() 的调用点不得再写 overrides.shape', () => {
    // `shape` 是派生的：写它就等于把栈与视图脱节，且无任何症状。
    // clone() 已对 `overrides.shape` 抛错，这里防的是有人绕过 clone 或删掉那道防线。
    //
    // GOTCHA（踩过两次，每次原因不同）：
    // ① 扫**行**会漏掉多行 clone 调用 ——
    //    `clone(wp, {\n  shape: result,\n  …\n})` 的 `shape:` 落在下一行，
    //    行级正则完全看不见（P3-0 首版就这么漏掉 3 处 `sweep` / `extrude` /
    //    `cutBlind`，60 条用例会红）。
    // ② 只看 `{` / `,` 之后的位置会误命中**嵌套**字面量 ——
    //    `tag()` 的 `tags: { …, [name]: { …, shape: wp.shape } }` 里那个
    //    `shape` 是 TaggedWorkplane 的快照字段，不是 clone 的 override。
    // 所以：扫全文 + 按**嵌套深度**取顶层键。
    const offenders: string[] = []
    const code = lines.filter(isCode).join('\n')
    // 每个 clone( 的第二参数对象字面量，从 `{` 起扫到配平的 `}`。
    const re = /clone\([^,()]+,\s*\{/g
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) {
      const open = m.index + m[0].length - 1
      let depth = 0
      let i = open
      for (; i < code.length; i++) {
        if (code[i] === '{') depth++
        else if (code[i] === '}') {
          depth--
          if (depth === 0) break
        }
      }
      const literal = code.slice(open + 1, i)
      // 逐字符走一遍，只在深度 === 0 的位置读「键名」。
      let d = 0
      let segStart = 0
      for (let k = 0; k <= literal.length; k++) {
        const ch = literal[k]
        if (k < literal.length && (ch === '{' || ch === '[' || ch === '(')) d++
        else if (k < literal.length && (ch === '}' || ch === ']' || ch === ')')) d--
        if (d === 0 && (k === literal.length || ch === ',')) {
          const seg = literal.slice(segStart, k)
          if (/^\s*shape\s*[,:}]/.test(seg)) {
            offenders.push(literal.slice(0, 60).replace(/\n/g, ' '))
            break
          }
          segStart = k + 1
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('不得用对象展开 {...wp} 造载体（会丢 WP_PROTO 并把 shape 固化成数据属性）', () => {
    // WP_PROTO 是 borrowDeep 跳过遍历的依据（workplane.ts 头部注释）：
    // 对象展开产出的 plain object 会被 compatOp 的 borrowDeep 走进字段，
    // 把 Shape 换成借用 brepjs 视图。P3-0 已把 5 处历史展开改走 clone()。
    const offenders: string[] = []
    lines.forEach((line, i) => {
      if (/\.\.\.wp\s*[,}]/.test(line)) offenders.push(`${i + 1}: ${line.trim()}`)
    })
    expect(offenders.filter((o) => isCode(lines[Number(o.slice(0, o.indexOf(':'))) - 1] ?? ''))).toEqual([])
  })

  it('不得绕过 clone() 直接给 .shape 赋值', () => {
    const offenders: string[] = []
    lines.forEach((line, i) => {
      if (isCode(line) && /(^|[^=!<>])(\.\s*shape\s*)=(?!=)/.test(line)) {
        offenders.push(`${i + 1}: ${line.trim()}`)
      }
    })
    // 允许的写法只有一处：clone() 内部的 `out.shape = out.objects[0] ?? null`
    const unexpected = offenders.filter((o) => !/out\.shape = out\.objects\[0\]/.test(o))
    expect(unexpected).toEqual([])
  })

  it('clone() 自身维护不变式（派生命中行存在）', () => {
    expect(src).toMatch(/out\.shape = out\.objects\[0\] \?\? null/)
  })

  it('clone() 拒绝 overrides.shape（不静默接受，避免脱节无声发生）', () => {
    expect(src).toMatch(/'shape' in overrides/)
  })
})

describe('P3-0 · 跨子路径兼容（assembly 读鸭子类型的 .shape）', () => {
  it('clone() 保留 WP_PROTO —— borrowDeep 跳过遍历的保证', () => {
    // 具体判据走行为：原型的 `__isCqWorkplane` 标记必须一路继承。
    // 走一次真实 op 链，确保每个中间载体都还是载体。
    const wp = Workplane('XY')
    const seen: boolean[] = [Boolean((Object.getPrototypeOf(wp) as Record<string, unknown>).__isCqWorkplane)]
    return box(wp, 1, 1, 1).then((r) => {
      seen.push(Boolean((Object.getPrototypeOf(r) as Record<string, unknown>).__isCqWorkplane))
      return split(r, [0, 0, 0], [0, 0, 1], { keepTop: true, keepBottom: false })
    }).then((r) => {
      seen.push(Boolean((Object.getPrototypeOf(r) as Record<string, unknown>).__isCqWorkplane))
      expect(seen).toEqual([true, true, true])
    })
  })
})
