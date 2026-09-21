/**
 * stdlib import_brep — 平台 BREP 资产导入 op（H11 / 方案 §4.1）
 *
 *
 * 与编辑器 `cad.load`（`api/load.ts`）的区别见方案 §4.5：
 * - `cad.load` 是 ../3d_editor 的「文件导入 Feature」（key/path/url 三键分流、
 *   语句位置约定、partIndex 画布语义），且历史契约要求实体。
 * - `cad.import_brep` 是 faijs **平台**几何 op：单一 asset 引用（容器资产名，
 *   去扩展名），语义是「把冻结的 BREP 载体装成持 OCCT 句柄的 Shape」。
 *
 * 非实体（wire/face/shell）一等公民（C6）：不要求实体，始终 allowNonSolid。
 * 需要实体的操作（布尔、up-to 目标面）在使用点报错（V-C8）。
 *
 * BREP 专属：`.brp` 无 mesh 解析器；mesh / 无内核模式抛 E_BREP_UNSUPPORTED。
 */

import type { Shape } from '../mesh/types'
import { getBackends, BrepUnsupportedError } from '../runtime-state'
import { OpError } from './internal/result-unwrap'
import { loadBrep } from '../brep/brep-ops'
import { fromBrep } from '../shape'
import type { BrepEngineApi } from '../brep/engine/types'

/**
 * 平台 BREP 资产导入：把容器 `assets/` 里的冻结 BREP 载体装成持 OCCT 句柄的 Shape。
 *
 * `asset` = 资产名（去扩展名，沿用 `FsAssetResolver` 的 `key = basename(file)` 规则），
 * 由宿主资产解析器按 key 解析（与 `cad.load` 同套解析器）。
 *
 * @group 创建
 * @inputs 0
 * @async true
 * @qual ok
 * @name import_brep
 * @param params.asset - 容器资产名（去扩展名）。type:string required:true
 * @note 非实体一等（C6）：wire/face/shell 一律可导入，本 op 不设 `allowNonSolid` 一类开关。需要实体的 op（布尔、up-to 目标面）在**使用点**报错，而不是在导入点拒绝。
 * @note 这是**平台**资产导入 op。编辑器 `cad.load` 是 `../3d_editor` 的「文件导入 Feature」（key/path/url 三键分流 + 画布语句位置语义），平台侧不要复用它（C7）。
 * @returns Promise<Shape> 持 OCCT 句柄的几何（非实体亦可）。
 * @example
 * const a = await cad.import_brep({ asset: 'Array001.Shape' })
 */
export async function import_brep(params: Record<string, unknown>): Promise<Shape> {
  const assets = getBackends().assets as {
    resolveByKey?(key: string): Promise<{ bytes: ArrayBuffer }>
  } | undefined
  if (!assets || !assets.resolveByKey) {
    throw new OpError('import_brep', 'E_OP_FAILED', '[api/import_brep] assets backend is required')
  }

  const asset = params.asset
  if (typeof asset !== 'string' || asset.length === 0) {
    throw new OpError('import_brep', 'E_ARGS', '[api/import_brep] asset name (string) is required')
  }

  const buffer = (await assets.resolveByKey(asset)).bytes

  const { config, kernel: kernels } = getBackends()
  const kernel = kernels.brep as BrepEngineApi | null
  if (!kernel) {
    throw new BrepUnsupportedError(
      'E_BREP_UNSUPPORTED: import_brep requires an OCCT kernel (.brp assets have no mesh parser)',
    )
  }

  // C6：非实体一等公民——始终允许导入 wire/face/shell（allowNonSolid=true）。
  const { solid: solidHandle, shape } = loadBrep(
    kernel, buffer, undefined, undefined, undefined, { allowNonSolid: true },
  )
  return fromBrep(shape, { solid: solidHandle })
}
