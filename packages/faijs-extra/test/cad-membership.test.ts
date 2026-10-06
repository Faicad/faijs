/**
 * cad-membership — the cad-namespace assembly guard (plan §4.3 / §7).
 *
 * After the split, `cad` is assembled by the host out of two namespaces that
 * live in different packages. Nothing in the type system notices if one side
 * loses a key or if the two ever collide, so this test derives the membership
 * equation from the runtime objects and fails on any drift:
 *
 *     keys(createEditorCadNamespace()) == keys(createApiNamespace()) ∪ ALL_EDITOR_OPS
 *
 * It also pins the P5 symbol-table extension: registering the editor op names
 * makes them statically queryable, and a library may never shadow a platform
 * function.
 */
import { describe, it, expect } from 'vitest'
import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import { getFunctionSymbol, registerSymbolTableEntries, symbolTableNames } from '@faicad/faijs/symbol-table'
import {
  ALL_EDITOR_OPS, CREATOR_OPS, EDITOR_OPS,
  createEditorCadNamespace, createEditorNamespace,
  registerEditorSymbols, unregisterEditorSymbols,
} from '../src/index'
import {
  createEditorOpsNamespace, createEditorOwnedCadNamespace,
  registerEditorOpsSymbols, unregisterEditorOpsSymbols,
} from '../src/editor-ops'

const keysOf = (ns: Record<string, unknown>): string[] =>
  Object.keys(ns).filter((k) => k !== 'contractVersion')

describe('cad namespace membership', () => {
  it('the full editor namespace carries exactly ALL_EDITOR_OPS', () => {
    expect(new Set(keysOf(createEditorNamespace() as unknown as Record<string, unknown>)))
      .toEqual(new Set(ALL_EDITOR_OPS))
  })

  it('the editor-op namespace carries exactly EDITOR_OPS', () => {
    expect(new Set(keysOf(createEditorOpsNamespace() as unknown as Record<string, unknown>)))
      .toEqual(new Set(EDITOR_OPS))
  })

  it('EDITOR_OPS and CREATOR_OPS are disjoint and make up ALL_EDITOR_OPS', () => {
    expect(EDITOR_OPS.filter((n) => (CREATOR_OPS as readonly string[]).includes(n))).toEqual([])
    expect([...ALL_EDITOR_OPS]).toEqual([...EDITOR_OPS, ...CREATOR_OPS])
  })

  it('the platform namespace no longer carries any editor op', () => {
    const platform = createApiNamespace() as unknown as Record<string, unknown>
    for (const name of ALL_EDITOR_OPS) {
      expect(name in platform, `core's cad namespace still carries "${name}"`).toBe(false)
    }
  })

  it('merged cad keys == platform keys ∪ ALL_EDITOR_OPS', () => {
    const platform = keysOf(createApiNamespace() as unknown as Record<string, unknown>)
    const merged = keysOf(createEditorCadNamespace() as unknown as Record<string, unknown>)
    expect(new Set(merged)).toEqual(new Set([...platform, ...ALL_EDITOR_OPS]))
  })

  it('the three-basic-only namespace keeps every platform key too', () => {
    const platform = keysOf(createApiNamespace() as unknown as Record<string, unknown>)
    const merged = keysOf(createEditorOwnedCadNamespace() as unknown as Record<string, unknown>)
    expect(new Set(merged)).toEqual(new Set([...platform, ...EDITOR_OPS]))
  })
})

describe('P5 — symbol-table extension', () => {
  it('editor op names become queryable after registration', () => {
    registerEditorSymbols()
    try {
      for (const name of ALL_EDITOR_OPS) {
        expect(getFunctionSymbol(name), `missing symbol for editor op "${name}"`).toBeDefined()
      }
      expect(symbolTableNames()).toEqual(expect.arrayContaining([...ALL_EDITOR_OPS]))
    } finally {
      unregisterEditorSymbols()
    }
    expect(getFunctionSymbol('fai_drill')).toBeUndefined()
  })

  it('the A-only registration covers EDITOR_OPS only', () => {
    registerEditorOpsSymbols()
    try {
      for (const name of EDITOR_OPS) expect(getFunctionSymbol(name)).toBeDefined()
      for (const name of CREATOR_OPS) expect(getFunctionSymbol(name)).toBeUndefined()
    } finally {
      unregisterEditorOpsSymbols()
    }
  })

  it('a library may not shadow a platform function', () => {
    // `box` is generated into the platform table; redefining it would let the
    // extension silently change what static analysis sees.
    expect(() => registerSymbolTableEntries(['box'])).toThrow(/redefines platform function "box"/)
  })

  it('registration is idempotent for extension names', () => {
    registerEditorSymbols()
    try {
      expect(() => registerEditorSymbols()).not.toThrow()
    } finally {
      unregisterEditorSymbols()
    }
  })
})
