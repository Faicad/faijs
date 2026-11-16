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
import type { BrepHandle, BrepVec3 } from '../../brep/engine/types'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { brepOf, fromBrep } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { getOcctKernel } from '../../occt-kernel/occtKernel'
import { areaOfProfileFace, assertSweptVolumeMatches } from '../internal/sweep-guard'
import { toProfileRingsView } from '../internal/profile-wire'

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
}

/** BREP 路径：occt 原生 pipe。脊柱须 wire（原生 TopoDS::Wire 转换）；截面原样透传
 *  ——**face 截面产实体，wire/edge 截面产壳**（BRepOffsetAPI_MakePipe 语义，
 *  实测钉在 test/api/occt-s4-solid-offset.test.ts A3/A4），故不做面→外环适配
 *  （那会把实体口径降级成壳）。 */
function pipeBrep(profile: Shape, spine: Shape, opts?: PipeOptions): Shape {
  if (!profile || !spine) {
    throw new Error('E_PIPE_MISSING_ARG: pipe requires a profile and a spine (wire)')
  }
  const profileHandle = handleOf(profile, 'pipe', 'profile')
  const spineHandle = handleOf(spine, 'pipe', 'spine wire')
  const kernel = getBrepApi()
  const handle = getOcctKernel().pipe(
    profileHandle as never, spineHandle as never,
  ) as unknown as BrepHandle
  // 体积对账：只对 **face 截面**（→实体）判。wire/edge 截面产壳，体积无意义，
  // 必须跳过（A4 已钉住这个产物类型差异）。折线脊柱的实测偏差见 internal/sweep-guard.ts。
  let profileArea: number | undefined
  try {
    if (String(kernel.shapeType(profileHandle)).toLowerCase() === 'face') {
      profileArea = areaOfProfileFace(kernel, profileHandle)
    }
  } catch {
    profileArea = undefined
  }
  assertSweptVolumeMatches(kernel, 'pipe', profileArea, spineHandle, handle, opts?.volumeTolerance)
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
// pipeAlong — 等截面沿多段中心线扫成（空心）管
// ─────────────────────────────────────────────────────────────────────────────

/** `pipeAlong` 选项。 */
export interface PipeAlongOptions {
  /** 保留：闭合中心线。当前不支持，传入 true 报 `E_PIPE_ALONG_CLOSED_UNSUPPORTED`。 */
  closed?: boolean
  /**
   * 本次调用的扫掠体积对账容差，`(0,1)`，缺省用进程级 5%。
   * 显式放宽只是**知情放行**，不修几何。
   */
  volumeTolerance?: number
}

function unit3(v: BrepVec3): BrepVec3 {
  const l = Math.hypot(v.x, v.y, v.z)
  return l < 1e-12 ? { x: 0, y: 0, z: 1 } : { x: v.x / l, y: v.y / l, z: v.z / l }
}

function cross3(a: BrepVec3, b: BrepVec3): BrepVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

/**
 * 12 元行主序仿射矩阵：把截面局部坐标系（XY 平面、+Z 法向）搬到
 * 「过 p、法向 ∥ t」的切平面，并让截面的包围盒中心落在 p 上。
 *
 * 为什么必须自己搬：内核 `MakePipe` / `MakePipeShell` **不会**把截面平移到
 * 弧脊柱的起点（实测 `withContact` / `withCorrection` 对单段真弧同样无效，
 * 见 `test/api/sweep-hollow-pipe.test.ts` F2c），截面留在原处时弧段扫出 0 体积。
 */
function sectionFrameMatrix(p: BrepVec3, t: BrepVec3, center: BrepVec3): number[] {
  const n = unit3(t)
  const helper: BrepVec3 = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const ax = unit3(cross3(helper, n))
  const ay = cross3(n, ax)
  const tx = p.x - (ax.x * center.x + ay.x * center.y + n.x * center.z)
  const ty = p.y - (ax.y * center.x + ay.y * center.y + n.y * center.z)
  const tz = p.z - (ax.z * center.x + ay.z * center.y + n.z * center.z)
  return [ax.x, ay.x, n.x, tx, ax.y, ay.y, n.y, ty, ax.z, ay.z, n.z, tz]
}

/** BREP 路径：多段中心线逐段扫掠后 union（带孔截面逐段布尔减）。 */
function pipeAlongBrep(section: Shape, spine: Shape, opts?: PipeAlongOptions): Shape {
  if (!section || !spine) {
    throw new Error('E_PIPE_ALONG_MISSING_ARG: pipeAlong requires a section and a spine (wire)')
  }
  if (opts?.closed) {
    throw new Error('E_PIPE_ALONG_CLOSED_UNSUPPORTED: closed centrelines are not supported yet')
  }
  const api = getBrepApi()
  const kernel = getOcctKernel()
  const sectionHandle = handleOf(section, 'pipeAlong', 'section')
  const spineHandle = handleOf(spine, 'pipeAlong', 'spine wire')
  if (String(api.shapeType(spineHandle)).toLowerCase() !== 'wire') {
    throw new Error('E_PIPE_ALONG_SPINE_NOT_WIRE: pipeAlong spine must be a wire (multi-segment path)')
  }
  const rings = toProfileRingsView(section)
  const edges = api.getSubShapes(spineHandle, 'edge')
  // 截面中心：让中心线穿过截面中心（Pappus 恒等式 volume = 净面积 × 段长 的前提）。
  const box = api.getBoundingBox(sectionHandle)
  const center: BrepVec3 = {
    x: (box.xmin + box.xmax) / 2,
    y: (box.ymin + box.ymax) / 2,
    z: (box.zmin + box.zmax) / 2,
  }
  const netArea = rings.length > 1 ? areaOfProfileFace(api, sectionHandle) : undefined
  let acc: BrepHandle | undefined
  try {
    if (edges.length === 0) {
      throw new Error('E_PIPE_ALONG_NO_EDGES: pipeAlong spine has no edges')
    }
    for (const edge of edges) {
      // 每段：起点 + 起点切向 → 截面搬到该处 → 单段扫掠。
      const pr = api.curveParameters(edge)
      const p0 = api.curvePointAtParam(edge, pr.first)
      const t0 = api.curveTangent(edge, pr.first)
      const matrix = sectionFrameMatrix(p0, t0, center)
      const segWire = api.makeWire([edge])
      const moved: BrepHandle[] = []
      const faces: BrepHandle[] = []
      try {
        for (const ring of rings) {
          const m = api.transform(ring.wrapped, matrix)
          moved.push(m)
          faces.push(api.makeFace(m))
        }
        let seg = kernel.pipe(faces[0]! as never, segWire as never) as unknown as BrepHandle
        assertSweptVolumeMatches(
          api, 'pipeAlong', areaOfProfileFace(api, faces[0]!), segWire, seg, opts?.volumeTolerance,
        )
        for (let i = 1; i < faces.length; i++) {
          const holeSolid = kernel.pipe(faces[i]! as never, segWire as never) as unknown as BrepHandle
          const next = api.cut(seg, holeSolid)
          api.release(seg)
          api.release(holeSolid)
          seg = next
        }
        if (netArea !== undefined) {
          assertSweptVolumeMatches(api, 'pipeAlong', netArea, segWire, seg, opts?.volumeTolerance)
        }
        if (acc === undefined) {
          acc = seg
        } else {
          const fused = api.fuse(acc, seg)
          api.release(acc)
          api.release(seg)
          acc = fused
        }
      } finally {
        for (const h of faces) {
          try { api.release(h) } catch { /* 已释放 */ }
        }
        for (const h of moved) {
          try { api.release(h) } catch { /* 已释放 */ }
        }
        try { api.release(segWire) } catch { /* 已释放 */ }
      }
    }
    if (acc === undefined) {
      throw new Error('E_PIPE_ALONG_NO_EDGES: pipeAlong spine has no edges')
    }
    return fromBrep(solidToShape(api, acc), { solid: acc })
  } finally {
    for (const e of edges) {
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
 * 沿多段中心线扫出等截面（可带孔）的管：把「拆段 + 逐段定位截面 + 逐段扫 + union」
 * 一次做完。
 *
 * 与 `pipe` 的区别：`pipe` 只吃**单段**直线 / 真弧脊柱，且截面必须已落在脊柱起点
 * （否则弧段扫出 0 体积）；`pipeAlong` 接受任意多段 wire（直线 / 真弧混合，相切或
 * 折角均可），自动把截面搬到每段起点、逐段扫掠后 union。带孔截面（如圆环）按
 * 「外环 − 孔环」扫出空心管。
 *
 * 截面的包围盒中心落在中心线上（Pappus：体积 = 净面积 × 段长）；截面应关于中心
 * 线对称（圆管 / 圆环），非对称截面在弧段上的体积对账会按 Pappus 偏离而报错。
 * @group 创建
 * @inputs 3
 * @async false
 * @qual ok
 * @name pipeAlong
 * @note 平台 op：仅 occt 引擎。脊柱须为 wire；每段按 `curveParameters` 起点切向
 *       摆放截面。闭合中心线（`opts.closed`）当前不支持。
 * @returns Shape 完整扫掠体（带孔截面产空心管固体）。
 * @param section - 等截面（实心 face / 带孔 face / 闭合 wire）。 type:Shape required:true
 * @param spine - 多段中心线 wire（直线 / 真弧任意组合）。 type:Shape required:true
 * @param opts - 选项（`closed` 保留，当前不支持；`volumeTolerance` 可显式放宽体积对账容差）。
 *               type:PipeAlongOptions required:false
 * @throws E_SWEEP_VOLUME_MISMATCH 某段扫掠体积与「截面积 × 段长」不符。
 * @example
 * const tube = cad.pipeAlong(annulusFace, cad.wireFromEdges([leg, bend, leg2]))
 */
export const pipeAlong = defineOp({
  name: 'pipeAlong',
  brep(section: Shape, spine: Shape, opts?: PipeAlongOptions) {
    return pipeAlongBrep(section, spine, opts)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'pipeAlong swept-body face vocabulary not defined',
  } as Provenance,

  paramDims: {},
})
