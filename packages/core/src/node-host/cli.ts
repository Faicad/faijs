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

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, extname, dirname, join } from 'node:path'
import { createRuntime } from '../cad-runtime/runtime'
import type { CadRuntime } from '../cad-runtime/runtime'
import type { LibNamespace } from '../runtime-state'
import type { ExecutionMode, HostPorts, LibLoader } from '../cad-runtime/ports'
import { createNodePorts } from './index'
import { createFsProjectLoader, findProjectRoot, projectKeyOf } from './fs-project-loader'
import { exportModelSync } from '../brep/export/export-model'
import { exportStepFromSolids, type StepExportEntry } from '../brep/export/step'
import { solidToShape } from '../brep/brep-ops'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import type { Shape } from '../mesh/types'
import type { CompoundShape } from '../shape'
import { ensureSlot } from '../shape'
import { brepOf } from '../shape'
import type { BrepHandle, BrepSubShapeType } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { asPartName } from '../identity'
import { symbolTableNames } from '../lang/symbol-table'
import { projectView, projectSheet } from '../api/view'
import type { ViewSpec } from '../api/view/view-camera'

// ── P 四（4.4）：Node CLI 自动装载（D3-Node，§9.4）──
// 脚本 import 的第三方库按 specifier 动态解析，host 不再写死任何包清单：
// - scoped 包名（`@faicad/...`）直接动态 import；
// - 短名（如 `sheetmetal`）先归一为 scoped 全名再装载（避免误装同名陌生人包）。
// 包未安装 → 动态 import 抛 ERR_MODULE_NOT_FOUND，由 runtime 报明确装载失败信息。
/** scoped 包名前缀：CLI 允许动态装载的库范围。 */
const CLI_SCOPED_PREFIX = '@faicad/'
/** 已登记短名 → scoped 全名归一表（仅收录 `@faicad/` 范围内的库，防同名陌生人包）。 */
const CLI_SHORT_NAMES: Record<string, string> = {
  'sheetmetal': '@faicad/sheetmetal',
  'faijs-cadquery': '@faicad/faijs-cadquery',
  'faijs-gears': '@faicad/faijs-gears',
  'faijs-fasteners': '@faicad/faijs-fasteners',
}

/**
 * 读库 package.json 的 `faijs.autoLift` 字段（D3-autoLift 外置，§9.4）：
 * 逐库 autoLift 约定从 host 写死改为由各库自身 package.json 声明，loader 此处读取。
 * 未声明 → 返回 undefined（回落到 runtime 的推断式 `!hasDualOp(ns)`）；
 * 声明为布尔 → 直接采用（如 cq-compat 声明 false，因其函数以 faijs Shape 为受众，
 * 被 compat 边界整体提升会破坏内部借面逻辑）。
 */
const requireNode = createRequire(import.meta.url)
function readLibAutoLift(pkg: string): boolean | undefined {
  try {
    const pjPath = requireNode.resolve(`${pkg}/package.json`)
    const pj = JSON.parse(readFileSync(pjPath, 'utf8')) as { faijs?: { autoLift?: boolean } }
    const v = pj.faijs?.autoLift
    return typeof v === 'boolean' ? v : undefined
  } catch {
    return undefined
  }
}

/** specifier → scoped 全名归一：scoped 名原样，已登记短名映射，其余原样交 import 解析。 */
function normalizeCliSpecifier(name: string): string {
  return CLI_SHORT_NAMES[name] ?? name
}

const cliPortsLibLoader: LibLoader = {
  loadLib: async (name) => {
    const pkg = normalizeCliSpecifier(name)
    if (!pkg.startsWith(CLI_SCOPED_PREFIX)) {
      throw new Error(`package "${name}" is not a scoped @faicad/ library`)
    }
    return (await import(pkg)) as LibNamespace
  },
  listLibs: () => [...Object.keys(CLI_SHORT_NAMES), '@faicad/'],
  loadSource: async (name) => {
    const pkg = normalizeCliSpecifier(name)
    if (!pkg.startsWith(CLI_SCOPED_PREFIX)) return undefined
    try {
      const req = createRequire(import.meta.url)
      const pkgJsonPath = req.resolve(`${pkg}/package.json`)
      const pkgDir = dirname(pkgJsonPath)
      for (const p of [join(pkgDir, 'src', 'index.ts'), join(pkgDir, 'dist', 'index.js'), join(pkgDir, 'src', 'index.js')]) {
        if (existsSync(p)) return readFileSync(p, 'utf-8')
      }
      return undefined
    } catch {
      return undefined
    }
  },
  // 默认不提升（与历史 CLI 行为一致）；各库用 package.json "faijs.autoLift" 逐库覆盖。
  options: {
    autoLift: false,
    autoLiftFor: (name) => {
      const pkg = normalizeCliSpecifier(name)
      return pkg.startsWith(CLI_SCOPED_PREFIX) ? readLibAutoLift(pkg) : undefined
    },
  },
}

/**
 * 注入 libLoader 到 node ports（CLI 宿主白名单装载）。Exported for executeScript (B6).
 * @param ports - Node host ports to augment with the CLI lib loader.
 * @returns The augmented ports (`libLoader` set to the CLI scoped-package loader).
 */
export function withCliLibLoader(ports: HostPorts): HostPorts {
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
  /**
   * Extra cad-namespace entries the host merges at run time (`cad.sketch`
   * from @faicad/faijs-sketch).
   *
   * I-group (2026-10-03): the unknown-op guard compares the script's callees
   * against `symbolTableNames()`, which knows only the STATIC table. A host
   * that merges those libraries and passes them to {@link cliRun} therefore
   * got `unknown op: cad.sketch is not in the cad namespace` from every check
   * of a perfectly runnable script — `rebased-sweep.ts` reported it for every
   * product in a corpus sweep. Check and run must see the same namespace, so
   * the caller states its merged entries here.
   */
  libs?: Record<string, unknown>
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
  /** Host-injected library namespace (includes cad — the CLI entry faijs-cli.ts passes createApiNamespace; core does not assemble it by default). */
  libs?: Record<string, LibNamespace>
  /**
   * 项目根（多文件 §4.5）：相对 import 的解析基准，moduleKey = 相对它的路径。
   * 缺省由入口文件向上找最近的 package.json。
   */
  projectRoot?: string
  /**
   * 连带导出隐藏终端（默认 false）。keep / keepHidden 保留的源几何默认不产出
   * （隐藏的语义即"保留但不出现在产物里"）；置 true 恢复旧行为，把 hidden 终端
   * 也一并写盘（多为诊断用途）。
   */
  includeHidden?: boolean
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
  libs?: Record<string, LibNamespace>
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
  const errors = result.errors.map((e) => ({
    stage: e.stage,
    message: e.message,
    line: e.line,
    stmtId: e.stmtId,
  }))
  // D11 (2026-09-28): unknown-op guard. check() is syntax+reference only — an
  // op the cad namespace doesn't have used to pass `check` clean and die at
  // runtime (e.g. `cad.sketch is not a function` when a host forgets to merge
  // the sketch library). Compare the script's callees against the
  // symbol-table union view (platform + registered library entries) and fail
  // the check on any unknown callee.
  if (result.ok && result.script) {
    const known = new Set(symbolTableNames())
    // Ops the host merges at run time are not in the static table; accept the
    // names it declares as known so check agrees with the run that follows.
    for (const ns of Object.values(_opts?.libs ?? {})) {
      if (ns && typeof ns === 'object') {
        for (const key of Object.keys(ns as Record<string, unknown>)) known.add(key)
      }
    }
    const unknown = [...new Set(result.script.callees)].filter((n) => !known.has(n))
    for (const name of unknown) {
      errors.push({
        stage: 'symbol',
        message: `unknown op: cad.${name} is not in the cad namespace (host library not merged or op name misspelled)`,
        line: undefined,
        stmtId: undefined,
      })
    }
  }
  return {
    ok: result.ok && errors.length === 0,
    errors,
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

  // Initialize OCCT and bind the brep engine registry (D10) so that
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

  // E1 (H12): export-side failures must surface as a structured result, not an
  // exception — the census and batch driver treat a throw as a process crash,
  // while `{ ok: false, error }` keeps it a per-file, classifiable failure.
  try {
    return await exportExecutionResult(outPath, ext, execResult, terminals, opts?.includeHidden ?? false)
  } catch (e) {
    return {
      ok: false,
      error: `Export failed: ${String((e as Error)?.message ?? e)}`,
      infos: execResult.infos,
    }
  }
}

/**
 * 选出「可导出」的终端：默认剔除 hidden。
 *
 * 隐藏终端 = 「保留但不产出」（`keep` / `keepHidden` 语义，R5）。导出层必须默认跳过，
 * 否则布尔运算保留的源几何会对每个 hidden 终端各写一个 `out.step_<i>_<name>` 产物，
 * 让一个逻辑形状看起来像 N 个（FCStd port 的 `solids 1vsN` 失配即由此而来）。
 * 需要旧行为（连同隐藏源一起写出，多用于诊断）时显式传 `includeHidden=true`。
 *
 * @param terminals - 存活终端集合（含 `hidden` 标记）
 * @param includeHidden - 是否连同隐藏终端一起导出，缺省 false
 * @returns `exportable`（可导出终端）与 `hiddenCount`（被剔除的隐藏终端数）
 */
export function selectExportableTerminals<T extends { hidden?: boolean }>(
  terminals: readonly T[],
  includeHidden = false,
): { exportable: T[]; hiddenCount: number } {
  const hiddenCount = terminals.reduce((n, t) => (t.hidden ? n + 1 : n), 0)
  const exportable = includeHidden ? [...terminals] : terminals.filter((t) => !t.hidden)
  return { exportable, hiddenCount }
}

/** 判据取 shapeType/getSubShapes 的最小接口面（用真 kernel 时即 BrepEngineApi 的这两个方法）。 */
export interface ShapeTypeProbe {
  shapeType(shape: BrepHandle): string
  getSubShapes(shape: BrepHandle, type: BrepSubShapeType): BrepHandle[]
}

/**
 * 终端 BREP 句柄是否「可落成零件」——即含至少一个三维实体。
 *
 * **为什么需要它**：终端集合（`live-shapes.ts`）只回答「谁该被看见」，未消费的 2D 草图
 * 同样是顶层未消费变量 ⇒ 也是终端 ⇒ 会走到导出层落一个 `.step`。而 2D 面片（实测厚度
 * 2e-07、solids=0）一旦落盘，`fcstd-port` 的 `parity-judge.py merge_parts` 会把它的 area
 * 加进真实件（5.04e+06 vs 5.50e+06 ⇒ ~91% 误差），parity 必 FAIL。所以「谁该被看见」与
 * 「什么能落成零件」是两件事：本判据只管后者，不去动终端集合。
 *
 * **判决表**（实测标定，2026-10-06）：
 * | shapeType | 判决 | 依据 |
 * |---|---|---|
 * | `SOLID` / `COMPSOLID` | 导出 | 真零件 |
 * | `COMPOUND` | 含 ≥1 solid → 导出；否则跳过 | 装配体是 compound；`getSubShapes` 递归取子实体 |
 * | `SHELL` | 含 ≥1 solid → 导出；否则跳过 | 旧栈基线 9/9 真实件皆 solid/compound；实测 8 个游离草图中 5 个顶层恰是 SHELL |
 * | `FACE`/`WIRE`/`EDGE`/`VERTEX` | 跳过 | 无实体的 2D 片面 / 1D 线框 |
 * | 其它（`SHAPE` 枚举兜底、空串） | 导出 | 保守，零回归 |
 * | 无句柄（纯 mesh 终端） | 导出 | mesh 零件导出 STEP 是既有能力，不借本批收紧 |
 *
 * **`SHELL` 的裁决**：方案 §3 初稿把 shell 判为「导出（保留现状）」，理由是"面模型是合法
 * 产物的先例存在"。但 2026-10-06 的 E-1 探针推翻了该前提：
 * ① 旧栈 parity 基线（A 组 9 个真实件）顶层全为 `SOLID`/`COMPOUND`、`solids ≥ 1`，无一面模型；
 * ② 新栈多出的 8 个游离草图中 **5 个顶层就是 `SHELL`** ⇒ 按初稿判决**根本拦不住**，方案失效；
 * ③ `cli.ts` 改动前 0 处 shell 逻辑，不存在需要兼容的既有行为。
 * ⇒ 改判为 **`SHELL` 且无子实体 → 跳过**。若日后语料真出现「合法的 2D 面模型产物」需求，
 * 应由脚本侧或显式开关承接，而不是让导出层无法区分草图与零件（登记于相邻缺陷 D-2）。
 *
 * 实现上不分层递归：内核 `getSubShapes`（OCCT `TopExp_Explorer` 语义）对任意嵌套深度的
 * compound **一次即可取到全部子实体**（E-1 探针：顶层 COMPOUND 的草图也能数出 solids=0）。
 * 探针抛错 → **保守放行**（宁可多导一个，不可误删真零件）。
 *
 * @param shape - 终端 BREP 句柄（无句柄传 undefined）
 * @param probe - shapeType/getSubShapes 提供者（生产用 `brepSolids` 条目的 kernel；测试可注入假 kernel）
 * @returns 该句柄是否含至少一个实体（可落成零件）
 */
export function isExportableSolid(shape: BrepHandle | undefined, probe: ShapeTypeProbe | undefined): boolean {
  // 无 BREP 句柄（纯 mesh 终端）→ 导出（既有能力，零回归）。
  if (!shape || !probe) return true
  let type: string
  try {
    type = probe.shapeType(shape).toUpperCase()
  } catch {
    // 探针抛错（异常句柄）→ 保守放行。
    return true
  }
  switch (type) {
    case 'SOLID':
    case 'COMPSOLID':
      return true
    case 'COMPOUND':
    case 'SHELL':
      // 无实体的 compound / shell = 2D 面片（游离草图）。`getSubShapes('solid')` 递归取子实体。
      try {
        return probe.getSubShapes(shape, 'solid').length > 0
      } catch {
        return true
      }
    case 'FACE':
    case 'WIRE':
    case 'EDGE':
    case 'VERTEX':
      return false
    default:
      // 枚举兜底（'SHAPE' / 空串 / 未知方言）→ 保守导出。
      return true
  }
}

/** Export an executed result to `outPath` (shared body of cliRun's export path). */
async function exportExecutionResult(
  outPath: string,
  ext: string,
  execResult: Awaited<ReturnType<CadRuntime['execute']>>,
  terminals: NonNullable<Awaited<ReturnType<CadRuntime['execute']>>['terminals']>,
  includeHidden = false,
): Promise<{ ok: boolean; error?: string; outputFile?: string; outputFormat?: string; infos?: string[] }> {
  const { exportable, hiddenCount } = selectExportableTerminals(terminals, includeHidden)
  // 装配导出（writeAssemblyStep 的兜底路径）同样不得带出隐藏终端；includeHidden 时传 undefined。
  const hiddenTerminals = includeHidden
    ? undefined
    : new Set(terminals.filter((t) => t.hidden).map((t) => String(t.id)))
  // 有终端但全部隐藏 → 明确报错（不静默回退到「最后一个 output」，那等于把隐藏源漏出去）。
  if (!includeHidden && exportable.length === 0 && hiddenCount > 0) {
    return {
      ok: false,
      error: `All ${hiddenCount} live terminal(s) are hidden — nothing to export (pass includeHidden to export them)`,
    }
  }

  // ── 二维终端过滤（G0-D）──：终端集合回答「谁该被看见」，导出层回答「什么能落成零件」。
  // 未消费的 2D 草图同样是顶层未消费变量 ⇒ 也是终端，但落成 `.step` 会污染 parity 的 area。
  // 过滤后**不得**回退到「最后一个 output」，否则等于把刚剔除的草图从后门写回去。
  const skipped2d: string[] = []
  let solidExportable = exportable
  if (!includeHidden) {
    solidExportable = []
    for (const t of exportable) {
      const entry = execResult.brepSolids?.get(t.id)
      if (isExportableSolid(entry?.solid, entry?.kernel)) {
        solidExportable.push(t)
      } else {
        skipped2d.push(String(t.meta?.name ?? t.id))
      }
    }
    if (solidExportable.length === 0 && exportable.length > 0) {
      return {
        ok: false,
        error:
          `All ${exportable.length} live terminal(s) are 2D (no solid) — nothing to export as a 3D part` +
          (skipped2d.length > 0 ? ` (skipped: ${skipped2d.join(', ')})` : ''),
      }
    }
  }
  const solidInfos = skipped2d.length > 0 ? [`Skipped ${skipped2d.length} 2D terminal(s): ${skipped2d.join(', ')}`] : []

  if (solidExportable.length === 0) {
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
    const r = writeOutput(outPath, ext, shape, solidEntry ? { solid: solidEntry.solid, kernel: solidEntry.kernel } : undefined)
    return solidInfos.length > 0 ? { ...r, infos: [...(r.infos ?? []), ...solidInfos] } : r
  }

  // Single terminal
  if (solidExportable.length === 1) {
    const terminal = solidExportable[0]
    const shape = execResult.outputs.get(terminal.id)
    if (!shape) {
      return { ok: false, error: `No output for terminal "${terminal.id}"` }
    }
    // Assembly (compound with behavior) → expand members with colors
    if (!('positions' in shape) || !('indices' in shape)) {
      const asmResult = writeAssemblyStep(outPath, ext, shape as CompoundShape, execResult, hiddenTerminals)
      if (asmResult) {
        return solidInfos.length > 0 ? { ...asmResult, infos: [...(asmResult.infos ?? []), ...solidInfos] } : asmResult
      }
    }
    const solidEntry = execResult.brepSolids?.get(terminal.id)
    const r = writeOutput(outPath, ext, shape, solidEntry ? { solid: solidEntry.solid, kernel: solidEntry.kernel } : undefined)
    return solidInfos.length > 0 ? { ...r, infos: [...(r.infos ?? []), ...solidInfos] } : r
  }

  // Multiple terminals — write each to a separate file
  // First, check if any terminal is a compound (assembly) — export it as a single STEP
  for (let i = 0; i < solidExportable.length; i++) {
    const terminal = solidExportable[i]
    const shape = execResult.outputs.get(terminal.id)
    if (!shape) continue
    if (!('positions' in shape) || !('indices' in shape)) {
      // Compound terminal — try assembly STEP export
      const asmResult = writeAssemblyStep(outPath, ext, shape as CompoundShape, execResult, hiddenTerminals)
      if (asmResult) {
        return solidInfos.length > 0 ? { ...asmResult, infos: [...(asmResult.infos ?? []), ...solidInfos] } : asmResult
      }
    }
  }
  // Then export non-compound terminals
  for (let i = 0; i < solidExportable.length; i++) {
    const terminal = solidExportable[i]
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

  return { ok: true, outputFormat: ext, ...(solidInfos.length > 0 ? { infos: solidInfos } : {}) }
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
 * 隐藏终端（keep/keepHidden 保留的源几何）默认不投影——与 `run` 同口径。
 */
function selectViewShapes(
  execResult: {
    outputs: Map<unknown, Shape | CompoundShape>
    terminals?: Array<{ id: unknown; hidden?: boolean; meta?: { name?: string } }>
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

  // 隐藏终端默认不投影。全部终端皆隐藏 → 空集（**不**回退到「所有 outputs」，
  // 否则会把全部中间量也画出来，与 run 的「全隐藏即无可导出」语义相悖）。
  const allTerminals = execResult.terminals ?? []
  const { exportable: terminals } = selectExportableTerminals(allTerminals)
  const ids: unknown[] = allTerminals.length > 0 ? terminals.map((t) => t.id) : [...outputs.keys()]
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

  // Initialize OCCT（投影 HLR 依赖 brep 内核）。registerOcctBrepEngine is
  // idempotent and itself boots initOcctWasm, and also binds the
  // brep engine registry (D10) — same boot path as cliRun above.
  await registerOcctBrepEngine()

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
 * 按零件类型分别处理导出：
 * - STL：取网格载荷（BREP 零件先经内核三角化），无重建。
 * - STEP：有 BREP solid → 精确 STEP（ADVANCED_FACE）；无 BREP solid → 该零件的
 *   三角网格经重建管线导出（exportModelSync 内的 mesh 条目通路）。
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
  // 统一导出入口（R11）：坐标换算与单位声明由 exportModel 同源产出。
  // CLI 无单位选项 → 缺省 mm（与既有行为一致）。
  const fmt = ext === 'stp' ? 'step' : ext
  if (fmt !== 'stl' && fmt !== 'step') {
    return { ok: false, error: `Unsupported output format: .${ext} (supported: .stl, .step)` }
  }
  // STL 只吃 mesh（export-model §10.6：solid 条目由调用方先三角化）。auto 模式下
  // 形状可能是 BREP solid → 导出 STL 前必须先用内核三角化，否则「no mesh entries」。
  // STEP 则直接走 solid 条目保留 ADVANCED_FACE 拓扑。
  let entry: { solid?: BrepHandle; mesh?: { positions: Float32Array; indices: Uint32Array } }
  if (brepSolid) {
    if (fmt === 'stl') {
      const tri = solidToShape(brepSolid.kernel, brepSolid.solid)
      entry = { mesh: { positions: tri.positions, indices: tri.indices } }
    } else {
      entry = { solid: brepSolid.solid }
    }
  } else {
    entry = { mesh: { positions: shape.positions, indices: shape.indices } }
  }
  const buffer = exportModelSync([entry], fmt)
  writeFileSync(outPath, Buffer.from(buffer))
  return { ok: true, outputFile: outPath, outputFormat: fmt }
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
  hiddenTerminals?: ReadonlySet<string>,
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
      // Preferred: read the member's LIVE identity slot (brepOf) — assembly
      // transforms are baked into slot.solid by the executor's
      // applyPendingAssemblyTransforms AFTER this statement, so the brepSolids
      // snapshot (registered at member creation) may hold the PRE-transform
      // handle. GOTCHA: don't reorder — brepSolids entries are stale for
      // transformed members.
      const child = children[i]
      const liveSolid = child ? (brepOf(child) as BrepHandle | undefined) : undefined
      if (liveSolid) {
        if (!kernel) kernel = execResult.brepSolids?.values().next().value?.kernel ?? null
        if (kernel) {
          entries.push({
            solid: liveSolid,
            name: memberName,
            color: behavior.memberColors?.[memberName],
          })
          continue
        }
      }
      const solidEntry = execResult.brepSolids?.get(asPartName(memberName))
      if (solidEntry) {
        if (!kernel) kernel = solidEntry.kernel
        entries.push({
          solid: solidEntry.solid,
          name: memberName,
          color: behavior.memberColors?.[memberName],
        })
      }
    }
  }

  // Fallback: export all brepSolids (covers compounds where memberNames wasn't propagated)
  if (entries.length === 0 && execResult.brepSolids) {
    for (const [key, solidEntry] of execResult.brepSolids) {
      // 隐藏终端（keep/keepHidden 保留的源几何）不得借这条兜底路径落盘——
      // 与主导出路径同一判据（includeHidden 时 hiddenTerminals 传 undefined，不过滤）。
      if (hiddenTerminals?.has(String(key))) continue
      // 同一 3D 判据：兜底路径直接遍历全体 brepSolids，2D 草图句柄同样会进这里（G0-D I-4）。
      if (!isExportableSolid(solidEntry.solid, solidEntry.kernel)) continue
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
  includeHidden?: boolean
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
  let includeHidden: boolean | undefined

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
    } else if (arg === '--include-hidden') {
      includeHidden = true
    } else if (!file && !arg.startsWith('-')) {
      file = arg
    }
  }

  return { command, file, out, mode, assetsDir, fontsDir, projectRoot, view, sheet, part, includeHidden }
}

/**
 * CLI main entry point (called by scripts/faijs-cli.ts).
 *
 * @param argv - the raw process argument list
 * @param libs - host-injected library namespace (includes cad — faijs-cli.ts passes createApiNamespace; core does not assemble it by default)
 * @returns the process exit code (0 on success, non-zero on failure)
 */
export async function cliMain(argv: string[], libs?: Record<string, LibNamespace>): Promise<number> {
  const { command, file, out, mode, assetsDir, fontsDir, projectRoot, view, sheet, part, includeHidden } = parseArgs(argv)

  if (!command) {
    process.stderr.write('Usage: faijs-cli <check|run|view> <file.fai.js> [options]\n')
    process.stderr.write('  check <file>              DryRun validation\n')
    process.stderr.write('  run <file> --out <file>   Execute and export STL/STEP\n')
    process.stderr.write('  view <file> --out <svg>   Execute and project view SVG (三视图/等轴测)\n')
    process.stderr.write('  --mode <auto|brep|mesh>   Execution mode (view 需要 BREP 路径)\n')
    process.stderr.write('  --assets <dir>            Asset directory\n')
    process.stderr.write('  --fonts <dir>             Extra fonts directory\n')
    process.stderr.write('  --project-root <dir>      Project root for relative .fai.js imports\n')
    process.stderr.write('  --include-hidden          (run) also export hidden terminals (keep/keepHidden sources; default off)\n')
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
    const result = await cliRun(filePath, outPath, { mode, assetsDir, fontsDir, projectRoot, libs, includeHidden })

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
