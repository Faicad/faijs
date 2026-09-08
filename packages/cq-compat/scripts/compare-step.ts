#!/usr/bin/env npx tsx
/**
 * ⚠️ DEPRECATED — do not use for new comparisons.
 *
 * compareStepFiles only compares the whole file's total solid count / volume /
 * bounding box / boolean difference — it **cannot tell "N independent parts"
 * apart from "one compound of N solids"** (slide_top case: 2 parts vs 1
 * compound wrongly passed). All STEP comparisons must use the assembly
 * consistency comparison:
 *
 *   npx tsx packages/cq-compat/scripts/compare-assembly.ts <a.step> <b.step>
 *
 * This script is kept only to demonstrate the limitation of compareStepFiles
 * (regression diagnostics).
 *
 * Usage:
 *   npx tsx packages/cq-compat/scripts/compare-step.ts <a.step> <b.step> [options]
 *
 * Options:
 *   --linear-tol <n>       Linear tolerance in mm (default: 1e-4)
 *   --volume-tol <n>       Relative volume tolerance (default: 1e-4)
 *   --boolean-tol <n>      Boolean diff volume tolerance in mm^3 (default: 1e-3)
 *   --no-strict-topology   Don't require exact face/edge/vertex count match
 *   --json                 Output JSON instead of human-readable report
 */

import { compareStepFiles, printCompareReport } from '../src/step-compare'

function parseArgs(argv: string[]): { fileA: string; fileB: string; options: Record<string, unknown> } {
  const args = argv.slice(2)
  const files: string[] = []
  const options: Record<string, unknown> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--linear-tol') {
      options.linearTolerance = parseFloat(args[++i])
    } else if (arg === '--volume-tol') {
      options.volumeRelativeTolerance = parseFloat(args[++i])
    } else if (arg === '--boolean-tol') {
      options.booleanVolumeTolerance = parseFloat(args[++i])
    } else if (arg === '--no-strict-topology') {
      options.strictTopology = false
    } else if (arg === '--json') {
      options.json = true
    } else if (!arg.startsWith('--')) {
      files.push(arg)
    }
  }
  if (files.length < 2) {
    console.error('Usage: compare-step.ts <a.step> <b.step> [options]')
    process.exit(1)
  }
  return { fileA: files[0], fileB: files[1], options }
}

async function main() {
  const { fileA, fileB, options } = parseArgs(process.argv)
  const { json, ...compareOpts } = options
  const result = await compareStepFiles(fileA, fileB, compareOpts)
  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printCompareReport(result)
  }
  process.exit(result.equivalent ? 0 : 1)
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(2)
})
