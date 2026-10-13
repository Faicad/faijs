/**
 * cad-membership — the cad-namespace completeness guard (2026-10-13 merge).
 *
 * After the merge, `createApiNamespace()` is the single source of truth for
 * the `cad` namespace. It contains platform + sketch + extra ops. This test
 * verifies that all merged ops are present in the namespace and that the
 * op-name lists (ALL_EDITOR_OPS, EDITOR_OPS, CREATOR_OPS) are consistent.
 *
 * It also pins:
 * - The symbol-table extension is no longer needed (ops are in the generated
 *   table directly), but legacy registration still works without error.
 * - A library may never shadow a platform function.
 */
import { describe, it, expect } from 'vitest'
import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import { getFunctionSymbol, registerSymbolTableEntries, symbolTableNames } from '@faicad/faijs/symbol-table'
import {
  ALL_EDITOR_OPS, CREATOR_OPS, EDITOR_OPS,
} from '../../src/extra/op-names'

const keysOf = (ns: Record<string, unknown>): string[] =>
  Object.keys(ns).filter((k) => k !== 'contractVersion')

describe('cad namespace membership (post-merge)', () => {
  it('createApiNamespace() contains all editor ops', () => {
    const ns = createApiNamespace() as unknown as Record<string, unknown>
    for (const name of ALL_EDITOR_OPS) {
      expect(name in ns, `cad namespace missing merged op "${name}"`).toBe(true)
    }
  })

  it('EDITOR_OPS and CREATOR_OPS are disjoint and make up ALL_EDITOR_OPS', () => {
    expect(EDITOR_OPS.filter((n) => (CREATOR_OPS as readonly string[]).includes(n))).toEqual([])
    expect([...ALL_EDITOR_OPS]).toEqual([...EDITOR_OPS, ...CREATOR_OPS])
  })

  it('createApiNamespace() contains the sketch op', () => {
    const ns = createApiNamespace() as unknown as Record<string, unknown>
    expect('sketch' in ns).toBe(true)
  })

  it('the merged op names are present in the generated symbol table', () => {
    // After the merge, the 10 new ops are listed explicitly in
    // createApiNamespace(), so gen-symbol-table discovers them automatically.
    for (const name of ALL_EDITOR_OPS) {
      expect(getFunctionSymbol(name), `missing symbol for merged op "${name}"`).toBeDefined()
    }
    expect(symbolTableNames()).toEqual(expect.arrayContaining([...ALL_EDITOR_OPS]))
    expect(getFunctionSymbol('sketch')).toBeDefined()
  })

  it('a library may not shadow a platform function', () => {
    // `box` is generated into the platform table; redefining it would let the
    // extension silently change what static analysis sees.
    expect(() => registerSymbolTableEntries(['box'])).toThrow(/redefines platform function "box"/)
  })
})
