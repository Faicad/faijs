/**
 * determinism-scanner — B-tier conservative taint unit tests.
 *
 * Covers the allowed/rejected examples from docs/reproducibility-contract.md §3
 * plus the universe of source → sink flows the scanner must catch.
 */

import { describe, it, expect } from 'vitest'
import { scanDeterminism } from '../../src/lang/determinism-scanner'

function scan(code: string, opts: Parameters<typeof scanDeterminism>[1] = {}) {
  return scanDeterminism(code, opts)
}

describe('determinism-scanner: allowed (console / non-geometry flow)', () => {
  it('console.log(Date.now())', () => {
    expect(scan('console.log(Date.now())').ok).toBe(true)
  })

  it('const t = Date.now(); console.log(t)', () => {
    expect(scan('const t = Date.now()\nconsole.log(t)').ok).toBe(true)
  })

  it('pure math computation does not violate', () => {
    expect(scan('const x = Math.sin(1)\nconst y = Math.max(2, 3)').ok).toBe(true)
  })
})

describe('determinism-scanner: rejected (source reaches geometry sink)', () => {
  it('cad.box(Date.now(), ...) direct argument', () => {
    const r = scan('let part0 = cad.box(Date.now(), 10, 10)')
    expect(r.ok).toBe(false)
    expect(r.violations[0].source).toBe('Date')
  })

  it('taint carried through a variable into cad.*', () => {
    const r = scan('const w = Date.now()\nlet part0 = cad.box(w, 10, 10)')
    expect(r.ok).toBe(false)
  })

  it('Math.random into cad.sphere', () => {
    const r = scan('let part0 = cad.sphere({ radius: Math.random() })')
    expect(r.ok).toBe(false)
    expect(r.violations[0].source).toBe('Math.random')
  })

  it('new Date() into geometry', () => {
    const r = scan('let part0 = cad.box(new Date(), 1, 1)')
    expect(r.ok).toBe(false)
    expect(r.violations[0].source).toBe('Date')
  })

  it('Math.random carried through translate offset array', () => {
    const r = scan('const t = Math.random()\ncad.translate(part0, { offset: [t, 0, 0] })')
    expect(r.ok).toBe(false)
  })

  it('implicit flow: tainted if-condition selects geometry', () => {
    const r = scan('let r = 10\nif (Date.now() > 0) r = 20\nlet part0 = cad.sphere({ radius: r })')
    expect(r.ok).toBe(false)
  })

  it('unknown callee with tainted argument (conservative)', () => {
    const r = scan('const v = helper(Date.now())')
    expect(r.ok).toBe(false)
  })

  it('function body uses Date.now directly in geometry', () => {
    const r = scan('function f() { return cad.box(Date.now(), 1, 1) }')
    expect(r.ok).toBe(false)
  })

  it('performance.now into geometry', () => {
    const r = scan('let part0 = cad.box(performance.now(), 1, 1)')
    expect(r.ok).toBe(false)
  })

  it('crypto.getRandomValues into geometry', () => {
    const r = scan('let part0 = cad.box(crypto.getRandomValues(new Uint8Array(1))[0], 1, 1)')
    expect(r.ok).toBe(false)
  })
})

describe('determinism-scanner: library call sites', () => {
  it('library namespace member is a sink (extraNamespaces)', () => {
    const r = scan('sheet.make(Date.now())', { extraNamespaces: ['sheet'] })
    expect(r.ok).toBe(false)
  })

  it('named library callee is a sink (extraCallees)', () => {
    const r = scan('gear(Date.now())', { extraCallees: ['gear'] })
    expect(r.ok).toBe(false)
  })

  it('cad default namespace still detected with extra hints', () => {
    const r = scan('let part0 = cad.box(Date.now(), 1, 1)', { extraNamespaces: ['sheet'], extraCallees: ['gear'] })
    expect(r.ok).toBe(false)
  })
})

describe('determinism-scanner: strict parse (library source contract)', () => {
  it('strict: TS-syntax source throws SyntaxError (type stripping is not supported)', () => {
    expect(() => scan('export function make(n: number): number { return n }', { strict: true }))
      .toThrow(/library source is not valid plain JavaScript/)
  })

  it('strict: plain JS parses and scans normally (violations still detected)', () => {
    const r = scan('const w = Math.random()\nlet part0 = cad.box(w, 10, 10)', { strict: true })
    expect(r.ok).toBe(false)
    expect(r.violations[0].source).toBe('Math.random')
  })

  it('strict: clean plain JS returns ok', () => {
    const r = scan('export function make(n) { return n }', { strict: true })
    expect(r.ok).toBe(true)
  })

  it('non-strict: parse failure stays silent ok (main script path owns syntax diagnostics)', () => {
    expect(scan('export function make(n: number): number { return n }').ok).toBe(true)
  })
})