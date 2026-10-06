/**
 * core-surface — "core carries no consumer-surface symbol" guard (plan §7).
 *
 * The split moves the editor ops and the svg/3D-text preview helpers out of
 * core. `cad-membership.test.ts` pins the *namespace*; this file pins the
 * **published entry surfaces** — the thing a consumer actually imports. Both
 * halves are needed: a name can leave the `cad` namespace while a stale re-export
 * keeps it importable from `@faicad/faijs` or `@faicad/faijs/browser`, and that
 * is how a "removed" API quietly survives a major release.
 *
 * The test is deliberately written against the runtime export objects, so it
 * cannot be satisfied by editing a comment or a type declaration.
 */
import { describe, it, expect } from 'vitest'
import * as coreRoot from '@faicad/faijs'
import * as coreBrowser from '@faicad/faijs/browser'
import * as symbolTable from '@faicad/faijs/symbol-table'
import { ALL_EDITOR_OPS, CREATOR_OPS, EDITOR_OPS } from '../src/op-names'

/** The preview helpers that moved with the B group. */
const MIGRATED_PREVIEW_HELPERS = [
  'svgToExtrudedGeometry',
  'parseSvgShapes',
  'extrudeShapes',
  'createTextGeometry',
  'getOpentypeFont',
  'opentypePathToGeometry',
  'createMixedTextGeometry',
]

/** Symbols that must stay on core (they never moved). */
const STILL_CORE = [
  'containsCjk',
  'isCjkChar',
  'loadSystemCjkFont',
  'engrave',
  'knurl',
  'translate',
  'rotate_euler',
  'scale',
  'scale3d',
]

const CORE_ENTRIES: Array<[string, Record<string, unknown>]> = [
  ['@faicad/faijs', coreRoot as unknown as Record<string, unknown>],
  ['@faicad/faijs/browser', coreBrowser as unknown as Record<string, unknown>],
]

describe('core entry surfaces carry no editor / creator symbol', () => {
  for (const [name, mod] of CORE_ENTRIES) {
    it(`${name}: no editor op and no creator op is exported`, () => {
      const leaked = [...ALL_EDITOR_OPS].filter((op) => op in mod)
      expect(leaked, `${name} still exports editor/creator op(s)`).toEqual([])
    })

    it(`${name}: no migrated svg/3D-text preview helper is exported`, () => {
      const leaked = MIGRATED_PREVIEW_HELPERS.filter((helper) => helper in mod)
      expect(leaked, `${name} still exports helper(s)`).toEqual([])
    })

    it(`${name}: the platform symbols that stayed in core are still exported`, () => {
      const missing = STILL_CORE.filter((symbol) => !(symbol in mod))
      expect(missing, `${name} lost platform symbol(s)`).toEqual([])
    })
  }

  it('the entry points expose the engrave decoration provider (the injected port)', () => {
    for (const [name, mod] of CORE_ENTRIES) {
      expect(typeof mod.setEngraveDecorationProvider, `${name} lacks setEngraveDecorationProvider`).toBe('function')
      expect(typeof mod.getEngraveDecorationProvider, `${name} lacks getEngraveDecorationProvider`).toBe('function')
    }
  })

  it('core never re-exports the extension library helpers', () => {
    const extras = [
      'createEditorNamespace', 'createEditorCadNamespace', 'mergeEditorNamespace',
      'registerEditorSymbols', 'unregisterEditorSymbols',
      'installEditorMeshProviders', 'uninstallEditorMeshProviders',
      'EDITOR_OPS', 'CREATOR_OPS', 'ALL_EDITOR_OPS', 'isEditorOp',
    ]
    for (const [name, mod] of CORE_ENTRIES) {
      const leaked = extras.filter((symbol) => symbol in mod)
      expect(leaked, `${name} re-exports extension-library symbol(s)`).toEqual([])
    }
  })
})

describe('@faicad/faijs/symbol-table hosts the extension registry, not the ops', () => {
  it('exposes the registry entry points', () => {
    for (const fn of ['registerSymbolTableEntries', 'unregisterSymbolTableEntries', 'symbolTableNames', 'getFunctionSymbol']) {
      expect(typeof (symbolTable as unknown as Record<string, unknown>)[fn], `missing ${fn}`).toBe('function')
    }
  })

  it('the generated table holds the platform surface, not the editor ops', () => {
    // Extensions live beside the generated table, not inside it — that is what
    // keeps "platform surface" machine-derivable from the generated file alone.
    const generated = symbolTable.SYMBOL_TABLE as Record<string, unknown>
    expect(Object.keys(generated).length).toBeGreaterThan(0)
    for (const op of ALL_EDITOR_OPS) {
      expect(op in generated, `generated table contains editor op "${op}"`).toBe(false)
    }
  })

  it('the op-name lists are disjoint and cover the namespace', () => {
    expect([...EDITOR_OPS].some((n) => (CREATOR_OPS as readonly string[]).includes(n))).toBe(false)
    expect([...ALL_EDITOR_OPS]).toEqual([...EDITOR_OPS, ...CREATOR_OPS])
  })
})
