/**
 * faijs-cli — CLI 逻辑（可导入、可测试）。第三方调用入口：packages/core/scripts/faijs-cli.ts。
 * （仓库自用 doc/ci/开发脚本在根 scripts/ 与 packages/core/scripts/gen-*，见 scripts/README.md。）
 *
 *
 * 命令：
 *   check <file.fai.js>                 — dryRun：parse + schema + 引用预检
 *   run <file.fai.js> --out <file>      — 执行并导出 STL/STEP
 *   view <file.fai.js> --out <x.svg>    — 执行并投影输出视图 SVG（三视图/等轴测）
 *
 * 选项：
 *   --mode <auto|brep|mesh>             — 执行模式（默认 auto；view 需要 BREP 路径）
 *   --assets <dir>                      — 资产目录
 *   --fonts <dir>                       — 额外字体目录
 *   --part <name>                       — (view) 指定投影的 shape 变量名；缺省按终端自动选择
 *   --view <front|back|top|bottom|left|right|iso|"x,y,z">
 *                                       — (view) 单视图方向（默认 front）
 *   --sheet <front,top,right,iso>       — (view) 多视图图纸（projectSheet；与 --view 互斥）
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { createRuntime } from '../cad-runtime/runtime'
import type { StdlibNamespace } from '../runtime-state'
import type { ExecutionMode, HostPorts, LibLoader } from '../cad-runtime/ports'
import { createNodePorts } from './index'
import { createFsProjectLoader, findProjectRoot, projectKeyOf } from './fs-project-loader'
import { buildStlBufferFromMesh } from '../brep/export/stl'
import { exportStepFromSolid, exportStepFromSolids, type StepExportEntry } from '../brep/export/step'
import { exportStep } from '../occt-kernel/highLevelApi'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import type { Shape } from '../mesh/types'
import type { CompoundShape } from '../shape'
import { ensureSlot } from '../shape'
import { brepOf } from '../shape'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { asPartName } from '../identity'
import { projectView, projectSheet } from '../api/view'
import type { ViewSpec } from '../api/view/view-camera'

// ── P 四（4.4）：Node CLI 自动装载白名单 ──
// 脚本 import 的第三方包默认不从网络解析；仅白名单内的包可按需动态装载
// （monorepo workspace symlink 直接把裸包解析到包源码，无需 URL 构造）。
// 注意：脚本 specifier（如 'gear-lib-demo'）经 derivePackageName 无 '@' 前缀，
// 与 CLI 装载的真实包名（'@faicad/gear-lib-demo'）不同——白名单按真实包名登记，
// 同时收录该包名的短 specifier 别名，loadLib 一律归一到真实包名再 import。
const CLI_ALLOWED_LIBS = new Set(['@faicad/gear-lib-demo', '@faicad/sheetmetal', '@faicad/cq-compat', '@faicad/fai-cq-gears'])
/** specifier → 真实包名 归一映射（短名与完整 scoped 名都登记为可装载）。 */
const CLI_LIB_ALIASES: Record<string, string> = {
  '@faicad/gear-lib-demo': '@faicad/gear-lib-demo',
  'gear-lib-demo': '@faicad/gear-lib-demo',
  '@faicad/sheetmetal': '@faicad/sheetmetal',
  'sheetmetal': '@faicad/sheetmetal',
  '@faicad/cq-compat': '@faicad/cq-compat',
  'cq-compat': '@faicad/cq-compat',
  '@faicad/fai-cq-gears': '@faicad/fai-cq-gears',
  'fai-cq-gears': '@faicad/fai-cq-gears',
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
  options: { autoLift: false },
}

/** 注入 libLoader 到 node ports（CLI 宿主白名单装载）。 */
function withCliLibLoader(ports: HostPorts): HostPorts {
  return { ...ports, libLoader: cliPortsLibLoader }
}

/**
 * 注入 projectLoader 到 node ports（多文件 §4.5）。
 *
 * 项目根缺省由 `findProjectRoot` 从入口文件向上找最近的 `package.json`；
 * 宿主可用 `--project-root` 覆盖。未提供根（不应发生）时不注入，单文件行为不变。
 */
function withCliProjectLoader(ports: HostPorts, root: string | undefined): HostPorts {
  if (!root) return ports
  return { ...ports, projectLoader: createFsProjectLoader(root) }
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
  /**
   * 项目根（多文件 §4.5）：相对 import 的解析基准，moduleKey = 相对它的路径。
   * 缺省由入口文件向上找最近的 package.json。
   */
  projectRoot?: string
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

/** Options accepted by the `view` command. */
export interface CliViewOptions {
  /** Execution mode ('auto' | 'brep' | 'mesh'). view 需要 BREP 路径（mesh-only 无投影）。 */
  mode?: ExecutionMode
  /** Asset directory used by the node ports. */
  assetsDir?: string
  /** Extra fonts directory used by the node ports. */
  fontsDir?: string
  /** Default font path used by the node ports. */
  defaultFontPath?: string
  /** Host-injected library namespace (includes cad). */
  libs?: Record<string, StdlibNamespace>
  /** Project root for relative .fai.js imports. */
  projectRoot?: string
  /** Shape variable name to project; default resolves terminals like `run`. */
  part?: string
  /** Single view direction (default 'front'); mutually exclusive with sheet. */
  view?: ViewSpec
  /** Multi-view sheet list (projectSheet); mutually exclusive with view. */
  sheet?: ViewSpec[]
}

/** Result of the `view` (execute and project SVG) command. */
export interface CliViewResult {
  /** Whether execution and projection succeeded. */
  ok: boolean
  /** The written SVG file path(s). */
  outputFiles?: string[]
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
  // 多文件（§4.5）：项目根缺省向上找 package.json；入口自身也有 key（相对根的路径），
  // 否则入口在子目录时它的 `./parts/x.fai.js` 会以根为基准解析而错位。
  const projectRoot = opts?.projectRoot ? resolve(opts.projectRoot) : findProjectRoot(filePath)
  const entryKey = projectKeyOf(projectRoot, filePath)

  // Initialize OCCT and bind the vendored brepjs kernel registry (D10) so that
  // cq-compat parts (which project ops through compatFn) run end-to-end under
  // the CLI. registerOcctBrepEngine is idempotent and itself boots initOcctWasm.
  await registerOcctBrepEngine()

  // Create runtime with node ports
  const ports = withCliProjectLoader(
    withCliLibLoader(createNodePorts({
      assetsDir: opts?.assetsDir,
      fontsDir: opts?.fontsDir,
      defaultFontPath: opts?.defaultFontPath,
    })),
    projectRoot,
  )
  const runtime = createRuntime(ports, opts?.mode ?? 'auto', opts?.libs)
  // Part 1.4：cad 经 registerLib 声明 packageName（脚本可 `import * as cad from
  // '@faicad/faijs'`，check ①.5 据此校验 specifier——不 declare 则 import 被拒）。
  if (opts?.libs?.cad) {
    runtime.registerLib('cad', opts.libs.cad, {
      default: true,
      packageName: '@faicad/faijs',
    })
  }

  // Execute（T5 后：direct 路径，源码文本直通执行）
  const execResult = await runtime.execute(code, { entryKey })

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
    // No terminals — use last output
    const outputNames = [...execResult.outputs.keys()]
    if (outputNames.length === 0) {
      return { ok: false, error: 'No statements to export' }
    }
    const lastPartName = outputNames[outputNames.length - 1]
    const shape = execResult.outputs.get(asPartName(lastPartName))
    if (!shape) {
      return { ok: false, error: `No output for part "${lastPartName}"` }
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
    // Assembly (compound with behavior) → expand members with colors
    if (!('positions' in shape) || !('indices' in shape)) {
      const asmResult = writeAssemblyStep(outPath, ext, shape as CompoundShape, execResult)
      if (asmResult) return asmResult
    }
    const solidEntry = execResult.brepSolids?.get(terminal.id)
    return writeOutput(outPath, ext, shape, solidEntry ? { solid: solidEntry.solid, kernel: solidEntry.kernel } : undefined)
  }

  // Multiple terminals — write each to a separate file
  // First, check if any terminal is a compound (assembly) — export it as a single STEP
  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i]
    const shape = execResult.outputs.get(terminal.id)
    if (!shape) continue
    if (!('positions' in shape) || !('indices' in shape)) {
      // Compound terminal — try assembly STEP export
      const asmResult = writeAssemblyStep(outPath, ext, shape as CompoundShape, execResult)
      if (asmResult) return asmResult
    }
  }
  // Then export non-compound terminals
  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i]
    const shape = execResult.outputs.get(terminal.id)
    if (!shape) continue
    if (!('positions' in shape) || !('indices' in shape)) continue // skip compounds

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
 * 解析 `--view` 参数：三数字逗号串 → 方向对象（"1,-1,1" → { dir: [1,-1,1] }），
 * 否则按视图名字符串处理（未知名由 viewCamera 抛错）。
 */
function parseViewArg(v: string): ViewSpec {
  const parts = v.split(',').map((s) => s.trim())
  if (parts.length === 3) {
    const nums = parts.map(Number)
    if (nums.every((n) => Number.isFinite(n))) return { dir: nums as [number, number, number] }
  }
  // 视图名字符串（'front'|'iso'|…）：类型上 CLI 接受任意名称，未知名由 viewCamera 抛错。
  return v as ViewSpec
}

/**
 * 选出待投影的 shape 列表（`--part` 指定，或按终端自动选择，与 `run` 一致）：
 * 只保留带 mesh 的 shape（compound/assembly 无 mesh，无法投影，跳过）。
 */
function selectViewShapes(
  execResult: {
    outputs: Map<unknown, Shape | CompoundShape>
    terminals?: Array<{ id: unknown; meta?: { name?: string } }>
  },
  part?: string,
): Array<{ name: string; shape: Shape }> {
  const outputs = execResult.outputs
  const viewable = (s: Shape | CompoundShape | undefined): s is Shape =>
    !!s && 'positions' in s && 'indices' in s

  if (part) {
    const shape = outputs.get(asPartName(part)) ?? outputs.get(part)
    if (viewable(shape)) return [{ name: part, shape }]
    return []
  }

  const terminals = execResult.terminals ?? []
  const ids: unknown[] = terminals.length > 0 ? terminals.map((t) => t.id) : [...outputs.keys()]
  const out: Array<{ name: string; shape: Shape }> = []
  for (const id of ids) {
    const shape = outputs.get(id) ?? outputs.get(asPartName(String(id)))
    if (viewable(shape)) {
      const metaName = terminals.find((t) => t.id === id)?.meta?.name
      out.push({ name: metaName ?? String(id), shape })
    }
  }
  return out
}

/**
 * Execute the `view` command: execute a .fai.js file and write view SVG(s).
 *
 * 投影在宿主侧进行：脚本只需建模（shape 变量或终端），CLI 调 projectView（--view，
 * 缺省 front）或 projectSheet（--sheet）把 SVG 字符串写盘。view 需要 BREP 路径——
 * mesh-only 的 shape 无 brep 槽，projectView 抛 E_BREP_ONLY_INPUT（提示 --mode brep/auto）。
 *
 * @param filePath - path to the .fai.js file to execute
 * @param outPath - output SVG path (multiple shapes get `<out>_<i>_<name>.svg` suffixes)
 * @param opts - optional view options (mode, part, view/sheet, assets/fonts dirs, libs)
 * @returns the view result describing success or failure
 */
export async function cliView(
  filePath: string,
  outPath: string,
  opts?: CliViewOptions,
): Promise<CliViewResult> {
  const code = readFileSync(filePath, 'utf-8')
  const projectRoot = opts?.projectRoot ? resolve(opts.projectRoot) : findProjectRoot(filePath)
  const entryKey = projectKeyOf(projectRoot, filePath)

  // Initialize OCCT（投影 HLR 依赖 brep 内核）
  await initOcctWasm()

  const ports = withCliProjectLoader(
    withCliLibLoader(createNodePorts({
      assetsDir: opts?.assetsDir,
      fontsDir: opts?.fontsDir,
      defaultFontPath: opts?.defaultFontPath,
    })),
    projectRoot,
  )
  const runtime = createRuntime(ports, opts?.mode ?? 'auto', opts?.libs)
  if (opts?.libs?.cad) {
    runtime.registerLib('cad', opts.libs.cad, {
      default: true,
      packageName: '@faicad/faijs',
    })
  }

  const execResult = await runtime.execute(code, { entryKey })

  if (execResult.failedAt) {
    return {
      ok: false,
      error: `Execution failed at statement ${execResult.failedAt.index} (callee: ${execResult.failedAt.callee}): ${execResult.failedAt.message}`,
      infos: execResult.infos,
    }
  }

  const shapes = selectViewShapes(execResult, opts?.part)
  if (shapes.length === 0) {
    return {
      ok: false,
      error: opts?.part
        ? `No output for part "${opts.part}"`
        : 'No viewable (mesh-bearing) shapes to project',
      infos: execResult.infos,
    }
  }

  const outFiles: string[] = []
  const single = shapes.length === 1
  for (let i = 0; i < shapes.length; i++) {
    const { name, shape } = shapes[i]
    const target = single
      ? outPath
      : `${outPath}${outPath.endsWith('/') || outPath.endsWith('\\') ? '' : '_'}${i}_${name}.svg`
    try {
      const svg = opts?.sheet
        ? projectSheet(shape, opts.sheet)
        : projectView(shape, opts?.view ?? 'front')
      writeFileSync(target, svg, 'utf-8')
      outFiles.push(target)
    } catch (e) {
      return {
        ok: false,
        error: `Projection failed for "${name}": ${(e as Error).message}`,
        infos: execResult.infos,
      }
    }
  }
  return { ok: true, outputFiles: outFiles, infos: execResult.infos }
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
 * Export an assembly (compound with AssemblyBehavior) as a multi-entity STEP
 * file, preserving member names and colors (from behavior.memberColors).
 *
 * Returns null if the compound has no assembly behavior (falls through to
 * regular writeOutput), or a CliRunResult on success/failure.
 */
function writeAssemblyStep(
  outPath: string,
  ext: string,
  compound: CompoundShape,
  execResult: {
    outputs: Map<unknown, Shape | CompoundShape>
    brepSolids?: Map<unknown, { solid: BrepHandle; kernel: BrepEngineApi }>
  },
): CliRunResult | null {
  if (ext !== 'step' && ext !== 'stp') return null
  const slot = ensureSlot(compound)
  const behavior = slot.behavior as
    | { memberNames?: string[]; memberColors?: Record<string, [number, number, number]> }
    | undefined

  // Find a kernel and collect all exportable solids
  let kernel: BrepEngineApi | null = null
  const entries: StepExportEntry[] = []

  // Preferred path: use behavior.memberNames to match colors.
  // Member name lookup tries (1) the explicit member name, then (2) the kept
  // script-variable name of the compound's i-th child — cq-compat's
  // buildAssembly passes CadQuery-style part names ("axk") while the shapes
  // are registered under their .fai.js variable names ("shape_axk").
  if (behavior?.memberNames && behavior.memberNames.length > 0) {
    // Member Shape list (same order as memberNames) — when a member name
    // misses in brepSolids (e.g. cq libs register short names like 'axk' while
    // the statement variable is 'shape_axk'), resolve the member shape by index
    // and extract its BREP solid, keeping the member name and color.
    const children = (compound as { children?: Shape[] }).children ?? []
    for (let i = 0; i < behavior.memberNames.length; i++) {
      const memberName = behavior.memberNames[i]
      const solidEntry = execResult.brepSolids?.get(asPartName(memberName))
      if (solidEntry) {
        if (!kernel) kernel = solidEntry.kernel
        entries.push({
          solid: solidEntry.solid,
          name: memberName,
          color: behavior.memberColors?.[memberName],
        })
        continue
      }
      const child = children[i]
      const solid = child ? (brepOf(child) as BrepHandle | undefined) : undefined
      if (solid) {
        if (!kernel) kernel = execResult.brepSolids?.values().next().value?.kernel ?? null
        if (kernel) {
          entries.push({
            solid,
            name: memberName,
            color: behavior.memberColors?.[memberName],
          })
        }
      }
    }
  }

  // Fallback: export all brepSolids (covers compounds where memberNames wasn't propagated)
  if (entries.length === 0 && execResult.brepSolids) {
    for (const [key, solidEntry] of execResult.brepSolids) {
      if (!kernel) kernel = solidEntry.kernel
      entries.push({
        solid: solidEntry.solid,
        name: typeof key === 'string' ? key : `part_${entries.length}`,
      })
    }
  }

  if (!kernel || entries.length === 0) {
    return null // Let writeOutput handle the error
  }

  const buffer = exportStepFromSolids(kernel, entries)
  writeFileSync(outPath, Buffer.from(buffer))
  return { ok: true, outputFile: outPath, outputFormat: 'step' }
}

/**
 * Parse command-line arguments.
 *
 * @param argv - the raw process argument list (index 0 = node, 1 = script)
 * @returns the parsed command, file, and option values (command is null when unusable)
 */
export function parseArgs(argv: string[]): {
  command: 'check' | 'run' | 'view' | null
  file?: string
  out?: string
  mode?: ExecutionMode
  assetsDir?: string
  fontsDir?: string
  projectRoot?: string
  view?: string
  sheet?: string
  part?: string
} {
  const args = argv.slice(2) // skip node + script
  if (args.length === 0) return { command: null }

  const command = args[0] as 'check' | 'run' | 'view' | null
  if (command !== 'check' && command !== 'run' && command !== 'view') return { command: null }

  let file: string | undefined
  let out: string | undefined
  let mode: ExecutionMode | undefined
  let assetsDir: string | undefined
  let fontsDir: string | undefined
  let projectRoot: string | undefined
  let view: string | undefined
  let sheet: string | undefined
  let part: string | undefined

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
    } else if (arg === '--project-root') {
      projectRoot = args[++i]
    } else if (arg === '--view') {
      view = args[++i]
    } else if (arg === '--sheet') {
      sheet = args[++i]
    } else if (arg === '--part') {
      part = args[++i]
    } else if (!file && !arg.startsWith('-')) {
      file = arg
    }
  }

  return { command, file, out, mode, assetsDir, fontsDir, projectRoot, view, sheet, part }
}

/**
 * CLI main entry point (called by scripts/faijs-cli.ts).
 *
 * @param argv - the raw process argument list
 * @param libs - host-injected library namespace (includes cad — faijs-cli.ts passes createInternalStdlib; core does not assemble it by default)
 * @returns the process exit code (0 on success, non-zero on failure)
 */
export async function cliMain(argv: string[], libs?: Record<string, StdlibNamespace>): Promise<number> {
  const { command, file, out, mode, assetsDir, fontsDir, projectRoot, view, sheet, part } = parseArgs(argv)

  if (!command) {
    process.stderr.write('Usage: faijs-cli <check|run|view> <file.fai.js> [options]\n')
    process.stderr.write('  check <file>              DryRun validation\n')
    process.stderr.write('  run <file> --out <file>   Execute and export STL/STEP\n')
    process.stderr.write('  view <file> --out <svg>   Execute and project view SVG (三视图/等轴测)\n')
    process.stderr.write('  --mode <auto|brep|mesh>   Execution mode (view 需要 BREP 路径)\n')
    process.stderr.write('  --assets <dir>            Asset directory\n')
    process.stderr.write('  --fonts <dir>             Extra fonts directory\n')
    process.stderr.write('  --project-root <dir>      Project root for relative .fai.js imports\n')
    process.stderr.write('  --part <name>             (view) shape variable to project (default: terminals)\n')
    process.stderr.write('  --view <dir>              (view) single view: front|back|top|bottom|left|right|iso|"x,y,z" (default front)\n')
    process.stderr.write('  --sheet <a,b,c>           (view) multi-view sheet: front,top,right,iso (mutually exclusive with --view)\n')
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
    const result = await cliRun(filePath, outPath, { mode, assetsDir, fontsDir, projectRoot, libs })

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

  if (command === 'view') {
    if (!out) {
      process.stderr.write('Error: --out is required for "view" command\n')
      return 1
    }
    if (view && sheet) {
      process.stderr.write('Error: --view and --sheet are mutually exclusive\n')
      return 1
    }

    const outPath = resolve(out)
    const viewSpec = view ? parseViewArg(view) : undefined
    const sheetSpec = sheet
      ? (sheet
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as ViewSpec[])
      : undefined
    const result = await cliView(filePath, outPath, {
      mode,
      assetsDir,
      fontsDir,
      projectRoot,
      libs,
      part,
      view: viewSpec,
      sheet: sheetSpec,
    })

    if (result.ok) {
      for (const f of result.outputFiles ?? []) {
        process.stdout.write(`✓ ${filePath} → ${f} (svg)\n`)
      }
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
