/**
 * api/assembly/solvers/global-solver — 纯 TS global 装配求解器（P1）
 *
 * 复刻 CadQuery `cadquery/occ_impl/solver.py` 的**语义**（全局 NLP、模长参数化旋转、
 * 9 类代价、Axis 缺省反平行、Plane=Axis(π)+Point(0)、包围盒对角长缩放），
 * 以 Levenberg-Marquardt 替代 IPOPT，**零原生/WASM 依赖**（裁定 1–6，详见
 * `docs/plans/2026-09-08-assembly-dual-solver.md`）。
 *
 * 关键裁定（写进代码，不在别处手算）：
 * - 裁定 1/2：faijs Shape 不携带 placement → 初值 T0=R0=0，world 系==本地系；
 *   两侧 marker 经 `resolveFaceGeometryOfRef`/`resolveSolverEntity` 直接取本地系，无不对称。
 * - 裁定 3：残差取 CQ 代价的「平方前内层量」（非对代价开方）。
 * - 裁定 4：线性求解自实现（linalg.ts）。
 * - 裁定 5：旋转 pivot 恒 [0,0,0]（CQ 的 Rotate(v,R)+T 绕世界原点）。
 * - 裁定 6：锚定用 CQ B4（assembly.py:455-490）：Fixed / name==self.name 锁定；
 *   否则第一个不在 unary 里的 binary object；否则实体 0。锁定成员冻结为 identity。
 *
 * 失败模式（§4.6）：唯一抛错路径 = 约束类型无法映射为代价；其余以 warnings 透明化，
 * 不抛错（LM 终止即 converged=true）。
 */

import type { Shape } from '../../../mesh/types'
import type { BrepEngineApi } from '../../../brep/engine/primitives'
import { getBackends } from '../../../runtime-state'
import type { AssemblyTransform } from '../../../runtime-state'
import type { AssemblyConstraint, EntityRef } from '../types'
import { normalizeConstraint } from '../normalize'
import { poseToAssemblyTransform, type SolverPose } from '../pose'
import {
  resolveFaceGeometryOfRef,
  resolveSolverEntity,
  type EntityResolutionEnv,
} from '../entities'
import { type SolveOptions, type GlobalMarker, type GlobalSolveResult } from './types'
import {
  type Vec3,
  vadd,
  vsub,
  vdot,
  vscale,
  vnormalize,
  vsumsqr,
  ata,
  atb,
  solveDampedNormal,
} from './linalg'
import { rotateByR, quatFromR } from './pose-from-delta'

const DEG2RAD = Math.PI / 180
const R_INIT = 1e-2 // B3
const LM_LAMBDA0 = 1e-3
const LM_MAXITER = 2000
const LM_TOL_OBJ = 1e-12
const LM_TOL_STEP = 1e-10
const PENALTY = 1e-16 // B1，等价 sqrt = 1e-8
const RESIDUAL_WARN = 1e-6 // §4.6 阈值系数

type CostFn = 'point' | 'axis' | 'point_in_plane' | 'point_on_line'

interface CostTerm {
  cid: number
  fn: CostFn
  /** 点侧成员下标（point_in_plane/point_on_line 的点；axis 的 dir 侧）。 */
  ia: number
  ma: GlobalMarker
  /** 平面/线侧成员下标（point_in_plane/point_on_line 的平面/线；axis 的 dir 侧）。 */
  ib: number
  mb: GlobalMarker
  /** point=距离(mm)；axis=夹角(rad)；point_in_plane/point_on_line=val。 */
  val: number
  /** 是否除以 scale（CQ scaling 字典：point 类 true，axis 类 false）。 */
  scaleFlag: boolean
}

/** 把一条 EntityRef 解析为本地系 GlobalMarker（无坐标系不对称）。 */
function resolveMarker(ref: EntityRef, env: EntityResolutionEnv): GlobalMarker {
  if ('point' in ref) {
    return { type: 'point', p: [ref.point[0], ref.point[1], ref.point[2]] }
  }
  if ('face' in ref) {
    const geom = resolveFaceGeometryOfRef(ref, env)
    const normal = vnormalize([geom.normal[0], geom.normal[1], geom.normal[2]])
    return {
      type: 'plane',
      center: [geom.center[0], geom.center[1], geom.center[2]],
      normal,
    }
  }
  // edge / faceIndex → 走 resolveSolverEntity（统一抽取）
  const se = resolveSolverEntity(ref, env)
  if (se.type === 'axis') {
    return {
      type: 'axis',
      origin: [se.origin[0], se.origin[1], se.origin[2]],
      // `direction` is optional in the vendored SolverEntity type but always present for the
      // axis branch produced by resolveSolverEntity (cylinder/cone face, or edge axis snapshot).
      dir: vnormalize([se.direction![0], se.direction![1], se.direction![2]]),
    }
  }
  if (se.type === 'plane') {
    return {
      type: 'plane',
      center: [se.origin[0], se.origin[1], se.origin[2]],
      // `normal` is optional in the vendored SolverEntity type but always present for the plane branch.
      normal: vnormalize([se.normal![0], se.normal![1], se.normal![2]]),
    }
  }
  return { type: 'point', p: [se.origin[0], se.origin[1], se.origin[2]] }
}

function markerPoint(m: GlobalMarker, R: Vec3, T: Vec3): Vec3 {
  const base = m.type === 'point' ? m.p : m.type === 'axis' ? m.origin : m.center
  return vadd(rotateByR(base, R), T)
}
function markerDir(m: GlobalMarker, R: Vec3): Vec3 {
  // point markers never reach here (axis cost / plane normal / line direction only);
  // narrow to axis/plane and fall back to the point for type-completeness.
  const base = m.type === 'axis' ? m.dir : m.type === 'plane' ? m.normal : m.p
  return rotateByR(base, R)
}

/** 计算单条代价项的残差向量（平方前内层量，裁定 3）。 */
function termResidual(t: CostTerm, sa: { T: Vec3; R: Vec3 }, sb: { T: Vec3; R: Vec3 }, scale: number): number[] {
  const inv = t.scaleFlag ? 1 / scale : 1
  switch (t.fn) {
    case 'point': {
      const pa = markerPoint(t.ma, sa.R, sa.T)
      const pb = markerPoint(t.mb, sb.R, sb.T)
      const d = vscale(vsub(pa, pb), inv)
      if (Math.abs(t.val) < 1e-12) return d // 3-vec，val=0
      return [vsumsqr(d) - (t.val / scale) ** 2] // 1-vec，val≠0
    }
    case 'axis': {
      const d1 = markerDir(t.ma, sa.R)
      const d2 = markerDir(t.mb, sb.R)
      if (Math.abs(t.val) < 1e-12) return vsub(d1, d2) // 3-vec，val=0
      if (Math.abs(t.val - Math.PI) < 1e-12) return vadd(d1, d2) // 3-vec，val=π
      return [vdot(d1, d2) - Math.cos(t.val)] // 1-vec，其他
    }
    case 'point_in_plane': {
      const p1 = markerPoint(t.ma, sa.R, sa.T) // 点
      const n = markerDir(t.mb, sb.R) // 平面法向
      let c = markerPoint(t.mb, sb.R, sb.T) // 平面上一点
      if (Math.abs(t.val) > 1e-12) c = vadd(c, vscale(n, t.val)) // 沿法向平移 val（CQ m2_pnt 偏移）
      const d = vdot(n, vsub(c, p1)) * inv
      return [d] // 1-vec
    }
    case 'point_on_line': {
      const p1 = markerPoint(t.ma, sa.R, sa.T) // 点
      const o = markerPoint(t.mb, sb.R, sb.T) // 线上一点
      const dln = markerDir(t.mb, sb.R) // 线方向
      const delta = vsub(p1, o)
      const perp = vscale(vsub(delta, vscale(dln, vdot(delta, dln))), inv)
      if (Math.abs(t.val) < 1e-12) return perp // 3-vec，val=0
      return [vsumsqr(perp) - t.val] // 1-vec，val≠0（注意 val 不缩放）
    }
  }
}

/**
 * 纯 TS global 求解器入口。
 *
 * @param members - member shapes（与 memberNames 对齐）。
 * @param memberNames - 成员变量名（约束以名引用，空名会抛错）。
 * @param constraints - 规范化前的原始约束。
 * @param opts - 求解选项（solver 已在外层判定为 'global'，此处 name 用于 B4 锚定）。
 * @returns 与 `AssemblySolveResult` 对齐的结果。
 */
export function solveGlobal(
  members: Shape[],
  memberNames: string[],
  constraints: AssemblyConstraint[],
  opts?: SolveOptions,
): GlobalSolveResult {
  memberNames.forEach((name, i) => {
    if (!name) {
      throw new Error(`[assembly:global] member at index ${i} has an empty name`)
    }
  })

  const memberMap = new Map<string, Shape>()
  members.forEach((m, i) => {
    const name = memberNames[i]
    if (name && !memberMap.has(name)) memberMap.set(name, m)
  })

  let kernel: BrepEngineApi | null = null
  try {
    kernel = getBackends().kernel.brep as BrepEngineApi | null
  } catch {
    /* mesh/primitive 行快照路径：快照引用仍可解 */
  }
  const env: EntityResolutionEnv = { kernel, memberOf: (p: string) => memberMap.get(p) }

  // ── 建立代价项、锁定集、尺度点 ──
  const terms: CostTerm[] = []
  const unsupported: string[] = []
  const lockedSet = new Set<number>()
  const order: string[] = []
  const binaryOrder: string[] = []
  const unarySet = new Set<string>()
  const scalePts: Vec3[] = []

  constraints.forEach((raw, cid) => {
    const c = normalizeConstraint(raw)
    const register = (p: string) => {
      if (!order.includes(p)) order.push(p)
    }
    if (c.type === 'fixed') {
      register(c.part)
      unarySet.add(c.part)
      const idx = memberNames.indexOf(c.part)
      if (idx >= 0) lockedSet.add(idx)
      return
    }
    const ia = memberNames.indexOf(c.a.part)
    const ib = memberNames.indexOf(c.b.part)
    if (ia < 0 || ib < 0) {
      unsupported.push(`constraint references unknown part: ${ia < 0 ? c.a.part : c.b.part}`)
      return
    }
    if (!binaryOrder.includes(c.a.part)) binaryOrder.push(c.a.part)
    register(c.a.part)
    register(c.b.part)
    if (c.a.part === opts?.name) lockedSet.add(ia)
    if (c.b.part === opts?.name) lockedSet.add(ib)

    const mA = resolveMarker(c.a, env)
    const mB = resolveMarker(c.b, env)
    scalePts.push(markerPoint(mA, [0, 0, 0], [0, 0, 0]))
    scalePts.push(markerPoint(mB, [0, 0, 0], [0, 0, 0]))

    switch (c.type) {
      case 'mate':
      case 'align': {
        if (mA.type !== 'plane' || mB.type !== 'plane') {
          unsupported.push(`${c.type} requires plane entities on both sides`)
          return
        }
        terms.push({ cid, fn: 'axis', ia, ma: mA, ib, mb: mB, val: c.type === 'mate' ? Math.PI : 0, scaleFlag: false })
        terms.push({ cid, fn: 'point', ia, ma: mA, ib, mb: mB, val: 0, scaleFlag: true })
        break
      }
      case 'coincident': {
        pushCoincident(terms, cid, ia, mA, ib, mB)
        break
      }
      case 'concentric': {
        if (mA.type !== 'axis' || mB.type !== 'axis') {
          unsupported.push('concentric requires axis entities on both sides')
          return
        }
        terms.push({ cid, fn: 'axis', ia, ma: mA, ib, mb: mB, val: 0, scaleFlag: false })
        terms.push({ cid, fn: 'point_on_line', ia, ma: { type: 'point', p: mA.origin }, ib, mb: mB, val: 0, scaleFlag: true })
        break
      }
      case 'distance': {
        pushDistance(terms, cid, ia, mA, ib, mB, c.value, unsupported)
        break
      }
      case 'angle': {
        terms.push({ cid, fn: 'axis', ia, ma: mA, ib, mb: mB, val: c.value * DEG2RAD, scaleFlag: false })
        break
      }
      case 'parallel': {
        terms.push({ cid, fn: 'axis', ia, ma: mA, ib, mb: mB, val: 0, scaleFlag: false })
        break
      }
      case 'perpendicular': {
        terms.push({ cid, fn: 'axis', ia, ma: mA, ib, mb: mB, val: Math.PI / 2, scaleFlag: false })
        break
      }
      default:
        unsupported.push(`unsupported constraint type: ${(c as { type?: string }).type}`)
    }
  })

  // ── B4 锚定 ──
  if (lockedSet.size === 0) {
    for (const b of binaryOrder) {
      if (!unarySet.has(b)) {
        const idx = memberNames.indexOf(b)
        if (idx >= 0) {
          lockedSet.add(idx)
          break
        }
      }
    }
  }
  if (lockedSet.size === 0 && order.length > 0) {
    const idx = memberNames.indexOf(order[0])
    if (idx >= 0) lockedSet.add(idx)
  }

  // ── scale = 所有 marker 点的包围盒对角长（CQ B5；marker 近似几何 bbox） ──
  const scale = computeScale(scalePts)

  // ── 自由成员与变量 ──
  const freeIdx: number[] = []
  const blockMap = new Map<number, number>()
  memberNames.forEach((_, i) => {
    if (!lockedSet.has(i)) {
      blockMap.set(i, freeIdx.length)
      freeIdx.push(i)
    }
  })
  const n = freeIdx.length * 6
  const x = new Array(n).fill(0)
  for (let k = 0; k < freeIdx.length; k++) {
    x[6 * k + 3] = R_INIT
    x[6 * k + 4] = R_INIT
    x[6 * k + 5] = R_INIT
  }

  const stateOf = (xx: number[], i: number): { T: Vec3; R: Vec3 } => {
    if (lockedSet.has(i)) return { T: [0, 0, 0], R: [0, 0, 0] }
    const k = blockMap.get(i)!
    return {
      T: [xx[6 * k], xx[6 * k + 1], xx[6 * k + 2]],
      R: [xx[6 * k + 3], xx[6 * k + 4], xx[6 * k + 5]],
    }
  }

  const residual = (xx: number[]): number[] => {
    const r: number[] = []
    for (const t of terms) {
      const e = termResidual(t, stateOf(xx, t.ia), stateOf(xx, t.ib), scale)
      for (const v of e) r.push(v)
    }
    // penalty 1e-16（B1）：sqrt 后 1e-8，T/scale 缩小、R 直接
    for (let k = 0; k < freeIdx.length; k++) {
      r.push(PENALTY ** 0.5 * (xx[6 * k] / scale))
      r.push(PENALTY ** 0.5 * (xx[6 * k + 1] / scale))
      r.push(PENALTY ** 0.5 * (xx[6 * k + 2] / scale))
      r.push(PENALTY ** 0.5 * xx[6 * k + 3])
      r.push(PENALTY ** 0.5 * xx[6 * k + 4])
      r.push(PENALTY ** 0.5 * xx[6 * k + 5])
    }
    return r
  }

  // ── LM 迭代 ──
  let lambda = LM_LAMBDA0
  let current = residual(x)
  let obj = 0.5 * dot(current, current)
  let converged = false

  for (let iter = 0; iter < LM_MAXITER; iter++) {
    const m = current.length
    const J = new Array(m * n).fill(0)
    for (let col = 0; col < n; col++) {
      const h = col % 6 < 3 ? 1e-7 * scale : 1e-7
      const xp = x.slice()
      const xm = x.slice()
      xp[col] += h
      xm[col] -= h
      const rp = residual(xp)
      const rm = residual(xm)
      for (let row = 0; row < m; row++) J[row * n + col] = (rp[row] - rm[row]) / (2 * h)
    }
    const JtJ = ata(J, m, n)
    const Jtr = atb(J, current, m, n)

    // 梯度范数收敛（与步长早停互补，避免 λ 放大时误判收敛）
    if (maxAbs(Jtr) < 1e-8) {
      converged = true
      break
    }

    const negJtr = Jtr.map((v) => -v)
    const objBefore = obj
    let improved = false
    let acceptedStep: number[] | null = null
    for (let attempt = 0; attempt < 12 && !improved; attempt++) {
      const step = solveDampedNormal(JtJ, negJtr, n, lambda)
      if (!step) break
      const xTry = x.slice()
      for (let j = 0; j < n; j++) xTry[j] += step[j]
      const rTry = residual(xTry)
      const objTry = 0.5 * dot(rTry, rTry)
      if (objTry <= obj) {
        for (let j = 0; j < n; j++) x[j] = xTry[j]
        current = rTry
        obj = objTry
        improved = true
        acceptedStep = step
        lambda = Math.max(lambda / 3, 1e-15)
      } else {
        lambda *= 2
      }
    }
    if (!improved) break

    // 步长收敛仅在信任域健康（λ 小）时认定——λ 大时的微小步长只是阻尼，非真收敛
    if (acceptedStep && maxAbs(acceptedStep) < LM_TOL_STEP && lambda < 1e-2) {
      converged = true
      break
    }
    if (Math.abs(objBefore - obj) < LM_TOL_OBJ * Math.max(1, Math.abs(objBefore))) {
      converged = true
      break
    }
  }

  // ── 组装结果 ──
  const transforms: AssemblyTransform[] = []
  for (let k = 0; k < freeIdx.length; k++) {
    const i = freeIdx[k]
    const T: Vec3 = [x[6 * k], x[6 * k + 1], x[6 * k + 2]]
    const R: Vec3 = [x[6 * k + 3], x[6 * k + 4], x[6 * k + 5]]
    const pose: SolverPose = { position: T, rotation: quatFromR(R[0], R[1], R[2]) }
    transforms.push(poseToAssemblyTransform(pose, [0, 0, 0], i))
  }

  // 逐约束残差（诊断）
  const residuals: number[] = []
  const warnings: string[] = []
  const byCid = new Map<number, number>()
  for (const t of terms) {
    const e = termResidual(t, stateOf(x, t.ia), stateOf(x, t.ib), scale)
    const s = e.reduce((acc, v) => acc + v * v, 0)
    byCid.set(t.cid, (byCid.get(t.cid) ?? 0) + s)
  }
  constraints.forEach((_, cid) => {
    const r = byCid.get(cid) ?? 0
    residuals.push(r)
    if (r > RESIDUAL_WARN * scale) warnings.push(`constraint #${cid} residual=${r.toExponential(3)} (> ${RESIDUAL_WARN * scale})`)
  })

  return {
    transforms,
    dof: 0,
    converged: true,
    unsupported,
    residuals,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

function pushCoincident(terms: CostTerm[], cid: number, ia: number, mA: GlobalMarker, ib: number, mB: GlobalMarker): void {
  if (mA.type === 'point' && mB.type === 'point') {
    terms.push({ cid, fn: 'point', ia, ma: mA, ib, mb: mB, val: 0, scaleFlag: true })
  } else if (mA.type === 'plane' && mB.type === 'point') {
    terms.push({ cid, fn: 'point_in_plane', ia: ib, ma: mB, ib: ia, mb: mA, val: 0, scaleFlag: true })
  } else if (mA.type === 'point' && mB.type === 'plane') {
    terms.push({ cid, fn: 'point_in_plane', ia, ma: mA, ib, mb: mB, val: 0, scaleFlag: true })
  } else if (mA.type === 'axis' && mB.type === 'axis') {
    terms.push({ cid, fn: 'axis', ia, ma: mA, ib, mb: mB, val: 0, scaleFlag: false })
    terms.push({ cid, fn: 'point_on_line', ia, ma: { type: 'point', p: mA.origin }, ib, mb: mB, val: 0, scaleFlag: true })
  } else if (mA.type === 'axis' && mB.type === 'point') {
    terms.push({ cid, fn: 'point_on_line', ia: ib, ma: mB, ib, mb: mA, val: 0, scaleFlag: true })
  } else if (mA.type === 'point' && mB.type === 'axis') {
    terms.push({ cid, fn: 'point_on_line', ia, ma: mA, ib, mb: mB, val: 0, scaleFlag: true })
  } else {
    // 两面 coincident：按 align 语义（平行 + 中心重合）
    terms.push({ cid, fn: 'axis', ia, ma: mA, ib, mb: mB, val: 0, scaleFlag: false })
    terms.push({ cid, fn: 'point', ia, ma: mA, ib, mb: mB, val: 0, scaleFlag: true })
  }
}

function pushDistance(
  terms: CostTerm[],
  cid: number,
  ia: number,
  mA: GlobalMarker,
  ib: number,
  mB: GlobalMarker,
  val: number,
  unsupported: string[],
): void {
  if (mA.type === 'point' && mB.type === 'point') {
    terms.push({ cid, fn: 'point', ia, ma: mA, ib, mb: mB, val, scaleFlag: true })
  } else if (mA.type === 'plane' && mB.type === 'point') {
    terms.push({ cid, fn: 'point_in_plane', ia: ib, ma: mB, ib: ia, mb: mA, val, scaleFlag: true })
  } else if (mA.type === 'point' && mB.type === 'plane') {
    terms.push({ cid, fn: 'point_in_plane', ia, ma: mA, ib, mb: mB, val, scaleFlag: true })
  } else if (mA.type === 'axis' && mB.type === 'axis') {
    terms.push({ cid, fn: 'point_on_line', ia, ma: { type: 'point', p: mA.origin }, ib, mb: mB, val, scaleFlag: true })
  } else {
    unsupported.push(`distance requires point-point / plane-point / axis-axis entities, got ${mA.type}-${mB.type}`)
  }
}

function computeScale(pts: Vec3[]): number {
  if (pts.length === 0) return 1
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i]
      if (p[i] > max[i]) max[i] = p[i]
    }
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  return Math.max(diag, 1e-6)
}

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
function maxAbs(a: number[]): number {
  let m = 0
  for (const v of a) m = Math.max(m, Math.abs(v))
  return m
}
