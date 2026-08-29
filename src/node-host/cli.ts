/**
 * faijs-cli — CLI 逻辑（可导入、可测试）
 *
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
import { parseScript } from '../lang/parser'
import { createRuntime } from '../cad-runtime/runtime'
import type { ExecutionMode } from '../cad-runtime/ports'
import { createNodePorts } from './index'
import { buildStlBufferFromMesh } from '../brep/export/stl'
import { exportStepFromSolid } from '../brep/export/step'
import { exportStep } from '../occt-kernel/highLevelApi'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { Shape } from '../mesh/types'
import type { CompoundShape } from '../stdlib/shape'
import type { ShapeHandle, OcctKernel } from 'occt-wasm'
import { asPartName } from '../identity'

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
  script?: { statements: number; callees: string[] }
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
  const execResult = await runtime.execute(script)

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
    const lastStmt = script.statements.filter((s) => s.hasAssignment).pop()
    if (!lastStmt) {
      return { ok: false, error: 'No statements to export' }
    }
    // Phase 3: stmt.id 是 sN（StmtId），outputs[0] 才是 PartName（outputs 键）
    const lastPartName = lastStmt.outputs[0] ?? lastStmt.id
    const shape = execResult.outputs.get(asPartName(lastPartName))
    if (!shape) {
      return { ok: false, error: `No output for statement "${lastStmt.id}" (part: ${lastPartName})` }
    }
    const solidEntry = execResult.brepSolids?.get(asPartName(lastPartName))
    return writeOutput(outPath, ext, shape, solidEntry ? { solid: solidEntry.solid, kernel: solidEntry.kernel } : undefined)
  }

  // Single terminal
  if (terminals.length === 1) {
    const terminal = terminals[0]
    const shape = execResult.outputs.get(terminal.id)
    if (!shape) {
      return { ok: false, error: `No output for terminal "${terminal.id}"` }
    }
    const solidEntry = execResult.brepSolids?.get(terminal.id)
    return writeOutput(outPath, ext, shape, solidEntry ? { solid: solidEntry.solid, kernel: solidEntry.kernel } : undefined)
  }

  // Multiple terminals — write each to a separate file
  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i]
    const shape = execResult.outputs.get(terminal.id)
    if (!shape) continue

    const name = terminal.meta?.name ?? terminal.id
    const sep = outPath.endsWith('/') || outPath.endsWith('\\') ? '' : '_'
    const terminalOutPath = `${outPath}${sep}${i}_${name}.${ext}`
    const solidEntry = execResult.brepSolids?.get(terminal.id)
    const result = writeOutput(terminalOutPath, ext, shape, solidEntry ? { solid: solidEntry.solid, kernel: solidEntry.kernel } : undefined)
    if (!result.ok) return result
  }

  return { ok: true, outputFormat: ext }
}

/**
 * 写出输出文件。
 *
 * 按零件类型分别处理 STEP 导出：
 * - 有 BREP solid → 精确 STEP（exportStepFromSolid，ADVANCED_FACE）
 * - 无 BREP solid → 三角化 STEP（exportStep/meshesToStep，faceted）
 * - STL：无论是否 BREP，都取 mesh Shape 导出
 *
 * keep-syntax §5.1：outputs 现含 compound（group/assembly 产物，无 mesh）；
 * compound 无法导出，给出明确错误（此前"不在 outputs 中"是静默失败）。
 */
function writeOutput(
  outPath: string,
  ext: string,
  shape: Shape | CompoundShape,
  brepSolid?: { solid: ShapeHandle; kernel: OcctKernel },
): CliRunResult {
  if (!('positions' in shape) || !('indices' in shape)) {
    return {
      ok: false,
      error: `Output "${outPath}" is a compound (group/assembly) with no exportable mesh; export a member shape instead`,
    }
  }
  if (ext === 'stl') {
    const buffer = buildStlBufferFromMesh(shape.positions, shape.indices)
    writeFileSync(outPath, Buffer.from(buffer))
    return { ok: true, outputFile: outPath, outputFormat: 'stl' }
  }

  if (ext === 'step' || ext === 'stp') {
    if (brepSolid) {
      // 有 BREP solid → 精确 STEP
      const buffer = exportStepFromSolid(brepSolid.solid, brepSolid.kernel)
      writeFileSync(outPath, Buffer.from(buffer))
      return { ok: true, outputFile: outPath, outputFormat: 'step' }
    }
    // 无 BREP solid → 三角化 STEP（mesh 也可以导出 STEP，只是三角化的）
    const stepContent = exportStep(shape)
    writeFileSync(outPath, Buffer.from(stepContent, 'utf-8'))
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
        process.stdout.write(`  callees: ${result.script.callees.join(', ')}\n`)
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
