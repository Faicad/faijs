/**
 * api boolean-op — 通用布尔族（S4 剩余，平台 op engines:['occt']）
 *
 * @platform occt — 原生 `booleanOp(op, args, tools, options)`（occt-wasm 5.6.0 有）
 * 直调 occt：**不在** L1 契约 `BrepEngineApi` 里（L1 只有 fuse / cut / intersect 三个
 * 逐对的成员，见 brep/engine/primitives.ts）⇒ 平台 op。
 *
 * 方案落点：docs/plans/2026-10-07-occt-wasm-op-enablement-plan.md §3.4.5。与既有 op
 * 的边界（§4.5 去重表）：脚本面 `union` / `subtract` / `intersect` / `fuse` / `cut`
 * 是**无选项**的形态，且两两 chirality 链式合流；本 op 是带 glue / fuzzy /
 * simplify 选项的**通用形态**，args 与 tools 分组、一次内核调用内完成。
 *
 * 与 `commonCells` 的边界：后者求 ≥2 输入的**重叠区域**（干涉检查语义，返回的是
 * 胞元复合体）；本 op 的 `common` 是布尔交集，返回的是实体。
 *
 * **naming 为什么是 unmodeled**：原生 `booleanOp` 返回 `EvolutionData`，其中
 * modified / generated / deleted 是**扁平的面 hash 数组**，而不是本仓
 * `faceEvolution` 需要的 `Map<输入面 hash, 结果面 hash[]>` 映射。缺这层对应关系就
 * 合成不出 roleTable，强行按 byAdjacency 声称「内核给了历史」是**伪造身份**
 * （方案 §4.2：词汇未定义就用 unmodeled + reason）。
 *
 * §9.5 降级路径：一旦 L1 契约补上带选项的通用布尔成员且两侧适配器同时落地，删掉
 * `engines` 声明改走 getBrepApi()，`booleanOp` 即从 C2 转入 C1。
 */

import type { Shape } from '../../mesh/types'
import type { BrepHandle } from '../../brep/engine/types'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { brepOf, fromBrep } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { getOcctKernel } from '../../occt-kernel/occtKernel'

/** 布尔算子（脚本面收字符串，映射到 occt-wasm 的 `BooleanOp` 枚举值）。 */
export type BooleanKind = 'fuse' | 'cut' | 'common'

/** `boolean` 的选项（与 occt-wasm 的 `BooleanOpOptions` 子集一致）。 */
export interface BooleanOptions {
  /** 粘连 coplanar 处理：0=off（默认，完全求交）/ 1=shift（部分共面）/ 2=full（整面共享）。 */
  glue?: 0 | 1 | 2
  /** 模糊容差（模型单位）：在此范围内的近乎重合几何会被合并。 */
  fuzzyValue?: number
  /** 结果内同域面/边的合并角阈值（**弧度**）。 */
  simplifyAngularTolerance?: number
}

const KINDS: readonly BooleanKind[] = ['fuse', 'cut', 'common']
const KIND_CODE: Record<BooleanKind, number> = { fuse: 0, cut: 1, common: 2 }

/** 输入 Shape → 内核句柄（无 BREP 槽报错）。 */
function handleOf(shape: Shape, op: string, which: string): BrepHandle {
  const h = brepOf(shape) as BrepHandle | undefined
  if (!h) {
    throw new Error(`E_${op}_NO_BREP: ${which} requires a BREP handle (mesh-only shape has none)`)
  }
  return h
}

/** BREP 路径：occt 原生 booleanOp（EvolutionData.result 即结果句柄）。 */
function booleanBrep(
  args: Shape[],
  tools: Shape[],
  kind: BooleanKind,
  options?: BooleanOptions,
): Shape {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('E_BOOLEAN_NO_ARGS: boolean requires at least one argument shape')
  }
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('E_BOOLEAN_NO_TOOLS: boolean requires at least one tool shape')
  }
  if (!KINDS.includes(kind)) {
    throw new Error(`E_BOOLEAN_BAD_KIND: kind must be one of fuse/cut/common (got ${String(kind)})`)
  }
  if (options !== undefined) {
    if (options.glue !== undefined && ![0, 1, 2].includes(options.glue)) {
      throw new Error(`E_BOOLEAN_BAD_GLUE: glue must be 0|1|2 (got ${String(options.glue)})`)
    }
    if (options.fuzzyValue !== undefined && (typeof options.fuzzyValue !== 'number' || options.fuzzyValue < 0)) {
      throw new Error('E_BOOLEAN_BAD_FUZZY: fuzzyValue must be a non-negative number')
    }
    if (
      options.simplifyAngularTolerance !== undefined &&
      (typeof options.simplifyAngularTolerance !== 'number' || options.simplifyAngularTolerance < 0)
    ) {
      throw new Error('E_BOOLEAN_BAD_SIMPLIFY: simplifyAngularTolerance must be a non-negative number')
    }
  }
  const argHandles = args.map((s, i) => {
    if (!s) throw new Error(`E_BOOLEAN_MISSING_ARG: args[${i}] is empty`)
    return handleOf(s, 'BOOLEAN', `args[${i}]`)
  })
  const toolHandles = tools.map((s, i) => {
    if (!s) throw new Error(`E_BOOLEAN_MISSING_ARG: tools[${i}] is empty`)
    return handleOf(s, 'BOOLEAN', `tools[${i}]`)
  })
  const data = getOcctKernel().booleanOp(
    KIND_CODE[kind] as never,
    argHandles as never[],
    toolHandles as never[],
    options as never,
  )
  const handle = data.result as unknown as BrepHandle
  return fromBrep(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 通用布尔运算：一次调用对 args / tools 两组形状做布尔，并支持粘连、模糊容差与
 * 结果简化选项（脚本面的 union/subtract/intersect 是无选项形态）。
 * @group 特征
 * @inputs 2
 * @async false
 * @qual ok
 * @name boolean
 * @note 平台 op：仅 occt 引擎（原生 booleanOp，L1 契约无对应成员）。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。
 *       血缘：原生只回扁平的面 hash 列表（modified/generated/deleted），不是
 *       输入面→结果面的映射，无法构造 faceEvolution，故 naming 为 unmodeled。
 * @returns Shape 布尔结果。
 * @param args - 参与运算的形状（≥1）。type:Shape[] required:true
 * @param tools - 工具形状（≥1）。type:Shape[] required:true
 * @param kind - 算子 fuse|cut|common。type:string required:true
 * @param options.glue - 共面粘连模式 0|1|2。type:number required:false
 * @param options.fuzzyValue - 模糊容差（模型单位）。type:number required:false
 * @param options.simplifyAngularTolerance - 同域合并角阈值（弧度）。type:number required:false
 * @example
 * // 两盒相减（第二个盒作为工具）
 * const hollow = cad.boolean([boxA], [boxB], 'cut')
 * // 带容差的 union（近乎重合的面会被合并）
 * const joined = cad.boolean([p1, p2], [p3], 'fuse', { fuzzyValue: 1e-4 })
 */
export const boolean = defineOp({
  name: 'boolean',
  brep(args: Shape[], tools: Shape[], kind: BooleanKind, options?: BooleanOptions) {
    return booleanBrep(args, tools, kind, options)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'booleanOp returns flat face-hash lists, not an input-face to result-face map',
  } as Provenance,
})
