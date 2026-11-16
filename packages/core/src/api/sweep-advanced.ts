/**
 * api sweep-advanced — `cad.sweepRaw`：扫掠内核控制面直通（occt 平台 op）。
 *
 * ## 为什么它不再是公开主入口
 *
 * 2026-11-16 起公开面只有 `cad.sweep`（策略 + 落位 + 判据）。本文件保留的是**内核
 * 控制面**：transition 模式、auxSpine + guideContact、support、解析式 law、orientation
 * 参考系 —— 这些字段与 `sweep` 的 Pappus 判据（体积 = 净面积 × 长度）**冲突**：
 * `law` 会改变截面积、`support`/`auxSpine` 会把料推到脊柱包围盒之外。把它们混进
 * `sweep` 的选项，C1/C3 就只能退化成"一堆特例"，所以它们留在逃生口。
 *
 * 命名：`sweepRaw` 不是"更高级的 sweep"，而是"**不做策略、不做落位决策**的 sweep"。
 * 调用方要自己保证截面位置与过渡模式；默认值仍按脊柱事实给（G0 → 斜接），
 * 但那只是不让旧行为继续塌陷，不是替你选路。
 *
 * ## 与 `sweep` 的分工
 *
 * | 场景 | 用谁 |
 * |---|---|
 * | 等截面沿中心线扫出管（含带孔截面、三维路径、折线斜接） | `cad.sweep` |
 * | 缩放律 / 引导线 / 支撑面 / 恒定 binormal | `cad.sweepRaw`（occt） |
 * | 想要内核裸行为做对拍或排障 | `cad.sweepRaw`（occt） |
 *
 * 实现走 core 直连 `brep-operations/sweepFns.ts#sweepBrep`（occt `simplePipe` /
 * `sweepPipeShell` / `sweepFull`），产物经 `fromBrep` 收养。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import { sweepBrep as coreSweep } from './brep-operations/sweepFns'
import {
  areaOfProfileFace,
  areaOfProfileWire,
  assertSweepResult,
  assertSweptVolumeMatches,
} from './internal/sweep-guard'
import { analyzeSpine, describeSpine } from './internal/spine-analysis'
import {
  bboxCenter,
  isPlaced,
  sectionIsOnPath,
  sectionNormal,
  sectionPlacementMatrix,
  sectionRadius,
} from './internal/section-placement'
import { toProfileRingsView, toProfileWireView } from './internal/profile-wire'
import { unwrapResult } from './internal/result-unwrap'
import type { BrepHandle } from '../brep/engine/types'

/** sweep 的截面朝向模式（映射 occt `SweepMode`）。 */
export type SweepOrientation = 'fixed' | 'frenet' | 'fixedUp' | 'auxiliary'
/** sweep 的引导线接触关系（映射 occt `SweepContact`，仅 `orientation:'auxiliary'` 有效）。 */
export type SweepGuideContact = 'none' | 'contact' | 'contactOnBorder'
/** sweep 沿脊柱的缩放律（映射 occt `SweepLaw`；`law ≠ 'none'` 时必须给 `lawLength`）。 */
export type SweepLawKind = 'none' | 'linear' | 'sCurve'

/**
 * 扫掠完整控制面（occt）。
 *
 * 两条路径：
 * - **旧路径**（默认）：只给 `frenet` / `mode` / `tolerance` / `transitionMode:'right'` 时，
 *   走 `sweepPipeShell`（`mode:'simple'` → `simplePipe`），行为与 S3 前逐字节一致；
 * - **完整控制面**：给出下列任一 sweepFull 字段时改走 occt 原生 `sweepFull`
 *   （occt-wasm 的 `sweepAdvanced` / `sweepOriented` 是其子集，由同一选项对象承载）。
 */
export interface SweepRawOptions {
  /** Frenet 参考系（默认 false）。仅旧路径。 */
  frenet?: boolean
  /** 扫掠模式：'simple'（MakePipe）或 undefined（PipeShell）。与 sweepFull 字段互斥。 */
  mode?: 'simple'
  /**
   * 转角过渡模式。`'auto'`（默认）= 脊柱有 G0 折角时用 `'rightCorner'`（斜接），
   * 全 G1 时交给内核缺省；`'right'` 是旧别名（等价于内核缺省 `'transformed'`）；
   * 显式给 `'transformed'` 可回到「截面只平移不旋转」的旧行为（折线上会塌陷）。
   */
  transitionMode?: 'auto' | 'right' | 'transformed' | 'rightCorner' | 'roundCorner'
  /** 公差等其余旧字段（保留以兼容调用方）。 */
  tolerance?: number

  // ── sweepFull 控制面（S3）──
  /** 截面朝向模式（默认内核缺省 Fixed）。 */
  orientation?: SweepOrientation
  /** `orientation:'fixedUp'` 的恒定 binormal 方向（默认 +Z）。 */
  up?: [number, number, number]
  /** `orientation:'auxiliary'` 的引导线（Shape）。 */
  auxSpine?: Shape
  /** `orientation:'auxiliary'`：按弧长而非参数匹配脊柱与引导线（默认 false）。 */
  curvilinearEquivalence?: boolean
  /** `orientation:'auxiliary'`：截面与引导线的关系（默认 'none'）。 */
  guideContact?: SweepGuideContact
  /**
   * 扫掠前把截面平移到与 spine 相切（`MakePipeShell::Add` 的 `WithContact`，
   * 默认 false = 截面停在调用方放置的位置）。
   */
  withContact?: boolean
  /**
   * 把截面旋转到与 spine 切线正交（`Add` 的 `WithCorrection`，默认 false）。
   * 直脊柱上是空操作。
   */
  withCorrection?: boolean
  /** 支持面（含 spine 的 shape）；给出后取代 `orientation`。 */
  support?: Shape
  /** 逼近面的最大阶数（缺省 = 内核缺省）。 */
  maxDegree?: number
  /** 最大段数（缺省 = 内核缺省）。 */
  maxSegments?: number
  /** 沿脊柱的缩放律（默认 'none'）。 */
  law?: SweepLawKind
  /** law 跨越的参数长度（= 脊柱长度）；`law ≠ 'none'` 时必给。 */
  lawLength?: number
  /** law 末端的截面缩放（1 = 不缩放）。 */
  lawEndFactor?: number
  /** 3D 逼近公差（绝对量，缺省 = 内核缺省 1e-4）。 */
  tol3d?: number
  /** 边界公差（绝对量）。 */
  boundTol?: number
  /** 角度公差（弧度）。 */
  tolAngular?: number
  /**
   * 扫掠前把截面搬到脊柱起点、法向对准起点切向。默认 `false`（保持既有行为：
   * 截面停在调用方放置的位置）。要「一次调用就正确」用 `cad.sweepAlong`，它的
   * 落位默认开着。
   */
  autoPlace?: boolean
  /**
   * 本次调用的扫掠体积对账容差，`(0,1)`，缺省用进程级 5%（见 `internal/sweep-guard.ts`）。
   * 显式放宽只是**知情放行**，不修几何——折线脊柱不会因为放宽阈值变对。
   */
  volumeTolerance?: number
  /** 默认 `true`；`false` 时端面法向（C2）与包围盒（C3）判据降为通知，体积（C1）仍抛。 */
  strict?: boolean
}

/** BREP 路径：截面沿脊柱扫掠（wire 视图 → brep-operations 直连 → fromBrep 收养）。
 *
 * 带孔截面（圆环）：内核 `MakePipe` / `MakePipeShell` 都只吃**单环**截面
 * （`sweepPipeShell(face)` 直接拒：`bad shape type of section`），所以外环与每个孔环
 * **各自扫掠成实体**，再 `cut` 出内腔。实测（`test/api/sweep-hollow-pipe.test.ts` F1/F3）：
 * 外环 − 孔环 = 净空心体积。
 *
 * 默认值方面（2026-11-16）：`transitionMode` 缺省按「脊柱事实」解析 —— 有 G0 折角时
 * 用 `rightCorner`（斜接），全 G1 时交给内核缺省（**保持旧代码路径**）。旧行为可用
 * 显式 `transitionMode: 'transformed'` 复现（折线上会塌陷成平移体）。
 */
function sweepRawBrep(profile: Shape, spine: Shape, opts?: SweepRawOptions): Shape {
  if (!profile) throw new Error('E_SWEEP_NO_PROFILE: sweep requires a profile (section) shape')
  if (!spine) throw new Error('E_SWEEP_NO_SPINE: sweep requires a spine (path) shape')
  // 截面：wire 直用；面取全部环（外环 + 孔环）。脊柱只取单环 wire。
  const rings = toProfileRingsView(profile)
  const spineWire = toProfileWireView(spine)
  const kernel = getBrepApi()
  // 缩放律（law）会改变截面积 ⇒ 恒等式不成立，只在无 law 时判。
  // 判据与容差依据见 internal/sweep-guard.ts 文件头（折线脊柱实测 2/π、1/2）。
  const guard = !(opts?.law !== undefined && opts.law !== 'none')
  const facts = analyzeSpine(kernel, spineWire.wrapped)

  // transitionMode：'auto'/缺省 → 有折角才斜接，全 G1 保持内核缺省（= 旧路径逐字节不变）。
  // 前提是脊柱**真相连**（无断裂）：断开的 wire 上「相邻边切向不同」并不是折角，而是
  // 几何错误本身，此时套右斜接只会把内核的失败消息换成更难读的一条。
  const connected = facts.gaps.length === 0
  const requested = opts?.transitionMode
  const transitionMode =
    requested === undefined || requested === 'auto'
      ? connected && facts.corners.length > 0
        ? 'rightCorner'
        : undefined
      : requested
  const sweepOpts: SweepRawOptions = { ...(opts ?? {}), transitionMode }

  // 落位（默认关，保持既有行为）。开关打开时按「截面中心压到起点、法向对准切向」搬。
  let matrix: number[] | undefined
  if (opts?.autoPlace === true && facts.edges.length > 0) {
    const sectionHandle = brepOf(profile) as BrepHandle
    const normal = sectionNormal(kernel, sectionHandle, rings[0]!.wrapped)
    const start = facts.edges[0]!
    const center = bboxCenter(kernel, sectionHandle)
    if (normal !== undefined && !isPlaced(normal, center, start.start, start.tStart, sectionRadius(kernel, sectionHandle) * 2)) {
      matrix = sectionPlacementMatrix(normal, center, start.start, start.tStart)
    }
  }

  const swept: BrepHandle[] = []
  const moved: BrepHandle[] = []
  try {
    for (const ring of rings) {
      const sectionHandle = matrix === undefined ? ring.wrapped : kernel.transform(ring.wrapped, matrix)
      if (matrix !== undefined) moved.push(sectionHandle)
      const r = coreSweep(sectionHandle, spineWire, sweepOpts, false)
      const h = unwrapResult(r, 'sweepRaw') as BrepHandle
      swept.push(h)
      if (guard) {
        assertSweptVolumeMatches(
          kernel,
          'sweepRaw',
          areaOfProfileWire(kernel, sectionHandle),
          spineWire.wrapped,
          h,
          opts?.volumeTolerance,
        )
      }
    }
    // 带孔：外环实体 − 每个孔环实体。
    let solid = swept[0]!
    for (let i = 1; i < swept.length; i++) {
      const hole = swept[i]!
      const next = kernel.cut(solid, hole) as BrepHandle
      kernel.release(solid)
      kernel.release(hole)
      solid = next
    }
    // C2/C3 的前提是「截面落在路径上」：截面整体偏移时扫出的管整体挪位（体积仍对、
    // 位置错），该修的是落位而不是断言 —— 此时只保留 C1。`autoPlace:true` 由本 op 摆正，
    // 未给时按截面实际位置判定。
    const onPath =
      opts?.autoPlace === true ||
      (facts.edges.length > 0 &&
        sectionIsOnPath(kernel, brepOf(profile) as BrepHandle, rings[0]!.wrapped, facts.edges[0]!.start, facts.edges[0]!.tStart))
    if (guard) {
      // 复合结果按**净面积**再对一次（单环判据抓不出「孔环扫出 0 体积、cut 没减掉」），
      // 并（截面已落位时）做端面法向（C2）与包围盒覆盖（C3）。
      const caps =
        !onPath || facts.closed || facts.edges.length === 0
          ? undefined
          : [
              { label: 'start', point: facts.edges[0]!.start, tangent: facts.edges[0]!.tStart },
              {
                label: 'end',
                point: facts.edges[facts.edges.length - 1]!.end,
                tangent: facts.edges[facts.edges.length - 1]!.tEnd,
              },
            ]
      assertSweepResult(kernel, 'sweepRaw', {
        result: solid,
        spine: spineWire.wrapped,
        profileArea: areaOfProfileFace(kernel, brepOf(profile) as BrepHandle),
        volumeTolerance: opts?.volumeTolerance,
        caps,
        coversPath: onPath,
        spineNote: describeSpine(facts),
        strict: opts?.strict,
      })
    }
    return fromBrep(solidToShape(kernel, solid), { solid })
  } finally {
    // 面→环产出的 wire 是 arena 新句柄（曲线借用不 release）
    for (const ring of rings) {
      if (!ring.borrowed) {
        try { kernel.release(ring.wrapped) } catch { /* 已释放 */ }
      }
    }
    for (const h of moved) {
      try { kernel.release(h) } catch { /* 已释放 */ }
    }
    if (!spineWire.borrowed) {
      try { kernel.release(spineWire.wrapped) } catch { /* 已释放 */ }
    }
  }
}

/**
 * 扫掠（内核控制面直通）：把 occt `sweepFull` 的完整选项面暴露给脚本。
 * @group 特征
 * @inputs 3
 * @async true
 * @qual ok
 * @name sweepRaw
 * @note 平台 op：仅 occt 引擎（BRepOffsetAPI_MakePipeShell / simplePipe）。截面接受
 *       wire 或面（面取其外环）；脊柱必须为 wire。非 occt 引擎执行前报错；
 *       brep_mock 不拦截。`shellMode` 不暴露（元组产物跨不过单产物边界）。
 *
 *       **这是逃生口，不是主入口**：日常「等截面沿中心线扫出管」用 `cad.sweep`
 *       （自动策略 + 落位 + C1–C3 判据）。本 op 不做策略选择，只在脊柱事实的基础
 *       上给默认过渡（G0 → `rightCorner`）—— 给 `orientation` / `up` / `auxSpine` /
 *       `curvilinearEquivalence` / `guideContact` / `withContact` / `withCorrection` /
 *       `support` / `maxDegree` / `maxSegments` / `law` / `lawLength` /
 *       `lawEndFactor` / `tol3d` / `boundTol` / `tolAngular` 任一，即改走 occt 原生
 *       `sweepFull`。`law ≠ 'none'` 时体积恒等式不成立，C1 自动跳过（由调用方负责）。
 * @returns Shape 扫掠体。
 * @param profile - 截面几何（wire 或面；面取其外环）。type:Shape required:true
 * @param spine - 脊柱路径（wire）。type:Shape required:true
 * @param opts - 扫掠完整控制面。type:SweepRawOptions required:false
 * @throws E_SWEEP_VOLUME_MISMATCH 体积与「截面积 × 长度」不符（`law` 生效时不判）。
 * @throws E_SWEEP_CAP_NORMAL 端面法向与端点切向不符（截面没转）。
 * @throws E_SWEEP_BBOX_MISMATCH 产物没有覆盖整条脊柱。
 * @example
 * const path = cad.wire([[0, 0, 0], [0, 0, 50]])
 * const body = cad.sweepRaw(section, path, { orientation: 'frenet' })
 */
export const sweepRaw = defineOp({
  name: 'sweepRaw',
  brep(profile: Shape, spine: Shape, opts?: SweepRawOptions) {
    return sweepRawBrep(profile, spine, opts)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: 'swept-body face vocabulary not defined' } as Provenance,

  paramDims: {},
})
