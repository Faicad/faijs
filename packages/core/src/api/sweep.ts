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
 * | occt | ✔ | ✔（内核 `rightCorner`） | ✔（逐段；含 G0 折角时按角平分面裁成斜接） | ✔ | ✔ |
 * | smlib | ✔ | ✔（平面折角走内核；空间折角走**策略层自补斜接**） | ✔（混合边全 G1；**混合边 + 折角**因布尔限制拒绝） | ✔ | ✔ |
 * | brepkit | ✔ | ✘ | ✘ | ✘ | ✘（旧引擎，保留 single 只为历史脚本） |
 *
 * 实测数字（4×4 截面，`cad.sweep` 脚本级 / 内核级，2026-11-16）：
 * - occt：直线 25 → 400；折角 L 形（长 20）miter → 320；**空间**折角（长 30）→ 480；
 *   闭合圆 r=10 → 1005.31；带孔截面（8/4）→ 3015.93（= 净面积 × 20）；真弧脊柱 → 251.33；
 *   **混合边 + G0 折角**（弧尾 90° 折直腿）→ 411.33 × **1.0046**（残差来自"弧段沿端点
 *   切向的直段延伸"，O(δ²/2R)，见表下注）；强制 `segments` 走 16 段折线 → 0.9996。
 * - smlib：直线 400 / autoPlace 搬 90mm → 800 / 共线多边 400 / 带孔 3015.93 /
 *   **平面**折角 320（内核自己就斜接）/ **空间**折角 480（策略层自补，与 occt 同值）/
 *   真弧脊柱 251.33 / 混合边 G1（弧+直腿）411.33；闭合圆 → 1005.31；
 *   混合边 + 折角 → `E_SWEEP_ENGINE_CAP`（曲面段被 `splitByPlane` 切后读出 V=0，
 *   `fuse` 直接报 `smw_fuse: boolean failed`）。
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
 *   直接给精确斜接；**空间** G0 折角内核吐 V=0、非流形的碎片（P0i），因此在策略层自补：
 *   逐段过量延伸 + 角平分面裁剪 + `fuse`（P0k：平面 320.000 / 空间 319.988，脚本级
 *   空间折角 480.000 与 occt 同值）。它的另一个边界是「带孔 face 的孔环」（只取外环 ⇒
 *   op 层必须逐环扫 + `cut`）；
 * - brepkit：剖面 face + 路径整链拟合成一条 NURBS + `sweepWithOptions('rmf','smooth')`，
 *   折角被**光滑掉**（不是斜接）；`shapeType` 不区分 wire（一律 COMPOUND）⇒ 脊柱判据
 *   必须用**结构**判（有边、无面），不能按类型字符串判。
 *
 * 不支持的组合在**扫掠之前**拒绝（`E_SWEEP_ENGINE_CAP`），消息给出该引擎缺的是哪个
 * 内核能力与可执行修法 —— 绝不静默降级成另一条策略（朴素「逐段扫 + 直接 fuse」会在 G0
 * 接缝留下「重叠被吞 + 外侧无斜接补料」的错件，4×4/90° 实测 304 而精确值 320，刚好压在
 * C1 的 5% 容差界上 —— 所以转角要么内核给，要么按 P0k 的配方在策略层造）。
 *
 * 注：**曲面段**（弧 / 样条）的过量延伸只能沿端点切向接一小段直线（真要沿同一圆续下去得
 * 重建圆弧，本文件不这么做），误差 O(δ²/2R) —— 4×4 截面、R10 弧、90° 折角实测 **+0.46%**
 * （411.33 → 413.22）。纯直线脊柱没有这个残差（16 段折线 0.9996 的残差来自折线对弧本身的
 * 近似，与延伸无关）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getBrepApi } from '../brep/handle-bridge'
import { getActiveBrepEngineId } from '../brep/engine/registry'
import type { BrepHandle, BrepVec3 } from '../brep/engine/types'
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
import { analyzeSpineEdges, describeSpine, unit } from './internal/spine-analysis'
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
   * - `miter`：全 G0 折角 → 斜接（occt 一次扫掠 + `rightCorner`，实测 0.9936–0.9996；
   *   smlib 无过渡入口，走「逐段过量延伸 + 角平分面裁剪 + fuse」自补，实测 480.000 同值）；
   * - `segments`：逐段扫（内核一次扫在混合链上符号错）。全 G1 时接缝是共面端面直接 fuse；
   *   有 G0 折角时每个折角按角平分面裁出斜接（`smlib` 的曲面段做不到，见引擎表）。
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
  // 折角改由执行器自补斜接，实测 480）、segments（逐段扫 + fuse，实测 411.327 = 两段和）、
  // closed（闭合圆 1005.31）。
  smlib: ['single', 'miter', 'segments', 'closed'],
  // 旧引擎，保留 single 只为历史脚本；折角在 brepkit 上被光滑掉，不是斜接。
  brepkit: ['single'],
}

/** 各引擎缺的关键内核能力（只用于拒绝消息，让「为什么不行」可行动）。 */
const ENGINE_GAP: Record<string, string> = {
  smlib:
    'smlib exposes only SmApiCreateSweepAlongPlanarPath: it has no native corner transition (a spatial ' +
    'G0 corner fed to the kernel yields V=0 and a non-manifold body), so `sweep` builds the miter ' +
    'itself by per-segment over-extension + bisector trim + fuse; it also has no guide / law / support ' +
    'control surface',
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
 * - **occt** 的 `miter` / `closed`：`sweepFull` 的 `transitionMode`；闭合脊柱一次成形。
 * - 其余（`single` / `segments` 的单段 / 非 occt 的 `miter` 单段）：走 L1 中立名
 *   `BrepEngineApi#sweep`，occt = `sweepPipeShell(f,sp,false,false)`、smlib = 平面路径扫掠、
 *   brepkit = RMF 扫掠。**不用 occt 专属面**是让三引擎跑同一条代码路径的唯一办法。
 *   非 occt 的 `miter` 到这里的只是**单段**（转角由 `sweepWithBuiltJoints` 自己造）。
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

// ── 策略层自补斜接（smlib 没有 transitionMode 时的转角过渡）────────────────────────

function dot3(a: BrepVec3, b: BrepVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function sub3(a: BrepVec3, b: BrepVec3): BrepVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function add3(a: BrepVec3, b: BrepVec3, k: number): BrepVec3 {
  return { x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k }
}

/** 一个 G0 折角的斜接几何：角平分面 + 每段在这端要过量延伸的长度。 */
interface JointPlan {
  /** 折角后面那条边的下标（`facts.corners[i].index`）。 */
  index: number
  point: BrepVec3
  /** 角平分面法向 = 两条单位切向之和的单位化。 */
  normal: BrepVec3
  turn: number
  /** 每段在转角端沿自身切向多伸的长度。必须 > `extent`，否则切不过斜接面。 */
  delta: number
  /** 斜接面在段轴上截出的距离 = 半宽 × tan(θ/2)。 */
  extent: number
}

/**
 * 把 G0 折角排成「斜接计划」：每个折角给出角平分面与延伸量。
 *
 * `extent = 半宽 × tan(θ/2)` 是斜接面沿段轴到折点的距离（截面最外点刚好落在斜接面上
 * 的位置）。延伸量取 `1.05×extent`：必须**略大于** extent 才能让 `splitByPlane`
 * 真的把实体切成两半（smlib 的 splitByPlane 在"只擦过"时会拒绝），多给的部分会被
 * 斜接面切掉，所以过量无害。
 *
 * @param facts - 脊柱事实。
 * @param radius - 截面 bbox 最长边的一半（外接半径，保守覆盖任何方向上的半宽）。
 * @returns 每个折角的计划；折角太密（延伸会穿越相邻折点）时抛
 *          `E_SPINE_MITER_SELF_INTERSECT`，不静默产残件。
 */
function planMiterJoints(facts: SpineFacts, radius: number): JointPlan[] {
  const plans: JointPlan[] = []
  for (const c of facts.corners) {
    const prev = facts.edges[c.index - 1]
    const next = facts.edges[c.index]
    // 闭合收尾折角（index === edges.length）走 `closed` 策略，不在这里处理。
    if (!prev || !next) continue
    const normal = unit({
      x: prev.tEnd.x + next.tStart.x,
      y: prev.tEnd.y + next.tStart.y,
      z: prev.tEnd.z + next.tStart.z,
    })
    if (Math.hypot(normal.x, normal.y, normal.z) < 1e-9) continue // 180° 折返：策略层已拒
    const extent = radius * Math.tan(Math.min(c.turn, Math.PI - 1e-3) / 2)
    // 延伸不能越过相邻段的另一端（否则切完会戳到上一个拐角之外）。0.98 留出顶点合并余量。
    const cap = Math.min(prev.length, next.length) * 0.98
    const delta = Math.min(extent * 1.05, cap)
    if (!(delta > extent)) {
      throw new OpError(
        'sweep',
        'E_SPINE_MITER_SELF_INTERSECT',
        `[api/sweep] miter at corner ${c.index} needs ${(extent * 1.05).toFixed(3)} of run-out but the ` +
          `adjacent segment is only ${Math.min(prev.length, next.length).toFixed(3)} long — the miter ` +
          `plane falls outside the segment, so the corner cannot be built by trimming. Enlarge the ` +
          `segment spacing, use a smaller section, or replace the corner with a true tangent arc.`,
      )
    }
    plans.push({ index: c.index, point: c.point, normal, turn: c.turn, delta, extent })
  }
  return plans
}

/**
 * 逐段扫 + 转角处按角平分面裁剪 + `fuse`：**在策略层自己把斜接造出来**。
 *
 * 为什么需要（实测，`test/api/sweep-engines.test.ts` P0i / P0j / P0k）：
 * - smlib 只有 `SmApiCreateSweepAlongPlanarPath`，**空间** G0 折角喂进去得 V=0、非流形（P0i）；
 * - 朴素地「逐段扫 + 直接 fuse」得 V=304（平面） / 305.37（空间），精确值 320 —— 两段在
 *   转角处的重叠被 fuse 吞掉、外侧没有斜接补料（P0j）。体积只差 5%，正好压在 C1 默认容差
 *   界上 ⇒ 守卫兜不住，必须在几何层修；
 * - 每段在转角端过量延伸 δ、再用角平分面切掉自己那一侧、最后 fuse：平面 320.000 /
 *   空间 319.988，流形，平面情形的面数与内核自己那次 miter 完全一致（P0k）。
 *
 * 为什么对「空间」也成立：两条切向不共线时 `n = t̂_prev + t̂_next` 就唯一确定一个过折点的
 * 平面，被它切出的两个端面天然同面 —— 与转弯是否出平面无关。内核只负责「截面沿一条直线 /
 * 一段弧推走」，拐弯这段几何由本函数造。
 *
 * @returns 合并后的实体句柄（调用方负责 release）。
 */
function sweepWithBuiltJoints(
  api: Kernel,
  engineId: string,
  rings: WireView[],
  edgeHandles: BrepHandle[],
  facts: SpineFacts,
  joints: JointPlan[],
  place: { normal?: BrepVec3; center?: BrepVec3 },
  opts: { strategy: SweepStrategy; volumeTolerance?: number },
): BrepHandle {
  const byIndex = new Map<number, JointPlan>(joints.map((j) => [j.index, j]))
  const scratch: BrepHandle[] = []
  const pieces: BrepHandle[] = []
  const releaseScratch = (): void => {
    for (const h of scratch) {
      try { api.release(h) } catch { /* 已释放 */ }
    }
  }
  try {
    for (const [i, edge] of edgeHandles.entries()) {
      const ef = facts.edges[i]!
      const before = byIndex.get(i) // 折角在边 i 的起点
      const after = byIndex.get(i + 1) // 折角在边 i 的终点
      const dStart = before?.delta ?? 0
      const dEnd = after?.delta ?? 0
      const startPoint = dStart > 0 ? add3(ef.start, ef.tStart, -dStart) : ef.start
      const endPoint = dEnd > 0 ? add3(ef.end, ef.tEnd, dEnd) : ef.end

      const parts: BrepHandle[] = []
      if (ef.kind === 'line') {
        // 直线段：延伸就是延长同一条线，不必拆成「直线 + 短线」。
        const line = api.makeLineEdge(startPoint, endPoint)
        scratch.push(line)
        parts.push(line)
      } else {
        // 弧 / 样条：只能沿端点切向接一小段直线（误差 O(δ²/2R)，δ 由 extent 决定）。
        if (dStart > 0) {
          const lead = api.makeLineEdge(startPoint, ef.start)
          scratch.push(lead)
          parts.push(lead)
        }
        parts.push(edge)
        if (dEnd > 0) {
          const tail = api.makeLineEdge(ef.end, endPoint)
          scratch.push(tail)
          parts.push(tail)
        }
      }

      const wire = api.makeWire(parts)
      let piece: BrepHandle | undefined
      try {
        const matrix =
          place.normal === undefined || place.center === undefined
            ? undefined
            : sectionPlacementMatrix(place.normal, place.center, startPoint, ef.tStart)
        piece = sweepRingsOnce(api, engineId, rings, wire, matrix, {
          strategy: opts.strategy,
          volumeTolerance: opts.volumeTolerance,
        })
      } finally {
        try { api.release(wire) } catch { /* 已释放 */ }
      }

      // 转角裁剪：每段只保留自己那一侧（探针点用该段参数中点，必然落在自己一侧）。
      let cur = piece
      for (const [joint, probe] of [
        [before, ef.mid] as const,
        [after, ef.mid] as const,
      ]) {
        if (joint === undefined || cur === undefined) continue
        const cut = api.splitByPlane(cur, joint.point, joint.normal)
        const s = dot3(sub3(probe, joint.point), joint.normal)
        const keep = s < 0 ? cut.negative : cut.positive
        const drop = s < 0 ? cut.positive : cut.negative
        api.release(drop)
        api.release(cur)
        cur = keep
      }
      pieces.push(cur)
    }

    let acc = pieces[0]
    if (acc === undefined) throw new Error('E_SWEEP_NO_EDGES: sweep spine has no edges')
    for (let i = 1; i < pieces.length; i++) {
      const seg = pieces[i]!
      const fused = api.fuse(acc, seg)
      api.release(acc)
      api.release(seg)
      acc = fused
    }
    pieces.length = 0 // 已全部并入 acc / 或已释放
    return acc
  } finally {
    releaseScratch()
  }
}

/** 按策略与引擎能力解析「这一次能不能扫」——不行就给出可执行的拒绝。 */function assertEngineCan(
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
  // 平面性曾是策略之外的**引擎**约束：smlib 的转角过渡只在平面路径上成立，空间 G0 折角
  // 喂进去得 V=0、非流形（单次内核扫掠，P0i 实测）。现在**不再**在这里拒绝：执行器改走
  // 「逐段过量延伸 + 角平分面裁剪 + fuse」在策略层把斜接造出来（P0k 实测 320.000 /
  // 319.988），内核只负责单段的直线/弧推动。只有造不出来（折角太密）时才由
  // `planMiterJoints` 抛 `E_SPINE_MITER_SELF_INTERSECT`。
  // 混合边类型 + G0 折角：策略层已放行（走 `segments` + 自补斜接），但**曲面段**在 smlib 上
  // 做不到。实测（2026-11-16，弧尾 90° 折到直腿）：弧段过量延伸后 `splitByPlane` 交回的
  // 自己是空的一半（V=0），拿去 `fuse` 直接报 `smw_fuse: boolean failed`。这不是策略问题，
  // 是 smlib 布尔对"被切过的曲面扫掠体"的边界，所以在这里显式拒绝而不是产出 160 的残件。
  if (engineId === 'smlib' && facts.mixed && facts.corners.length > 0) {
    throw new OpError(
      'sweep',
      'E_SWEEP_ENGINE_CAP',
      `[api/sweep] engine 'smlib' cannot sweep a mixed-kind spine with a G0 corner ` +
        `(${describeSpine(facts)}): the corner miter is built by trimming an over-extended segment body and ` +
        `fusing it back, and for a curved segment smlib's boolean cannot do that (measured: the trimmed half ` +
        `reads V=0, then smw_fuse reports "boolean failed"). Fix: run this model on occt, or split the path ` +
        `into G1-only runs and sweep each (a true tangent arc removes the corner entirely).`,
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
    if (strategy === 'segments' || (strategy === 'miter' && engineId !== 'occt')) {
      // **唯一的「逐段」执行器**（2026-11-16 合并）：脊柱拆段 → 每段单扫 → 按折角计划
      // 裁接缝（计划可能为空）→ 依次 fuse。
      //
      // - `segments`：混合边类型（内核一次扫在混合链上会按 A×(弧长−腿长) 出错），所以必须
      //   逐段；有 G0 折角时由 `planMiterJoints` 给出每个折角的角平分面与延伸量，接缝被
      //   裁成斜接（P0k 实测平面 320.000 / 空间 319.988）；全 G1 时计划为空 ⇒ δ=0、不切，
      //   退化成「逐段扫 + 共面 fuse」，与原 `segments` 行为逐位等价。
      // - `miter`（非 occt）：引擎没有 transitionMode（smlib 只有平面路径扫掠），
      //   同样用这个执行器把斜接造出来。occt 上 `miter` 仍走内核 `rightCorner`（更便宜、
      //   面数更少、已实测精确）。
      const joints = planMiterJoints(facts, radius)
      solid = sweepWithBuiltJoints(api, engineId, rings, edgeHandles, facts, joints, { normal, center }, {
        strategy,
        volumeTolerance: opts?.volumeTolerance,
      })
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
 * 逐段直接 union 在折角上是错的（4×4/90° 实测 304，精确 320 —— 转角重叠被 fuse 吞掉、
 * 外侧没有斜接补料，而且只差 5% 刚好压在 C1 容差界上），所以折角要么由内核给斜接，
 * 要么按「逐段过量延伸 + 角平分面裁剪 + fuse」在策略层造（smlib 走这条）。
 *
 * **引擎能力**（不支持的组合在扫掠前拒绝，`E_SWEEP_ENGINE_CAP`）：
 * occt 全策略；smlib `single` / `miter`（平面折角内核给、空间折角策略层自补）/ `segments` /
 * `closed`；brepkit 只 `single`（旧引擎，折角被 RMF 光滑掉）。
 *
 * 无解脊柱显式拒绝（带修法）：断裂 `E_SPINE_DISCONTINUOUS`、折返 `E_SPINE_FOLD`、
 * 零长边 `E_SPINE_DEGENERATE`、混合 + 折角 `E_SPINE_MIXED_CORNER`、斜接必自交
 * `E_SPINE_MITER_SELF_INTERSECT`（含「延伸会越过相邻折点」这种造不出来的折角）。
 *
 * 判据：C1 体积（净面积 × 长度）、C2 端面法向 vs 端点切向（抓「截面没转」的塌陷，
 * 15° 折角体积只偏 1.7% 也逃不掉；occt + smlib 可评，|dot| 判据不依赖 shapeOrientation）、
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
 * @throws E_SPINE_MIXED_CORNER（已废弃）—— 混合边 + G0 折角现在能扫（`segments` + 自补斜接），
 *         occt 上实测 +0.46%；smlib 上因布尔限制改为 `E_SWEEP_ENGINE_CAP`。
 * @throws E_SPINE_MITER_SELF_INTERSECT 折角太密：斜接所需的延伸会越过相邻折点，造不出来。
 * @throws E_SWEEP_VOLUME_MISMATCH 体积与「净截面积 × 长度」不符。
 * @throws E_SWEEP_CAP_NORMAL 端面法向与端点切向不符（截面没转；occt + smlib 评）。
 * @throws E_SWEEP_BBOX_MISMATCH 产物没有覆盖整条脊柱。
 * @example
 * const path = cad.wireFromEdges([leg1, bend, leg2]) // 直线 / 真弧任意拼接
 * const tube = cad.sweep(annulusFace, path)          // 一次调用，截面自动落位
 */
export const sweep = defineOp({
  name: 'sweep',
  // 三引擎：occt 全策略；smlib 四策略全开（空间 G0 折角的斜接由执行器自补）；brepkit 仅 single。
  // 能力差异在本文件 STRATEGIES_BY_ENGINE 判定，并在扫掠前拒绝不支持的组合。
  engines: ['occt', 'brepkit', 'smlib'],
  brep(section: Shape, spine: Shape, opts?: SweepOptions) {
    return sweepBrep(section, spine, opts)
  },
  naming: { kind: 'unmodeled', reason: 'swept-body face vocabulary not defined' } as Provenance,

  paramDims: {},
})
