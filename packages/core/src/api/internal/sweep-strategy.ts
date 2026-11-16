/**
 * sweep-strategy — 脊柱事实 → 扫掠策略（纯函数，不碰几何）
 *
 * ## 为什么策略要单独一层
 *
 * 同一个 `sweep` 调用在五种脊柱上就有五种正确解法（实测表见
 * `internal/spine-analysis.ts` 文件头）。把「选哪条路」写进执行器内部，
 * 结果就是调用方永远不知道自己走的是哪条、为什么错。抽成纯函数之后：
 *
 * - 策略可解释：拒绝时给出**具体修法**，不是「不支持」；
 * - 策略可测：`spine-analysis.test.ts` 只测事实，`sweep-along.test.ts` 只测策略 × 脊柱矩阵；
 * - 策略不依赖判据阈值，判据不依赖执行细节。
 *
 * ## 判据来源（全部实测，见 test/api/sweep-kernel-behavior.test.ts）
 *
 * | 事实 | 策略 | 依据 |
 * |---|---|---|
 * | 单边 / 同类型多边全 G1 | `single` | K1a/K1b/K1d 精确 1.0000 |
 * | 全直线 / 同类多边、有 G0 | `miter` | K3a/K6a 斜接精确、K6b 落位后 0.9936–0.9996 |
 * | 混合类型、全 G1 | `segments` | K1c 单次扫按 A×(弧长−腿长) 出错，逐段 1.0000 |
 * | 混合类型 + G0 | 拒绝 | 两条路都给不出正确几何：单次扫符号错、逐段在折角留 V 形缺口 |
 * | 断裂 / 折返 / 退化 | 拒绝 | R6：自交实体、包含关系退化、切向无定义 |
 *
 * 「全直线折线走 `miter` 而不是 `segments`」这条最容易写错：逐段圆管在折角处
 * 只并到 0.88–0.90（K6d，接缝留 V 形缺口），斜接一次扫是 0.99+。所以策略必须
 * 先看「有没有折角」，再看「边类型是否混合」。
 */

import type { SpineFacts } from './spine-analysis'
import { describeSpine } from './spine-analysis'

/** 扫掠策略。 */
export type SweepStrategy = 'single' | 'miter' | 'segments' | 'closed'

/** 策略选择结果：要么给出策略与理由，要么给出一条可执行的拒绝。 */
export type StrategyDecision =
  | { strategy: SweepStrategy; reason: string }
  | { reject: StrategyReject }

/** 拒绝：错误码 + 已排好的人类可读消息（含修法）。 */
export interface StrategyReject {
  code: string
  message: string
}

/** 策略选择的入参。 */
export interface StrategyRequest {
  /** 调用方强制指定；`'auto'`（默认）= 由脊柱事实决定。 */
  strategy?: 'auto' | SweepStrategy
  /** 截面外接半径（bbox 最长边的一半），只用于斜接自交预判；拿不到则跳过该预检。 */
  sectionRadius?: number
}

/**
 * 斜接自交预判：截面在转角处被斜切的偏移量 r·tan(θ/2) 超过相邻段长时，
 * 斜接平面落到段外，几何必然自交。
 *
 * 为什么不用「相邻拐点距离 < 2×截面半径」：16 段折线（R10 弧）的相邻拐点距离
 * 只有 0.98，但斜接实测 0.9996 是**正确**的 —— 那条粗判据会把好几何一并拒掉。
 */
function miterSelfIntersects(f: SpineFacts, sectionRadius: number | undefined): { index: number; extent: number; segLen: number } | undefined {
  if (sectionRadius === undefined || sectionRadius <= 0) return undefined
  for (const c of f.corners) {
    // corners[i].index = 折角后面那条边的下标（闭合收尾为 edges.length）。
    const next = f.edges[c.index]
    const prev = f.edges[c.index - 1]
    if (!next || !prev) continue
    const extent = sectionRadius * Math.tan(Math.min(c.turn, Math.PI - 1e-6) / 2)
    const segLen = Math.min(prev.length, next.length)
    if (extent > segLen) return { index: c.index, extent, segLen }
  }
  return undefined
}

/**
 * 由脊柱事实选策略。
 *
 * 顺序即优先级：硬拒绝（退化/断裂/折返）先于一切；闭合脊柱单独一档；显式
 * `strategy` 覆写在硬拒绝之后、自动判定之前（覆写不能绕过物理上无解的脊柱）。
 *
 * @param f - 脊柱事实（`analyzeSpine` 的产物）。
 * @param req - 调用方覆写与截面外接半径。
 * @returns 策略与理由，或一条带修法的拒绝。
 */
export function selectStrategy(f: SpineFacts, req?: StrategyRequest): StrategyDecision {
  if (f.edges.length === 0) {
    return { reject: { code: 'E_SPINE_EMPTY', message: 'spine has no edges — pass a wire built from at least one edge' } }
  }
  if (f.degenerate.length > 0) {
    return {
      reject: {
        code: 'E_SPINE_DEGENERATE',
        message:
          `spine edge(s) ${f.degenerate.join(', ')} have zero length — the tangent is undefined there ` +
          `(${describeSpine(f)}). Remove the duplicated point(s) from the spine.`,
      },
    }
  }
  if (f.gaps.length > 0) {
    const g = f.gaps[0]!
    const prev = f.edges[g.index - 1]!
    const cur = f.edges[g.index]!
    return {
      reject: {
        code: 'E_SPINE_DISCONTINUOUS',
        message:
          `spine edges ${g.index - 1} and ${g.index} do not meet: ` +
          `end (${prev.end.x.toFixed(4)}, ${prev.end.y.toFixed(4)}, ${prev.end.z.toFixed(4)}) vs ` +
          `start (${cur.start.x.toFixed(4)}, ${cur.start.y.toFixed(4)}, ${cur.start.z.toFixed(4)}), ` +
          `distance ${g.dist.toFixed(6)}. Build the spine from edges that share endpoints ` +
          `(cad.wireFromEdges with tangent edges, or cad.wire([p0,p1,...])).`,
      },
    }
  }
  if (f.fold) {
    const worst = f.corners.reduce((m, c) => (c.turn > m.turn ? c : m), f.corners[0]!)
    return {
      reject: {
        code: 'E_SPINE_FOLD',
        message:
          `spine folds back on itself at ` +
          `(${worst.point.x.toFixed(4)}, ${worst.point.y.toFixed(4)}, ${worst.point.z.toFixed(4)}): ` +
          `turn ${((worst.turn * 180) / Math.PI).toFixed(2)}° > 175°. The second leg lies inside the ` +
          `first tube, so the swept body is self-intersecting and unions silently collapse. ` +
          `Remove the reversal (a U-bend needs an arc whose end tangent matches the return leg).`,
      },
    }
  }
  if (f.closed) {
    // 闭合脊柱：内核一次扫掠就收口（实测环面体积 = 面积 × 周长，与解析值一致；
    // 见 sweep-kernel-behavior.test.ts K8a）。没有端面 ⇒ 判据跳过 C2，靠 C1 + C3。
    return {
      strategy: 'closed',
      reason: `closed spine (${describeSpine(f)}) — single kernel sweep, no end caps`,
    }
  }

  const forced = req?.strategy
  if (forced !== undefined && forced !== 'auto') {
    return { strategy: forced, reason: `forced by opts.strategy='${forced}'` }
  }

  if (f.mixed && f.corners.length > 0) {
    return {
      reject: {
        code: 'E_SPINE_MIXED_CORNER',
        message:
          `spine mixes edge kinds (${[...new Set(f.edges.map((e) => e.kind))].join(' + ')}) AND has ` +
          `${f.corners.length} G0 corner(s) (${describeSpine(f)}). The two problems need opposite routes: ` +
          `a corner needs one mitered sweep, while mixed kinds are only verified segment-wise — and ` +
          `segment-wise sweeping leaves a V-shaped gap at every corner (measured 0.88). Fix one of the two: ` +
          `(a) split the path into G1-only runs and sweep each with cad.sweepAlong, or ` +
          `(b) replace the sampled polyline with true tangents (cad.tangentArc / cad.circleArc) so the whole ` +
          `spine becomes G1 and one call suffices.`,
      },
    }
  }

  if (f.corners.length > 0) {
    const bad = miterSelfIntersects(f, req?.sectionRadius)
    if (bad !== undefined) {
      return {
        reject: {
          code: 'E_SPINE_MITER_SELF_INTERSECT',
          message:
            `miter at corner ${bad.index} needs ${bad.extent.toFixed(3)} of run-out but the adjacent ` +
            `segment is only ${bad.segLen.toFixed(3)} long — the miter plane falls outside the segment and ` +
            `the section sweeps through itself. Either enlarge the segment spacing (coarser polyline), ` +
            `use a smaller section (current half-extent ${req?.sectionRadius?.toFixed(3)}), or replace the ` +
            `corner with a true tangent arc.`,
        },
      }
    }
    return {
      strategy: 'miter',
      reason: `${f.corners.length} G0 corner(s), max ${((f.maxTurn * 180) / Math.PI).toFixed(1)}° — mitered single sweep`,
    }
  }

  if (f.mixed) {
    return {
      strategy: 'segments',
      reason: `mixed edge kinds (${[...new Set(f.edges.map((e) => e.kind))].join(' + ')}) but all G1 — segment-wise sweep with coplanar joints`,
    }
  }

  return {
    strategy: 'single',
    reason: `${f.edges.length} edge(s), single kind, all G1 — one kernel sweep`,
  }
}
