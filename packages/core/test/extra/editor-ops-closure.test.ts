/**
 * editor-ops-closure — guard: editor-ops entry does not pull in heavy deps.
 *
 * 2026-10-13 merge: the `@faicad/faijs/extra/editor-ops` entry (formerly
 * `@faicad/faijs-extra/editor-ops`) is the lightweight closure for weapp.
 * It must NOT import opentype.js, text geometry, or SVG extrude chains.
 *
 * This test scans the source (not dist) for forbidden imports, serving as
 * a pre-build guard. The dist-level guard is checked by the build system.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const srcFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/extra/editor-ops.ts',
)

describe('editor-ops-closure: lightweight entry stays clean', () => {
  it('editor-ops.ts source file exists', () => {
    expect(existsSync(srcFile), `expected ${srcFile} to exist`).toBe(true)
  })

  it('does not import opentype.js', () => {
    const src = readFileSync(srcFile, 'utf-8')
    expect(src).not.toMatch(/from\s+['"][^'"]*opentype/)
  })

  it('does not import text geometry or svg-extrude modules', () => {
    const src = readFileSync(srcFile, 'utf-8')
    // The editor-ops entry should not import text.ts or svg-extrude.ts
    expect(src).not.toMatch(/from\s+['"]\.\/ops\/text['"]/)
    expect(src).not.toMatch(/from\s+['"]\.\/ops\/svg-extrude['"]/)
    expect(src).not.toMatch(/from\s+['"]\.\/extras\/['"]/)
  })

  it('exports the A group ops (no text/svgExtrude)', () => {
    const src = readFileSync(srcFile, 'utf-8')
    // Should export fai_drill, fai_extrude, fai_split, group, assembly, copy, load
    expect(src).toMatch(/export\s+\{[^}]*fai_drill/)
    expect(src).toMatch(/export\s+\{[^}]*fai_extrude/)
    expect(src).toMatch(/export\s+\{[^}]*fai_split/)
    expect(src).toMatch(/export\s+\{[^}]*group/)
    expect(src).toMatch(/export\s+\{[^}]*assembly/)
    expect(src).toMatch(/export\s+\{[^}]*copy/)
    expect(src).toMatch(/export\s+\{[^}]*load/)
    // Should NOT export text or svgExtrude
    expect(src).not.toMatch(/export\s+\{[^}]*text/)
    expect(src).not.toMatch(/export\s+\{[^}]*svgExtrude/)
  })
})
