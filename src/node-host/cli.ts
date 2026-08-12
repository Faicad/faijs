/**
 * faijs-cli — CLI 逻辑（可导入、可测试）
 *
 * 设计文档：docs/faijs-engine-refactor-design.md §5.3
 *
 * 命令：
 *   check <file.faijs>                  — dryRun：parse + schema + 引用预检
 *   run <file.faijs> --out <file>       — 执行并导出 STL/STEP
 *
 * 选项：
 *   --mode <auto|brep|mesh>             — 执行模式（默认 auto）
 *   --assets <dir>                      — 资产目录
 *   --fonts <dir>                       — 额外字体目录
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { parseScript } from '../faijs/parser'
import { createRuntime } from '../cad-runtime/runtime'
import type { ExecutionMode } from '../cad-runtime/ports'
import { createNodePorts } from './index'
import { buildStlBufferFromMesh } from '../brep/export/stl'
import { exportStepFromSolid } from '../brep/export/step'
import { initOcctWasm } from '../occt/occtKernel'

export interface CliCheckOptions {
  assetsDir?: string
  fontsDir?: string
}

export interface CliRunOptions {
  mode?: ExecutionMode
  assetsDir?: string
  fontsDir?: string
  defaultFontPath?: string
}

export interface CliCheckResult {
  ok: boolean
  errors: Array<{ stage: string; message: string; line?: number; stmtId?: string }>
  warnings: string[]
  script?: { statements: number; ops: string[] }
}

export interface CliRunResult {
  ok: boolean
  outputFile?: string
  outputFormat?: string
  error?: string
  infos?: string[]
}

/**
 * 执行 check 命令：dryRun 校验 .faijs 文件
 */
export function cliCheck(filePath: string, _opts?: CliCheckOptions): CliCheckResult {
  const code = readFileSync(filePath, 'utf-8')
  const ports = createNodePorts({
    assetsDir: _opts?.assetsDir,
    fontsDir: _opts?.fontsDir,
  })
  const runtime = createRuntime(ports)
  const result = runtime.check(code)
  return {
    ok: result.ok,
    errors: result.errors.map((e) => ({
      stage: e.stage,
      message: e.message,
      line: e.line,
      stmtId: e.stmtId,
    })),
    warnings: result.warnings,
    script: result.script,
  }
}

/**
 * 执行 run 命令：执行 .faijs 文件并导出 STL/STEP
 */
export async function cliRun(
  filePath: string,
  outPath: string,
  opts?: CliRunOptions,
): Promise<CliRunResult> {
  const code = readFileSync(filePath, 'utf-8')

  // Parse
  let script
  try {
    const result = parseScript(code)
    script = result.script
  } catch (err) {
    return {
      ok: false,
      error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // Initialize OCCT
  await initOcctWasm()

  // Create runtime with node ports
  const ports = createNodePorts({
    assetsDir: opts?.assetsDir,
    fontsDir: opts?.fontsDir,
    defaultFontPath: opts?.defaultFontPath,
  })
  const runtime = createRuntime(ports, opts?.mode ?? 'auto')

  // Execute
  const execResult = await runtime.replay(script)

  if (execResult.failedAt) {
    return {
      ok: false,
      error: `Execution failed at statement ${execResult.failedAt.index} (op: ${execResult.failedAt.op}): ${execResult.failedAt.message}`,
      infos: execResult.infos,
    }
  }

  // Determine output format from extension
  const ext = extname(outPath).toLowerCase().slice(1)
  const terminals = execResult.terminals ?? []

  if (terminals.length === 0) {
    // No terminals — use last statement output
    const lastStmt = script.statements.filter((s) => !s.isMarker).pop()
    if (!lastStmt) {
      return { ok: false, error: 'No statements to export' }
    }
    const shape = execResult.outputs.get(lastStmt.id)
    if (!shape) {
      return { ok: false, error: `No output for statement "${lastStmt.id}"` }
    }
    return writeOutput(outPath, ext, shape.positions, shape.indices, execResult.brepSolid)
  }

  // Single terminal
  if (terminals.length === 1) {
    const terminal = terminals[0]
    const shape = execResult.outputs.get(terminal.id)
    if (!shape) {
      return { ok: false, error: `No output for terminal "${terminal.id}"` }
    }
    return writeOutput(outPath, ext, shape.positions, shape.indices, execResult.brepSolid)
  }

  // Multiple terminals — write each to a separate file
  // If outPath is a directory, write each terminal as <name>.<ext>
  // Otherwise, prefix with terminal index
  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i]
    const shape = execResult.outputs.get(terminal.id)
    if (!shape) continue

    const name = terminal.meta?.name ?? terminal.id
    const sep = outPath.endsWith('/') || outPath.endsWith('\\') ? '' : '_'
    const terminalOutPath = `${outPath}${sep}${i}_${name}.${ext}`
    const result = writeOutput(terminalOutPath, ext, shape.positions, shape.indices, undefined)
    if (!result.ok) return result
  }

  return { ok: true, outputFormat: ext }
}

function writeOutput(
  outPath: string,
  ext: string,
  positions: Float32Array,
  indices: Uint32Array,
  brepSolid?: { solid: import('occt-wasm').ShapeHandle; kernel: import('occt-wasm').OcctKernel },
): CliRunResult {
  if (ext === 'stl') {
    const buffer = buildStlBufferFromMesh(positions, indices)
    writeFileSync(outPath, Buffer.from(buffer))
    return { ok: true, outputFile: outPath, outputFormat: 'stl' }
  }

  if (ext === 'step' || ext === 'stp') {
    if (!brepSolid) {
      // No BREP solid — fallback to STL mesh reconstruction
      // For now, write STL with .step extension is wrong — report error
      return {
        ok: false,
        error: 'No BREP solid available (chain was broken). Use --mode brep or fix the script to maintain BREP chain. Falling back to STL output.',
      }
    }
    const buffer = exportStepFromSolid(brepSolid.solid, brepSolid.kernel)
    writeFileSync(outPath, Buffer.from(buffer))
    return { ok: true, outputFile: outPath, outputFormat: 'step' }
  }

  return { ok: false, error: `Unsupported output format: .${ext} (supported: .stl, .step)` }
}

/**
 * 解析命令行参数
 */
export function parseArgs(argv: string[]): {
  command: 'check' | 'run' | null
  file?: string
  out?: string
  mode?: ExecutionMode
  assetsDir?: string
  fontsDir?: string
} {
  const args = argv.slice(2) // skip node + script
  if (args.length === 0) return { command: null }

  const command = args[0] as 'check' | 'run' | null
  if (command !== 'check' && command !== 'run') return { command: null }

  let file: string | undefined
  let out: string | undefined
  let mode: ExecutionMode | undefined
  let assetsDir: string | undefined
  let fontsDir: string | undefined

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--out' || arg === '-o') {
      out = args[++i]
    } else if (arg === '--mode' || arg === '-m') {
      const m = args[++i] as ExecutionMode
      if (m === 'auto' || m === 'brep' || m === 'mesh') {
        mode = m
      }
    } else if (arg === '--assets') {
      assetsDir = args[++i]
    } else if (arg === '--fonts') {
      fontsDir = args[++i]
    } else if (!file && !arg.startsWith('-')) {
      file = arg
    }
  }

  return { command, file, out, mode, assetsDir, fontsDir }
}

/**
 * CLI 主入口（被 scripts/faijs-cli.ts 调用）
 */
export async function cliMain(argv: string[]): Promise<number> {
  const { command, file, out, mode, assetsDir, fontsDir } = parseArgs(argv)

  if (!command) {
    process.stderr.write('Usage: faijs-cli <check|run> <file.faijs> [options]\n')
    process.stderr.write('  check <file>              DryRun validation\n')
    process.stderr.write('  run <file> --out <file>   Execute and export\n')
    process.stderr.write('  --mode <auto|brep|mesh>   Execution mode\n')
    process.stderr.write('  --assets <dir>            Asset directory\n')
    process.stderr.write('  --fonts <dir>             Extra fonts directory\n')
    return 1
  }

  if (!file) {
    process.stderr.write(`Error: missing file argument for "${command}"\n`)
    return 1
  }

  const filePath = resolve(file)

  if (command === 'check') {
    const result = cliCheck(filePath, { assetsDir, fontsDir })
    if (result.ok) {
      process.stdout.write(`✓ ${filePath}: OK\n`)
      if (result.script) {
        process.stdout.write(`  statements: ${result.script.statements}\n`)
        process.stdout.write(`  ops: ${result.script.ops.join(', ')}\n`)
      }
      return 0
    } else {
      process.stderr.write(`✗ ${filePath}: ${result.errors.length} error(s)\n`)
      for (const err of result.errors) {
        const loc = err.line ? ` (line ${err.line})` : err.stmtId ? ` (stmt: ${err.stmtId})` : ''
        process.stderr.write(`  [${err.stage}] ${err.message}${loc}\n`)
      }
      return 1
    }
  }

  if (command === 'run') {
    if (!out) {
      process.stderr.write('Error: --out is required for "run" command\n')
      return 1
    }

    const outPath = resolve(out)
    const result = await cliRun(filePath, outPath, { mode, assetsDir, fontsDir })

    if (result.ok) {
      process.stdout.write(`✓ ${filePath} → ${outPath} (${result.outputFormat})\n`)
      if (result.infos && result.infos.length > 0) {
        for (const info of result.infos) {
          process.stderr.write(`  ℹ ${info}\n`)
        }
      }
      return 0
    } else {
      process.stderr.write(`✗ ${filePath}: ${result.error}\n`)
      if (result.infos && result.infos.length > 0) {
        for (const info of result.infos) {
          process.stderr.write(`  ℹ ${info}\n`)
        }
      }
      return 1
    }
  }

  return 1
}
