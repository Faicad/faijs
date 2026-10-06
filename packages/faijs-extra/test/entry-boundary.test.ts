/**
 * entry-boundary — the extension library's host-boundary guards.
 *
 * Three facts are pinned here:
 *
 * 1. **`@faicad/faijs-extra/editor-ops` is addon-free.** The weapp worker mounts
 *    the editor-owned ops (it replays web-authored scripts containing
 *    `cad.group` / `cad.copy` / `cad.load`), but must not bundle
 *    `three/examples`' `SVGLoader` nor the `Shape`/`ExtrudeGeometry` chain —
 *    the end-side three copy is r162 and the addons are outside three's
 *    compatibility promise. The A-only subentry is what makes that possible, so
 *    its closure is asserted, not assumed.
 *
 * 2. **The full entry really does carry the addon.** If the SVG chain ever
 *    disappears from the full entry, the subentry above has lost its reason to
 *    exist and this guard says so rather than letting a stale split linger.
 *
 * 3. **No deep core imports.** The extension library consumes core only through
 *    its published subpaths (`@faicad/faijs/*`), never a relative path into
 *    core's source tree, so it stays a real external consumer.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const distRoot = join(pkgRoot, 'dist')

function staticSpecifiers(code: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) specifiers.push(m[1])
  }
  return specifiers
}

/** Transitive static closure of a built entry over relative specifiers. */
function distClosure(entry: string): string[] {
  const specifiers: string[] = []
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const current = queue.pop()!
    if (seen.has(current) || !existsSync(current)) continue
    seen.add(current)
    for (const spec of staticSpecifiers(readFileSync(current, 'utf-8'))) {
      specifiers.push(spec)
      if (!spec.startsWith('.')) continue
      const target = resolve(dirname(current), spec)
      for (const candidate of [`${target}.js`, join(target, 'index.js'), target]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          queue.push(candidate)
          break
        }
      }
    }
  }
  return specifiers
}

describe('@faicad/faijs-extra/editor-ops — three-basic-only closure', () => {
  const entry = join(distRoot, 'editor-ops.js')

  it.skipIf(!existsSync(entry))('carries no three/examples addon and no opentype.js', () => {
    const specifiers = distClosure(entry)
    expect(specifiers.filter((s) => s.startsWith('three/examples/'))).toEqual([])
    expect(specifiers.filter((s) => s === 'opentype.js')).toEqual([])
  })
})

describe('@faicad/faijs-extra — the full entry owns the svg/3D-text chain', () => {
  const entry = join(distRoot, 'index.js')

  it.skipIf(!existsSync(entry))('does reach the three/examples SVG loader', () => {
    const specifiers = distClosure(entry)
    expect(specifiers.some((s) => s === 'three/examples/jsm/loaders/SVGLoader.js')).toBe(true)
  })

  // Note: `opentype.js` deliberately does NOT appear in either closure. Glyph
  // parsing lives in core's fontRegistry (`ensureDefaultFont` / `getFont`), so
  // the extension library only imports opentype's *types*. `opentype.js` stays a
  // declared dependency because the helper signatures expose `opentype.Font`.
})

describe('extension library consumes core only through published subpaths', () => {
  const files: string[] = []
  function walk(dir: string): void {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (e.endsWith('.ts')) files.push(full)
    }
  }
  // Scan src/ only — test files legitimately import from ../../src/*
  walk(join(pkgRoot, 'src'))

  it('no relative import escapes into core / the repo root', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const spec of staticSpecifiers(readFileSync(file, 'utf-8'))) {
        if (!spec.startsWith('..')) continue
        // Only `../x` inside packages/faijs-extra/src is allowed; `../../` is not.
        if (spec.startsWith('../../')) offenders.push(`${relative(pkgRoot, file)} → ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no import reaches core by filesystem path', () => {
    const offenders = files.filter((f) => /from\s+['"][^'"]*packages[\\/]core/.test(readFileSync(f, 'utf-8')))
    expect(offenders.map((f) => relative(pkgRoot, f))).toEqual([])
  })
})
