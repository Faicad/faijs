/**
 * cad-face-completeness — guard: createApiNamespace() contains all declared ops.
 *
 * 2026-10-13 merge: the cad namespace is built-in and complete. This test
 * asserts that every op declared in `api-namespace.ts` (including the merged
 * sketch + extra ops) appears in the runtime namespace. Any "exists but not
 * assembled" op is a hard failure.
 *
 * Also guards against the spread trap (plan §6.6): if someone replaces the
 * explicit op keys with `...spread`, gen-symbol-table would miss them but
 * runtime would still see them — this test catches that too.
 */
import { describe, it, expect } from 'vitest'
import { createApiNamespace } from '../../src/api/api-namespace'
import { SYMBOL_TABLE } from '../../src/lang/symbol-table'
import { ALL_EDITOR_OPS } from '../../src/extra/op-names'

/** cad namespace keys (without contractVersion metadata). */
function cadNamespaceKeys(): string[] {
  return Object.keys(createApiNamespace()).filter((k) => k !== 'contractVersion')
}

describe('cad-face-completeness: all declared ops are in the cad namespace', () => {
  it('merged sketch op "sketch" is in the cad namespace', () => {
    const keys = new Set(cadNamespaceKeys())
    expect(keys.has('sketch')).toBe(true)
  })

  it('all editor ops (A group) are in the cad namespace', () => {
    const keys = new Set(cadNamespaceKeys())
    for (const op of ALL_EDITOR_OPS) {
      expect(keys.has(op), `editor op "${op}" missing from cad namespace`).toBe(true)
    }
  })

  it('merged ops are in the symbol table (guard against spread trap)', () => {
    // gen-symbol-table does NOT discover SpreadAssignment. If someone replaces
    // explicit keys with ...spread, the symbol table would miss them.
    const mergedOps = ['sketch', 'fai_drill', 'fai_extrude', 'fai_split', 'group', 'assembly', 'copy', 'load', 'text', 'svgExtrude']
    for (const op of mergedOps) {
      expect(SYMBOL_TABLE[op], `merged op "${op}" missing from symbol table (was spread used?)`).toBeDefined()
    }
  })

  it('cad namespace functions are all callable (type check)', () => {
    const ns = createApiNamespace() as unknown as Record<string, unknown>
    for (const key of cadNamespaceKeys()) {
      const val = ns[key]
      // Each cad namespace entry must be a function (an op)
      expect(typeof val, `cad.${key} is not a function`).toBe('function')
    }
  })
})
