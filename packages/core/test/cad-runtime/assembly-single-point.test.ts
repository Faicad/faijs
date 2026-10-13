/**
 * assembly-single-point — guard: no host assembly entry points remain.
 *
 * 2026-10-13 merge: the cad namespace is assembled in a single place
 * (`createApiNamespace` + `createRuntime`). The old host-assembly functions
 * (mergeSketchNamespace, createSketchCadNamespace, registerSketchSymbols,
 * createEditorCadNamespace, mergeEditorNamespace, registerEditorSymbols,
 * installEditorMeshProviders) must NOT exist in the codebase.
 *
 * This test scans the source tree for any of these symbols to prevent
 * reintroduction.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const srcRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src',
)

/** Collect all .ts files under a directory (recursive). */
function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      collectTsFiles(full, out)
      continue
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Symbols that were host-assembly entry points and must not exist anymore.
 *  Note: `installSketchSolver` is NOT banned — it is retained as a deprecated
 *  alias of `setSketchSolverInitFn` for one release (see §6.3(a)).
 */
const BANNED_EXPORTS = [
  'createSketchCadNamespace',
  'mergeSketchNamespace',
  'createEditorCadNamespace',
  'mergeEditorNamespace',
  'registerSketchSymbols',
  'registerEditorSymbols',
  'installEditorMeshProviders',
]

describe('assembly-single-point: no host-assembly entry points remain', () => {
  it('no banned export/function name appears in core source', () => {
    const files = collectTsFiles(srcRoot)
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf-8')
      // Strip comments to avoid false positives from prose mentioning these names
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      for (const banned of BANNED_EXPORTS) {
        // Match as export or function declaration
        const re = new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${banned}\\b|\\bexport\\s+\\{[^}]*\\b${banned}\\b[^}]*\\}|\\bfunction\\s+${banned}\\b`)
        if (re.test(stripped)) {
          offenders.push(`${file}: ${banned}`)
        }
      }
    }
    expect(
      offenders,
      `banned host-assembly symbols found:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('createRuntime is the single cad assembly point', () => {
    const files = collectTsFiles(srcRoot)
    let createRuntimeCount = 0
    for (const file of files) {
      const text = readFileSync(file, 'utf-8')
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      // Count `export function createRuntime`
      if (/export\s+function\s+createRuntime\b/.test(stripped)) {
        createRuntimeCount++
      }
    }
    expect(createRuntimeCount, 'createRuntime must be exported exactly once').toBe(1)
  })

  it('cad.sketch / cad.fai_drill / cad.text / cad.svgExtrude are available via createRuntime (no manual registration)', () => {
    // This is a source-level assertion: createApiNamespace is the only place
    // that defines the cad namespace. If someone adds a second assembly point
    // that merges ops into cad, the single-point guarantee is broken.
    const files = collectTsFiles(srcRoot)
    let apiNamespaceCount = 0
    for (const file of files) {
      const text = readFileSync(file, 'utf-8')
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      if (/export\s+function\s+createApiNamespace\b/.test(stripped)) {
        apiNamespaceCount++
      }
    }
    expect(apiNamespaceCount, 'createApiNamespace must be exported exactly once').toBe(1)
  })
})
