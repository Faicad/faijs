/**
 * api shape-type — 类型判定谓词族（平台 op engines:['occt']，普通函数形态）
 *
 * @platform occt — 8 个布尔谓词（isEdge / isFace / isShell / isVertex / isWire /
 * isCompound / isCompSolid / isEqual）直调 occt 原生 `isEdge`/`isFace`/…（occt-wasm
 * 有）。这些原生方法**不在** L1 契约 `BrepEngineApi` 里（L1 只有 `isSolid` 与
 * `getSubShapes`/`subShapeHashes`，见 brep/engine/primitives.ts）——因此它们不能走
 * 中立路径，必须声明 `engines: ['occt']` 直调 occt（方案 §3.4.6 校正注）。
 *
 * 为什么不是 `defineOp`：本族返回**布尔**（非 Shape）。`defineOp` 的 brep 包装
 * （define-op.ts#wrapBrepOne）把返回值一律收养为 Shape，装不下布尔。数据型平台 op
 * 走普通函数，是 `api/export-brep.ts` 的既定口径（先例：projectView 返回 SVG 字符串）。
 *
 * 引擎身份**不能**靠 dispatchPath 门控（普通函数不走那条路）⇒ 按
 * `api/internal/l3-bridge.ts#assertEngineFor` 的既定做法：函数体第一行断言当前引擎，
 * 触碰内核之前报出与 D11-4 同构的 `E_BREP_UNSUPPORTED`，不补桩、不回退。
 * （与 dispatchPath 的差异：`assertEngineFor` **不含** D11-3 的 `brep_mock` 豁免——
 *  mock 句柄不是 occt 句柄，放行只会拿到错形状，故这里如实拦截。）
 *
 * 注册：api/api-namespace.ts 手动 import + 进 createApiNamespace 对象；覆盖率扫描器
 * scan-occt-op-coverage.ts 的 PLAN_C2_EXTRA 补 8 个方法名（普通函数不在 defineOp
 * 全集口径内，collectOps 看不见）。
 *
 * §9.5 降级路径（记录在案）：一旦 brepkit 的 wasm 面把 isEdge/isFace/… 接进 L1 契约
 * 且两侧适配器同时落地，这些函数删掉 assertEngineFor 并改走 `getBrepApi()`，对应方法
 * 即从 C2 转入 C1。
 */

import type { Shape } from '../../mesh/types'
import type { BrepHandle } from '../../brep/engine/types'
import { brepOf } from '../../shape'
import { getOcctKernel } from '../../occt-kernel/occtKernel'
import { assertEngineFor } from '../internal/l3-bridge'

/** occt 原生类型判定方法名（与 OcctKernel 导出一一对应）。 */
type OcctTypePredicate =
  | 'isEdge' | 'isFace' | 'isShell' | 'isVertex' | 'isWire' | 'isCompound' | 'isCompSolid'

/** 借出形状的内核句柄；无 BREP 槽（mesh-only）报错。 */
function occtHandleOf(shape: Shape, op: string): BrepHandle {
  const h = brepOf(shape) as BrepHandle | undefined
  if (!h) {
    throw new Error(`E_SHAPE_TYPE_NO_BREP: ${op} requires a BREP handle (mesh-only shape has none)`)
  }
  return h
}

/**
 * 单参数类型判定：先断言引擎身份 → 借出句柄 → occt 原生 is* 直调。
 * @param method - occt 原生方法名（op 名与之相同）。
 * @param shape - 被判别的形状。
 * @returns 该形状是否为对应拓扑类型。
 */
function shapePredicate(method: OcctTypePredicate, shape: Shape): boolean {
  assertEngineFor(method, ['occt'])
  const kernel = getOcctKernel() as unknown as Record<OcctTypePredicate, (h: unknown) => boolean>
  return kernel[method](occtHandleOf(shape, method))
}

/**
 * 形状是否为边（edge）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name isEdge
 * @note 平台 op：仅 occt 引擎（原生 isEdge）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns boolean 是否为边。
 * @param shape - 被判别的形状。type:Shape required:true
 * @example
 * const e = cad.makeLineEdge([0,0,0],[1,0,0])
 * const yes = cad.isEdge(e)
 */
export function isEdge(shape: Shape): boolean {
  return shapePredicate('isEdge', shape)
}

/**
 * 形状是否为面（face）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name isFace
 * @note 平台 op：仅 occt 引擎（原生 isFace）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns boolean 是否为面。
 * @param shape - 被判别的形状。type:Shape required:true
 * @example
 * const f = cad.makeFace(wire)
 * const yes = cad.isFace(f)
 */
export function isFace(shape: Shape): boolean {
  return shapePredicate('isFace', shape)
}

/**
 * 形状是否为壳（shell）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name isShell
 * @note 平台 op：仅 occt 引擎（原生 isShell）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns boolean 是否为壳。
 * @param shape - 被判别的形状。type:Shape required:true
 */
export function isShell(shape: Shape): boolean {
  return shapePredicate('isShell', shape)
}

/**
 * 形状是否为顶点（vertex）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name isVertex
 * @note 平台 op：仅 occt 引擎（原生 isVertex）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns boolean 是否为顶点。
 * @param shape - 被判别的形状。type:Shape required:true
 */
export function isVertex(shape: Shape): boolean {
  return shapePredicate('isVertex', shape)
}

/**
 * 形状是否为线（wire）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name isWire
 * @note 平台 op：仅 occt 引擎（原生 isWire）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns boolean 是否为线。
 * @param shape - 被判别的形状。type:Shape required:true
 */
export function isWire(shape: Shape): boolean {
  return shapePredicate('isWire', shape)
}

/**
 * 形状是否为复合体（compound）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name isCompound
 * @note 平台 op：仅 occt 引擎（原生 isCompound）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns boolean 是否为复合体。
 * @param shape - 被判别的形状。type:Shape required:true
 */
export function isCompound(shape: Shape): boolean {
  return shapePredicate('isCompound', shape)
}

/**
 * 形状是否为组合实体（comp-solid）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name isCompSolid
 * @note 平台 op：仅 occt 引擎（原生 isCompSolid）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns boolean 是否为组合实体。
 * @param shape - 被判别的形状。type:Shape required:true
 */
export function isCompSolid(shape: Shape): boolean {
  return shapePredicate('isCompSolid', shape)
}

/**
 * 两个形状是否为同一几何实体（occt 原生 `isEqual` 语义）。
 *
 * occt 的 `IsEqual` 当且仅当两形状共享同一 `TShape` 且 `Location`/`Orientation`
 * 相同时返回 true——即「同一几何实体」，不是「几何内容相同但独立构造」。因此两个
 * 几何相同但各自 `makeBox` 出来的形状会返回 false；要比较「内容相同」需另走几何
 * 比较（非本 op 职责）。区别于 `isSame`（同一句柄引用）。
 * @group 查询
 * @inputs 2
 * @async false
 * @qual ok
 * @name isEqual
 * @note 平台 op：仅 occt 引擎（原生 isEqual，L1 无对应成员）。非 occt 引擎执行前报
 *       E_BREP_UNSUPPORTED。
 * @returns boolean 是否为同一几何实体。
 * @param a - 第一个形状。type:Shape required:true
 * @param b - 第二个形状。type:Shape required:true
 * @example
 * const same = cad.isEqual(part0, part0)   // true（同一手柄）
 * const diff = cad.isEqual(part0, part1)   // 独立构造的相同几何 → false
 */
export function isEqual(a: Shape, b: Shape): boolean {
  assertEngineFor('isEqual', ['occt'])
  const ka = occtHandleOf(a, 'isEqual')
  const kb = occtHandleOf(b, 'isEqual')
  const kernel = getOcctKernel() as unknown as { isEqual(h: unknown, h2: unknown): boolean }
  return kernel.isEqual(ka, kb)
}
