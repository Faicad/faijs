/**
 * api solid-offset — 实体与偏置族（S4 剩余：draftPrism / pipe，平台 op engines:['occt']）
 *
 * @platform occt — 本目录 import occt-kernel：`draftPrism`（拔模棱柱）与 `pipe`
 * （沿脊柱的管）直调 occt 原生（occt-wasm 原生有）。这两个原生方法**不在** L1 契约
 * `BrepEngineApi` 里（L1 只有 `offset` / `sweepPipeShell` 等，见
 * brep/engine/primitives.ts）⇒ 平台 op：defineOp 声明 `engines: ['occt']`（D11）。
 *
 * 方案落点：docs/plans/2026-10-07-occt-wasm-op-enablement-plan.md §3.4.4
 * （该族 5 项中 `offsetWire2d` / `buildSolidFromFaces` / `halfSpace` 已由 S3 落地）。
 * 与既有 op 的边界（§4.5 去重表）：
 * - `pipe` vs `sweep`：pipe = `BRepOffsetAPI_MakePipe`（沿脊柱的管，单截面裸管线）；
 *   sweep = `sweepPipeShell` / `simplePipe`（截面扫掠，带 Frenet/平滑选项）；
 * - `draftPrism` vs `extrude`：前者带拔模角（上下截面渐变），后者平行拔出；
 * - `draftPrism` vs `draft`：draft 对已有实体面加拔模斜度；draftPrism 是拔模挤出。
 *
 * 角度约定（实测钉住，见 test/api/occt-s4-solid-offset.test.ts）：occt 原生
 * `draftPrism` 的形参名即 `angleDeg`（**度**，facade 内部自行换算弧度）——脚本面
 * 直传度，不做二次换算。
 */

import type { Shape } from '../../mesh/types'
import type { BrepHandle } from '../../brep/engine/types'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { brepOf, fromBrep } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { getOcctKernel } from '../../occt-kernel/occtKernel'
import { areaOfProfileFace, areaOfProfileWire, assertSweepResult, assertSweptVolumeMatches } from '../internal/sweep-guard'
import { toProfileRingsView } from '../internal/profile-wire'
import type { WireView } from '../internal/profile-wire'
import { analyzeSpine, analyzeSpineEdges, describeSpine } from '../internal/spine-analysis'
import type { SpineFacts } from '../internal/spine-analysis'
import { selectStrategy } from '../internal/sweep-strategy'
import {
  bboxCenter,
  isPlaced,
  sectionIsOnPath,
  sectionNormal,
  sectionPlacementMatrix,
  sectionRadius,
} from '../internal/section-placement'
import { OpError, unwrapResult } from '../internal/result-unwrap'
import { sweepBrep as coreSweep } from '../brep-operations/sweepFns'

type Vec3 = [number, number, number]

/** 输入 Shape → 内核句柄（无 BREP 槽报错）。判空用 undefined 比较：句柄可为 0。 */
function handleOf(shape: Shape, op: string, which: string): BrepHandle {
  const h = brepOf(shape) as BrepHandle | undefined
  if (h === undefined) {
    throw new Error(`E_${op.toUpperCase()}_NO_BREP: ${op} requires a BREP handle for ${which} (mesh-only shape has none)`)
  }
  return h
}

// ─────────────────────────────────────────────────────────────────────────────
// draftPrism — 拔模棱柱（带角度挤出）
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 draftPrism（angleDeg 度，原生内部换算弧度）。 */
function draftPrismBrep(base: Shape, direction: Vec3, angleDeg: number): Shape {
  if (!base) {
    throw new Error('E_DRAFTPRISM_NO_BASE: draftPrism requires a planar base (face or wire)')
  }
  if (
    !Array.isArray(direction) ||
    direction.length !== 3 ||
    direction.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
    (direction[0] === 0 && direction[1] === 0 && direction[2] === 0)
  ) {
    throw new Error('E_DRAFTPRISM_BAD_DIRECTION: direction must be a non-zero [dx,dy,dz]')
  }
  if (typeof angleDeg !== 'number' || !Number.isFinite(angleDeg)) {
    throw new Error('E_DRAFTPRISM_BAD_ANGLE: angleDeg must be a finite number (degrees)')
  }
  const bh = handleOf(base, 'draftPrism', 'base shape')
  const handle = getOcctKernel().draftPrism(
    bh as never, direction[0], direction[1], direction[2], angleDeg,
  ) as unknown as BrepHandle
  return fromBrep(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 拔模棱柱：把平面基底（face 或 wire）沿方向挤出，并施加拔模角（上下截面渐变）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name draftPrism
 * @note 平台 op：仅 occt 引擎（原生 draftPrism，形参即 angleDeg——角度单位是**度**，
 *       原生内部换算）。角度为 0 时等价普通挤出。
 * @returns Shape 拔模挤出体。
 * @param base - 平面基底（face 或闭合 wire）。type:Shape required:true
 * @param direction - 挤出方向 [dx,dy,dz]（非零；长度即挤出距离）。type:Vec3 required:true
 * @param angleDeg - 拔模角（度）。type:number required:true
 * @example
 * const s = cad.draftPrism(squareFace, [0, 0, 10], 5)
 */
export const draftPrism = defineOp({
  name: 'draftPrism',
  paramDims: { direction: 'length', angleDeg: 'angle' },
  brep(base: Shape, direction: Vec3, angleDeg: number) {
    return draftPrismBrep(base, direction, angleDeg)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'tapered prism face vocabulary not defined',
  } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// pipe — 沿脊柱的管（BRepOffsetAPI_MakePipe）
// ─────────────────────────────────────────────────────────────────────────────

/** `pipe` 选项。 */
export interface PipeOptions {
  /**
   * 本次调用的扫掠体积对账容差，`(0,1)`，缺省用进程级 5%。
   * 显式放宽只是**知情放行**，不修几何。
   */
  volumeTolerance?: number
  /** 默认 `true`；`false` 时端面法向（C2）与包围盒（C3）判据降为通知，体积（C1）仍抛。 */
  strict?: boolean
}

/** BREP 路径：occt 原生 pipe。脊柱须 wire（原生 TopoDS::Wire 转换）；截面原样透传
 *  ——**face 截面产实体，wire/edge 截面产壳**（BRepOffsetAPI_MakePipe 语义，
 *  实测钉在 test/api/occt-s4-solid-offset.test.ts A3/A4），故不做面→外环适配
 *  （那会把实体口径降级成壳）。
 *
 * 脊柱形态硬约束（2026-11-16 实测）：`MakePipe` 只在两类脊柱上给出正确几何 ——
 * 单边（任意曲线），或**同类型**多边且全 G1。其余两类会被静默扫错，所以在进入
 * 内核之前就拒绝：
 *
 * - **混合边类型**（如真弧 + 直线）：体积 = A ×(弧长 − 腿长)，腿长 ≥ 弧长时为负；
 * - **有 G0 折角**：`MakePipe` 没有过渡模式入口，内核缺省 `Transformed` 让截面只平移
 *   不旋转，两段 90° 折角只剩 1/2 体积，且产物 bbox 完全不含管半径的展开。
 *
 * 两类都指向 `cad.sweepAlong`（按脊柱事实选策略：混合走逐段、折角走斜接）。
 */
function pipeBrep(profile: Shape, spine: Shape, opts?: PipeOptions): Shape {
  if (!profile || !spine) {
    throw new Error('E_PIPE_MISSING_ARG: pipe requires a profile and a spine (wire)')
  }
  const profileHandle = handleOf(profile, 'pipe', 'profile')
  const spineHandle = handleOf(spine, 'pipe', 'spine wire')
  const kernel = getBrepApi()
  let facts: SpineFacts | undefined
  if (String(kernel.shapeType(spineHandle)).toLowerCase() === 'wire') {
    facts = analyzeSpine(kernel, spineHandle)
    if (facts.mixed || facts.corners.length > 0) {
      const kinds = [...new Set(facts.edges.map((e) => e.kind))].join(' + ')
      const why = facts.mixed
        ? `it mixes edge kinds (${kinds}): a single MakePipe sweep is measured at ` +
          `area × (arcLength − legLength) on such a spine — a straight leg is subtracted instead of added`
        : `it has ${facts.corners.length} G0 corner(s) (max ${((facts.maxTurn * 180) / Math.PI).toFixed(1)}°), ` +
          `and MakePipe has no corner-transition entry: the kernel default leaves the section ` +
          `un-rotated, so the solid is a translated slab (measured 1/2 volume for a single 90° bend)`
      throw new OpError(
        'pipe',
        'E_PIPE_SPINE_UNSUPPORTED',
        `[api/pipe] this spine cannot be swept by MakePipe: ${why} (${describeSpine(facts)}). ` +
          `Use cad.sweepAlong(section, spine) — it picks the correct strategy from the spine ` +
          `(segment-wise for mixed kinds, mitered single sweep for corners) and verifies the result. ` +
          `cad.pipe is meant for a single edge, or same-kind edges with tangent joints.`,
      )
    }
  }
  const handle = getOcctKernel().pipe(
    profileHandle as never, spineHandle as never,
  ) as unknown as BrepHandle
  // 对账：face 截面产实体（C1 有意义）；wire/edge 截面产壳，体积无意义、端面也没有，
  // 判据自动跳过 C1/C2，只留 C3（产物必须覆盖整条脊柱）。
  let profileArea: number | undefined
  try {
    if (String(kernel.shapeType(profileHandle)).toLowerCase() === 'face') {
      profileArea = areaOfProfileFace(kernel, profileHandle)
    }
  } catch {
    profileArea = undefined
  }
  // C2/C3 的前提是「截面落在路径上」（见 section-placement.sectionIsOnPath）：
  // pipe 不搬截面，截面留在原点时管整体偏移、体积仍对，此时只保留 C1。
  const onPath =
    facts !== undefined &&
    facts.edges.length > 0 &&
    sectionIsOnPath(kernel, profileHandle, profileHandle, facts.edges[0]!.start, facts.edges[0]!.tStart)
  const caps =
    !onPath || facts === undefined || facts.closed || facts.edges.length === 0
      ? undefined
      : [
          { label: 'start', point: facts.edges[0]!.start, tangent: facts.edges[0]!.tStart },
          {
            label: 'end',
            point: facts.edges[facts.edges.length - 1]!.end,
            tangent: facts.edges[facts.edges.length - 1]!.tEnd,
          },
        ]
  assertSweepResult(kernel, 'pipe', {
    result: handle,
    spine: spineHandle,
    profileArea,
    volumeTolerance: opts?.volumeTolerance,
    caps,
    coversPath: onPath,
    spineNote: facts === undefined ? undefined : describeSpine(facts),
    strict: opts?.strict,
  })
  return fromBrep(solidToShape(kernel, handle), { solid: handle })
}

/**
 * 沿脊柱扫出管：把截面沿脊柱 wire 扫掠（`BRepOffsetAPI_MakePipe` 裸管线；
 * 带过渡/方向控制的扫掠见 `sweep`）。
 *
 * 产物类型随截面类型（实测钉住，test/api/occt-s4-solid-offset.test.ts A3/A4）：
 * **截面 face → 实体；截面 wire/edge → 壳（管面，体积无意义）**。要实体管，
 * 喂面截面（如 `cad.profile` 的圆盘轮廓）。
 *
 * **脊柱形态硬约束（实测，2026-11-14）**：脊柱只能是单段直线或单段真弧。
 * 折线脊柱不报错、只静默少体积（两段 90° 折线 = 解析值 1/2；N 段密采样弧 = 2/π）。
 * face 截面产物走体积对账守卫（`E_SWEEP_VOLUME_MISMATCH`，5%）；wire 截面产壳，
 * 体积无意义，守卫自动跳过。
 *
 * ⚠️ **真弧脊柱的写法（2026-11-14 更正，同 `sweep`）**：`cad.circleArc` 产的是单条 edge，
 * 要用 `cad.wireFromEdges([arc])` 组装成 wire（该 op 已允许单边）。此前下限 2 让真弧
 * 脊柱无路可走、只能写折线——case8 的 40 点折线就是这么来的。
 * @group 创建
 * @inputs 3
 * @async false
 * @qual ok
 * @name pipe
 * @note 平台 op：仅 occt 引擎（原生 pipe，L1 契约无对应成员）。脊柱须为 wire。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。
 * @returns Shape 扫出的管（截面 face → 实体；wire/edge → 壳）。
 * @param profile - 截面（face → 实体；wire/edge → 壳）。
 *                  type:Shape required:true
 * @param spine - 脊柱 wire（**单段直线或单段真弧**）。type:Shape required:true
 * @param opts - 选项（`volumeTolerance` 可显式放宽体积对账容差）。
 *               type:PipeOptions required:false
 * @throws E_SWEEP_VOLUME_MISMATCH face 截面时扫掠体积对不上（折断在折线脊柱）。
 * @example
 * const tube = cad.pipe(diskFace, spineWire)
 */
export const pipe = defineOp({
  name: 'pipe',
  brep(profile: Shape, spine: Shape, opts?: PipeOptions) {
    return pipeBrep(profile, spine, opts)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'pipe face vocabulary not defined',
  } as Provenance,

  paramDims: {},
})

// ─────────────────────────────────────────────────────────────────────────────
// sweepAlong — 等截面沿任意三维中心线扫成（可空心）的管
// ─────────────────────────────────────────────────────────────────────────────

/** `sweepAlong` 选项。 */
export interface SweepAlongOptions {
  /**
   * 策略覆写。默认 `'auto'`（由脊柱事实决定，见 `internal/sweep-strategy.ts`）：
   * - `single`：单边 / 同类型多边全 G1 → 内核一次扫（精确）；
   * - `miter`：全 G0 折角 → 一次扫 + 斜接过渡（实测 0.9936–0.9996）；
   * - `segments`：混合边类型全 G1 → 逐段扫 + 共面接缝 fuse（精确）。
   *
   * 覆写不能绕过物理上无解的脊柱（断裂 / 折返 / 退化 / 混合+G0 一律先拒）。
   */
  strategy?: 'auto' | 'single' | 'miter' | 'segments' | 'closed'
  /**
   * 扫掠前把截面搬到脊柱起点、法向对准起点切向。默认 `true`。
   *
   * 已经落位（截面中心在起点且法向与切向夹角 < 1°）时**不动**，避免二次变换引入误差。
   */
  autoPlace?: boolean
  /** 截面朝向模式（默认 `'frenet'`；`single` / `miter` 生效）。 */
  orientation?: 'frenet' | 'fixed' | 'fixedUp'
  /** 转角过渡（默认 `'rightCorner'`）；显式 `'transformed'` 可回到「平移塌陷」旧行为。 */
  transitionMode?: 'rightCorner' | 'roundCorner' | 'transformed'
  /**
   * 本次调用的体积对账容差，`(0,1)`，缺省用进程级 5%。
   * 显式放宽只是**知情放行**，不修几何。
   */
  volumeTolerance?: number
  /** 默认 `true`；`false` 时端面法向（C2）与包围盒（C3）判据降为通知，体积（C1）仍抛。 */
  strict?: boolean
}

/**
 * 一次内核扫掠（单环或多环）：每个环各自扫成实体，孔环用 `cut` 减掉。
 *
 * 为什么逐环：内核 `MakePipe` / `MakePipeShell` 只吃一个截面句柄，带孔 face 的孔环
 * 会被整段忽略（`toProfileWireView` 时代的内腔丢失就是这么来的）。
 *
 * @returns 扫出的实体句柄（调用方负责 release）。
 */
function sweepRingsOnce(
  api: ReturnType<typeof getBrepApi>,
  rings: WireView[],
  spineWire: BrepHandle,
  matrix: number[] | undefined,
  opts: { orientation: string; transitionMode?: string; volumeTolerance?: number },
): BrepHandle {
  const profile: BrepHandle[] = []
  const swept: BrepHandle[] = []
  try {
    for (const ring of rings) {
      const h = matrix === undefined ? ring.wrapped : api.transform(ring.wrapped, matrix)
      profile.push(h)
      // 单环判据先按本环的面积判一次：孔环扫出 0 体积时，净面积判据区分不出是哪一环。
      const area = areaOfProfileWire(api, h)
      const query: Record<string, unknown> = { orientation: opts.orientation }
      if (opts.transitionMode !== undefined) query['transitionMode'] = opts.transitionMode
      const s = coreSweep(h, spineWire, query, false)
      const out = unwrapResult(s, 'sweepAlong') as BrepHandle
      swept.push(out)
      assertSweptVolumeMatches(api, 'sweepAlong', area, spineWire, out, opts.volumeTolerance)
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
    for (const h of profile) {
      if (matrix !== undefined) {
        try { api.release(h) } catch { /* 已释放 */ }
      }
    }
  }
}

/** BREP 路径：按策略执行（single / miter / segments），每步都过判据套件。 */
function sweepAlongBrep(section: Shape, spine: Shape, opts?: SweepAlongOptions): Shape {
  if (!section || !spine) {
    throw new Error('E_SWEEP_ALONG_MISSING_ARG: sweepAlong requires a section and a spine (wire)')
  }
  const api = getBrepApi()
  const sectionHandle = handleOf(section, 'sweepAlong', 'section')
  const spineHandle = handleOf(spine, 'sweepAlong', 'spine wire')
  if (String(api.shapeType(spineHandle)).toLowerCase() !== 'wire') {
    throw new Error('E_SWEEP_ALONG_SPINE_NOT_WIRE: sweepAlong spine must be a wire (the centreline path)')
  }

  const edgeHandles = api.getSubShapes(spineHandle, 'edge')
  const rings = toProfileRingsView(section)
  try {
    const facts = analyzeSpineEdges(api, edgeHandles)
    const radius = sectionRadius(api, sectionHandle)
    const decision = selectStrategy(facts, { strategy: opts?.strategy, sectionRadius: radius })
    if ('reject' in decision) {
      throw new OpError('sweepAlong', decision.reject.code, decision.reject.message)
    }
    const strategy = decision.strategy
    const first = facts.edges[0]!
    const last = facts.edges[facts.edges.length - 1]!
    const netArea = areaOfProfileFace(api, sectionHandle) ?? areaOfProfileWire(api, rings[0]!.wrapped)
    const caps =
      strategy === 'closed'
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
      // 逐段：起点 + 起点切向摆正截面 → 单段 pipe（MakePipe）→ 共面接缝 fuse。
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
          seg = sweepRingsOnce(api, rings, segWire, matrix, {
            orientation: 'frenet',
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
        throw new Error('E_SWEEP_ALONG_NO_EDGES: sweepAlong spine has no edges')
      }
      solid = acc
    } else {
      // single / miter / closed：一次内核扫掠（frenet + 落位 + 折角过渡）。
      // closed 没有端面 ⇒ 判据层跳过 C2（caps 置空），靠 C1 + C3。
      const matrix =
        normal === undefined || center === undefined
          ? undefined
          : isPlaced(normal, center, first.start, first.tStart, radius * 2)
            ? undefined
            : sectionPlacementMatrix(normal, center, first.start, first.tStart)
      solid = sweepRingsOnce(api, rings, spineHandle, matrix, {
        orientation: opts?.orientation ?? 'frenet',
        transitionMode: opts?.transitionMode ?? (strategy === 'miter' ? 'rightCorner' : undefined),
        volumeTolerance: opts?.volumeTolerance,
      })
    }

    try {
      assertSweepResult(api, 'sweepAlong', {
        result: solid,
        spine: spineHandle,
        profileArea: netArea,
        volumeTolerance: opts?.volumeTolerance,
        caps,
        coversPath: true,
        spineNote: describeSpine(facts),
        strict: opts?.strict,
      })
      return fromBrep(solidToShape(api, solid), { solid })
    } catch (e) {
      try { api.release(solid) } catch { /* 已释放 */ }
      throw e
    }
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
 * 沿任意三维中心线扫出等截面（可带孔）的管：按脊柱事实自动选策略，一次调用得到
 * 解析体积的实体。
 *
 * 三条策略（`internal/sweep-strategy.ts`，全部实测）：
 * - `single`——单边 / 同类型多边全 G1：内核一次扫，精确；
 * - `miter`——有 G0 折角：一次扫 + `rightCorner` 斜接，0.9936（4 拐角）/ 0.9996（16 拐角）；
 * - `segments`——混合边类型（弧 + 直腿）全 G1：逐段扫 + 共面接缝 fuse，精确。
 *
 * 逐段 union 在折角上只有 0.88–0.90（接缝留 V 形缺口），所以折角必须走斜接，不能
 * 沿用「逐段并一块」。
 *
 * 无解脊柱显式拒绝（带修法）：断裂 `E_SPINE_DISCONTINUOUS`、折返 `E_SPINE_FOLD`、
 * 零长边 `E_SPINE_DEGENERATE`、混合 + 折角 `E_SPINE_MIXED_CORNER`、斜接必自交
 * `E_SPINE_MITER_SELF_INTERSECT`、闭合 `E_SPINE_CLOSED_UNSUPPORTED`。
 *
 * 判据：C1 体积（面积 × 长度）、C2 端面法向 vs 端点切向（抓「截面没转」的塌陷，
 * 15° 折角体积只偏 1.7% 也逃不掉）、C3 产物 bbox 必须覆盖脊柱。
 * @group 创建
 * @inputs 3
 * @async false
 * @qual ok
 * @name sweepAlong
 * @note 平台 op：仅 occt 引擎。脊柱须为 wire；截面可以是 face（全部环参与，外环扫
 *       实体、孔环 cut 出内腔）或闭合 wire。
 * @returns Shape 完整扫掠体（带孔截面产空心管实体）。
 * @param section - 等截面（实心 face / 带孔 face / 闭合 wire）。 type:Shape required:true
 * @param spine - 三维中心线 wire（直线 / 真弧 / 样条任意组合）。 type:Shape required:true
 * @param opts - 见 `SweepAlongOptions`（策略覆写、落位、过渡、容差、严格度）。
 *               type:SweepAlongOptions required:false
 * @throws E_SPINE_DISCONTINUOUS 相邻边端点不重合。
 * @throws E_SPINE_FOLD 转角 > 175°（折返）。
 * @throws E_SPINE_DEGENERATE 零长边。
 * @throws E_SPINE_MIXED_CORNER 边类型混合且带折角（给两条修法）。
 * @throws E_SPINE_CLOSED_UNSUPPORTED 闭合中心线。
 * @throws E_SWEEP_VOLUME_MISMATCH 体积与「截面积 × 长度」不符。
 * @throws E_SWEEP_CAP_NORMAL 端面法向与端点切向不符（截面没转）。
 * @throws E_SWEEP_BBOX_MISMATCH 产物没有覆盖整条脊柱。
 * @example
 * const path = cad.wireFromEdges([leg1, bend, leg2]) // 直线 / 真弧任意拼接
 * const tube = cad.sweepAlong(annulusFace, path)      // 一次调用，截面自动落位
 */
export const sweepAlong = defineOp({
  name: 'sweepAlong',
  brep(section: Shape, spine: Shape, opts?: SweepAlongOptions) {
    return sweepAlongBrep(section, spine, opts)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'sweepAlong swept-body face vocabulary not defined',
  } as Provenance,

  paramDims: {},
})
