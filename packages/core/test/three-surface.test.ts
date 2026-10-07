/**
 * three-surface — three.js dependency-surface guard (plan §4.4 M1/M2/M3).
 *
 * faijs must run on both the web host (three r184) and the weapp host (three
 * r162, pinned because the end-side canvas is WebGL1-only). The engine therefore
 * refuses to take a *version position*: it declares a peer range and uses only
 * the API subset that is stable across that range. The parts of three that are
 * neither basic nor version-stable — `three/examples/**` addons and the
 * `Shape`/`ExtrudeGeometry`/`SVGLoader` chain — live in
 * `@faicad/faijs-extra` instead.
 *
 * Guards, in the plan's R-notation:
 *  - R1: no `three/examples/**` import may appear in core's source or in the
 *    static import closure of its built entries.
 *  - R2: every three symbol core's source touches must be in `THREE_ALLOWED`.
 *  - R3: the svg / 3D-text geometry chain (`Shape`, `ExtrudeGeometry`, `Path`,
 *    `LineCurve`) may not appear in core at all — it moved out with the B group.
 *  - M1a: `three` is a *peer* with the dual range, never a hard dependency.
 *  - The extension library may not leak back in: core must not import
 *    `@faicad/faijs-extra` (that would be a cycle: extra peer-depends on core).
 *
 * Precedent: `sdk.test.ts` scans a built entry's static specifiers the same way.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const pkgRoot = resolve(here, '..')
const distRoot = join(pkgRoot, 'dist')

/**
 * R2 whitelist: three's math, container and basic-generator API, all stable
 * across r162–r184. Extend deliberately — R3's answer for anything else is
 * "move it to @faicad/faijs-extra or port it and diff-test against three".
 */
const THREE_ALLOWED = new Set([
  // math
  'Vector2', 'Vector3', 'Matrix3', 'Matrix4', 'Quaternion', 'Euler', 'Plane', 'Box3', 'Sphere',
  // containers
  'BufferGeometry', 'BufferAttribute', 'Float32BufferAttribute',
  // basic generators + shape utilities
  'BoxGeometry', 'SphereGeometry', 'CylinderGeometry', 'ConeGeometry',
  'ShapeUtils', 'Line3', 'Ray', 'Triangle',
])

/**
 * R3: the 2-D shape / extrusion chain that carries the svg and 3D-text
 * geometry. It left core with the B group; if it ever comes back, the weapp
 * worker would bundle `Shape`/`ExtrudeGeometry` again.
 */
const THREE_FORBIDDEN_IN_CORE = new Set(['Shape', 'ExtrudeGeometry', 'Path', 'LineCurve', 'SVGLoader'])

/** Core's built entries whose static closure must stay free of the addons. */
const ENTRY_POINTS = ['index.js', 'browser.js', 'weapp.js', 'node.js', 'sdk.js']

/** Strip comments so prose like "THREE.js" cannot be read as a symbol. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // `compat` has its own strict tsconfig; `test-support` is test-only and
      // deliberately imports @faicad/faijs-extra (excluded from dist — see the
      // built-closure assertions below, which are the authoritative check).
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

/**
 * Locate the installed three by walking up the node_modules chain (npm hoists
 * it to the repo root in the workspace).
 * @returns the resolved `three/package.json` path, or null when not installed.
 */
function findThreePackageJson(): string | null {
  let dir = pkgRoot
  for (;;) {
    const candidate = join(dir, 'node_modules', 'three', 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** three symbols referenced by one source file: `THREE.X` plus named imports. */
function threeSymbolsOf(text: string): { symbols: Set<string>; specifiers: string[] } {
  const code = stripComments(text)
  const specifiers: string[] = []
  const symbols = new Set<string>()
  // Static import/export-from, side-effect imports, AND dynamic `import('…')`:
  // a dynamic addon import still bundles the addon (esbuild follows literal
  // specifiers), so it counts. `mesh/io.ts` used to reach STLLoader that way.
  const patterns = [
    /(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) specifiers.push(m[1])
  }
  const relevant = specifiers.some((s) => s === 'three' || s.startsWith('three/'))
  if (!relevant) return { symbols, specifiers }
  for (const spec of specifiers) {
    if (spec === 'three') {
      const named = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]three['"]/g
      let m: RegExpExecArray | null
      while ((m = named.exec(code)) !== null) {
        for (const raw of m[1].split(',')) {
          const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
          if (name) symbols.add(name)
        }
      }
    } else if (spec.startsWith('three/')) {
      // `three/examples/jsm/...` — the imported binding is the addon export.
      const named = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]`, 'g')
      let m: RegExpExecArray | null
      while ((m = named.exec(code)) !== null) {
        for (const raw of m[1].split(',')) {
          const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
          if (name) symbols.add(name)
        }
      }
    }
  }
  for (const m of code.matchAll(/THREE\.([A-Za-z_][A-Za-z0-9_]*)/g)) symbols.add(m[1])
  return { symbols, specifiers }
}

/** Static import specifiers of a built file (relative and bare alike). */
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

describe('R1/R2/R3 — three API surface of core', () => {
  const sourceFiles = collectSourceFiles(here)

  it('R1: core source imports no three/examples addon', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const { specifiers } = threeSymbolsOf(readFileSync(file, 'utf-8'))
      for (const spec of specifiers) {
        if (spec.startsWith('three/examples/')) offenders.push(`${relative(pkgRoot, file)} → ${spec}`)
      }
    }
    expect(offenders, `three/examples addons must live in @faicad/faijs-extra:\n${offenders.join('\n')}`).toEqual([])
  })

  it('R2: every three symbol core uses is in the whitelist', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const { symbols } = threeSymbolsOf(readFileSync(file, 'utf-8'))
      for (const symbol of symbols) {
        if (THREE_FORBIDDEN_IN_CORE.has(symbol)) continue // reported by R3
        if (!THREE_ALLOWED.has(symbol)) offenders.push(`${relative(pkgRoot, file)} → THREE.${symbol}`)
      }
    }
    expect(
      offenders,
      `three symbols outside the whitelist (migrate to @faicad/faijs-extra or port it):\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('R3: the svg / 3D-text geometry chain is absent from core', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const { symbols } = threeSymbolsOf(readFileSync(file, 'utf-8'))
      for (const symbol of symbols) {
        if (THREE_FORBIDDEN_IN_CORE.has(symbol)) offenders.push(`${relative(pkgRoot, file)} → THREE.${symbol}`)
      }
    }
    expect(offenders, `the svg/3D-text chain moved to @faicad/faijs-extra:\n${offenders.join('\n')}`).toEqual([])
  })

  it('core never imports the extension library (that would be a dependency cycle)', () => {
    const offenders = sourceFiles.filter((f) =>
      /from\s+['"]@faicad\/faijs-extra/.test(readFileSync(f, 'utf-8')),
    )
    expect(offenders.map((f) => relative(pkgRoot, f))).toEqual([])
  })
})

describe('M1a — three is a peer with a dual range, not a hard dependency', () => {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  it('three is not in dependencies', () => {
    expect(pkg.dependencies?.three).toBeUndefined()
  })

  it('three is a peer covering both r162 (weapp) and r184 (web)', () => {
    expect(pkg.peerDependencies?.three).toBe('^0.162.0 || ^0.184.0')
  })

  it('three stays a devDependency so core builds and tests standalone', () => {
    expect(pkg.devDependencies?.three).toBeDefined()
  })

  it('the installed three satisfies the declared peer range', () => {
    const threePkgJson = findThreePackageJson()
    expect(threePkgJson, 'three must be installed (devDependency) for core to build/test').not.toBeNull()
    const installed = JSON.parse(readFileSync(threePkgJson!, 'utf-8')) as { version: string }
    // The peer range admits exactly the two hosts' lines: weapp r162, web r184.
    expect(['0.162', '0.184']).toContain(installed.version.split('.').slice(0, 2).join('.'))
  })
})

describe('R1 (built) — dist entry closures stay addon-free', () => {
  for (const entry of ENTRY_POINTS) {
    const entryPath = join(distRoot, entry)
    it.skipIf(!existsSync(entryPath))(`${entry}: no three/examples, no @faicad/faijs-extra`, () => {
      const { specifiers } = distClosure(entryPath)
      const addons = specifiers.filter((s) => s.startsWith('three/examples/'))
      expect(addons).toEqual([])
      const leaks = specifiers.filter((s) => s.startsWith('@faicad/faijs-extra'))
      expect(leaks).toEqual([])
    })
  }
})
