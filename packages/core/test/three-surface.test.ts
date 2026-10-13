/**
 * three-surface — three.js dependency-surface guard (plan §4.4 M4).
 *
 * After M0–M3, core's source no longer imports `three` at all: the math layer
 * is `math3d/`, the geometry container is `Shape`, and triangulation is `earcut`.
 * `three` remains only as a *test-only* dev tool:
 *  - `three-162` (npm alias for r0.162) — the reference oracle for parity tests.
 *  - `@types/three` — types for the `test/support/three-162.d.ts` shim.
 *
 * Guards, in the plan's R-notation:
 *  - R1: no `three` or `three/**` import may appear in core's source.
 *  - R1 (built): the static import closure of core's built entries is `three`-free.
 *  - M4: `three` is absent from `dependencies`, `peerDependencies`, and
 *    `devDependencies` (the r184 install is gone; only `three-162` stays).
 *
 * Precedent: `sdk.test.ts` scans a built entry's static specifiers the same way.
 *
 * 2026-10-13: the `@faicad/faijs-extra` import guard was removed (the package
 * was merged into core; the guard's object no longer exists).
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const pkgRoot = resolve(here, '..')
const distRoot = join(pkgRoot, 'dist')

/** Core's built entries whose static closure must stay free of three. */
const ENTRY_POINTS = ['index.js', 'browser.js', 'weapp.js', 'node.js', 'sdk.js']

/** Strip comments so prose like "THREE.js" cannot be read as a symbol. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'test-support') continue
      collectSourceFiles(full, out)
      continue
    }
    if (!entry.endsWith('.ts')) continue
    if (entry.includes('.test.')) continue
    out.push(full)
  }
  return out
}

/** All import/export specifiers (static + dynamic) found in a source file. */
function specifiersOf(text: string): string[] {
  const code = stripComments(text)
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

/** Static import specifiers of a built file (relative and bare alike). */
function staticSpecifiers(code: string): string[] {
  return specifiersOf(code)
}

/**
 * Transitive closure of a built entry over relative specifiers — a *static*
 * walk, so a module reachable only through a dynamic `import()` still counts.
 */
function distClosure(entry: string): { files: string[]; specifiers: string[] } {
  const files: string[] = []
  const specifiers: string[] = []
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const current = queue.pop()!
    if (seen.has(current) || !existsSync(current)) continue
    seen.add(current)
    files.push(current)
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
  return { files, specifiers }
}

/** True when a specifier is `three` or a sub-path of `three`. */
function isThreeSpecifier(spec: string): boolean {
  return spec === 'three' || spec.startsWith('three/')
}

describe('R1 — core source is three-free', () => {
  const sourceFiles = collectSourceFiles(here)

  it('no core source file imports three or three/**', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const specs = specifiersOf(readFileSync(file, 'utf-8'))
      for (const spec of specs) {
        if (isThreeSpecifier(spec)) offenders.push(`${relative(pkgRoot, file)} → ${spec}`)
      }
    }
    expect(
      offenders,
      `core source must not import three (use math3d / Shape / earcut instead):\n${offenders.join('\n')}`,
    ).toEqual([])
  })

})

describe('M4 — three is absent from core runtime deps', () => {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  it('three is not in dependencies', () => {
    expect(pkg.dependencies?.three).toBeUndefined()
  })

  it('three is not in peerDependencies', () => {
    expect(pkg.peerDependencies?.three).toBeUndefined()
  })

  it('three (r184) is not in devDependencies', () => {
    expect(pkg.devDependencies?.three).toBeUndefined()
  })

  it('three-162 stays in devDependencies (parity-test oracle)', () => {
    expect(pkg.devDependencies?.['three-162']).toBeDefined()
  })

  it('@types/three stays in devDependencies (type shim for three-162.d.ts)', () => {
    expect(pkg.devDependencies?.['@types/three']).toBeDefined()
  })
})

describe('R1 (built) — dist entry closures are three-free', () => {
  for (const entry of ENTRY_POINTS) {
    const entryPath = join(distRoot, entry)
    it.skipIf(!existsSync(entryPath))(`${entry}: no three`, () => {
      const { specifiers } = distClosure(entryPath)
      const threeSpecs = specifiers.filter(isThreeSpecifier)
      expect(threeSpecs, `built dist must not reference three:\n${threeSpecs.join('\n')}`).toEqual([])
    })
  }
})
