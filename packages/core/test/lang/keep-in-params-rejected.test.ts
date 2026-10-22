/**
 * @vitest-environment node
 *
 * keep 只能独立成句（2026-10-22）：**参数位写 keep 一律报错**，不静默生效。
 *
 * 被钉住的四种写错形态：
 * 1. 选项对象里的 `keep: [...]` —— 旧通道，运行时要么把对象当成第 3 个形状（布尔崩），
 *    要么完全无视（`cad.assembly({ …, keep: [p] })` 的游离键）；
 * 2. 选项对象里的 `keepHidden: true` —— 同上；
 * 3. `part0.keep(x)` —— 带实参；
 * 4. `cad.keep(part0)` / `ns.keep(part0)` —— 命名空间 callee（又一种"把变量塞进参数"）。
 *
 * 走 `check()`（纯静态，无几何副作用），所以不需要内核初始化。注意 `check()` 会带
 * `opDims` 做量纲校验，因此这里的字面量一律带单位（`20 * MM`）；安全扫描默认 strict，
 * 只有专门验 `E_REFERENCE` 的用例把策略关掉，否则未知标识符会先被 `SEC_FREE_IDENT` 拦下。
 */

import { describe, it, expect } from 'vitest'
import { createRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import type { CadRuntimeOptions, CheckResult } from '../../src/cad-runtime/runtime'

const PORTS: HostPorts = { events: { emit: (): void => { /* nothing to observe */ } } }

function check(code: string, options?: CadRuntimeOptions): CheckResult {
  return createRuntime(PORTS, 'mesh', undefined, options).check(code)
}

/** 断言静态检查失败，且第一条错误命中期望的诊断码。 */
function expectRejected(code: string, expected: 'E_STATEMENT' | 'E_REFERENCE', options?: CadRuntimeOptions): string {
  const result = check(code, options)
  expect(result.ok, `expected rejection for:\n${code}`).toBe(false)
  const first = result.errors[0]
  expect(first.code, `errors: ${JSON.stringify(result.errors)}`).toBe(expected)
  return first.message
}

const BOX_A = 'let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })'
const BOX_B = 'let part1 = cad.box(10 * MM, 10 * MM, 10 * MM, { centered: true })'

describe('keep in the argument object is rejected', () => {
  it('选项对象里的 keep: [...] → E_STATEMENT，并指向 a.keep()', () => {
    const message = expectRejected(
      [BOX_A, BOX_B, "let part2 = cad.subtract(part0, part1, { keep: ['part0'] })"].join('\n'),
      'E_STATEMENT',
    )
    expect(message).toContain('"keep" is not an op option')
    expect(message).toContain('a.keep()')
    expect(message).toContain('instead of passing it in the argument object')
  })

  it('选项对象里的 keepHidden: true → E_STATEMENT，并指向 a.keepHidden()', () => {
    const message = expectRejected(
      [BOX_A, 'let part1 = cad.drill(part0, { diameter: 8 * MM, keepHidden: true })'].join('\n'),
      'E_STATEMENT',
    )
    expect(message).toContain('"keepHidden" is not an op option')
    expect(message).toContain('a.keepHidden()')
  })

  it('只有一个 keep 键的对象也算参数位写法（不是"空对象"）', () => {
    expectRejected([BOX_A, 'let part1 = cad.copy(part0, { keep: [part0] })'].join('\n'), 'E_STATEMENT')
  })

  it('cad.assembly({ …, keep: [...] }) 的游离键同样拒绝（成员本来就由库内 keep 保留）', () => {
    expectRejected(
      [
        BOX_A,
        BOX_B,
        "let asm1 = cad.assembly({ name: 'A', members: [part0, part1], constraints: [], keep: [part0] })",
      ].join('\n'),
      'E_STATEMENT',
    )
  })
})

describe('malformed keep statements are rejected', () => {
  it('part0.keep(x) 带实参 → E_STATEMENT', () => {
    const message = expectRejected([BOX_A, BOX_B, 'part0.keep(part1)'].join('\n'), 'E_STATEMENT')
    expect(message).toContain('takes no arguments')
  })

  it('cad.keep(part0) 命名空间写法 → E_STATEMENT（要声明在变量上）', () => {
    const message = expectRejected([BOX_A, 'cad.keep(part0)'].join('\n'), 'E_STATEMENT')
    expect(message).toContain('is not supported')
  })

  it('未声明变量的 keep → E_REFERENCE（安全扫描关闭时由提取器报出）', () => {
    const message = expectRejected('part0.keep()', 'E_REFERENCE', { security: 'off' })
    expect(message).toContain('unknown variable "part0"')
  })

  it('安全扫描开着时同一个错误先被 SEC_FREE_IDENT 拦下（两道闸门都在）', () => {
    const result = check('part0.keep()')
    expect(result.ok).toBe(false)
    expect(result.errors[0].code).toBe('E_SECURITY')
    expect(result.errors[0].stage).toBe('security')
  })
})

describe('well-formed keep statements are accepted', () => {
  it('part0.keep() / part1.keepHidden() 通过静态检查', () => {
    const result = check(
      [BOX_A, BOX_B, 'let part2 = cad.union(part0, part1)', 'part0.keep()', 'part1.keepHidden()'].join('\n'),
    )
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('写在消费语句之前也合法（声明是全局的，与行序无关）', () => {
    const result = check([BOX_A, 'part0.keep()', BOX_B, 'let part2 = cad.union(part0, part1)'].join('\n'))
    expect(result.ok, JSON.stringify(result.errors)).toBe(true)
  })
})
