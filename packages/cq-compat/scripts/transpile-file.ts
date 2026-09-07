/**
 * CLI: transpile a CadQuery .py file to .fai.js.
 *
 * Usage: npx tsx packages/cq-compat/scripts/transpile-file.ts <input.py> <output.fai.js> [partName]
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractConfig, transpile } from '../src/transpile'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DUMP_AST = path.join(__dirname, 'dump_ast.py')

function loadAst(pyPath: string): unknown {
  const out = execFileSync('python', [DUMP_AST, pyPath], { encoding: 'utf-8' })
  return JSON.parse(out)
}

function main() {
  const [, , inputPy, outputJs, partNameArg] = process.argv
  if (!inputPy || !outputJs) {
    console.error('Usage: transpile-file.ts <input.py> <output.fai.js> [partName]')
    process.exit(1)
  }

  const inputDir = path.dirname(path.resolve(inputPy))
  const configPy = path.join(inputDir, 'config.py')

  // Load config (if exists)
  let config = { consts: new Map<string, string>(), fns: new Map() }
  if (fs.existsSync(configPy)) {
    config = extractConfig(loadAst(configPy) as never)
  }

  // Load input AST
  const ast = loadAst(inputPy) as never

  // Determine part name
  const partName = partNameArg ?? path.basename(inputPy, '.py').replace(/[^a-zA-Z0-9_]/g, '_')

  // Transpile
  const code = transpile(ast, config, partName)

  // Write output
  fs.mkdirSync(path.dirname(path.resolve(outputJs)), { recursive: true })
  fs.writeFileSync(outputJs, code + '\n', 'utf-8')
  console.log(`Transpiled ${inputPy} → ${outputJs} (part: ${partName})`)
}

main()
