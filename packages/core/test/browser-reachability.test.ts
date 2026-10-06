/**
 * browser-reachability.test.ts — node builtin leak guard for browser-reachable entries.
 *
 * GOTCHA: this exact leak shipped once (2026-10-03, io/bytes.ts). A Node-only
 * helper (`readFileArrayBuffer`, top-level `import 'node:fs'`) was re-exported
 * from `io/index.ts` — a browser-reachable subpath (`@faicad/faijs/io/zip`
 * resolves to that same module) — and the 3d_editor web build failed with a
 * hard rollup error (`"readFileSync" is not exported by __vite-browser-external`).
 * The existing entry-boundary guards only read browser.ts / env-agnostic.ts
 * source text, so a leak through a *deep* subpath entry was invisible.
 *
 * This guard walks the actual import graph instead of eyeballing entry files:
 * from every package.json `exports` subpath that a browser bundle may resolve
 * (i.e. everything except the `/node` entry and node-host internals), follow
 * relative imports transitively and assert none of them imports a node
 * builtin (`node:` prefix, plus bare `fs`/`path`/`url`/... specifiers).
 *
 * Rules for callers:
 * - Browser-safe helper needed from `io/index.ts` & co → keep it free of
 *   node: imports (see io/bytes.ts `toArrayBuffer`).
 * - Node-only companion (fs readers etc.) → separate `*-node.ts` module,
 *   exported only from `@faicad/faijs/node` (see io/bytes-node.ts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
const coreSrc = srcDir // packages/core/src
const pkgRoot = path.resolve(coreSrc, '..')

interface ExportsEntry {
  subpath: string
  file: string
}

/** Flatten package.json exports into (subpath, default file) pairs. */
function browserReachableEntries(): ExportsEntry[] {
  const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'))
  const out: ExportsEntry[] = []
  for (const [subpath, value] of Object.entries<string | Record<string, unknown>>(pkg.exports)) {
    // The dedicated Node entry is allowed to use node builtins.
    if (subpath === './node') continue
    const target =
      typeof value === 'string' ? value : (value as { default?: string }).default
    if (typeof target !== 'string') continue
    out.push({ subpath, file: target.replace('./dist/', './src/').replace(/\.js$/, '.ts') })
  }
  return out
}

/** One specifier level of `./api/*`-style patterns, for wildcard subpaths. */
function resolveWildcard(subpath: string, file: string): ExportsEntry[] {
  const m = subpath.match(/^\.\/(.*)\/\*$/)
  if (!m) return [{ subpath, file }]
  const dir = path.resolve(coreSrc, m[1])
  if (!existsSync(dir)) return []
  return listTsFiles(dir).map((f) => ({
    subpath: `./${m[1]}/${path.basename(f, '.ts')}`,
    file: f,
  }))
}

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of existsSync(dir) ? readFsSync(dir) : []) {
    const full = path.join(dir, name)
    if (isDir(full)) out.push(...listTsFiles(full))
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

// Minimal fs helpers kept local so the guard itself stays dependency-free.
function readFsSync(dir: string): string[] {
  return readdirSync(dir)
}
function isDir(p: string): boolean {
  return statSync(p).isDirectory()
}

/** Extract static import/export-from specifiers from TS source text. */
function staticSpecifiers(src: string): string[] {
  const specs: string[] = []
  // Strip comments so `// import 'x'` never counts.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const re = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) specs.push(m[1] ?? m[2] ?? m[3])
  return specs
}

const NODE_BUILTIN = /^(node:)?(fs|path|url|util|os|process|crypto|stream|child_process|http|https|net|zlib|readline|events|worker_threads|module|assert|buffer|vm|perf_hooks|tty|dns|tls|v8|inspector|async_hooks)(\/|$)/

/**
 * Node-only test-support helpers that sit under wildcard subpaths (`brep/*`,
 * `brepkit-kernel/*`) and therefore show up as walk roots. They import node:
 * builtins on purpose and are consumed exclusively by test files. Listed here
 * by exact path so any NEW node-using module still fails the walk.
 */
const NODE_ONLY_TEST_HELPERS = new Set([
  'brep/text/fontTestHelper.ts',
  'brepkit-kernel/multi-version-test.ts',
])

/**
 * `*-node.ts` / `node-host/*` are the CONVENTION for node-only modules: they
 * resolve through wildcard subpaths (`@faicad/faijs/io/bytes-node`) and are
 * therefore reachable by a browser bundler in principle, but the contract is
 * that browser code never imports them — the entry-level guard below
 * (io/index.ts must not re-export readFileArrayBuffer) plus this suffix rule
 * keep that auditable. Anything node-only MUST carry the suffix; a new
 * node-using module without it fails this walk.
 */
const NODE_ONLY_PATTERN = /(^|[\\/])([^\\/]*-node\.ts|node-host[\\/].*)$/

describe('browser-reachable entries pull in no node builtins', () => {
  const entries = browserReachableEntries()
    .flatMap((e) => resolveWildcard(e.subpath, e.file))

  it('found the export entries to guard (sanity)', () => {
    expect(entries.length).toBeGreaterThan(10)
    const subpaths = entries.map((e) => e.subpath)
    expect(subpaths).toContain('./browser')
    expect(subpaths).toContain('./io')
    expect(subpaths).toContain('./io/zip')
  })

  it('no module reachable from browser entries imports a node builtin', () => {
    const failures: string[] = []
    const visited = new Set<string>()

    const visit = (file: string, via: string[]) => {
      if (visited.has(file)) return
      visited.add(file)
      if (NODE_ONLY_TEST_HELPERS.has(path.relative(coreSrc, file).replace(/\\/g, '/'))) return
      if (NODE_ONLY_PATTERN.test(file)) return
      let src: string
      try {
        src = readFileSync(file, 'utf-8')
      } catch {
        return // file missing (e.g. wildcard points at a dir index) — skip
      }
      for (const spec of staticSpecifiers(src)) {
        if (NODE_BUILTIN.test(spec)) {
          failures.push(
            `${path.relative(pkgRoot, file)} imports '${spec}'` +
              (via.length ? ` (reached via ${via.join(' -> ')})` : ''),
          )
          continue
        }
        if (spec.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), spec)
          for (const candidate of [resolved, `${resolved}.ts`, path.join(resolved, 'index.ts')]) {
            if (existsSync(candidate) && !candidate.endsWith('.d.ts')) {
              visit(candidate, [...via, path.basename(file)])
              break
            }
          }
        }
        // Bare specifiers (npm deps like fflate) are not walked: if a dep
        // itself requires node builtins in a browser context, that is the
        // dep's contract, surfaced by the consuming bundle build.
      }
    }

    for (const e of entries) visit(path.resolve(coreSrc, e.file), [])

    expect(
      failures,
      `node builtins reachable from browser subpath entries:\n${failures.join('\n')}`,
    ).toEqual([])
  })

  it('the node entry still provides the node-only readers (contract check)', () => {
    const nodeSrc = readFileSync(path.join(coreSrc, 'node.ts'), 'utf-8')
    expect(nodeSrc).toMatch(/export\s*\{[^}]*readFileArrayBuffer[^}]*\}\s*from\s*'\.\/io\/bytes-node'/)
    // And the browser-reachable io index must NOT re-export it (imports or
    // export statements; the comment mentioning it is fine, so match code lines).
    const ioSrc = readFileSync(path.join(coreSrc, 'io/index.ts'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n')
    expect(ioSrc).not.toMatch(/readFileArrayBuffer/)
  })
})
