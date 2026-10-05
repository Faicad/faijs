import type { Shape } from '../mesh/types'
import { getBackends, BrepUnsupportedError, getCurrentStmt } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { OpError } from './internal/result-unwrap'
import { loadBrep } from '../brep/brep-ops'
import { fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { parseStepPartMeta } from '../step/stepMetaParser'
import type { ShapeMeta } from './meta'

/** 尽力把 ArrayBuffer 当 UTF-8 文本解出；非文本（如 .brp 二进制）返回 undefined。 */
function decodeStepText(buffer: ArrayBuffer): string | undefined {
  if (!(buffer?.byteLength)) return undefined
  try {
    const s = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
    // STEP 是纯文本 ISO-10303-21；首段要出现 `ISO-10303-21;` 才算。
    return s.includes('ISO-10303-21') ? s : undefined
  } catch {
    return undefined
  }
}

/**
 * api import_step — 任意路径 STEP 文件导入 op（方案 Phase 5 / Q2 真缺口）
 *
 * 与 `import_brep`（容器资产）和 `cad.load`（编辑器 FileRef）的职责切分：
 * - `cad.import_step` 是 faijs **平台**几何 op：单一本地路径（宿主 `resolveFile`），
 *   OCCT STEPControl_Reader 读入，返回持 OCCT 句柄 + roleTable 的 Shape。
 * - `import_brep` 读的是容器 `assets/` 里的冻结 BREP 资产（key，去扩展名）；
 *   `cad.load` 是 `../3d_editor` 的「文件导入 Feature」（key/path/url 三键分流、
 *   画布语句位置语义），平台侧不要复用它（C7）。
 *
 * 非实体（wire/face/shell）一等公民（C6，对齐 import_brep）：始终 allowNonSolid。
 * STEP 是 BREP 专属格式：mesh / 无内核模式抛 E_BREP_UNSUPPORTED。
 *
 * @group 创建
 * @inputs 0
 * @async true
 * @qual ok
 * @name import_step
 * @param params.path - 本地绝对路径（宿主 resolveFile 解析）。type:string required:true
 * @note 平台 STEP 导入 op。读文件经宿主资产解析器（`assets.resolveFile`），与 `cad.load` 同一通道；语义为「任意路径 STEP → OCCT 读入的 Shape」。
 * @note 非实体一等（C6）：wire/face/shell 一律可导入。需要实体的 op（布尔、up-to 目标面）在**使用点**报错。
 * @returns Promise<Shape> 持 OCCT 句柄的几何（非实体亦可）。
 * @example
 * const a = await cad.import_step({ path: 'D:/models/box.step' })
 */

/**
 * 裸实现：契约层测试直调（不经 defineOp 的 dispatch 拦截）。
 *
 * @param params - op 参数对象；`path` 为 STEP 文件路径。
 * @returns 持 OCCT 句柄的几何（非实体亦可）。
 */
export async function importStepImpl(params: Record<string, unknown>): Promise<Shape> {
  const path = params.path
  if (typeof path !== 'string' || path.length === 0) {
    throw new OpError('import_step', 'E_ARGS', '[api/import_step] path (string) is required')
  }

  const assets = getBackends().assets as {
    resolveFile?(path: string): Promise<ArrayBuffer>
  } | undefined
  if (!assets || !assets.resolveFile) {
    throw new OpError(
      'import_step',
      'E_OP_FAILED',
      '[api/import_step] assets backend (resolveFile) is required',
    )
  }

  const buffer = await assets.resolveFile(path)

  let kernel: BrepEngineApi
  try { kernel = getBrepApi() } catch { throw new BrepUnsupportedError(
      'E_BREP_UNSUPPORTED: import_step requires an OCCT kernel (STEP has no mesh parser)',
    )
  }

  // C6：非实体一等公民（对齐 import_brep）。loadBrep 自适应：CASCADE Topology
  // 文本走 kernel.fromBREP，其余（STEP/STP）走 kernel.importStep。
  const { solid: solidHandle, shape } = loadBrep(
    kernel, buffer, undefined, undefined, { allowNonSolid: true },
  )
  // P2（设计文档 2026-10-05-meta §5.2 读）：从 STEP (P21) 文本捞伙伴级描述/属性
  // 挂 `shape.meta`（name 已由 OCCT label 提供，description/UDA 由纯文本补充）。
  // 非文本/非 STEP 内容跳过，绝不抛。
  const stepText = decodeStepText(buffer)
  if (stepText && shape.meta == null) {
    const partMeta = parseStepPartMeta(stepText)
    const shapeMeta: ShapeMeta = { ...(shape.meta ?? {}) }
    if (partMeta.description) shapeMeta.description = partMeta.description
    if (partMeta.metadata && Object.keys(partMeta.metadata).length > 0) shapeMeta.metadata = partMeta.metadata
    if (Object.keys(shapeMeta).length > 0) shape.meta = shapeMeta
  }
  // E3（H12）：链根建 roleTable——导入文件的面没有语义名，按枚举序命名
  // imported:<i>（同一文件重复导入，枚举序稳定，role 名跨次导入保持一致）。
  const stmtId = String(getCurrentStmt()?.id ?? '')
  const hashes = kernel.subShapeHashes(solidHandle, 'face', 2147483647)
  const roles = new Map<string, number[]>()
  for (let i = 0; i < hashes.length; i++) {
    roles.set(`imported:${i}`, [hashes[i]!])
  }
  return fromBrep(shape, { solid: solidHandle, roleTable: new Map([[stmtId, roles]]) })
}

/**
 * GOTCHA（2026-09-30）：与 import_brep 同——必须经 defineOp 包装进入 cad 命名空间，
 * 不能是裸 async 函数。part 键 roleTable（outputTablesByPart）只在 define-op.ts
 * 包装层的 brep 分支登记；裸 async 函数产物没有 part 键表，下游 place/edgeRef
 * 报 "input shape has no role table (nameless shape)"。
 */
export const import_step = defineOp({
  name: 'import_step',
  brep: importStepImpl,
  engines: ['occt'],
  // `imported:0` 是 <i> 采样值（同 extrude 的 `wall:0`），与 import-brep 同构。
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [{ kind: 'imported', index: 0 }] } } as Provenance,
})
