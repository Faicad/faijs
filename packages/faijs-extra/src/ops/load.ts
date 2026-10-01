/**
 * stdlib load — 加载库函数（统一 load 函数）
 *
 *
 * buffer 经宿主资产解析器解析，isCadFormat 静态判定 brep/mesh，
 * 产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '@faicad/faijs/mesh/types'
import { importFile, detectStepUnit } from '@faicad/faijs/mesh/io'
import { isCadFormat } from '@faicad/faijs/brep/brep-chain'
import { loadBrep } from '@faicad/faijs/brep/brep-ops'
import { OpError } from '@faicad/faijs/api/internal/result-unwrap'
import { getBackends, BrepUnsupportedError, getCurrentStmt, setPendingDetectedUnit, setPendingMultiPartCount } from '@faicad/faijs/runtime-state'
import { solid, fromBrep } from '@faicad/faijs/shape'
import { mm, centimeter, meter, micron, inch, foot, yard, type UnitName, type ValueWithUnits } from '@faicad/faijs/units'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'

/**
 * 执行加载操作（统一 load 函数）
 *
 * 按 params 中存在的 key/path/url 分流解析 buffer，全部经宿主资产解析器。
 *
 * 静态分派：
 * - CAD 源 + kernel + 非 mesh 模式 → BREP 路径（loadBrep 异常 = 未预期错误，冒泡上报）
 * - 非 CAD 源 / 无 kernel / mesh 模式 → mesh 路径
 * - brep 模式且将走 mesh 路径 → 调用前抛 BrepUnsupportedError（不静默回退）
 */
/**
 * 加载几何资产。key / path / url 三选一（按此优先级分流），内容经宿主资产解析器解析，**引用而非拷贝**。
 * @group 创建
 * @inputs 0
 * @async true
 * @qual ok
 * @name load
 * @note 语言正常化后 loadFile/loadUrl/loadByKey 别名已删除（A4），统一为 `load` 一个函数。
 * @returns Shape 加载的几何，永远是 part 的第一条语句，后面可接特征链。
 * @param params.key - faicad 缓存中的资产 key（内容按 key 取）。type:string
 * @param params.path - 本地绝对路径（非 web 环境）。type:string
 * @param params.url - 网络地址。type:string
 * @param params.format - 格式提示（如 'step'/'stl'；CAD 源走 BREP 精确路径，STL 等三角化源走 mesh 路径）。type:string
 * @note key/path/url 是优先级分流（key 优先，其次 path，最后 url），三者只需其一；同时给多个时按优先级取。`format` 是提示而非强约束——CAD 源（step/stp/brep 等）与三角化源（stl 等）由 `isCadFormat` 静态判定路径。
 * @note 本 op 要求导入物含实体（历史契约）。非实体（wire/face/shell）的导入是平台 `cad.import_brep` 的一等能力，不由本 op 承担。
 * @deprecated **`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用的「文件导入 Feature」提供——key/path/url 三键分流读的是应用侧 `FileRef`，产物语句位置与命名都是画布语义。不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**（见 `docs/plans/2026-09-22-topology-identity-development-plan.md` §2）。多零件文件按 §5.4 单零件收敛——只取第一个（不再有 `partIndex` 概念）。平台侧导入请用 `cad.import_brep`（冻结 BREP 资产）。
 * @example
 * const p = await cad.load({ key: 'file_abc123' })
 * const p = await cad.load({ path: 'D:/models/box.step', format: 'step' })
 * const p = await cad.load({ url: 'https://…/box.3mf' })
 */
export async function load(params: Record<string, unknown>): Promise<Shape> {
  const assets = getBackends().assets as {
    resolveByKey(key: string): Promise<{ bytes: ArrayBuffer }>
    resolveFile(path: string): Promise<ArrayBuffer>
    resolveUrl(url: string): Promise<ArrayBuffer>
  } | undefined
  if (!assets) {
    throw new OpError('load', 'E_OP_FAILED', '[stdlib/load] assets is required for load op')
  }

  // 按 key/path/url 分流解析 buffer
  let buffer: ArrayBuffer
  if (params.key !== undefined && params.key !== null) {
    buffer = (await assets.resolveByKey(params.key as string)).bytes
  } else if (params.path !== undefined && params.path !== null) {
    buffer = await assets.resolveFile(params.path as string)
  } else if (params.url !== undefined && params.url !== null) {
    buffer = await assets.resolveUrl(params.url as string)
  } else {
    throw new OpError('load', 'E_OP_FAILED', '[stdlib/load] load op requires exactly one of key/path/url')
  }

  // 静态判定路径：mesh 模式 / 无 kernel / 非 CAD 源 → mesh 路径；否则 BREP 路径
  const { config, kernel: kernels } = getBackends()
  const kernel = kernels.brep as BrepEngineApi | null
  const useBrep = config.mode !== 'mesh' && !!kernel && isCadFormat(params, true)

  // brep 模式且将走 mesh-only 路径 → 调用前抛错，不静默回退
  if (!useBrep && config.mode === 'brep') {
    throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: load op has no BREP implementation for this source')
  }

  // mesh 路径：importFile 返回 { shape, unit, multiPartCount? } — unit 是文件自己
  // 声明的单位（元数据；坐标已是基准值）。STL 无声明 → unit=null，opts.unit 决定刻度。
  // 多零件 mesh（多 object 3MF）在 importFile 内部已降级取第一个（§5.4 单零件收敛），
  // 这里据 multiPartCount 登记"多零件降级" pending → 宿主弹警告（§5.4:166）。
  if (!useBrep) {
    const fmt = params.format as string | undefined
    const opts = buildImportOpts(params.unit)
    const { shape, unit, multiPartCount } = await importFile(buffer, fmt, opts)
    registerDetectedUnit(unit)
    if (multiPartCount !== undefined) registerMultiPartDegradation(multiPartCount)
    return solid(shape)
  }

  // BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  // P2：brepChain（meshShapeCache）归引擎侧，loadBrep 不再传。
  // §5.4 单零件收敛：多 solid 文件（多零件 STEP）在 loadBrep 内部已降级取第一个
  // 零件（单一 Shape）并回传 multiSolidCount；此处登记"多零件降级" pending → 宿主
  // 据零件数弹警告（§5.4:166）。**不再接收/使用 partIndex**（取件点唯一，宿主不再拆）。
  // 红线：不做任何缩放——OCCT 读入已折算到基准，按声明再 scale = 双重换算。
  const { solid: solidHandle, shape, multiSolidCount } = loadBrep(
    kernel!, buffer,
  )
  if (multiSolidCount !== undefined) {
    registerMultiPartDegradation(multiSolidCount)
  }
  // BREP 路径的声明单位：走文本探测（元数据；不参与几何运算）。
  const declared = detectStepUnit(new TextDecoder().decode(new Uint8Array(buffer)))
  registerDetectedUnit(declared)
  return fromBrep(shape, { solid: solidHandle })
}

/**
 * params.unit（UnitName 字符串，固化在脚本行里）→ importFile 的 ValueWithUnits。
 * 只对无声明格式（STL）有意义；能声明的格式引擎自己读。
 */
function buildImportOpts(unitParam: unknown): { unit: ValueWithUnits } | undefined {
  if (typeof unitParam !== 'string' || unitParam === '') return undefined
  const spec = LENGTH_UNIT_VALUES[unitParam as UnitName]
  if (!spec) {
    throw new OpError('load', 'E_ARGS_FORM', `[stdlib/load] unknown unit: ${JSON.stringify(unitParam)}`)
  }
  return { unit: spec }
}

/** Register the file's declared unit for the current statement's output part. */
function registerDetectedUnit(unit: UnitName | null): void {
  if (!unit) return
  const stmt = getCurrentStmt()
  const part = stmt?.outputs[0]
  if (part) setPendingDetectedUnit(part, unit)
}

/**
 * Register a "multi-part downgrade" for the current statement's output part
 * (fileid-container-and-nesting §5.4): a multi-part file ($partCount>=2) was
 * loaded and only its first part is used. The engine takes this pending value
 * into ExecutionResult.multiPartCounts so the host can toast
 * 「该文件包含 N 个零件，当前仅加载第一个」.
 */
function registerMultiPartDegradation(partCount: number): void {
  if (partCount < 2) return
  const stmt = getCurrentStmt()
  const part = stmt?.outputs[0]
  if (part) setPendingMultiPartCount(part, partCount)
}

/** UnitName → base-scaled ValueWithUnits (length dims only; load is a length-domain op). */
const LENGTH_UNIT_VALUES: Partial<Record<UnitName, ValueWithUnits>> = {
  mm,
  cm: centimeter,
  m: meter,
  micron,
  inch,
  foot,
  yard,
}
