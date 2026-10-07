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
import { loadBrepAssembly, solidToShape, type LoadBrepAssemblyPart } from '@faicad/faijs/brep/brep-ops'
import { importBrepToMesh } from '@faicad/faijs'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { OpError } from '@faicad/faijs/api/internal/result-unwrap'
import {
  getBackends, BrepUnsupportedError, getCurrentStmt,
  setPendingDetectedUnit, setPendingImportModel,
  setPendingMeshSolid, setPendingMeshTopology,
} from '@faicad/faijs/runtime-state'
import { solid, compound, fromBrep, fromMeshSolid } from '@faicad/faijs/shape'
import { UNIT_DIM, type UnitName } from '@faicad/faijs/units'
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
 * @param params.unit - 单位提示（仅对无声明单位的格式（STL）有意义；STEP/3MF 引擎自读声明）。type:string
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
  // 源单位（必然有值；faijs 单一真源；元数据；坐标已是基准值）。STL 取 opts.unit
  // 或 guessStlUnit 猜测。P0（方案 §5.4）：多零件 mesh（多 object 3MF）不再折叠——
  // 全量 parts 以 compound 返回 + importModel 登记；单零件保持现状（buildMeshPart）。
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
  // 红线：不做任何缩放——OCCT 读入已折算到基准，按声明再 scale = 双重换算。
  // P2（2026-10-06）：文件级缓存（内容 SHA-256）——execute 全量重放时同一文件
  // 只解析一次。worker 环境下重复 XCAF 解析累积 OCCT 资源、约第 6 次后 BOP 挂死
  // （node 不现），缓存是根治；同时省去重复解析/三角化成本。
  const hash = await contentHash(buffer)
  let brepParts: LoadBrepAssemblyPart[]
  let assembly: ImportAssemblyNode | undefined
  if (fmt === 'brep') {
    // CASCADE BREP 文本（单 solid，无装配树）：XCAF（STEPCAFControl_Reader）
    // 读不了 BREP 语法——唯一读取实现是 kernel.fromBREP（importBrepToMesh）。
    // 产物与 STEP 单零件同构（fromBrep + solid 句柄，句柄归 brepChain 管理）。
    const imported = await importBrepToMesh(new TextDecoder().decode(new Uint8Array(buffer)))
    const handle = imported.shapeHandle as unknown as BrepHandle
    brepParts = [{ index: 0, name: file, shape: solidToShape(kernel!, handle), solid: handle, color: null }]
  } else if (hash) {
    const cached = loadCache.get(hash)
    if (cached) {
      brepParts = cached.parts
      assembly = cached.assembly
    } else {
      const r = await loadBrepAssembly(kernel!, buffer)
      brepParts = r.parts
      assembly = r.assembly
      loadCache.set(hash, { parts: brepParts, assembly })
    }
  } else {
    const r = await loadBrepAssembly(kernel!, buffer)
    brepParts = r.parts
    assembly = r.assembly
  }
  // BREP 路径的源单位：走文本探测（元数据；不参与几何运算）。
  // STEP/BREP 无单位声明 → 探测返回 null → fallback 'mm'（与 OCCT 约定一致）。
  // unit 必然有值（faijs 单一真源），registerDetectedUnit 总是登记。
  const declared = detectStepUnit(new TextDecoder().decode(new Uint8Array(buffer)))
  registerDetectedUnit(declared ?? 'mm')
  const importModel: ImportModel = {
    format: fmt === 'brep' ? 'brep' : 'step',
    unit: declared,
    parts: brepParts.map((p) => ({
      index: p.index,
      name: p.name,
      ...(p.color ? { color: p.color } : {}),
    })),
    ...(assembly ? { assembly } : {}),
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
const loadCache = new Map<string, { parts: LoadBrepAssemblyPart[]; assembly?: ImportAssemblyNode }>()

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
 * params.unit（UnitName 字符串，固化在脚本行里）→ importFile 的 opts.unit。
 * 只对无声明格式（STL）有意义；能声明的格式引擎自己读。
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
