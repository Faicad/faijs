/**
 * One-off tool: list all exported function names from a module's compiled dist.
 * USAGE: npx tsx packages/core/scripts/list-exports.ts [entry]
 * entry defaults to packages/core/dist/index.js
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)

const scriptDir = import.meta.dirname
const entryArg = process.argv[2] ?? '../dist/index.js'
const entryPath = resolve(scriptDir, entryArg)
const mod = await import(pathToFileURL(entryPath).href)
const names = Object.keys(mod).sort()
for (const n of names) {
  const v = (mod as Record<string, unknown>)[n]
  const kind = typeof v
  console.log(`${n}\t${kind}`)
}
console.error(`TOTAL ${names.length}`)