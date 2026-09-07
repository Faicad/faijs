#!/usr/bin/env npx tsx
/**
 * CLI for comparing two assembly STEP files.
 *
 * Usage:
 *   npx tsx packages/cq-compat/scripts/compare-assembly.ts <ref.step> <cand.step> [options]
 *
 * Options:
 *   --linear-tol <n>      Linear tolerance in mm (default: 1e-3)
 *   --volume-tol <n>      Relative volume tolerance (default: 1e-3)
 *   --boolean-tol <n>     Boolean diff volume tolerance in mm³ (default: 0.1)
 *   --strict-topology     Require exact face/edge/vertex count match
 *   --json                Output JSON
 */

import { compareAssemblyFiles, printAssemblyReport } from '../src/assembly-compare'

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const files: string[] = []
  const options: Record<string, unknown> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--linear-tol') options.linearTolerance = parseFloat(args[++i])
    else if (a === '--volume-tol') options.volumeRelativeTolerance = parseFloat(args[++i])
    else if (a === '--boolean-tol') options.booleanVolumeTolerance = parseFloat(args[++i])
    else if (a === '--strict-topology') options.strictTopology = true
    else if (a === '--json') options.json = true
    else if (!a.startsWith('--')) files.push(a)
  }
  if (files.length < 2) {
    console.error('Usage: compare-assembly.ts <ref.step> <cand.step> [options]')
    process.exit(1)
  }
  return { fileA: files[0], fileB: files[1], options }
}

async function main() {
  const { fileA, fileB, options } = parseArgs(process.argv)
  const { json, ...compareOpts } = options
  const result = await compareAssemblyFiles(fileA, fileB, compareOpts)
  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printAssemblyReport(result)
  }
  process.exit(result.equivalent ? 0 : 1)
}

main().catch(e => {
  console.error('Error:', e)
  process.exit(2)
})
