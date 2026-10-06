/**
 * script-globals — 「免 import 安全全局」(S4_SAFE_GLOBALS) 在各层的可见性契约
 *
 * ## 缺陷（2026-10-06 修复）
 *
 * `Math` / `JSON` / `Number` / `console` / `Infinity` / … 是 faijs 设计上明确的
 * **免 import 安全全局**：`lang/security-scanner.ts` 的 S4 门禁放行、`interp` 后端
 * 从 `globalThis` 取值、VM 后端靠 `new Function` 的真实全局作用域解析。
 *
 * 但「哪些裸标识符是合法全局」这份知识散落在六处，其中四处只内联了单位常量表
 * （`SCRIPT_UNIT_NAMES`）而漏掉 `S4_SAFE_GLOBALS`，于是同一份代码出现自相矛盾：
 *
 * ```
 * cad.box(10 * MM, 1, 1)     → 放行（MM 在 SCRIPT_UNIT_NAMES 里）
 * cad.box(Math.PI, 1, 1)     → 抛 E_REFERENCE: unknown identifier "Math"   ← 缺陷
 * ```
 *
 * 后果：`Math.max(x, 20)`、`JSON.parse(...)`、`{ center: Math.PI > 3 }` 只要出现在
 * op 实参槽里，**整个脚本连执行都进不去**（`runtime.execute` 第一步就跑
 * `extractMetadata`）。而 `security-scanner.test.ts` 的 S-21/S-22 又明确断言
 * `Math.max` / `Math.PI` / `JSON.parse` / `new Date()` 合法 —— 两者直接冲突。
 *
 * 受影响面（本次一并修复）：
 *   1. `metadata-extractor.collectExprIdentifiers` —— 表达式位置的 `Math.*`
 *   2. `metadata-extractor.parseValueExpr`        —— 裸全局作值表达式实参
 *   3. `metadata-extractor.parsePositionalArgs`   —— 裸全局作位置实参（`MM` 也在此被拒）
 *   4. `direct-executor.collectRefs`              —— append 前缀校验误报「缺失引用」
 *   5. `direct-executor.transformArg` / `emitCall` —— 发射成 `__ctx.Math`（求值静默变错）
 *   6. `code-to-args.extractIdentifiers`          —— 前置哨兵导致幻影参数 params:['Math']
 *
 * 本文件把「六处判定必须与 S4 白名单一致」钉成长期契约。
 */

import { describe, it, expect } from 'vitest'
import { extractMetadata } from './metadata-extractor'
import { isSafeGlobalIdent, S4_SAFE_GLOBALS } from './security-scanner'
import { validateExpression } from './expr-validate'
import { codeToArgs } from './code-to-args'
import { SCRIPT_UNIT_NAMES } from '../units'
import { CadRuntime } from '../cad-runtime/runtime'
import { DirectExecutor } from '../cad-runtime/direct-executor'
import type { HostPorts } from '../cad-runtime/ports'
import { createApiNamespaceWithEditorOps } from '../test-support/editor-ops'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as unknown as HostPorts
}

/** mesh 实体的 X 轴跨度（几何 op 是否真的吃到了该数值的判据）。 */
function spanX(v: unknown): number {
  const pos = (v as { positions?: ArrayLike<number> } | undefined)?.positions
  if (!pos || pos.length === 0) return Number.NaN
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]
    if (x < min) min = x
    if (x > max) max = x
  }
  return max - min
}

describe('script-globals: 名单一致性契约', () => {
  it('isSafeGlobalIdent 与 S4_SAFE_GLOBALS 同源', () => {
    for (const name of S4_SAFE_GLOBALS) expect(isSafeGlobalIdent(name)).toBe(true)
    expect(isSafeGlobalIdent('zzz')).toBe(false)
    expect(isSafeGlobalIdent('cad')).toBe(false)
  })

  it('单位常量名必须 ⊆ S4_SAFE_GLOBALS（防两份手写名单漂移）', () => {
    const notGlobal = [...SCRIPT_UNIT_NAMES].filter((n) => !S4_SAFE_GLOBALS.has(n))
    expect(notGlobal).toEqual([])
  })

  it('S4 的每一个名字都能作为 op 实参通过提取（不抛 E_REFERENCE）', () => {
    const failed: string[] = []
    for (const name of S4_SAFE_GLOBALS) {
      try {
        extractMetadata(`let p = cad.box(${name}, 1, 1)`)
      } catch (e) {
        failed.push(`${name}: ${(e as Error).message}`)
      }
    }
    expect(failed).toEqual([])
  })
})

describe('script-globals: 提取层（表达式位置）', () => {
  it('Math.max 带参数引用 —— 原缺陷用例（曾整体不可执行）', () => {
    const meta = extractMetadata('const x = 20\nlet p = cad.box(Math.max(x, 20), 1, 1)')
    const slot = meta.argSources.find((s) => s.path === 'positional[0]')
    expect(slot?.text).toBe('Math.max(x, 20)')
    expect(slot?.isExpression).toBe(true)
  })

  it('Math.PI 作位置实参', () => {
    const meta = extractMetadata('let p = cad.box(Math.PI, 1, 1)')
    expect(meta.argSources.find((s) => s.path === 'positional[0]')?.text).toBe('Math.PI')
  })

  it('嵌套对象属性值里的 Math（M2 实际踩到的形态）', () => {
    const meta = extractMetadata('let p = cad.box(1, 1, 1, { center: Math.PI > 3 })')
    expect(meta.argSources.find((s) => s.path === 'args.center')?.text).toBe('Math.PI > 3')
  })

  it('其余安全全局调用：Number / parseInt / JSON.parse / console.log', () => {
    for (const expr of [
      'Number("7")',
      'parseFloat("2.5")',
      'parseInt("7", 10)',
      'JSON.parse("{}").length',
      'Math.round(1.5)',
      'isFinite(1)',
    ]) {
      expect(() => extractMetadata(`let p = cad.box(${expr}, 1, 1)`), expr).not.toThrow()
    }
  })

  it('Math 不进入依赖（它是 JS 全局，不是脚本作用域变量）', () => {
    const meta = extractMetadata('const x = 20\nlet p = cad.box(Math.max(x, 20), 1, 1)')
    const slot = meta.argSources.find((s) => s.path === 'positional[0]')
    // `const x = 20` 是参数行 → x 落在 params；变量落在 refs。两者都算「依赖」，
    // 但 Math 一个都不该进（否则 UI 依赖分析会出现幻影依赖 Math）。
    const deps = [...(slot?.params ?? []), ...(slot?.refs ?? [])]
    expect(deps).toContain('x')
    expect(deps).not.toContain('Math')
  })

  it('真未知标识符仍然被拒（不得因为本次修复而放宽）', () => {
    expect(() => extractMetadata('let p = cad.box(zzz, 1, 1)')).toThrow()
    expect(() => extractMetadata('const x = 1\nlet p = cad.box(zzz + x, 1, 1)')).toThrow()
  })
})

describe('script-globals: 提取层（裸标识符作实参）', () => {
  it('Infinity / NaN / undefined / console 可作位置实参', () => {
    for (const name of ['Infinity', 'NaN', 'undefined', 'console']) {
      expect(() => extractMetadata(`let p = cad.box(${name}, 1, 1)`), name).not.toThrow()
    }
  })

  it('单位常量裸用可折叠（MM=1 / INCH=25.4），不再被判未声明变量', () => {
    expect(() => extractMetadata('let p = cad.box(MM, 1, 1)')).not.toThrow()
    const meta = extractMetadata('let p = cad.box(INCH, 1, 1)')
    expect(meta.lines[0]?.positional?.[0]).toBe(25.4)
  })
})

describe('script-globals: 单行提取（codeToArgs）不得把全局当幻影参数', () => {
  it('Math 不入 params；真正的参数照常记录', () => {
    const a = codeToArgs('let p = cad.box(Math.PI, 1, 1)')
    expect(a.positional[0]).toEqual({ kind: 'expr-ref', text: 'Math.PI', refs: [], params: [] })

    const b = codeToArgs('let p = cad.box(Math.max(size, 20), 1, 1)')
    expect(b.positional[0]).toMatchObject({ kind: 'expr-ref', text: 'Math.max(size, 20)', params: ['size'] })
  })

  it('单位常量在单行提取里同样不入 params（保持既有折叠行为）', () => {
    const a = codeToArgs('let p = cad.box(10 * MM, 1, 1)')
    expect(a.positional[0]).toBe(10)
  })
})

describe('script-globals: 宿主实时校验（validateExpression）', () => {
  const meta = extractMetadata('const w = 10\nlet p = cad.box(w, 1, 1)')

  it('meta.names 作 knownNames 时 Math 表达式通过', () => {
    for (const text of ['Math.PI * w', 'Math.max(w, 20)', 'JSON.parse("{}").length', 'Number("1") + w']) {
      expect(validateExpression({ text, knownNames: meta.names }), text).toEqual({ ok: true })
    }
  })

  it('无需把 S4 全局塞进 names：空 knownNames 也通过（它们是全局，与脚本无关）', () => {
    expect(validateExpression({ text: 'Math.PI * 2', knownNames: [] })).toEqual({ ok: true })
  })

  it('未知名字仍被驳回', () => {
    const r = validateExpression({ text: 'zzz + 1', knownNames: meta.names })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('E_REFERENCE')
  })
})

describe('script-globals: append 前缀校验（missingPrefixVar）', () => {
  const de = new DirectExecutor({ namespaces: { cad: createApiNamespaceWithEditorOps() } })

  it('安全全局不再被误报为「缺失引用」', () => {
    for (const code of [
      'let p1 = cad.box(Math.PI, 1, 1)',
      'let p1 = cad.box(console, 1, 1)',
      'let p1 = cad.box(String, 1, 1)',
      'let p1 = cad.box(MM, 1, 1)',
      'let p1 = cad.box(10 * INCH, 1, 1)',
      'let p1 = cad.box(Infinity, 1, 1)',
    ]) {
      expect(de.missingPrefixVar(code), code).toBeUndefined()
    }
  })

  it('真正的缺失引用仍然被报出', () => {
    expect(de.missingPrefixVar('let p1 = cad.box(nope, 1, 1)')).toEqual({ unitLine: 1, varName: 'nope' })
    expect(de.missingPrefixVar('let p1 = cad.box(nope + 1, 1, 1)')).toEqual({ unitLine: 1, varName: 'nope' })
  })
})

describe('script-globals: 端到端求值（mesh；两种执行后端）', () => {
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespaceWithEditorOps() })

  /** 执行 code 并返回唯一几何产出的 X 跨度。 */
  async function runSpanX(code: string, backend: 'vm' | 'interpreter'): Promise<number> {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
    const ex = new DirectExecutor({ namespaces: { cad: createApiNamespaceWithEditorOps() }, execBackend: backend })
    const out = await ex.execute(code)
    expect(out.failedAt, `${code} :: ${JSON.stringify(out.failedAt)}`).toBeUndefined()
    const shape = Object.values(ex.ctx).find(
      (v) => v !== null && typeof v === 'object' && 'positions' in (v as object),
    )
    return spanX(shape)
  }

  for (const backend of ['vm', 'interpreter'] as const) {
    describe(`后端 ${backend}`, () => {
      it('Math.sqrt(100) 真的算成 10（不是 undefined 被吞）', async () => {
        expect(await runSpanX('let p = cad.box(Math.sqrt(100), 1, 1)', backend)).toBeCloseTo(10, 4)
      })

      it('Math.PI 真的算成 π', async () => {
        expect(await runSpanX('let p = cad.box(Math.PI, 1, 1)', backend)).toBeCloseTo(Math.PI, 4)
      })

      it('Math.max 读得到脚本变量', async () => {
        expect(await runSpanX('const x = 4\nlet p = cad.box(Math.max(x, 20), 1, 1)', backend)).toBeCloseTo(20, 4)
      })

      it('裸全局函数调用 Number / parseFloat 走 globalThis', async () => {
        expect(await runSpanX('let p = cad.box(Number("7"), 1, 1)', backend)).toBeCloseTo(7, 4)
        expect(await runSpanX('let p = cad.box(parseFloat("2.5"), 1, 1)', backend)).toBeCloseTo(2.5, 4)
      })

      it('裸单位常量：MM=1 / INCH=25.4', async () => {
        expect(await runSpanX('let p = cad.box(MM, 1, 1)', backend)).toBeCloseTo(1, 4)
        expect(await runSpanX('let p = cad.box(INCH, 1, 1)', backend)).toBeCloseTo(25.4, 4)
      })

      it('单位常量参与算术（10 * MM）仍走静态折叠', async () => {
        expect(await runSpanX('let p = cad.box(10 * MM, 1, 1)', backend)).toBeCloseTo(10, 4)
      })

      it('嵌套对象属性值里的 Math 参与求值（center: Math.PI > 3 → 真 → 居中）', async () => {
        expect(await runSpanX('let p = cad.box(1, 1, 1, { center: Math.PI > 3 })', backend)).toBeCloseTo(1, 4)
      })

      it('同名遮蔽优先于全局：let Math = 5 仍按用户变量解析', async () => {
        expect(await runSpanX('const Math = 5\nlet p = cad.box(Math, 1, 1)', backend)).toBeCloseTo(5, 4)
      })

      it('Infinity 被正确求值，并在 op 层被有限性校验拒绝（而非提取期 E_REFERENCE）', async () => {
        await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
        const ex = new DirectExecutor({ namespaces: { cad: createApiNamespaceWithEditorOps() }, execBackend: backend })
        const out = await ex.execute('let p = cad.box(Infinity, 1, 1)')
        expect(out.failedAt?.message).toContain('finite number')
      })
    })
  }
})

// ── A1：六处判定点 · 全集驱动不变量 ──────────────────────────────────────────
//
// `5e556070` 把「裸标识符是否免 import」收口到 `isSafeGlobalIdent()` 后，判定点仍有
// 六处（metadata-extractor ×3、direct-executor ×2、code-to-args ×1）。上面的用例只
// 硬编码了 `Math` / `Number` / `MM` 几个名字——名单新增一项时，漏抄的判定点不会被发现。
//
// 本组把「六处判定与 S4 白名单一致」变成**持续不变量**：遍历 `S4_SAFE_GLOBALS` 全集
// 驱动每个判定点，并保留反向断言（名单外标识符在对应语义下仍按未知处理）。
// 新增安全全局后本组自动覆盖，无需改测试。
//
// 判据映射（对应 security-scanner.ts `isSafeGlobalIdent` docstring 的「六处」）：
//  1. metadata-extractor.collectExprIdentifiers  —— 表达式位置
//  2. metadata-extractor.parseValueExpr         —— 裸全局作对象属性值
//  3. metadata-extractor.parsePositionalArgs    —— 裸全局作位置实参
//  4. direct-executor.collectRefs               —— append 前缀校验（missingPrefixVar）
//  5. direct-executor.transformArg / emitCall   —— 发射保持裸名（不得写成 __ctx.<name>）
//  6. code-to-args.extractIdentifiers           —— 单行提取哨兵不得造幻影参数

describe('script-globals: 六处判定点 · 全集驱动不变量（A1）', () => {
  const GLOBALS: readonly string[] = [...S4_SAFE_GLOBALS]
  /** 名单外的代表性标识符（反向断言用）。 */
  const UNKNOWN = ['zzz', 'nope', 'helper'] as const

  it('全集非空且都是字符串（守卫自身有效）', () => {
    expect(GLOBALS.length).toBeGreaterThan(0)
    expect(GLOBALS.every((n) => typeof n === 'string' && n.length > 0)).toBe(true)
  })

  it('判定点 1：collectExprIdentifiers —— 表达式位置放行全集', () => {
    const failed: string[] = []
    for (const name of GLOBALS) {
      try {
        extractMetadata(`let p = cad.box(${name} + 0, 1, 1)`)
      } catch (e) {
        failed.push(`${name}: ${(e as Error).message}`)
      }
    }
    expect(failed).toEqual([])
  })

  it('判定点 2：parseValueExpr —— 裸全局作对象属性值放行全集', () => {
    const failed: string[] = []
    for (const name of GLOBALS) {
      try {
        extractMetadata(`let p = cad.box(1, 1, 1, { center: ${name} })`)
      } catch (e) {
        failed.push(`${name}: ${(e as Error).message}`)
      }
    }
    expect(failed).toEqual([])
  })

  it('判定点 3：parsePositionalArgs —— 裸全局作位置实参放行全集', () => {
    const failed: string[] = []
    for (const name of GLOBALS) {
      try {
        extractMetadata(`let p = cad.box(${name}, 1, 1)`)
      } catch (e) {
        failed.push(`${name}: ${(e as Error).message}`)
      }
    }
    expect(failed).toEqual([])
  })

  it('判定点 4：direct-executor.collectRefs —— 全集不得被误报为缺失引用', () => {
    const de = new DirectExecutor({ namespaces: { cad: createApiNamespaceWithEditorOps() } })
    const failed: string[] = []
    for (const name of GLOBALS) {
      const missing = de.missingPrefixVar(`let p1 = cad.box(${name}, 1, 1)`)
      if (missing !== undefined) failed.push(`${name}: ${JSON.stringify(missing)}`)
    }
    expect(failed).toEqual([])
  })

  it('判定点 5：transformArg / emitCall —— 全集发射保持裸名（不得写成 __ctx.<name>）', () => {
    const de = new DirectExecutor({ namespaces: { cad: createApiNamespaceWithEditorOps() } })
    // TS `private` 在运行时抹除；守卫测试白盒取发射文本（无公开只读入口）。
    const internals = de as unknown as {
      parseAndTransform(code: string): Array<{ body: string }>
    }
    const emitted = (code: string): string =>
      internals.parseAndTransform(code).map((u) => u.body).join('\n')

    const failed: string[] = []
    for (const name of GLOBALS) {
      const body = emitted(`let p1 = cad.box(${name}, 1, 1)`)
      if (body.includes(`__ctx.${name}`)) failed.push(`${name}: emitted __ctx.${name}`)
    }
    expect(failed).toEqual([])

    // 全局**函数**必须以裸名调用，否则运行时 `__ctx.Number is not a function`。
    const callable = ['Number', 'String', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite']
    const callFailed: string[] = []
    for (const name of callable) {
      const body = emitted(`let p1 = cad.box(${name}("7"), 1, 1)`)
      if (body.includes(`__ctx.${name}`)) callFailed.push(`${name}: emitted __ctx.${name}`)
    }
    expect(callFailed).toEqual([])
  })

  it('判定点 6：code-to-args.extractIdentifiers —— 全集不得造幻影参数', () => {
    const failed: string[] = []
    for (const name of GLOBALS) {
      const a = codeToArgs(`let p = cad.box(${name}, 1, 1)`)
      const slot = a.positional[0] as { kind?: string; params?: string[] } | number | undefined
      // 单位常量折叠为数字（无 params 可言）；其余全局为引用形态，params 必须为空。
      if (slot !== null && typeof slot === 'object' && Array.isArray(slot.params) && slot.params.includes(name)) {
        failed.push(`${name}: phantom param in ${JSON.stringify(slot)}`)
      }
    }
    expect(failed).toEqual([])
  })

  it('反向断言：名单外标识符在六处仍按「未知」处理', () => {
    for (const name of UNKNOWN) {
      // 1 表达式位置 → E_REFERENCE
      expect(() => extractMetadata(`let p = cad.box(${name} + 0, 1, 1)`), name).toThrow()
      // 2 对象属性值 → E_REFERENCE
      expect(() => extractMetadata(`let p = cad.box(1, 1, 1, { center: ${name} })`), name).toThrow()
      // 3 位置实参 → E_REFERENCE
      expect(() => extractMetadata(`let p = cad.box(${name}, 1, 1)`), name).toThrow()
      // 4 append 前缀校验 → 报缺失引用
      const de = new DirectExecutor({ namespaces: { cad: createApiNamespaceWithEditorOps() } })
      expect(de.missingPrefixVar(`let p1 = cad.box(${name}, 1, 1)`), name).toEqual({ unitLine: 1, varName: name })
      // 6 单行提取 → 必须被前置哨兵声明（未知名当参数，测出的是「未知」而非「全局」）
      const a = codeToArgs(`let p = cad.box(${name}, 1, 1)`)
      expect(a.positional[0], name).toMatchObject({ kind: 'var-ref', name })
    }
  })

  it('反向断言：isSafeGlobalIdent 对名单外标识符返回 false', () => {
    for (const name of UNKNOWN) {
      expect(S4_SAFE_GLOBALS.has(name), name).toBe(false)
      expect(isSafeGlobalIdent(name), name).toBe(false)
    }
  })
})
