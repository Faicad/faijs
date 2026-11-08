/**
 * api/face-by-selector — 语义面选择器 → `FaceTopoRef`（AI 生成脚本用）
 *
 * `faceRef(shape, N)` 按面序号取引用，而序号是内核枚举序、跨内核漂移，
 * 其 JSDoc 已明确「不用于脚本生成；生成脚本应使用 TopoRef 字面量或
 * CadQuery 选择器字符串」。本模块补的就是后半句缺的那一环：按轴向
 * 选择器（`'>Z'` / `'<X'` / `'top'` …）定位面，再经 `findOriginRole`
 * 反查血统，产出能直接喂给 PMI `target` 的 `FaceTopoRef`。
 *
 * 为什么不复用 `cadquery-selectors/face.ts#resolveFaceSelector`：
 * ① 它是 async，而 `addDatum({ target: ... })` 在脚本里是同步语句，
 *    返回 Promise 会破坏脚本形态；② 它只返回 center/normal，不含
 *    origin/role 血统。本模块与 `face-ref.ts` 同构，只把「第 N 张面」
 *    换成「沿轴最外侧的那张面」。
 *
 * 语义口径（对齐 cq-compat 的 DirectionMinMaxSelector）：取**面质心沿
 * 指定轴最外侧**的面。`+Z` / `-Z` 在这里只是 `>Z` / `<Z` 的别名，不做
 * 「法向必须平行」的 DirectionSelector 判定；索引后缀（`>Z[-2]`）与
 * 复合轴（`+XY`）不支持，一律显式抛错、不静默近似。
 *
 * 与 `api/cadquery-selectors/face.ts:81-88, :125-137` 的两张表同源，
 * 由 `test/api/pmi/pmi-face-by-selector.test.ts` 钉住一致性。
 */

import type { Shape } from '../mesh/types'
import { getBrepApi } from '../brep/handle-bridge'
import { hasBrep } from '../shape'
import { captureFaceHint, findOriginRole, TopoRefError } from '../topology/naming'
import type { FaceTopoRef } from '../topology/naming/types'
import { buildEdgeResolutionContext } from './topo-resolve'

/** 轴向选择器 → (坐标轴, 方向符号)。`>` 取该轴正向最外侧，`<` 取负向最外侧。 */
const SELECTOR_AXES: Readonly<Record<string, { axis: 0 | 1 | 2; sign: 1 | -1 }>> = {
  '>Z': { axis: 2, sign: 1 }, '+Z': { axis: 2, sign: 1 },
  '<Z': { axis: 2, sign: -1 }, '-Z': { axis: 2, sign: -1 },
  '>X': { axis: 0, sign: 1 }, '+X': { axis: 0, sign: 1 },
  '<X': { axis: 0, sign: -1 }, '-X': { axis: 0, sign: -1 },
  '>Y': { axis: 1, sign: 1 }, '+Y': { axis: 1, sign: 1 },
  '<Y': { axis: 1, sign: -1 }, '-Y': { axis: 1, sign: -1 },
}

/** CadQuery 六个命名视图 → 轴向选择器（与 cq-compat 同表）。 */
const NAMED_VIEW_TO_AXIS: Readonly<Record<string, string>> = {
  front: '>Z', back: '<Z', left: '<X', right: '>X', top: '>Y', bottom: '<Y',
}

/**
 * 按语义选择器定位一张面并返回它的 `FaceTopoRef`。
 *
 * 结果可直接作为 `addDatum` / `addGdt` / `addSurfaceFinish` /
 * `addDimension` 的 `target(s)`，PMI 数据模型仍是纯 `TopoRef`，
 * 解析发生在**参数层**而不是执行后回填数据层。
 *
 * @group 查询
 * @inputs 2
 * @async false
 * @qual ok
 * @name faceBySelector
 * @returns FaceTopoRef 选中面的拓扑引用（origin/role 血统 + 几何 hint）。
 * @param of - 目标几何（BREP 实体所在的 Shape）。type:Shape required:true
 * @param selector - 轴向选择器或命名视图，如 '>Z' / '<X' / 'top'。type:string required:true
 * @note ⚠️ 这是 AI 生成脚本该用的面引用入口；序号式 faceRef 引用跨内核不可移植，勿用于生成脚本。
 * @note 定不了案（无 BREP / 无 role 血统 / 语法不支持 / 无可用质心）一律抛 `TopoRefError`，不静默退化。
 * @example
 * const base = cad.faceBySelector(part0, '>Z')
 * part0.addDatum({ identifier: 'A', datumType: 'datumPlane', target: base })
 */
export function faceBySelector(of: Shape, selector: string): FaceTopoRef {
  const raw = selector.trim()
  const key = NAMED_VIEW_TO_AXIS[raw.toLowerCase()] ?? raw
  const dir = SELECTOR_AXES[key]
  if (dir === undefined) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND', 'face',
      `faceBySelector: unsupported selector "${selector}" (use >Z/<Z/>X/<X/>Y/<Y or front/back/left/right/top/bottom)`,
    )
  }

  const kernel = getBrepApi()
  if (!kernel) {
    throw new TopoRefError('E_TOPO_MESH_UNSUPPORTED', 'face', 'faceBySelector: topology references are BREP-only (mesh path unsupported)')
  }
  if (!hasBrep(of)) {
    throw new TopoRefError('E_TOPO_MESH_UNSUPPORTED', 'face', 'faceBySelector: input shape has no BREP solid (mesh shapes do not carry topology identity)')
  }
  const ctx = buildEdgeResolutionContext(kernel, of as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'faceBySelector: input has no BREP naming context')
  const table = ctx.roleTable
  if (!table) throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'faceBySelector: input shape has no role table (nameless shape)')

  type Hint = ReturnType<typeof captureFaceHint>
  let bestOrdinal = 0
  let bestHint: Hint | undefined
  let bestKey = -Infinity
  for (const f of ctx.faces) {
    if (f.handle === undefined) continue
    const hint = captureFaceHint(kernel, f.handle)
    const center = hint.center
    if (center === undefined || center === null || center.length !== 3) continue
    const v = center[dir.axis]
    if (v === undefined) continue
    const score = v * dir.sign
    if (score > bestKey) {
      bestKey = score
      bestOrdinal = f.ordinal
      bestHint = hint
    }
  }
  if (bestHint === undefined) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `faceBySelector: no face with a resolvable center for "${selector}"`)
  }

  const found = findOriginRole(table, ctx.faces.map((f) => f.hash ?? 0), bestOrdinal)
  if (!found) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `faceBySelector: selected face ${bestOrdinal} has no role lineage`)
  }
  return { kind: 'face', origin: found.origin, role: found.role, hint: bestHint }
}
