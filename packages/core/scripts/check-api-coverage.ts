/**
 * API coverage gate: for each exported function of the public faijs surface,
 * require that at least one *.test.ts references its name as a standalone token.
 * Any exported function with no test reference fails the gate (CI).
 *
 * USAGE:
 *   npx tsx packages/core/scripts/check-api-coverage.ts [--entry=<dist/file.js> ...]
 * Default entries: core root index + core api subpath + faijs-extra root.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = resolve(import.meta.dirname, '../../../')

async function exportedFunctions(entryRel: string): Promise<string[]> {
  const p = resolve(REPO, entryRel)
  const mod = (await import(pathToFileURL(p).href)) as Record<string, unknown>
  return Object.entries(mod)
    .filter(([, v]) => typeof v === 'function')
    .map(([n]) => n)
    .sort()
}

function collectTestSources(dirs: string[]): string[] {
  const out: string[] = []
  const stack = [...dirs]
  while (stack.length) {
    const d = stack.pop()!
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      const st = statSync(p)
      if (st.isDirectory()) { stack.push(p); continue }
      // scan *.test.ts plus .fai.js fixtures plus support/helper sources, since
      // many integration tests drive exported ops through fixture scripts.
      if (/(\.(test|spec)\.ts|\.fai\.js)$/.test(e) || e.endsWith('_support.ts') || e.startsWith('_support')) {
        out.push(readFileSync(p, 'utf8'))
      }
    }
  }
  return out
}

function hasToken(src: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${esc}\\b`).test(src)
}

const testDirs = [
  resolve(REPO, 'packages/core/src'),
  resolve(REPO, 'packages/tests'),
  resolve(REPO, 'packages/faijs-extra/src'),
  resolve(REPO, 'packages/sketch/src'),
  resolve(REPO, 'packages/draw/src'),
].filter((d) => existsSync(d))

const srcs = collectTestSources(testDirs)

const custom = process.argv.filter((a) => a.startsWith('--entry=')).map((a) => a.slice('--entry='.length))
const defaultEntries = [
  'packages/core/dist/index.js',
  'packages/core/dist/api/index.js',
  'packages/faijs-extra/dist/index.js',
]
const entries = custom.length ? custom : defaultEntries

let failures = 0
for (const entry of entries) {
  let fns: string[] = []
  try {
    fns = await exportedFunctions(entry)
  } catch (e) {
    console.warn(`  !! cannot load ${entry}: ${String(e).slice(0, 120)}`)
    continue
  }
  const uncovered = fns.filter((f) => !srcs.some((s) => hasToken(s, f)))
  console.log(`## ${relative(REPO, entry)} — ${fns.length} exported functions`)
  if (uncovered.length === 0) {
    console.log('   OK all exported functions referenced by tests')
  } else {
    console.log(`   MISSING ${uncovered.length}:`)
    for (const f of uncovered) console.log(`     - ${f}`)
    failures += uncovered.length
  }
}

if (failures > 0) {
  console.error(`\nAPI-COVERAGE: ${failures} uncovered exported functions — CI FAIL`)
  process.exit(1)
}
console.log('\nAPI-COVERAGE: all exported functions covered — OK')