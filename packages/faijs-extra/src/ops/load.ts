/**
 * faijs-extra load — 加载库函数（统一 load 函数）
 *
 * file 指定资产名（用户上传文件名，不含路径、含后缀），经宿主资产解析器按名解析；
 * 格式由 file 后缀白名单自判（不依赖宿主 format 参数），isCadFormat 静态判定 brep/mesh，
 * 产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '@faicad/faijs/mesh/types'
import type { CompoundShape } from '@faicad/faijs/shape'
import type { ImportModel, ImportAssemblyNode } from '@faicad/faijs/mesh/import-model'
import { importFile, detectStepUnit } from '@faicad/faijs/mesh/io'
import { isCadFormat } from '@faicad/faijs/brep/brep-chain'
import { loadBrepAssembly, scaleBrepAndTessellate, solidToShape, type LoadBrepAssemblyPart } from '@faicad/faijs/brep/brep-ops'
import { importBrepToMesh } from '@faicad/faijs'
import type { BrepHandle, BrepMeshResult } from '@faicad/faijs/brep/engine/types'
import { OpError } from '@faicad/faijs/api/internal/result-unwrap'
import {
  getBackends, BrepUnsupportedError, getCurrentStmt,
  setPendingDetectedUnit, setPendingImportModel,
  setPendingMeshSolid, setPendingMeshTopology,
  setPendingBrepMesh,
} from '@faicad/faijs/runtime-state'
import { solid, compound, fromBrep, fromMeshSolid } from '@faicad/faijs/shape'
import { unitScale, UNIT_DIM, type UnitName } from '@faicad/faijs/units'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
// 只取**类型**：后端实现的运行时依赖（内核、拓扑构建器）留在 core，不进扩展库。
import type { MeshSolidBackend } from '@faicad/faijs/brep/mesh-solid'

/**
 * 执行加载操作（统一 load 函数）
 *
 * 按 params.file（资产名）从宿主资产库解析 buffer。
 *
 * 静态分派：
 * - CAD 源 + kernel + 非 mesh 模式 → BREP 路径（loadBrep 异常 = 未预期错误，冒泡上报）
 * - 非 CAD 源 / 无 kernel / mesh 模式 → mesh 路径
 * - brep 模式且将走 mesh 路径 → 调用前抛 BrepUnsupportedError（不静默回退）
 */
/**
 * 加载几何资产。`file` 指定资产名（用户上传文件名，不含路径、含后缀），内容经宿主资产解析器按名解析，**引用而非拷贝**。
 * @group 创建
 * @inputs 0
 * @async true
 * @qual ok
 * @name load
 * @note 语言正常化后 loadFile/loadUrl/loadByKey 别名已删除（A4），统一为 `load` 一个函数。
 * @returns Shape 加载的几何，永远是 part 的第一条语句，后面可接特征链。
 * @param params.file - 资产文件名（用户上传名，不含路径、含后缀，如 'vise.3mf'）；内容按名从宿主资产库取。type:string
 * @param params.unit - **强制设置模型的源单位（所有格式一视同仁）**：提供即覆盖/忽略
 *   文件内部记录的单位（STL 无声明 / 3MF `<model unit>` / STEP SI_UNIT），按指定单位
 *   折算坐标；只有调用方确实知道单位时才提供（用户手写脚本）。未提供时各格式按
 *   默认路径：STL faijs 启发式（guessStlUnit）、3MF/STEP 文件声明（STEP 无声明 → mm）。type:string
 * @note 格式由 `file` 后缀白名单自判：stl/3mf → mesh 路径；step/stp/stpz/brep → BREP 路径。宿主不再传 `format`。
 * @note 后缀白名单未命中 → 报错（不猜格式）；3MF 后缀会做 zip 魔数 sanity（后缀与内容明显不符时报错）。
 * @note 本 op 要求导入物含实体（历史契约）。非实体（wire/face/shell）的导入是平台 `cad.import_brep` 的一等能力，不由本 op 承担。
 * @deprecated **`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用的「文件导入 Feature」提供——`file` 读的是应用侧资产库（按用户上传文件名注册），产物语句位置与命名都是画布语义。不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。2026-10-06 起多零件文件不再单零件收敛——全量以 compound + `ExecutionResult.importModels` 返回；宿主按 `importModel.parts` 身份批量建 part。
 * @example
 * const p = await cad.load({ file: 'box.stl' })
 * const p = await cad.load({ file: 'box.3mf' })
 * const p = await cad.load({ file: 'model.step' })
 */
export async function load(params: Record<string, unknown>): Promise<Shape | CompoundShape> {
  const assets = getBackends().assets as {
    resolveByKey(key: string): Promise<{ bytes: ArrayBuffer }>
  } | undefined
  if (!assets) {
    throw new OpError('load', 'E_OP_FAILED', '[extra/load] assets is required for load op')
  }

  // P8：参数面收敛为 file（资产名，不含路径、含后缀）。key/path/url/format 三键已删除。
  const file = params.file
  if (typeof file !== 'string' || file === '') {
    throw new OpError('load', 'E_ARGS_FORM', '[extra/load] load op requires a non-empty file (asset file name, no path)')
  }
  if (file.includes('/') || file.includes('\\')) {
    throw new OpError('load', 'E_ARGS_FORM', `[extra/load] file must not contain path separators: ${JSON.stringify(file)}`)
  }

  // 格式自判：file 后缀白名单 → 归一化格式；未命中即报错（不猜格式）。
  const fmt = formatFromFile(file)
  if (!fmt) {
    throw new OpError('load', 'E_ARGS_FORM', `[extra/load] unsupported file extension in: ${JSON.stringify(file)}`)
  }

  const buffer = (await assets.resolveByKey(file)).bytes
  assertFileMagic(fmt, buffer, file)

  // 静态判定路径：mesh 模式 / 无 kernel / 非 CAD 源 → mesh 路径；否则 BREP 路径
  const { config, kernel: kernels } = getBackends()
  const kernel = kernels.brep as BrepEngineApi | null
  const useBrep = config.mode !== 'mesh' && !!kernel && isCadFormat({ format: fmt }, true)

  // brep 模式且将走 mesh-only 路径 → 调用前抛错，不静默回退
  if (!useBrep && config.mode === 'brep') {
    throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: load op has no BREP implementation for this source')
  }

  // mesh 路径：importFile 返回 { shape, parts, unit, importModel? } — unit 是文件
  // 源单位（必然有值；faijs 单一真源；元数据；坐标已是基准值）。opts.unit 强制
  // 设置源单位（所有格式一视同仁：STL 直接折算；3MF 覆盖 `<model unit>` 声明）；
  // 未提供时 STL 走 guessStlUnit 猜测、3MF 走文件声明。P0（方案 §5.4）：多零件
  // mesh（多 object 3MF）不再折叠——全量 parts 以 compound 返回 + importModel
  // 登记；单零件保持现状（buildMeshPart）。
  if (!useBrep) {
    const opts = buildImportOpts(params.unit)
    const { shape, parts, unit, importModel } = await importFile(buffer, fmt, opts)
    registerDetectedUnit(unit)
    if (importModel) registerImportModel(importModel)
    if (parts.length > 1) {
      // 多零件：compound 全量返回（children 序 = parts.index = importModel.parts.index）。
      // 多零件的网格实体/近似拓扑登记属 P2（宿主按 compound.children 建 part 时处理）。
      return compound(parts)
    }
    return buildMeshPart(shape, file)
  }

  // BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  // P2：brepChain（meshShapeCache）归引擎侧，loadBrepAssembly 不传。
  // P0（方案 §5.3）：多 solid 文件经 XCAF 装配树全量导入——多零件返回 compound
  // （children 序 = parts.index），单零件返回单一 Shape（行为与现状一致）。
  // **不再接收/使用 partIndex**（取件点唯一，宿主不再拆）。
  // 单位（unit-system §5.2，**所有格式一视同仁**）：params.unit 强制设置模型
  // 源单位、覆盖文件内部声明（STEP SI_UNIT）；未提供时取文件声明（文本探测，
  // 无声明 → 'mm'，与 OCCT 约定一致）。强制单位 ≠ 声明 → 读入结果（OCCT 已按
  // 声明折算到 mm 基准）重折算到指定单位：factor = unitScale(force)/unitScale(declared)，
  // **一次**换算（等价于用指定单位解读原始值），在 faijs 内完成（红线 R0）——
  // 不是"按声明再 scale"双重换算；factor = 1 时零操作。
  // P2（2026-10-06）：文件级缓存（内容 SHA-256 + 最终单位）——execute 全量重放
  // 时同一文件同一单位只解析/缩放一次。worker 环境下重复 XCAF 解析累积 OCCT
  // 资源、约第 6 次后 BOP 挂死（node 不现），缓存是根治；同时省去重复解析/
  // 三角化成本。缓存 key 含 finalUnit——强制单位产物（缩放后 solid）按单位
  // 维度缓存，避免每次重放重复缩放累积 OCCT 句柄。
  const text = new TextDecoder().decode(new Uint8Array(buffer))
  const declared = detectStepUnit(text) ?? 'mm'
  const forcedUnit = buildImportOpts(params.unit)?.unit
  const finalUnit = forcedUnit ?? declared
  const factor = forcedUnit && forcedUnit !== declared
    ? unitScale(forcedUnit) / unitScale(declared)
    : 1
  const hash = await contentHash(buffer)
  const cacheKey = hash ? `${hash}|${finalUnit}` : null
  let brepParts: (LoadBrepAssemblyPart & { mesh?: BrepMeshResult })[]
  let assembly: ImportAssemblyNode | undefined
  if (fmt === 'brep') {
    // CASCADE BREP 文本（单 solid，无装配树）：XCAF（STEPCAFControl_Reader）
    // 读不了 BREP 语法——唯一读取实现是 kernel.fromBREP（importBrepToMesh）。
    // 产物与 STEP 单零件同构（fromBrep + solid 句柄，句柄归 brepChain 管理）。
    // BREP 文本无内部单位声明（按 mm 读入）→ declared='mm' → factor=unitScale(force)。
    const imported = await importBrepToMesh(text)
    const handle = imported.shapeHandle as unknown as BrepHandle
    let part: { index: number; name: string; shape: Shape; solid: BrepHandle; color: null; mesh?: BrepMeshResult }
    if (factor === 1) {
      part = { index: 0, name: file, shape: solidToShape(kernel!, handle), solid: handle, color: null }
    } else {
      const t = scaleBrepAndTessellate(kernel!, handle, factor)
      part = { index: 0, name: file, shape: t.shape, solid: t.solid, color: null, mesh: t.mesh }
    }
    brepParts = [part]
  } else if (cacheKey) {
    const cached = loadCache.get(cacheKey)
    if (cached) {
      brepParts = cached.parts
      assembly = cached.assembly
    } else {
      const r = await loadBrepAssembly(kernel!, buffer)
      brepParts = factor === 1 ? r.parts : applyForcedUnitScale(kernel!, r.parts, factor)
      assembly = r.assembly
      loadCache.set(cacheKey, { parts: brepParts, assembly })
    }
  } else {
    const r = await loadBrepAssembly(kernel!, buffer)
    brepParts = factor === 1 ? r.parts : applyForcedUnitScale(kernel!, r.parts, factor)
    assembly = r.assembly
  }
  // BREP 路径的源单位：params.unit 强制值优先，否则文件声明（探测，无声明 → 'mm'）。
  // unit 必然有值（faijs 单一真源），registerDetectedUnit 总是登记。
  registerDetectedUnit(finalUnit)
  const importModel: ImportModel = {
    format: fmt === 'brep' ? 'brep' : 'step',
    unit: finalUnit,
    parts: brepParts.map((p) => ({
      index: p.index,
      name: p.name,
      ...(p.color ? { color: p.color } : {}),
    })),
    ...(assembly ? { assembly } : {}),
  }
  if (brepParts.length === 1 && brepParts[0]!.mesh) {
    // 单零件强制单位：把缩放三角化（含 faceGroups）登记进 pending——引擎收编进
    // brepChain.meshShapeCache，buildBrepTopology 直接复用（规则 1：显示 mesh =
    // 拓扑 mesh；不再二次 meshShape 退回绝对 deflection → 网格密度爆炸）。
    const part = getCurrentStmt()?.outputs[0]
    if (part) setPendingBrepMesh(part, brepParts[0]!.mesh)
  }
  registerImportModel(importModel)
  if (brepParts.length === 1) {
    const p = brepParts[0]
    return fromBrep(p.shape, { solid: p.solid })
  }
  // 多零件：每个 child 带自己的 BREP solid（宿主经 brepOf(child) 读取）。
  return compound(brepParts.map((p) => fromBrep(p.shape, { solid: p.solid })))
}

/**
 * mesh 路径产物构造：装了网格后端则产出**网格实体 + 近似拓扑**，否则退回裸网格。
 *
 * 两条分支的边界（方案 2026-10-01 §3.3）：
 * - **未装配网格后端**（`kernel.meshSolid` 缺失）→ `solid(shape)`。这是宿主的装配
 *   事实（如小程序构建不装 brepkit），不是静默降级：该 part 本来就没有网格内核可用。
 * - **装配了但规范化失败**（开放/非流形/自交网格）→ **抛错**，绝不退化成"无拓扑的
 *   裸网格"——那会让所有下游 mesh op 失去选择能力，属于"报错好于掩盖"。
 *
 * 显示 mesh 用**网格实体的三角化**而不是原始 STL 顶点数组：规则 1（拓扑 faceRuns
 * 所索引的三角形必须就是用户看到的三角形）。用原始 STL 数组 + 实体重新三角化会让
 * 两者三角形数/序错位，faceRuns 直接失效。
 *
 * @param shape - the parsed mesh payload (base-unit coordinates).
 * @param file - the source file name (error messages).
 * @returns the constructed shape (mesh solid when a backend is assembled).
 */
function buildMeshPart(shape: Shape, file: string): Shape {
  const backend = getBackends().kernel.meshSolid as MeshSolidBackend | undefined
  if (!backend) return solid(shape)

  const part = getCurrentStmt()?.outputs[0]
  let result: ReturnType<MeshSolidBackend['normalize']>
  try {
    result = backend.normalize({ positions: shape.positions, indices: shape.indices })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new OpError(
      'load',
      'E_MESH_SOLID_UNWELDABLE',
      `E_MESH_SOLID_UNWELDABLE: [extra/load] ${JSON.stringify(file)} could not be normalized into a mesh solid` +
      `${part ? ` (part "${part}")` : ''}: ${reason}`,
      { cause: err },
    )
  }

  // 句柄 + 近似拓扑登记：load op 拿不到 CadRuntime 实例，故走 pending 通道
  // （与 detectedUnit / multiPartCount 同模式），引擎在语句执行后收编。
  if (part) {
    setPendingMeshSolid(part, result.solid)
    setPendingMeshTopology(part, backend.buildTopologyData(result))
  }
  return fromMeshSolid(
    { positions: result.mesh.positions, indices: result.mesh.indices },
    { meshSolid: result.solid },
  )
}

/**
 * 文件级解析缓存（P2，2026-10-06）：按文件内容 SHA-256 缓存解析产物。
 *
 * 背景：execute 全量重放时同一文件会被反复解析（e2e 重放序列 3 次 execute × 2 条
 * load 语句 = 6 次 XCAF 解析）。occt-wasm 在 Web Worker 环境下每次 XCAF 解析都会
 * 累积 OCCT 资源，约第 6 次解析后 BOP（common/cut）整体挂死（node 环境不复现，
 * 内存充足）。缓存命中后同一文件全量重放只解析一次，既根治 worker BOP 挂死，
 * 也消除重复解析/三角化的成本。
 *
 * 缓存 key = 内容 SHA-256（不按文件名——同名文件内容可不同，内容指纹才可靠）。
 * 缓存持有解析产物（compound 的 BREP solid 句柄等），与 statementCache 同生命周期
 * （runtime 级；worker 重建时模块重载自然清空）。缓存只是优化：digest 计算失败时
 * 跳过缓存（功能等价，不静默降级语义）。
 */
const loadCache = new Map<string, { parts: (LoadBrepAssemblyPart & { mesh?: BrepMeshResult })[]; assembly?: ImportAssemblyNode }>()

async function contentHash(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null // 无 WebCrypto（罕见环境）：跳过缓存，功能等价
  }
}

/**
 * 文件加载白名单（P8 §4.2/§4.3，与 3d_editor config/file-formats 的 CAD 模型扩展名对齐）：
 * mesh 路径 stl/3mf；BREP 路径 step/stp/stpz/brep。
 * iges/igs 刻意不在白名单——occt-wasm 未链接 TKDEIGES（brep-chain CAD_FORMATS 注释），
 * 走 BREP 路径必然失败；报「不支持的扩展名」比报内核错误更清晰。宿主 iges 现状路径保留。
 * 返回归一化格式：stp/stpz → 'step'，其余原样；白名单未命中返回 undefined。
 */
const LOAD_EXTENSION_WHITELIST: Record<string, string> = {
  stl: 'stl',
  '3mf': '3mf',
  step: 'step',
  stp: 'step',
  stpz: 'step',
  brep: 'brep',
}

function formatFromFile(file: string): string | undefined {
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  return LOAD_EXTENSION_WHITELIST[ext]
}

/**
 * 魔数 sanity（P8 §4.3）：后缀定格式后用文件头校验，后缀与内容明显不符时报错。
 * 仅 3MF 做显式魔数（zip 头 PK\x03\x04 / PK\x05\x06，可靠且歧义小）；
 * STL（文本/二进制歧义）、STEP/IGES/BREP（文本格式）不做魔数，由各解析器内部消歧/报错——
 * 遵循「解析外部数据必须宽容」红线：只有可靠判据才拒绝，不误伤正常文件。
 */
function assertFileMagic(fmt: string, buffer: ArrayBuffer, file: string): void {
  if (fmt !== '3mf') return
  const bytes = new Uint8Array(buffer.slice(0, 4))
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)
  if (!isZip) {
    throw new OpError(
      'load',
      'E_ARGS_FORM',
      `[extra/load] file ${JSON.stringify(file)} has .3mf extension but content is not a 3MF archive`,
    )
  }
}

/**
 * 强制单位换算（BREP 路径，unit-system §5.2 所有格式一视同仁）：
 * 对读入结果（OCCT 已按文件声明折算到 mm 基准）应用
 * factor = unitScale(force)/unitScale(declared)，**一次**换算到指定单位。
 * 每个 part：`scaleBrepAndTessellate`（等比缩放 + **相对 deflection** 重新三角化，
 * 返回含 faceGroups 的 mesh——绝对 deflection 会让放大模型网格密度爆炸，见
 * brep-ops.scaleBrepAndTessellate 注释）。原句柄不变（缓存持有时零副作用）。
 * mesh 由调用方登记 pending → 引擎写进 meshShapeCache（规则 1：显示 mesh =
 * 拓扑 mesh）。
 *
 * 已知缺口（多零件 compound，如实记录）：compound 终端的拓扑走
 * buildCompoundTopologyRuntime（引擎侧按 children 重新 meshShape，绝对
 * 0.1mm）——强制单位 + 多 solid 文件的拓扑构建会网格密度爆炸。需
 * buildCompoundTopologyRuntime 支持预三角化输入才能根治；单零件路径已闭环。
 */
function applyForcedUnitScale(
  kernel: BrepEngineApi,
  parts: LoadBrepAssemblyPart[],
  factor: number,
): (LoadBrepAssemblyPart & { mesh: BrepMeshResult })[] {
  return parts.map((p) => {
    const t = scaleBrepAndTessellate(kernel, p.solid, factor)
    return { ...p, solid: t.solid, shape: t.shape, mesh: t.mesh }
  })
}

/**
 * params.unit（UnitName 字符串，固化在脚本行里）→ importFile / BREP 路径的
 * 强制单位。**所有格式一视同仁**：提供即强制设置模型源单位、覆盖文件内部
 * 声明（STL 无声明 / 3MF `<model unit>` / STEP SI_UNIT）；未提供时各格式按
 * 默认路径（STL 启发式；3MF/STEP 文件声明）。非法/非长度单位直接报错。
 */
function buildImportOpts(unitParam: unknown): { unit: UnitName } | undefined {
  if (typeof unitParam !== 'string' || unitParam === '') return undefined
  if (UNIT_DIM[unitParam as UnitName] !== 'length') {
    throw new OpError('load', 'E_ARGS_FORM', `[extra/load] unknown or non-length unit: ${JSON.stringify(unitParam)}`)
  }
  return { unit: unitParam as UnitName }
}

/** Register the file's source unit for the current statement's output part. */
function registerDetectedUnit(unit: UnitName): void {
  const stmt = getCurrentStmt()
  const part = stmt?.outputs[0]
  if (part) setPendingDetectedUnit(part, unit)
}

/**
 * Register the current statement's output part's import model (P0，方案
 * 2026-10-06-step-3mf-multipart-import-plan.md §5.5): the structure data
 * (parts identity table + STEP assembly + Bambu views) of a `cad.load`.
 * 单/多零件均登记（单零件 parts 长度 1）。引擎在语句执行后收编进
 * ExecutionResult.importModels，宿主据此批量建 part，不再自行解析文件。
 */
function registerImportModel(model: ImportModel): void {
  const stmt = getCurrentStmt()
  const part = stmt?.outputs[0]
  if (part) setPendingImportModel(part, model)
}
