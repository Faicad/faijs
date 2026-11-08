/**
 * faijs-extra drill-tapper — 双串攻丝孔库函数（BREP-only）
 *
 * 图纸语境的两串 op：钻孔串（`drill: 'Ø2.5 完全贯穿'`）+ 攻丝串
 * （`tap: 'M3-6H 完全贯穿'`）。两串各自独立解析（`parseDrillSpec` /
 * `parseThreadSpec`，共享 OCR 白名单文本层），再做**跨串校验**
 * （底孔 < 公称大径、通丝必须通孔、盲丝丝深 ≤ 孔深），矛盾显式 E_ARG。
 *
 * 几何 = `fai_drill` 的 BREP 钻孔路径（只钻底孔，不切牙型）；螺纹信息
 * 全部进 `PmiThreadHole` 标注（建模即标注，与 `fai_drill(tapped)` 同构）。
 * PMI **恒产出**——本 op 的语义就是攻丝孔；公差等级缺省**不补**
 * （tap 串带 '-6H' 才有，`buildThreadHolePmi` 的描述串路径不默认，
 * Q3/2026-11-08 拍板）。通孔 + 攻丝定深（`'Ø2.5 完全贯穿'` +
 * `'M3-6H ↓8'`）合法（Q2）：螺纹深 8 标注在贯穿底孔上。
 *
 * BREP-only（mesh 链冻结，2026-11-07 起）：本 op 无 mesh 实现，mesh
 * 模式下由 defineOp 包装层显式报错，绝不静默降级。
 *
 * 坐标契约同 `fai_drill`（unit-system §5.2 方向 A）：position /
 * faceNormal / direction 一律模型局部空间，本 op 不做 world→local。
 */

import type { Shape, Vec3 } from '../../mesh/types'
import { parseDrillSpec } from '../../primitives/screw/drill-spec'
import type { ResolvedDrillSpec } from '../../primitives/screw/drill-spec'
import { parseThreadSpec } from '../../primitives/screw/thread-spec'
import type { ResolvedThreadSpec } from '../../primitives/screw/thread-spec'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { resolveCompoundMember, replaceCompoundMember } from '../../shape'
import { appendPmiItem } from '../../api/pmi/methods'
import { assertVec3 } from '../../api/assert'
import {
  assertDrillParams,
  buildThreadHolePmi,
  drillBrepPath,
  faceNormalFrom,
  inwardDirection,
  resolveDirection,
} from './fai_drill'

// ── per-op 参数自校验（op 被直接 import 时的防御层） ──

/**
 * Validate tapper parameters: `drill` / `tap` must both be non-empty strings.
 * @param params - the raw tapper operation parameters.
 */
export function assertTapperParams(params: Record<string, unknown>): void {
  if (typeof params.drill !== 'string' || params.drill.trim() === '') {
    throw new Error(
      "[extra/drill_tapper] E_ARG: `drill` must be a non-empty drill callout string "
        + `(e.g. 'Ø2.5 完全贯穿'), got ${JSON.stringify(params.drill)}.`,
    )
  }
  if (typeof params.tap !== 'string' || params.tap.trim() === '') {
    throw new Error(
      "[extra/drill_tapper] E_ARG: `tap` must be a non-empty tap callout string "
        + `(e.g. 'M3-6H 完全贯穿'), got ${JSON.stringify(params.tap)}.`,
    )
  }
}

/**
 * 由两串推导的参数键——显式给出即 E_ARG（同一事实禁止两个来源，
 * 与 `fai_drill` 描述串路径的互斥规则同构）。
 */
const DERIVED_KEYS = [
  'diameter', 'depth', 'thread', 'threadDepth', 'threadClass', 'holeType',
  'screwSystem', 'screwSpecIdx', 'screwThread', 'screwPitchCustom', 'tolerance',
] as const

/**
 * 双串归一：解析 drill / tap 两串 → 跨串校验 → 构造 `drillBrepPath` 的
 * 参数对象 `p`。不经 `normalizeDrillParams`（那条路径的串内互斥规则
 * 针对单串 `fai_drill`，两串场景孔深来自 drill 串、丝深来自 tap 串，
 * 天然「两个来源」，跨串校验在这里做）。
 *
 * `p.thread` 带 tap 原串：`buildThreadHolePmi` 据此走描述串路径——
 * 公差等级不默认 6H/2B（Q3），`threadClass` 只来自串内 '-6H' 后缀。
 */
function normalizeTapperParams(
  params: Record<string, unknown>,
): { p: Record<string, unknown>; drill: ResolvedDrillSpec; th: ResolvedThreadSpec } {
  for (const key of DERIVED_KEYS) {
    if (params[key] !== undefined) {
      throw new Error(
        `[extra/drill_tapper] E_ARG: \`${key}\` is derived from the drill/tap callout `
          + 'strings — put it inside the string (e.g. \'Ø2.5 深12\' / \'M3-6H ↓8\'), '
          + 'not as a separate param.',
      )
    }
  }
  if (params.handedness !== undefined && params.handedness !== 'right' && params.handedness !== 'left') {
    throw new Error(
      `[extra/drill_tapper] E_ARG: \`handedness\` must be 'right' | 'left', got `
        + `${JSON.stringify(params.handedness)}.`,
    )
  }
  if (params.position !== undefined && params.position !== null) {
    assertVec3(params.position, 'drill_tapper.position')
  }
  const drill = parseDrillSpec(params.drill as string)
  const th = parseThreadSpec(params.tap as string)
  // ── 跨串校验（语义矛盾显式拒绝，绝不静默取舍） ──
  if (drill.diameter >= th.nominalDiameter) {
    throw new Error(
      `[extra/drill_tapper] E_ARG: pilot diameter (Φ${drill.diameter}) must be smaller than `
        + `the tap nominal major diameter (Φ${th.nominalDiameter}) — no thread form is left to tap.`,
    )
  }
  if (th.thru === true && !drill.thru) {
    throw new Error(
      `[extra/drill_tapper] E_ARG: the tap string says THRU but the pilot hole is blind `
        + `(Φ${drill.diameter} ↓${drill.depth}) — a through thread needs a through pilot hole.`,
    )
  }
  if (drill.depth > 0 && th.depth !== undefined && th.depth > drill.depth) {
    throw new Error(
      `[extra/drill_tapper] E_ARG: tap depth (${th.depth}) exceeds the blind pilot depth `
        + `(${drill.depth}) — the tap cannot run deeper than the drilled hole.`,
    )
  }
  const p: Record<string, unknown> = {
    ...params,
    holeType: 'tapped',
    // drill 串 → 底孔几何（图纸值是唯一真源）。
    diameter: drill.diameter,
    depth: drill.depth,
    // tap 串 → 螺纹规格；`thread` 带原串使 buildThreadHolePmi 走描述串路径。
    thread: params.tap,
    ...(th.toleranceClass !== undefined ? { threadClass: th.toleranceClass } : {}),
    ...(th.depth !== undefined ? { threadDepth: th.depth } : {}),
    position: (params.position as Vec3 | undefined) ?? [0, 0, 0],
  }
  return { p, drill, th }
}

/**
 * 双串攻丝孔：钻孔串 + 攻丝串各表一职——`drill` 决定底孔几何（直径 + 深度），
 * `tap` 决定螺纹规格（公差等级 / 丝深 / 旋向随串或参数）。
 *
 * @group 特征
 * @inputs 1
 * @async false
 * @qual ok
 * @name fai_drill_tapper
 * @deprecated **`../3d_editor` 消费面**：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**。**变更其 API 形态必须同步更新 `../3d_editor`**。BREP-only（mesh 链冻结，2026-11-07 起）：无 mesh 实现，mesh 模式显式报错。
 * @note 两串独立解析、跨串校验（E_ARG）：底孔直径必须 < 公称大径；tap 串 THRU 要求 drill 串也是通孔；盲丝丝深不得超过孔深。通孔 + 攻丝定深（'Ø2.5 完全贯穿' + 'M3-6H ↓8'）合法。由串推导的键（diameter/depth/thread/threadDepth/threadClass/holeType/旧三键/tolerance）显式给出即报错。
 * @note PMI 恒产出 `PmiThreadHole`（本 op 语义即攻丝孔）；公差等级缺省不补——tap 串带 '-6H' 才有（Q3，2026-11-08）。
 * @returns Shape 钻孔后的几何（恒附 `PmiThreadHole` 标注：底孔 + 螺纹一体）。
 * @param input - 目标几何。type:Shape required:true
 * @param params.drill - 钻孔串（底孔几何唯一真源）：`'Ø<diameter>[↧|↓|▼<depth> | 深<depth> | <depth> DEEP | THRU | 完全贯穿]'`，如 'Ø2.5 完全贯穿'、'Ø5 深10'、'Ø14 18 DEEP'。直径符号 Ø/⌀/Φ/φ/ϕ/∅ 等价（OCR 白名单）；无深度后缀 = 通孔。解析失败 E_THREAD_SPEC。type:string required:true
 * @param params.tap - 攻丝串（螺纹规格唯一真源）：`parseThreadSpec` 全文法（metric 'M3-6H'、imperial '1/4"-20-2B'、pipe 'PT1/8'；深度后缀 = 丝深，'THRU'/'完全贯穿' = 通丝）。串内 '-6H' → PMI 公差等级；无后缀则 PMI 无公差（不默认 6H）。解析失败 E_THREAD_SPEC。type:string required:true
 * @param params.direction - 钻孔轴向：`'normal'` = 沿该面法向进入材料，`x`/`y`/`z` = 世界轴，按面法向自动定号；PMI 的 `axis.direction` 记定号后的实际钻孔方向。type:'normal' | 'x' | 'y' | 'z' 默认 'normal'
 * @param params.position - 孔心位置（模型局部空间）。type:[x,y,z] 默认 原点
 * @param params.face - 面引用（`FaceTopoRef`，执行期按输入 Shape 解析派生法向；优先于 `faceNormal`）。type:FaceTopoRef
 * @param params.faceNormal - 面法向快照（历史兜底）。type:[x,y,z] 默认 [0,0,1]
 * @param params.partIndex - 多零件 load 的 compound 成员索引（结果替换回原 compound）。type:number
 * @param params.handedness - 螺纹旋向，仅标注用（写入 PMI；几何旋向不随此参数改变）。type:'right' | 'left' 默认 'right'
 * @example
 * // 通孔攻丝：底孔 Φ2.5 贯穿，M3-6H 贯穿（PMI：'M3-6H 通（底孔 Φ2.5 通，攻丝）'）
 * const p = cad.fai_drill_tapper(part0, { drill: 'Ø2.5 完全贯穿', tap: 'M3-6H 完全贯穿', position: [0, 0, 30], direction: 'z' })
 * // 盲孔攻丝：底孔 Φ2.5×12，丝深 8（孔底留 4 光底；PMI：'M3-6H ↓8（底孔 Φ2.5 ↓12，攻丝）'）
 * const p = cad.fai_drill_tapper(part0, { drill: 'Ø2.5 深12', tap: 'M3-6H ↓8', position: [0, 0, 30], direction: 'z' })
 * // 通孔 + 攻丝定深（Q2）：贯穿底孔上的 ↓8 丝段
 * const p = cad.fai_drill_tapper(part0, { drill: 'Ø2.5 完全贯穿', tap: 'M3-6H ↓8', position: [0, 0, 30], direction: 'z' })
 * // 管螺纹：底孔 Φ8.7×20，PT1/8（无公差概念，PMI 无公差等级）
 * const p = cad.fai_drill_tapper(part0, { drill: 'Ø8.7 深20', tap: 'PT1/8', position: [0, 0, 30], direction: 'z' })
 */
export const fai_drill_tapper = defineOp({
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[extra/drill_tapper] no input geometry')
    const { p, th } = normalizeTapperParams(params)
    assertDrillParams(p)
    const target = resolveCompoundMember(input, p.partIndex, 'fai_drill_tapper')
    const drilled = drillBrepPath(target, p)
    // 建模即标注：PMI 恒产出（攻丝孔 op 的本义）；公差缺省不补（Q3）。
    const fn = faceNormalFrom(target, p)
    const direction = inwardDirection(resolveDirection(p, fn), fn)
    appendPmiItem(
      drilled.shape,
      buildThreadHolePmi(p, th, direction, p.position as Vec3, drilled.target),
    )
    return replaceCompoundMember(input, p.partIndex, drilled.shape)
  },
  paramDims: {},
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
  // 建模即标注：同一语句既钻底孔又产 PmiThreadHole（底孔 + 螺纹一体）。
  // 上游标注归上游零件名所有，不搬运（查询时沿血缘聚合）。
})
