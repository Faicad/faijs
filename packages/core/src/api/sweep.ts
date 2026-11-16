/**
 * api sweep — 扫掠（**唯一公开入口**）：脊柱事实 → 策略 → 执行 → 判据
 *
 * ## 为什么只有一个入口
 *
 * 2026-11-16 之前仓里有四条扫掠路径（`pipe` / `sweep` / `sweepAdvanced` /
 * `sweepAlong`），差别全在「内核走哪条 API」——`MakePipe`、`sweepPipeShell`、
 * `sweepFull`、逐段+union。那是内核的差别，不是用户意图的差别：同一个「截面沿中心线
 * 扫出管」的意图，用户从名字里看不出该选谁，只能记住「上次有人用 pipe」。
 *
 * 现在按**意图**分：公开面只有 `sweep`，内核控制面留在 `sweepRaw`（occt 逃生口）。
 * 三条 op 级的差别被消掉：
 * - `cad.pipe`（`MakePipe` 裸管线）——**删除**：它的定义域（单边/同类型 G1）就是
 *   `sweep` 的 `single` 策略；带孔 face 由逐环扫 + `cut` 覆盖（F1/F3 实测），
 *   wire→壳 由 L1 截面口径覆盖。
 * - `cad.sweepAlong`——并入 `sweep`：策略/落位/判据本来就是这个 op 的主体。
 * - `cad.sweepAdvanced`——改名 `cad.sweepRaw`：`law` / `auxSpine` / `support` /
 *   过渡模式这些**与 Pappus 判据冲突**的控制面留在逃生口，不混进 `sweep` 的选项。
 *
 * ## 四层（每一层只回答一个问题）
 *
 * ```
 * internal/spine-analysis.ts   脊柱长什么样（纯几何事实，不扫掠）
 * internal/sweep-strategy.ts   该怎么扫（纯函数：事实 → 策略 / 拒绝）
 * 本文件                       执行器：按策略与**引擎能力**调用内核
 * internal/sweep-guard.ts      结果是否可信（C1 体积 / C2 端面法向 / C3 包围盒）
 * ```
 *
 * ## 引擎能力表（本文件是唯一判定点，**全部实测**，见 `test/api/sweep-engines.test.ts`）
 *
 * | 引擎 | single | miter | segments | closed | C2 端面法向 |
 * |---|---|---|---|---|---|
 * | occt | ✔ | ✔ | ✔ | ✔ | ✔ |
 * | smlib | ✔ | ✔（仅平面折角） | ✔ | ✔ | ✔ |
 * | brepkit | ✔ | ✘ | ✘ | ✘ | ✘（旧引擎，保留 single 只为历史脚本） |
 *
 * 实测数字（4×4 截面，`cad.sweep` 脚本级 / 内核级，2026-11-16）：
 * - occt：直线 25 → 400；折角 L 形（长 20）miter → 320；**空间**折角（长 30）→ 480；
 *   闭合圆 r=10 → 1005.31；带孔截面（8/4）→ 3015.93（= 净面积 × 20）；真弧脊柱 → 251.33。
 * - smlib：直线 400 / autoPlace 搬 90mm → 800 / 共线多边 400 / 带孔 3015.93 /
 *   **平面**折角 320（内核自己就斜接）/ 真弧脊柱 251.33 / 混合边 G1（弧+直腿）411.33；
 *   空间折角 → `E_SWEEP_ENGINE_CAP`（内核吐 V=0、非流形的碎片）；闭合圆 → 1005.31。
 * - brepkit：直线 400 / autoPlace 800 / 共线多边 400（结构判据修好后成立）；
 *   折角 → `E_SWEEP_ENGINE_CAP`；带孔截面 → 体积对（3015.93）但 C1 面积读数失真
 *   （读到 16 而非 150.8）→ 旧引擎不修，带孔截面在 brepkit 上按「不可用」看待。
 *
 * 依据（内核桥的硬事实）：
 * - occt：`sweepFull` 有 `transitionMode`（`rightCorner` 斜接 / `roundCorner`），
 *   闭合脊柱一次扫掠给环面（K8a），空间折角也成立；
 * - smlib：只有 `SmApiCreateSweepAlongPlanarPath`（名字叫 planar，实测**空间 G1 路径**
 *   —— 3D 样条 570.70 = 16 × 35.669、螺旋线 1639.96 = 16 × 102.498 —— 照样成立；
 *   内核自己把截面 bbox 中心搬到路径起点、`capEnds=3` 封端），**平面** G0 折角内核
 *   直接给精确斜接；它真正的边界是「空间 G0 折角」（V=0、非流形）与「带孔 face 的孔环」
 *   （只取外环 ⇒ op 层必须逐环扫 + `cut`）；
 * - brepkit：剖面 face + 路径整链拟合成一条 NURBS + `sweepWithOptions('rmf','smooth')`，
 *   折角被**光滑掉**（不是斜接）；`shapeType` 不区分 wire（一律 COMPOUND）⇒ 脊柱判据
 *   必须用**结构**判（有边、无面），不能按类型字符串判。
 *
 * 不支持的组合在**扫掠之前**拒绝（`E_SWEEP_ENGINE_CAP`），消息给出该引擎缺的是哪个
 * 内核能力与可执行修法 —— 绝不静默降级成另一条策略（降级到 `segments` 会在 G0 接缝
 * 留 V 形缺口，实测 0.88–0.90）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getBrepApi } from '../brep/handle-bridge'
import { getActiveBrepEngineId } from '../brep/engine/registry'
import type { BrepHandle } from '../brep/engine/types'
import { brepOf, fromBrep } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import { unifyOrientation, weldVertices } from '../mesh/reconcile'
import { OpError, unwrapResult } from './internal/result-unwrap'
import {
  areaOfProfileFace,
  areaOfProfileWire,
  assertSweepResult,
  assertSweptVolumeMatches,
} from './internal/sweep-guard'
import { toProfileRingsView } from './internal/profile-wire'
import type { WireView } from './internal/profile-wire'
import { analyzeSpineEdges, describeSpine } from './internal/spine-analysis'
import type { SpineFacts } from './internal/spine-analysis'
import { selectStrategy } from './internal/sweep-strategy'
import type { SweepStrategy } from './internal/sweep-strategy'
import {
  bboxCenter,
  isPlaced,
  sectionNormal,
  sectionPlacementMatrix,
  sectionRadius,
} from './internal/section-placement'
import { sweepBrep as coreSweep } from './brep-operations/sweepFns'

/** `sweep` 选项。 */
export interface SweepOptions {
  /**
   * 策略覆写。默认 `'auto'`（由脊柱事实决定，见 `internal/sweep-strategy.ts`）：
   * - `single`：单边 / 同类型多边全 G1 → 一次内核扫掠；
   * - `miter`：全 G0 折角 → 一次扫掠 + 斜接过渡（实测 0.9936–0.9996）；
   * - `segments`：混合边类型全 G1 → 逐段扫 + 共面接缝 fuse；
   * - `closed`：闭合中心线 → 一次扫掠（环面体积 = 面积 × 周长）。
   *
   * 覆写不能绕过物理上无解的脊柱（断裂 / 折返 / 退化 / 混合+G0 一律先拒），
   * 也不能绕过引擎能力（见文件头的引擎表，`E_SWEEP_ENGINE_CAP`）。
   */
  strategy?: 'auto' | 'single' | 'miter' | 'segments' | 'closed'
  /**
   * 扫掠前把截面搬到脊柱起点、法向对准起点切向。默认 `true`。
   *
   * 已经落位（截面中心在起点且法向与切向夹角 < 1°）时**不动**，避免二次变换引入误差。
   * 关掉它等于「截面停在调用方放的位置」——只有调用方自己保证位置时才该关。
   */
  autoPlace?: boolean
  /**
   * 本次调用的体积对账容差，`(0,1)`，缺省用进程级 5%。
   * 显式放宽只是**知情放行**，不修几何。
   */
  volumeTolerance?: number
  /** 默认 `true`；`false` 时端面法向（C2）与包围盒（C3）判据降为通知，体积（C1）仍抛。 */
  strict?: boolean
}

/** 每个引擎能正确执行的策略。**这是引擎能力的唯一判定点**（实测见文件头）。 */
const STRATEGIES_BY_ENGINE: Record<string, readonly SweepStrategy[]> = {
  occt: ['single', 'miter', 'segments', 'closed'],
  // smlib（2026-11-16 P0 探针后放宽）：single（含空间样条 / 螺旋 G1，实测体积与
  // 面积×长度同到 1e-4）、miter（平面 G0 折角内核自己就做斜接，实测 320 精确；空间
  // 折角由 assertEngineCan 单独拦）、segments（逐段扫 + fuse，实测 411.327 = 两段之和）、
  // closed（闭合圆 1005.31）。
  smlib: ['single', 'miter', 'segments', 'closed'],
  // 旧引擎，保留 single 只为历史脚本；折角在 brepkit 上被光滑掉，不是斜接。
  brepkit: ['single'],
}

/** 各引擎缺的关键内核能力（只用于拒绝消息，让「为什么不行」可行动）。 */
const ENGINE_GAP: Record<string, string> = {
  smlib:
    'smlib exposes only SmApiCreateSweepAlongPlanarPath: it has no corner transition for a SPATIAL ' +
    '(non-planar) G0 corner — measured a 3D fold yields V=0 and a non-manifold body — and no guide / ' +
    'law / support control surface',
  brepkit:
    'brepkit sweeps one NURBS interpolation of the whole spine with rmf + smooth corners: ' +
    'polyline corners are rounded away (not mitered), so a G0 spine cannot reach the analytic volume',
}

/**
 * 扫掠产物的网格出口：**绕序必须一致**（相邻三角形以相反方向遍历共享边）。
 *
 * 为什么修在出口而不是渲染层（真机证据 2026-10-21）：截面 29×27 沿「第一段 16.3mm、
 * 拐角偏转 35.7°」的折线扫掠时，拐角内侧的截面会扫过自身（截面半宽 × cot(拐角/2)
 * ≈ 41mm ≫ 段长），侧壁平面边界曲线自交，brepkit 的扇形三角化把凹/自交多边形拆成
 * 交错的三角形，其中一部分以相同方向遍历共享边；渲染层 `FrontSide` 单面剔除 ⇒
 * 朝向反的那片被剔掉，表面裂开一个洞（用户报的"破面、不像实心"）。STL 查看器双面
 * 渲染，所以导出看着正常 —— 两个现象同源。
 *
 * 这是**网格契约**，不属于某一个 op：任何 BREP→mesh 出口都该满足它。这里复用的是
 * 既有的 `mesh/reconcile.ts`（焊接 → 绕序传播），缺的只是接到这个出口。
 * @param s - BREP 派生的 shape（positions/indices 来自内核三角化）。
 * @returns the same shape with an orientation-unified mesh.
 */
function withConsistentWinding(s: Shape): Shape {
  // 只做「焊接 + 绕序统一」，**不做退化剔除**：这两步都不改变三角形数量与顺序，
  // 因此 `materialGroups` 的 (start,count) 仍然有效。
  const welded = weldVertices(s.positions, s.indices)
  const unified = unifyOrientation(welded.positions, welded.indices)
  // **就地替换载荷，不要 `{...s}`**：BREP 句柄挂在 runtime slots 上、以 shape 对象
  // 引用为键（`shape.ts:480 brepOf`），换新对象会让 brepOf 返回 undefined。
  s.positions = unified.positions
  s.indices = unified.indices
  return s
}

/** 内核面 + 引擎 id（执行器只需要这两样，判据层不感知引擎）。 */
type Kernel = ReturnType<typeof getBrepApi>

/**
 * 一次内核扫掠（单环或多环）：每个环各自扫成实体，孔环用 `cut` 减掉。
 *
 * 为什么逐环：内核 `sweepPipeShell` / smlib `sweepAlongPlanarPath` 都只吃**一个**
 * 截面句柄，带孔 face 的孔环会被整段忽略（`toProfileWireView` 时代的内腔丢失就是
 * 这么来的）。occt 原生 `MakePipe` 能吃带孔 face，但那是 `pipe` 唯一的独占能力，
 * 逐环 + `cut` 已经实测等价（F1/F3：净面积 × 长度）。
 *
 * @returns 扫出的实体句柄（调用方负责 release）。
 */
function sweepRingsOnce(
  api: Kernel,
  engineId: string,
  rings: WireView[],
  spineWire: BrepHandle,
  matrix: number[] | undefined,
  opts: { strategy: SweepStrategy; transitionMode?: string; volumeTolerance?: number },
): BrepHandle {
  const sections: BrepHandle[] = []
  const swept: BrepHandle[] = []
  try {
    for (const ring of rings) {
      let section = matrix === undefined ? ring.wrapped : api.transform(ring.wrapped, matrix)
      if (matrix !== undefined) sections.push(section)
      // 内核扫掠只吃 face / wire：单独一条 edge（`cad.circleArc` 的输出）直接喂进去会得到
      // occt 的 `BRepFill_Section: bad shape type of section`。包成 wire 后产**壳**
      // （管面），与 `MakePipe` 的老口径一致；体积判据在壳上无意义，C1 自动跳过。
      if (String(api.shapeType(section)).toLowerCase() === 'edge') {
        section = api.makeWire([section])
        sections.push(section)
      }
      // 单环判据先按本环的面积判一次：孔环扫出 0 体积时，净面积判据区分不出是哪一环。
      const area = areaOfProfileWire(api, section)
      const sweptHandle = sweepOneSection(api, engineId, section, spineWire, opts)
      swept.push(sweptHandle)
      assertSweptVolumeMatches(api, 'sweep', area, spineWire, sweptHandle, opts.volumeTolerance)
    }
    let solid = swept[0]!
    for (let i = 1; i < swept.length; i++) {
      const hole = swept[i]!
      const next = api.cut(solid, hole)
      api.release(solid)
      api.release(hole)
      solid = next
    }
    return solid
  } finally {
    for (const h of sections) {
      try { api.release(h) } catch { /* 已释放 */ }
    }
  }
}

/**
 * 单个截面句柄的扫掠：按策略与引擎选内核入口。
 *
 * - `miter` / `closed`：只有 occt 能做（`sweepFull` 的 `transitionMode`；闭合脊柱一次
 *   成形）。其余引擎在上游已被能力门禁拒绝，这里再兜一次（防接线漂移）。
 * - 其余（`single` / `segments` 的单段）：走 L1 中立名 `BrepEngineApi#sweep`，
 *   occt = `sweepPipeShell(f,sp,false,false)`、smlib = 平面路径扫掠、brepkit = RMF 扫掠。
 *   **不用 occt 专属面**是让三引擎跑同一条代码路径的唯一办法。
 *
 * @returns 扫出的实体句柄（调用方负责 release）。
 */
function sweepOneSection(
  api: Kernel,
  engineId: string,
  section: BrepHandle,
  spineWire: BrepHandle,
  opts: { strategy: SweepStrategy; transitionMode?: string },
): BrepHandle {
  if (engineId === 'occt' && (opts.strategy === 'miter' || opts.strategy === 'closed')) {
    const query: Record<string, unknown> = { orientation: 'frenet' }
    if (opts.transitionMode !== undefined) query['transitionMode'] = opts.transitionMode
    return unwrapResult(coreSweep(section, spineWire, query, false), 'sweep') as BrepHandle
  }
  return api.sweep(section, spineWire)
}

/** 按策略与引擎能力解析「这一次能不能扫」——不行就给出可执行的拒绝。 */
function assertEngineCan(
  engineId: string,
  strategy: SweepStrategy,
  facts: SpineFacts,
): void {
  const allowed = STRATEGIES_BY_ENGINE[engineId] ?? ['single']
  const gap = ENGINE_GAP[engineId] ?? `${engineId} has no kernel entry for this strategy`
  const fix = engineId === 'occt'
    ? 'report this as a missing engine registration'
    : 'run this model on occt, or reduce the spine to what the engine can sweep ' +
      '(single edge / same-kind G1 chain: a true arc beats a sampled polyline)'
  // 平面性是策略之外的**引擎**约束：smlib 的转角过渡只在平面路径上成立。
  // 实测（P0i，4×4 截面的空间 L 折角）：V=0、manifold=false、10 个面 —— 内核不报错，
  // 吐出一块退化碎片。这种「静默产废」必须在扫掠之前拦住。
  if (engineId === 'smlib' && strategy === 'miter' && !facts.planar) {
    throw new OpError(
      'sweep',
      'E_SWEEP_ENGINE_CAP',
      `[api/sweep] engine 'smlib' cannot sweep a spatial G0 corner (${describeSpine(facts)}): ` +
        `${gap}. Fix: run this model on occt, or make the spine planar (put every corner in one plane) ` +
        `or replace the sharp corner with a true arc (smlib sweeps arcs correctly).`,
    )
  }
  if (allowed.includes(strategy)) return
  throw new OpError(
    'sweep',
    'E_SWEEP_ENGINE_CAP',
    `[api/sweep] engine '${engineId}' cannot run strategy '${strategy}' required by this spine ` +
      `(${describeSpine(facts)}). ${gap}. Fix: ${fix}.`,
  )
}

/** BREP 路径：脊柱事实 → 策略 → （能力门禁）→ 执行 → 判据套件。 */
function sweepBrep(section: Shape, spine: Shape, opts?: SweepOptions): Shape {
  if (!section) throw new Error('E_SWEEP_NO_PROFILE: sweep requires a profile (section) shape')
  if (!spine) throw new Error('E_SWEEP_NO_SPINE: sweep requires a spine (path) shape')
  const api = getBrepApi()
  const engineId = getActiveBrepEngineId() ?? 'occt'
  const sectionHandle = brepOf(section) as BrepHandle | undefined
  if (sectionHandle === undefined) {
    throw new Error('E_SWEEP_NO_BREP: sweep requires a BREP handle for the section (mesh-only shape has none)')
  }
  const spineHandle = brepOf(spine) as BrepHandle | undefined
  if (spineHandle === undefined) {
    throw new Error('E_SWEEP_NO_BREP: sweep requires a BREP handle for the spine (mesh-only shape has none)')
  }
  // 脊柱必须是「只有边、没有面」的 1D 链。**不能按 `shapeType` 的字符串判**：
  // brepkit 的 shapeType 只区分 SOLID / FACE / COMPOUND，wire 一律报 COMPOUND
  // （brepkitKernel.ts:1478），字符串判会把 brepkit 上所有合法脊柱误杀。结构化判据
  // 对三引擎同样成立：有边、且没有任何面（面/实体才带面）。
  const spineFaces = api.getSubShapes(spineHandle, 'face')
  if (spineFaces.length > 0) {
    throw new Error(
      'E_SWEEP_SPINE_NOT_WIRE: sweep spine must be a wire (the centreline path), ' +
        'got a shape carrying faces (face / solid / shell)',
    )
  }
  const edgeHandles = api.getSubShapes(spineHandle, 'edge')
  if (edgeHandles.length === 0) {
    throw new Error('E_SWEEP_SPINE_NOT_WIRE: sweep spine has no edges (expected a wire centreline)')
  }
  const rings = toProfileRingsView(section)
  try {
    const facts = analyzeSpineEdges(api, edgeHandles)
    if (facts.edges.length === 0) {
      throw new Error('E_SWEEP_SPINE_EMPTY: sweep spine wire has no edges')
    }
    const radius = sectionRadius(api, sectionHandle)
    const decision = selectStrategy(facts, { strategy: opts?.strategy, sectionRadius: radius })
    if ('reject' in decision) {
      throw new OpError('sweep', decision.reject.code, decision.reject.message)
    }
    const strategy = decision.strategy
    assertEngineCan(engineId, strategy, facts)

    const first = facts.edges[0]!
    const last = facts.edges[facts.edges.length - 1]!
    // C1 的期望值用**净面积**（带孔面 = 外环 − 孔环）：孔环被 cut 掉，实心面积会高估。
    const netArea = areaOfProfileFace(api, sectionHandle) ?? areaOfProfileWire(api, rings[0]!.wrapped)
    // C2 的前提是「能找到平面端面 + 外法向」。C2 只用 |dot|，所以它不需要
    // `shapeOrientation` 的真值（smlib 未实现它）—— 只要 `surfaceType` / `uvBounds` /
    // `surfaceNormal` 能读数（occt + smlib 都有）。brepkit 的面积/法向读数不可靠，不判。
    const capsAvailable = (engineId === 'occt' || engineId === 'smlib') && strategy !== 'closed'
    const caps = !capsAvailable
      ? undefined
      : [
          { label: 'start', point: first.start, tangent: first.tStart },
          { label: 'end', point: last.end, tangent: last.tEnd },
        ]

    const place = opts?.autoPlace !== false
    const normal = place ? sectionNormal(api, sectionHandle, rings[0]!.wrapped) : undefined
    const center = place ? bboxCenter(api, sectionHandle) : undefined

    let solid: BrepHandle
    if (strategy === 'segments') {
      // 逐段：起点 + 起点切向摆正截面 → 单段扫掠 → 共面接缝 fuse。
      // 只在全 G1 上启用（策略层保证），接缝是共面同向端面，实测并成单块且体积精确。
      let acc: BrepHandle | undefined
      for (const [i, edge] of edgeHandles.entries()) {
        const ef = facts.edges[i]!
        const matrix =
          normal === undefined || center === undefined
            ? undefined
            : sectionPlacementMatrix(normal, center, ef.start, ef.tStart)
        const segWire = api.makeWire([edge])
        let seg: BrepHandle | undefined
        try {
          seg = sweepRingsOnce(api, engineId, rings, segWire, matrix, {
            strategy,
            volumeTolerance: opts?.volumeTolerance,
          })
        } finally {
          try { api.release(segWire) } catch { /* 已释放 */ }
        }
        if (acc === undefined) {
          acc = seg
        } else {
          const fused = api.fuse(acc, seg)
          api.release(acc)
          api.release(seg)
          acc = fused
        }
      }
      if (acc === undefined) {
        throw new Error('E_SWEEP_NO_EDGES: sweep spine has no edges')
      }
      solid = acc
    } else {
      // single / miter / closed：一次内核扫掠（截面落位 + 策略决定的过渡）。
      const matrix =
        normal === undefined || center === undefined
          ? undefined
          : isPlaced(normal, center, first.start, first.tStart, radius * 2)
            ? undefined
            : sectionPlacementMatrix(normal, center, first.start, first.tStart)
      solid = sweepRingsOnce(api, engineId, rings, spineHandle, matrix, {
        strategy,
        transitionMode: strategy === 'miter' ? 'rightCorner' : undefined,
        volumeTolerance: opts?.volumeTolerance,
      })
    }

    try {
      assertSweepResult(api, 'sweep', {
        result: solid,
        spine: spineHandle,
        profileArea: netArea,
        volumeTolerance: opts?.volumeTolerance,
        caps,
        coversPath: true,
        spineNote: describeSpine(facts),
        strict: opts?.strict,
      })
      return withConsistentWinding(fromBrep(solidToShape(api, solid), { solid }))
    } catch (e) {
      try { api.release(solid) } catch { /* 已释放 */ }
      throw e
    }
  } catch (e) {
    // 守卫抛的 OpError 必须原样透传：包成 E_SWEEP_FAILED 会丢掉 E_SWEEP_VOLUME_MISMATCH
    // / E_SWEEP_ENGINE_CAP 这些唯一能指向根因的码。
    if (e instanceof OpError) throw e
    const raw = e instanceof Error ? e.message : String(e)
    throw new Error(`E_SWEEP_FAILED: sweep failed: ${raw}`, { cause: e })
  } finally {
    for (const e of edgeHandles) {
      try { api.release(e) } catch { /* 已释放 */ }
    }
    for (const ring of rings) {
      if (!ring.borrowed) {
        try { api.release(ring.wrapped) } catch { /* 已释放 */ }
      }
    }
  }
}

/**
 * 扫掠：把等截面沿任意三维中心线扫成（可空心）的实体，一次调用给出解析体积。
 *
 * 三条策略（`internal/sweep-strategy.ts`，全部实测）：
 * - `single`——单边 / 同类型多边全 G1：内核一次扫，精确；
 * - `miter`——有 G0 折角：一次扫 + `rightCorner` 斜接，0.9936（4 拐角）/ 0.9996（16 拐角）；
 * - `segments`——混合边类型（弧 + 直腿）全 G1：逐段扫 + 共面接缝 fuse，精确；
 * - `closed`——闭合中心线：一次扫掠，环面体积 = 面积 × 周长。
 *
 * 逐段 union 在折角上只有 0.88–0.90（接缝留 V 形缺口），所以折角必须走斜接，不能
 * 沿用「逐段并一块」。
 *
 * **引擎能力**（不支持的组合在扫掠前拒绝，`E_SWEEP_ENGINE_CAP`）：
 * occt 全策略；smlib `single` / `closed`（平面路径扫掠，实测直线 400 / 闭合 1005.31 /
 * 带孔截面 3015.93，`segments` 等 `circleArc` 补 smlib）；brepkit 只 `single`
 * （旧引擎，折角被 RMF 光滑掉）。
 *
 * 无解脊柱显式拒绝（带修法）：断裂 `E_SPINE_DISCONTINUOUS`、折返 `E_SPINE_FOLD`、
 * 零长边 `E_SPINE_DEGENERATE`、混合 + 折角 `E_SPINE_MIXED_CORNER`、斜接必自交
 * `E_SPINE_MITER_SELF_INTERSECT`。
 *
 * 判据：C1 体积（净面积 × 长度）、C2 端面法向 vs 端点切向（抓「截面没转」的塌陷，
 * 15° 折角体积只偏 1.7% 也逃不掉；仅 occt 可评，smlib 未实现 `shapeOrientation`）、
 * C3 产物 bbox 必须覆盖脊柱。
 * @group 创建
 * @inputs 3
 * @async false
 * @qual ok
 * @name sweep
 * @note 三引擎 op，能力按引擎分级（见上）。脊柱须为 wire；截面可以是 face（全部环
 *       参与，外环扫实体、孔环 cut 出内腔）或闭合 wire。
 * @returns Shape 完整扫掠体（带孔截面产空心管实体）。
 * @param section - 等截面（实心 face / 带孔 face / 闭合 wire）。 type:Shape required:true
 * @param spine - 三维中心线 wire（直线 / 真弧 / 样条任意组合）。 type:Shape required:true
 * @param opts - 见 `SweepOptions`（策略覆写、落位、容差、严格度）。 type:SweepOptions required:false
 * @throws E_SWEEP_ENGINE_CAP 当前引擎没有该策略所需的内核能力（消息给出修法）。
 * @throws E_SPINE_DISCONTINUOUS 相邻边端点不重合。
 * @throws E_SPINE_FOLD 转角 > 175°（折返）。
 * @throws E_SPINE_DEGENERATE 零长边。
 * @throws E_SPINE_MIXED_CORNER 边类型混合且带折角（给两条修法）。
 * @throws E_SWEEP_VOLUME_MISMATCH 体积与「净截面积 × 长度」不符。
 * @throws E_SWEEP_CAP_NORMAL 端面法向与端点切向不符（截面没转；仅 occt 评）。
 * @throws E_SWEEP_BBOX_MISMATCH 产物没有覆盖整条脊柱。
 * @example
 * const path = cad.wireFromEdges([leg1, bend, leg2]) // 直线 / 真弧任意拼接
 * const tube = cad.sweep(annulusFace, path)          // 一次调用，截面自动落位
 */
export const sweep = defineOp({
  name: 'sweep',
  // 三引擎：occt 全策略；smlib 平面路径扫掠（single/segments）；brepkit 仅 single。
  // 能力差异在本文件 STRATEGIES_BY_ENGINE 判定，并在扫掠前拒绝不支持的组合。
  engines: ['occt', 'brepkit', 'smlib'],
  brep(section: Shape, spine: Shape, opts?: SweepOptions) {
    return sweepBrep(section, spine, opts)
  },
  naming: { kind: 'unmodeled', reason: 'swept-body face vocabulary not defined' } as Provenance,

  paramDims: {},
})
