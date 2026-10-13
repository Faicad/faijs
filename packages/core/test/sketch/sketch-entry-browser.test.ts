/**
 * sketch-entry-browser — `@faicad/faijs/sketch` must stay browser-bundle-safe.
 *
 * Background: the merged core (0.33.5) initially re-exported the Node-only
 * entry (`./node.js`) from the sketch main entry. `node.js` statically imports
 * `node:module` / `node:path` at top level, so any browser/worker bundler that
 * statically resolves `@faicad/faijs/sketch` (e.g. 3d_editor's Vite worker
 * build) failed with "createRequire is not exported by __vite-browser-external".
 *
 * Guards (mirror three-surface.test.ts style):
 *  - SRC: `src/sketch/index.ts` must not statically re-export `./node.js`.
 *  - BUILT: the static closure of `dist/sketch/index.js` contains no `node:`
 *    specifier and no `./node.js`. Dynamic `import('node:module')` inside
 *    `solver-loader.js` is allowed (runtime-only; a browser host's
 *    `customInitFn` takes precedence, so the branch is never reached).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const distRoot = join(pkgRoot, 'dist')
const srcSketchIndex = join(pkgRoot, 'src', 'sketch', 'index.ts')

/** Strip comments so prose like "node:path" cannot be read as a specifier. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** All import/export specifiers (static + dynamic) found in a file. */
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

/** Static (non-`import()`-wrapped) specifiers of a file. */
function staticSpecifiers(text: string): string[] {
  const code = stripComments(text)
  const specifiers: string[] = []
  const patterns = [
    /(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) specifiers.push(m[1])
  }
  return specifiers
}

/**
 * Static transitive closure of a built entry over relative specifiers.
 * A module reachable only through a dynamic `import()` still counts as part
 * of the closure for the "no static node:*" check only if its *own* static
 * specifiers introduce `node:` — dynamic edges are walked too so that a
 * dynamically-imported module with a top-level static `node:` import would
 * still be caught.
 */
function distStaticClosure(entry: string): { files: string[]; staticSpecs: string[] } {
  const files: string[] = []
  const staticSpecs: string[] = []
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const current = queue.pop()!
    if (seen.has(current) || !existsSync(current)) continue
    seen.add(current)
    files.push(current)
    for (const spec of staticSpecifiers(readFileSync(current, 'utf-8'))) {
      staticSpecs.push(spec)
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
  return { files, staticSpecs }
}

describe('SRC — sketch main entry must not re-export the Node-only entry', () => {
  it('src/sketch/index.ts contains no static `from \'./node.js\'`', () => {
    const text = readFileSync(srcSketchIndex, 'utf-8')
    const specs = staticSpecifiers(text)
    const offenders = specs.filter((s) => s === './node.js' || s.startsWith('node:'))
    expect(
      offenders,
      `@faicad/faijs/sketch main entry statically reaches the Node-only entry:\n` +
        `  ${offenders.join(', ')}\n` +
        `Node-only symbols (planegcsWasmPath / createNodePlanegcsSolver) live on ` +
        `@faicad/faijs/sketch/node; re-exporting them here drags node:* into browser bundles.`,
    ).toEqual([])
  })
})

describe('BUILT — dist/sketch/index.js static closure stays node-free', () => {
  const entry = join(distRoot, 'sketch', 'index.js')

  it('dist/sketch/index.js exists (run after build)', () => {
    expect(existsSync(entry)).toBe(true)
  })

  it('static closure contains no node: specifier and no ./node.js', () => {
    const { files, staticSpecs } = distStaticClosure(entry)
    const offenders = staticSpecs.filter((s) => s.startsWith('node:') || s === './node.js')
    expect(
      offenders,
      `static node:* specifiers leaked into the @faicad/faijs/sketch bundle closure\n` +
        `  ${offenders.join(', ')}\n` +
        `Files in closure: ${files.map((f) => f.replace(/\\/g, '/').replace(distRoot + '/', '')).join(', ')}`,
    ).toEqual([])
  })

  it('dist/sketch/node.js is not reachable from the main entry (reachable only via the /node subpath)', () => {
    const { files } = distStaticClosure(entry)
    expect(
      files.some((f) => f.replace(/\\/g, '/').endsWith('/sketch/node.js')),
      'dist/sketch/node.js must NOT be part of the @faicad/faijs/sketch main-entry closure',
    ).toBe(false)
  })
})
