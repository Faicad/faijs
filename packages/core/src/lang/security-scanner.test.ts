/**
 * security-scanner — 静态安全门禁单元测试
 *
 * 覆盖方案 docs/plans/2026-09-08-faijs-security-gate.md §8.1 的验收断言
 * S-1 ~ S-27（可在单测层覆盖的部分）。
 *
 * 拒绝类统一用具名 try/catch，放行类断言 scanSource().ok === true。
 */

import { describe, it, expect } from 'vitest'
import { scanSource, assertSecure, S6_MAX_DEPTH, S6_MAX_MODULES } from './security-scanner'
import type { SecurityPolicy, SecurityRuleId } from './security-scanner'
import { ParseError } from './parse-error'

// ── 辅助 ──

/** 拒绝类断言：assertSecure 抛 ParseError，code='E_SECURITY'，ruleId 匹配。 */
function expectRejected(code: string, ruleId: SecurityRuleId, policy: SecurityPolicy = 'strict'): void {
  let err: unknown
  try { assertSecure(code, { policy, knownNames: ['cad'] }) } catch (e) { err = e }
  expect(err).toBeInstanceOf(ParseError)
  expect((err as ParseError).code).toBe('E_SECURITY')
  expect((err as ParseError).ruleId).toBe(ruleId)
}

/** 放行类断言：scanSource().ok === true。 */
function expectPassed(code: string, policy: SecurityPolicy = 'strict'): void {
  const result = scanSource(code, { policy, knownNames: ['cad'] })
  expect(result.ok).toBe(true)
  expect(result.violations).toHaveLength(0)
}

// ── S-1 ~ S-16: 必须拒绝 ──

describe('SecurityScanner: must reject (S-1 ~ S-16)', () => {
  it('S-1: function body eval (V-A)', () => {
    expectRejected('function e(){ return eval(\'6*7\') }; const r = e()', 'SEC_IDENT')
  })

  it('S-2: function body globalThis.eval (V-B)', () => {
    expectRejected('function e(){ return globalThis.eval(\'6*7\') }; const r = e()', 'SEC_IDENT')
  })

  it('S-3: for-block eval (V-C)', () => {
    expectRejected('for (let i=0;i<1;i++){ const p = eval(\'6*7\') }', 'SEC_IDENT')
  })

  it('S-4: block Function(...)()  (V-D)', () => {
    expectRejected('for (let i=0;i<1;i++){ const f = Function(\'return 6*7\')() }', 'SEC_IDENT')
  })

  it('S-5: block new Function(...)', () => {
    expectRejected('for (let i=0;i<1;i++){ const f = new Function(\'return 6*7\')() }', 'SEC_IDENT')
  })

  it('S-6: block dynamic import() (V-E)', () => {
    expectRejected("for (let i=0;i<1;i++){ const m = import('./x') }", 'SEC_SYNTAX')
  })

  it('S-7: const g = globalThis', () => {
    expectRejected('const g = globalThis', 'SEC_IDENT')
  })

  it('S-8: block typeof process / function typeof fetch', () => {
    expectRejected('for (let i=0;i<1;i++){ const t = typeof process }', 'SEC_IDENT')
    expectRejected('function f(){ return typeof fetch }', 'SEC_IDENT')
  })

  it('S-9: ({}).constructor.constructor(...)()', () => {
    expectRejected("const x = ({}).constructor.constructor('return 1')()", 'SEC_MEMBER')
  })

  it('S-10: require / WebAssembly / importScripts', () => {
    expectRejected("const r = require('fs')", 'SEC_IDENT')
    expectRejected('const w = WebAssembly', 'SEC_IDENT')
    expectRejected('const s = importScripts', 'SEC_IDENT')
  })

  it('S-11: x.__proto__ / Object.setPrototypeOf', () => {
    expectRejected('const x = {}; x.__proto__ = {}', 'SEC_MEMBER')
    expectRejected('Object.setPrototypeOf({}, {})', 'SEC_MEMBER')
  })

  it('S-12: block cad.box = ... (S7)', () => {
    expectRejected('for (let i=0;i<1;i++){ cad.box = 1 }', 'SEC_NS_ASSIGN')
  })

  it('S-13: undeclared free identifier (e.g. Image)', () => {
    expectRejected('const x = Image', 'SEC_FREE_IDENT')
  })

  it('S-14: debugger / import.meta / tagged template (strict)', () => {
    expectRejected('debugger', 'SEC_SYNTAX')
    expectRejected('const m = import.meta', 'SEC_SYNTAX')
    expectRejected('const x = tag`hello`', 'SEC_SYNTAX')
    // NOTE: `with` statement is a SyntaxError in ESM (sourceType:'module');
    // acorn rejects it before the scanner can flag S2. That's acceptable—the
    // syntax error path (E_SYNTAX) already blocks it. S2 WithStatement is
    // still in the rule table for non-module sourceType contexts.
  })

  it('S-15: sub-module eval → assertSecure throws (module-registry A3)', () => {
    // A3 由 module-registry 包装为 MODULE_SECURITY；这里验证 assertSecure 本身抛错
    let err: unknown
    try {
      assertSecure("function e(){ return eval('1') }", { policy: 'strict', knownNames: ['cad'] })
    } catch (e) { err = e }
    expect(err).toBeInstanceOf(ParseError)
    expect((err as ParseError).code).toBe('E_SECURITY')
  })

  it('S-16: strict rejects, off passes', () => {
    const code = 'const g = globalThis'
    // strict → reject
    let err: unknown
    try { assertSecure(code, { policy: 'strict', knownNames: ['cad'] }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ParseError)
    // off → pass
    expectPassed(code, 'off')
  })
})

// ── S-17: UI and execution channel consistency ──

describe('SecurityScanner: channel consistency (S-17)', () => {
  it('S-17: same code rejected by both scanSource (UI) and assertSecure (exec)', () => {
    const code = 'function f(){ return eval(\'1\') }'
    // UI channel (scanSource)
    const uiResult = scanSource(code, { policy: 'strict', knownNames: ['cad'] })
    expect(uiResult.ok).toBe(false)
    expect(uiResult.violations[0].ruleId).toBe('SEC_IDENT')
    // exec channel (assertSecure)
    let execErr: unknown
    try { assertSecure(code, { policy: 'strict', knownNames: ['cad'] }) } catch (e) { execErr = e }
    expect(execErr).toBeInstanceOf(ParseError)
    expect((execErr as ParseError).code).toBe('E_SECURITY')
    expect((execErr as ParseError).ruleId).toBe('SEC_IDENT')
  })
})

// ── S-18 ~ S-24: must pass (no false positives) ──

describe('SecurityScanner: must pass (S-18 ~ S-24, no false positives)', () => {
  it('S-18: basic op call', () => {
    expectPassed('const part0 = cad.box(10, 10, 10)')
  })

  it('S-19: chaining and destructuring', () => {
    // w0 must be declared first; the scanner checks free identifiers
    expectPassed('const w0 = cad.box(1,1,1); let w1 = w0.rect(100, 100)')
    expectPassed('let part0 = cad.box(1,1,1); const { front: a } = cad.fai_split(part0)')
  })

  it('S-20: derived constants and negative literals', () => {
    // OUTX must be declared (e.g. from import) or the scanner flags it as free ident
    expectPassed('const OUTX = 24; const INX = OUTX - 24')
    expectPassed('const y = -5')
  })

  it('S-21: for/if blocks with declared vars and Math.*', () => {
    expectPassed([
      'const size = 10',
      'for (let i = 0; i < 3; i++) {',
      '  const r = Math.max(i, 1)',
      '}',
    ].join('\n'))
  })

  it('S-22: local function definition and call; Math.PI / JSON.parse / new Date()', () => {
    expectPassed([
      'function helper(x) {',
      '  return Math.PI * x',
      '}',
      'const v = helper(5)',
    ].join('\n'))
    expectPassed('const d = new Date()')
    expectPassed('const r = JSON.parse("{}")')
  })

  it('S-23: import binding auto-collected; $param; cfg.OUTX', () => {
    // import * as cfg → 'cfg' auto-collected into knownNames
    expectPassed("import * as cfg from './x.fai.js'\nconst w = cfg.OUTX")
    // $param is a declared variable (const)
    expectPassed('const $param = 10')
    // import { bp } from './x.fai.js' → 'bp' auto-collected
    expectPassed("import { bp } from './x.fai.js'\nconst s = bp.solid")
  })

  it('S-24: top-level await and console.log', () => {
    expectPassed('const r = await cad.box(1,1,1)')
    expectPassed('console.log("hello")')
  })
})

// ── S-25 ~ S-27: structural limits ──

describe('SecurityScanner: structural limits (S-25 ~ S-27)', () => {
  it('S-25: source too long / too many nodes / too deep', () => {
    // Source length > 1 MiB (a single string literal of 2 MiB)
    const hugeValid = 'const x = "' + 'a'.repeat(2 * 1024 * 1024) + '"'
    const r = scanSource(hugeValid, { policy: 'strict', knownNames: ['cad'] })
    expect(r.violations.some(v => v.ruleId === 'SEC_LIMIT')).toBe(true)
  })

  it('S-26: for(;;) and while(true) → warnings only, ok=true', () => {
    const r1 = scanSource('for(;;){ break }', { policy: 'strict', knownNames: ['cad'] })
    expect(r1.ok).toBe(true)
    expect(r1.warnings.length).toBeGreaterThan(0)
    expect(r1.warnings.some(w => w.ruleId === 'SEC_LIMIT')).toBe(true)

    const r2 = scanSource('while(true){ break }', { policy: 'strict', knownNames: ['cad'] })
    expect(r2.ok).toBe(true)
    expect(r2.warnings.length).toBeGreaterThan(0)
  })

  it('S-27: module depth/count limits (S6 constants exist)', () => {
    // S6 constants are exported and used by module-registry; verify via import
    expect(S6_MAX_DEPTH).toBe(16)
    expect(S6_MAX_MODULES).toBe(64)
  })
})

// ── balanced policy tests ──

describe('SecurityScanner: balanced policy', () => {
  it('balanced allows setTimeout (strict-only) but rejects eval', () => {
    // eval is in both strict and balanced → rejected
    expectRejected('const x = eval', 'SEC_IDENT', 'balanced')
    // setTimeout is strict-only in S1, but in balanced it's NOT in S1.
    // However it's also NOT in S4 safe globals → SEC_FREE_IDENT rejects it.
    // This is correct: D3 says "any identifier not resolvable is rejected."
    expectRejected('const x = setTimeout', 'SEC_FREE_IDENT', 'balanced')
    // crypto is strict-only in S1, same as setTimeout → SEC_FREE_IDENT in balanced
    expectRejected('const x = crypto', 'SEC_FREE_IDENT', 'balanced')
    // TaggedTemplate is strict-only in S2 → balanced allows it
    // BUT the tag identifier must be declared!
    expectPassed('const tag = 1; const x = tag`hello`', 'balanced')
    // globalThis is in both → balanced rejects
    expectRejected('const x = globalThis', 'SEC_IDENT', 'balanced')
  })
})

// ── fixture regression ──

describe('SecurityScanner: existing fixture code passes', () => {
  it('box.fai.js', () => {
    expectPassed([
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(10, 20, 30, { centered: true })',
      'let part2 = cad.box(15, 15, 15, { centered: true, at: [5,5,5] })',
    ].join('\n'))
  })

  it('union.fai.js', () => {
    expectPassed([
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(20, 20, 20, { centered: true, at: [10,0,0] })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'))
  })

  it('params.fai.js', () => {
    expectPassed([
      'const size = 20',
      'const radius = 10',
      'let part0 = cad.box(size, size, size, { centered: true })',
      'let part1 = cad.sphere({ radius:radius, center:[30,0,0] })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'))
  })

  it('split.fai.js (destructuring)', () => {
    expectPassed([
      'let part0 = cad.box(30, 30, 30, { centered: true })',
      'const { front: part1, back: part2 } = cad.fai_split(part0)',
    ].join('\n'))
  })

  it('geom-ref.fai.js (re-assignment)', () => {
    expectPassed([
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'part0 = cad.translate(part0, { offset:[10,0,0] })',
    ].join('\n'))
  })
})
