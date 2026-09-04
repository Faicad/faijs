/**
 * faijs-cli — CLI 逻辑（可导入、可测试）
 *
 *
 * 命令：
 *   check <file.fai.js>                 — dryRun：parse + schema + 引用预检
 *   run <file.fai.js> --out <file>      — 执行并导出 STL/STEP
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
import type { StdlibNamespace } from '../runtime-state'
import type { ExecutionMode, HostPorts, LibLoader } from '../cad-runtime/ports'
import { createNodePorts } from './index'
import { buildStlBufferFromMesh } from '../brep/export/stl'
import { exportStepFromSolid } from '../brep/export/step'
import { exportStep } from '../occt-kernel/highLevelApi'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { Shape } from '../mesh/types'
import type { CompoundShape } from '../shape'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { asPartName } from '../identity'

// ── P 四（4.4）：Node CLI 自动装载白名单 ──
// 脚本 import 的第三方包默认不从网络解析；仅白名单内的包可按需动态装载
// （monorepo workspace symlink 直接把裸包解析到包源码，无需 URL 构造）。
// 注意：脚本 specifier（如 'gear-lib-demo'）经 derivePackageName 无 '@' 前缀，
// 与 CLI 装载的真实包名（'@faicad/gear-lib-demo'）不同——白名单按真实包名登记，
// 同时收录该包名的短 specifier 别名，loadLib 一律归一到真实包名再 import。
const CLI_ALLOWED_LIBS = new Set(['@faicad/gear-lib-demo'])
/** specifier → 真实包名 归一映射（短名与完整 scoped 名都登记为可装载）。 */
const CLI_LIB_ALIASES: Record<string, string> = {
  '@faicad/gear-lib-demo': '@faicad/gear-lib-demo',
  'gear-lib-demo': '@faicad/gear-lib-demo',
}

const cliPortsLibLoader: LibLoader = {
  loadLib: async (name) => {
    const pkg = CLI_LIB_ALIASES[name]
    if (!pkg || !CLI_ALLOWED_LIBS.has(pkg)) {
      throw new Error(`package "${name}" is not in the CLI library whitelist`)
    }
    return (await import(pkg)) as StdlibNamespace
  },
  listLibs: () => Object.keys(CLI_LIB_ALIASES),
  options: { compat: true },
}

/** 注入 libLoader 到 node ports（CLI 宿主白名单装载）。 */
function withCliLibLoader(ports: HostPorts): HostPorts {
  return { ...ports, libLoader: cliPortsLibLoader }
}

/** Options accepted by the `check` command. */
export interface CliCheckOptions {
  /** Asset directory used by the node ports. */
  assetsDir?: string
  /** Extra fonts directory used by the node ports. */
  fontsDir?: string
}

/** Options accepted by the `run` command. */
export interface CliRunOptions {
  /** Execution mode ('auto' | 'brep' | 'mesh'). */
  mode?: ExecutionMode
  /** Asset directory used by the node ports. */
  assetsDir?: string
  /** Extra fonts directory used by the node ports. */
  fontsDir?: string
  /** Default font path used by the node ports. */
  defaultFontPath?: string
  /** Host-injected library namespace (includes cad — the CLI entry faijs-cli.ts passes createInternalStdlib; core does not assemble it by default). */
  libs?: Record<string, StdlibNamespace>
}

/** Result of the `check` (dry-run validation) command. */
export interface CliCheckResult {
  /** Whether the validation passed. */
  ok: boolean
  /** Validation errors found, one per stage. */
  errors: Array<{ stage: string; message: string; line?: number; stmtId?: string }>
  /** Non-fatal warnings reported during validation. */
  warnings: string[]
  /** Script-level summary when the script parsed successfully. */
  script?: { statements: number; callees: string[] }
}

/** Result of the `run` (execute and export) command. */
export interface CliRunResult {
  /** Whether execution and export succeeded. */
  ok: boolean
  /** The written output file path. */
  outputFile?: string
  /** The written output format ('stl' | 'step'). */
  outputFormat?: string
  /** A human-readable error message when the command failed. */
  error?: string
  /** Informational messages collected during execution. */
  infos?: string[]
}

/**
 * Execute the `check` command: dry-run validate a .fai.js file.
 *
 * @param filePath - path to the .fai.js file to validate
 * @param _opts - optional CLI check options (assets and fonts directories)
 * @returns the check result with any validation errors
 */
export function cliCheck(filePath: string, _opts?: CliCheckOptions): CliCheckResult {
  const code = readFileSync(filePath, 'utf-8')
  const ports = withCliLibLoader(createNodePorts({
    assetsDir: _opts?.assetsDir,
    fontsDir: _opts?.fontsDir,
  }))
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
 * Execute the `run` command: execute a .fai.js file and export STL/STEP.
 *
 * @param filePath - path to the .fai.js file to execute
 * @param outPath - output file path for the exported result (extension determines format)
 * @param opts - optional run options (mode, assets/fonts directories, injected libs)
 * @returns the run result describing success or failure
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
  const ports = withCliLibLoader(createNodePorts({
    assetsDir: opts?.assetsDir,
    fontsDir: opts?.fontsDir,
    defaultFontPath: opts?.defaultFontPath,
  }))
  const runtime = createRuntime(ports, opts?.mode ?? 'auto', opts?.libs)
  // Part 1.4：cad 经 registerLib 声明 packageName（脚本可 `import * as cad from
  // '@faicad/faijs'`，check ①.5 据此校验 specifier——不 declare 则 import 被拒）。
  if (opts?.libs?.cad) {
    runtime.registerLib('cad', opts.libs.cad, {
      default: true,
      compat: false,
      packageName: '@faicad/faijs',
    })
  }

  // Execute（内部：直接消费 parseScript 的 IR，走引擎内部版本）
  const execResult = await runtime.executeIR(script)

  if (execResult.failedAt) {
    return {
      ok: false,
      error: `Execution failed at statement ${execResult.failedAt.index} (callee: ${execResult.failedAt.callee}): ${execResult.failedAt.message}`,
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
  brepSolid?: { solid: BrepHandle; kernel: BrepEngineApi },
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
 * Parse command-line arguments.
 *
 * @param argv - the raw process argument list (index 0 = node, 1 = script)
 * @returns the parsed command, file, and option values (command is null when unusable)
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
 * CLI main entry point (called by scripts/faijs-cli.ts).
 *
 * @param argv - the raw process argument list
 * @param libs - host-injected library namespace (includes cad — faijs-cli.ts passes createInternalStdlib; core does not assemble it by default)
 * @returns the process exit code (0 on success, non-zero on failure)
 */
export async function cliMain(argv: string[], libs?: Record<string, StdlibNamespace>): Promise<number> {
  const { command, file, out, mode, assetsDir, fontsDir } = parseArgs(argv)

  if (!command) {
    process.stderr.write('Usage: faijs-cli <check|run> <file.fai.js> [options]\n')
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
    const result = await cliRun(filePath, outPath, { mode, assetsDir, fontsDir, libs })

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
