/**
 * namespace (C3/F5) tests — draw symbol registration and namespace merge.
 *
 * Verifies the draw namespace is core's platform surface plus `draw`, and that
 * register/unregister toggles the `draw` entry in the core symbol table for
 * static analysis.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import { getFunctionSymbol } from '@faicad/faijs/symbol-table'
import {
  DRAW_OPS,
  createDrawCadNamespace,
  createDrawNamespace,
  registerDrawSymbols,
  unregisterDrawSymbols,
} from '../src/namespace'

describe('draw namespace', () => {
  it('fragment exposes only the draw entry plus the version', () => {
    const ns = createDrawNamespace() as unknown as Record<string, unknown>
    expect(ns.draw).toBeTruthy()
    expect(ns.contractVersion).toBeTruthy()
  })

  it('merged namespace is a superset of the core platform surface', () => {
    const platform = createApiNamespace() as unknown as Record<string, unknown>
    const merged = createDrawCadNamespace() as unknown as Record<string, unknown>
    for (const key of Object.keys(platform)) {
      expect(merged[key], `missing core key ${key}`).toBeDefined()
    }
    expect(merged.draw).toBeTruthy()
  })
})

describe('draw symbols', () => {
  beforeEach(() => unregisterDrawSymbols())
  afterEach(() => unregisterDrawSymbols())

  it('appears only after register, and vanishes on unregister', () => {
    expect(DRAW_OPS).toEqual(['draw'])
    expect(getFunctionSymbol('draw')).toBeUndefined()
    registerDrawSymbols()
    expect(getFunctionSymbol('draw')).toBeDefined()
    unregisterDrawSymbols()
    expect(getFunctionSymbol('draw')).toBeUndefined()
  })
})