/**
 * api/assembly/solvers/global-solver — 纯 TS global 装配求解器（P1）
 *
 * 复刻 CadQuery `cadquery/occ_impl/solver.py` 的**语义**（全局 NLP、模长参数化旋转、
 * 9 类代价、Axis 缺省反平行、Plane=Axis(π)+Point(0)、包围盒对角长缩放），
 * 以 Levenberg-Marquardt 替代 IPOPT，**零原生/WASM 依赖**（裁定 1–6）。
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
import { getBrepApi } from '../../../brep/handle-bridge'
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
import { rotateByR, quatFromR, quatToRvec } from './pose-from-delta'
import { quatMultiply, quatRotate } from './quat'

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
      // `direction` is optional in the brepjs SolverEntity type but always present for the
      // axis branch produced by resolveSolverEntity (cylinder/cone face, or edge axis snapshot).
      dir: vnormalize([se.direction![0], se.direction![1], se.direction![2]]),
    }
  }
  if (se.type === 'plane') {
    return {
      type: 'plane',
      center: [se.origin[0], se.origin[1], se.origin[2]],
      // `normal` is optional in the brepjs SolverEntity type but always present for the plane branch.
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
      return [vsumsqr(d) - (t.val * inv) ** 2] // 1-vec，val≠0（目标值与残差同除 scale）
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
      // 1-vec，val≠0：perp 已除 scale → vsumsqr(perp) = (dist/scale)²；
      // 目标值必须同尺度（t.val·inv）²，否则实际满足 dist = scale·√val。
      // （历史缺陷：此处曾写 `vsumsqr(perp) - t.val`，val 不缩放——金丝雀见
      // planetary-static.test.ts distance 用例，修复后该断言已翻转为 ORBIT_R。）
      return [vsumsqr(perp) - (t.val * inv) ** 2]
    }
  }
}

/** 单条代价项的残差维数（与 termResidual 的分支表一一对应；诊断参考）。 */
function residualDim(t: CostTerm): number {
  switch (t.fn) {
    case 'point':
      return Math.abs(t.val) < 1e-12 ? 3 : 1
    case 'axis':
      return Math.abs(t.val) < 1e-12 || Math.abs(t.val - Math.PI) < 1e-12 ? 3 : 1
    case 'point_in_plane':
      return 1
    case 'point_on_line':
      return Math.abs(t.val) < 1e-12 ? 3 : 1
  }
}
void residualDim // P7/D1-1：诊断参考表（秩判定走列归一特征值，见下）

/**
 * 对称 n×n 矩阵的特征分解（循环 Jacobi 旋转）。
 *
 * @param A      行主 n×n 对称矩阵（会被复制，不修改原矩阵）。
 * @param n      阶数。
 * @param outVec 可选输出：n×n 行主特征向量矩阵 V（列 v[:,i] 是 outVec[i] 对应的
 *   特征向量）。传 `V`（单位矩阵）时原地累积旋转。
 * @returns 特征值数组（无序）；扫掠不收敛返回 null（调用方走保守 fallback）。
 */
function symEigenvalues(A: number[], n: number, outVec?: number[]): number[] | null {
  const a = A.slice()
  if (outVec) for (let i = 0; i < n * n; i++) outVec[i] = 0
  if (outVec) for (let i = 0; i < n; i++) outVec[i * n + i] = 1
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q]
    }
    if (off <= 1e-30 * Math.max(1, Math.abs(a[0]))) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]
        if (Math.abs(apq) < 1e-300) continue
        // Numerical Recipes 经典公式（θ=0 时 t=1，即 45° 旋转；sign(0)=0 的变体是错的）
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq)
        const t = theta >= 0 ? 1 / (theta + Math.sqrt(1 + theta * theta)) : 1 / (theta - Math.sqrt(1 + theta * theta))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]
          const akq = a[k * n + q]
          a[k * n + p] = c * akp - s * akq
          a[k * n + q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]
          const aqk = a[q * n + k]
          a[p * n + k] = c * apk - s * aqk
          a[q * n + k] = s * apk + c * aqk
        }
        if (outVec) {
          for (let k = 0; k < n; k++) {
            const vkp = outVec[k * n + p]
            const vkq = outVec[k * n + q]
            outVec[k * n + p] = c * vkp - s * vkq
            outVec[k * n + q] = s * vkp + c * vkq
          }
        }
      }
    }
    if (sweep === 59) return null
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(a[i * n + i])
  return out
}

/**
 * P7/D1-2：收敛后的欠定自由度诊断。
 *
 * 关键细节一：LM 的残差行含 PENALTY 正则行（1e-8·x）——正则化不是约束，却让 JᵀJ
 * 技术上满秩；秩判定必须剔除 penalty 行。
 *
 * 关键细节二（为何要列归一）：`computeScale` 只收集 fixedPoint 的 marker 点，
 * unary 场景（fixedAxis-only + 单点 fixedPoint）scale 可能退化到 1e-6，T 块
 * （1/scale² ~1e12）与 R 块（~1）的特征值量级悬殊，全局阈值会把 R 块整列误杀。
 * 做法是对 J 做列范数归一（J·D⁻¹，D = diag(列范数)；可逆对角重参数化保秩不变），
 * 再对归一后的 JᵀJ 做特征分解，rank = #{λ > λmax·1e-8}，dof = n − rank。
 * 欠定方向在归一后是精确零列（零特征值），与 λmax 差无穷量级，阈值余量充足。
 * 零范数列（约束完全摸不到的方向）直接计入自由。
 *
 * @returns 剩余自由度（0 = 适定）；特征分解不收敛时保守报 0（不阻塞消费方）。
 */
function computeUnderdeterminedDof(
  terms: CostTerm[],
  scale: number,
  n: number,
  x: number[],
  stateOf: (xx: number[], i: number) => { T: Vec3; R: Vec3 },
  outFreeDirs?: number[][],
): number {
  if (n === 0) return 0
  // 仅约束残差（剔除 penalty 正则行）
  const residualC = (xx: number[]): number[] => {
    const r: number[] = []
    for (const t of terms) {
      const e = termResidual(t, stateOf(xx, t.ia), stateOf(xx, t.ib), scale)
      for (const v of e) r.push(v)
    }
    return r
  }
  const m = residualC(x).length
  if (m === 0) return n // 无任何约束：全部自由
  const J: number[] = new Array(m * n).fill(0)
  for (let col = 0; col < n; col++) {
    const h = col % 6 < 3 ? 1e-7 * scale : 1e-7
    const xp = x.slice()
    xp[col] += h
    const xm = x.slice()
    xm[col] -= h
    const rp = residualC(xp)
    const rm = residualC(xm)
    for (let row = 0; row < m; row++) J[row * n + col] = (rp[row] - rm[row]) / (2 * h)
  }
  // 列范数归一（欠定方向 → 精确零列；可逆对角缩放保秩）
  const norms = new Array<number>(n).fill(0)
  let freeCols = 0
  for (let col = 0; col < n; col++) {
    let s = 0
    for (let row = 0; row < m; row++) s += J[row * n + col] * J[row * n + col]
    norms[col] = Math.sqrt(s)
    if (!(norms[col] > 1e-12)) freeCols++ // 约束完全摸不到的列 → 直接自由
  }
  if (freeCols === n) return n
  const Jn: number[] = J.slice()
  for (let col = 0; col < n; col++) {
    const d = norms[col] > 1e-12 ? norms[col] : 1 // 零列归一因子取 1（已被计为自由）
    for (let row = 0; row < m; row++) Jn[row * n + col] /= d
  }
  const JtJ = ata(Jn, m, n)
  const V: number[] = new Array(n * n).fill(0)
  const eig = symEigenvalues(JtJ, n, V)
  if (!eig) return 0 // 保守 fallback（适定假设，不阻塞）
  const lambdaMax = Math.max(...eig.map(Math.abs))
  if (!(lambdaMax > 1e-300)) return freeCols + n // 理论不可达；防御
  const rank = eig.filter((v) => Math.abs(v) > lambdaMax * 1e-8).length
  const dof = Math.max(0, n - rank)
  // P7/D1-4：零空间特征向量（λ < λmax·1e-8 的列）= 欠定自由方向（变量系：
  // 每成员 6 维 [tx,ty,tz,rx,ry,rz]，列范数已归一）。旋转分量为主的方向对
  // 位姿判等有意义；调用方按需解释。
  if (outFreeDirs && dof > 0) {
    for (let i = 0; i < n; i++) {
      if (Math.abs(eig[i]) > lambdaMax * 1e-8) continue
      const v: number[] = new Array(n)
      for (let r = 0; r < n; r++) v[r] = V[r * n + i]
      outFreeDirs.push(v)
    }
    // 零范数列（约束摸不到的坐标轴方向）也是自由方向，补在后面
    for (let col = 0; col < n; col++) {
      if (norms[col] > 1e-12) continue
      const v = new Array(n).fill(0)
      v[col] = 1
      outFreeDirs.push(v)
    }
  }
  return dof
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
    kernel = getBrepApi()
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
    // 世界锚定 unary（fixedPoint/fixedAxis/fixedRotation）：入 unarySet 但**不**入
    // lockedSet——只靠代价项约束，不冻结整件（CQ unary 语义，见 solver.py fixed_*_cost）。
    if (c.type === 'fixedPoint') {
      register(c.a.part)
      unarySet.add(c.a.part)
      const ia = memberNames.indexOf(c.a.part)
      if (ia < 0) {
        unsupported.push(`constraint references unknown part: ${c.a.part}`)
        return
      }
      const mA = resolveMarker(c.a, env)
      scalePts.push(markerPoint(mA, [0, 0, 0], [0, 0, 0]))
      terms.push({
        cid, fn: 'point', ia, ma: mA, ib: -1,
        mb: { type: 'point', p: [c.world[0], c.world[1], c.world[2]] },
        val: 0, scaleFlag: true,
      })
      return
    }
    if (c.type === 'fixedAxis') {
      register(c.a.part)
      unarySet.add(c.a.part)
      const ia = memberNames.indexOf(c.a.part)
      if (ia < 0) {
        unsupported.push(`constraint references unknown part: ${c.a.part}`)
        return
      }
      const len = Math.hypot(c.worldDir[0], c.worldDir[1], c.worldDir[2])
      if (!(len > 1e-12)) {
        unsupported.push('fixedAxis requires a non-zero worldDir')
        return
      }
      const mA = resolveMarker(c.a, env)
      terms.push({
        cid, fn: 'axis', ia, ma: mA, ib: -1,
        mb: { type: 'axis', origin: [0, 0, 0], dir: vnormalize([c.worldDir[0], c.worldDir[1], c.worldDir[2]]) },
        val: 0, scaleFlag: false,
      })
      return
    }
    if (c.type === 'fixedRotation') {
      register(c.part)
      unarySet.add(c.part)
      const ia = memberNames.indexOf(c.part)
      if (ia < 0) {
        unsupported.push(`constraint references unknown part: ${c.part}`)
        return
      }
      // 成员本地 X/Y/Z 轴分别钉到世界 X/Y/Z（恒等朝向）；平移保持自由
      const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
      for (const ax of axes) {
        terms.push({
          cid, fn: 'axis', ia,
          ma: { type: 'axis', origin: [0, 0, 0], dir: ax },
          ib: -1,
          mb: { type: 'axis', origin: [0, 0, 0], dir: [ax[0], ax[1], ax[2]] },
          val: 0, scaleFlag: false,
        })
      }
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
    // 兜底锚定不得选「世界锚定 unary」成员——锁死它会让其 anchor 代价无法满足
    // （全 unary 场景：无 binary 参考可锚，宁可全部自由交 LM 求解，也不误锁）。
    const candidate = order.find((p) => !unarySet.has(p))
    if (candidate !== undefined) {
      const idx = memberNames.indexOf(candidate)
      if (idx >= 0) lockedSet.add(idx)
    }
  }

  // ── scale = 所有 marker 点的包围盒对角长（CQ B5；marker 近似几何 bbox） ──
  const scale = computeScale(scalePts)

  // ── 自由成员与变量 ──
  // P8 刚体分组：同组成员共享一个 6 维状态块（子装配在 CQ 语义里是刚体）。
  // freeIdx 每项是一个块的"代表成员"下标；blockOf 把每个自由成员映射到其块位置 k
  // （代表自身与跟随者都映射到同一 k——stateOf 按成员直接查块，无需二次 rep 解析）。
  const freeIdx: number[] = []
  const blockOf = new Map<number, number>()
  const groupOf = new Map<number, number>() // member idx -> 代表成员 idx
  if (opts?.rigidGroups) {
    for (const g of opts.rigidGroups) {
      for (const m of g) groupOf.set(m, g[0])
    }
  }
  memberNames.forEach((_, i) => {
    if (lockedSet.has(i)) return
    const rep = groupOf.get(i) ?? i
    // 组代表被锁：整组随锁（跟随者也不进自由集）。
    if (lockedSet.has(rep)) return
    let k = freeIdx.indexOf(rep)
    if (k < 0) {
      k = freeIdx.length
      freeIdx.push(rep)
    }
    blockOf.set(i, k)
  })
  const n = freeIdx.length * 6
  const x = new Array(n).fill(0)
  for (let k = 0; k < freeIdx.length; k++) {
    x[6 * k + 3] = R_INIT
    x[6 * k + 4] = R_INIT
    x[6 * k + 5] = R_INIT
  }

  // P8 方案 A（CQ sublocs 语义）：成员建模坐标是装配前本地系，约束 marker 取自
  // 该本地系；求解器状态是 delta，绝对位姿 = initialPose ∘ delta（penalty 拉
  // delta→0 = 倾向保持初 loc）。未传 initialPoses 时初位姿为恒等——与旧 delta
  // 语义完全一致（回归零影响）。
  // 关键：init 按【成员下标】存，delta 按块共享——刚体组成员初位各不同
  // （nested_assy：b2 初 (0,4,0)、b3 初 (0,8,0)），同一 delta 下绝对位姿各异；
  // 若 init 按块存，跟随者会错拿代表的初位（实测 b2 错落 (2,0,0.75)，ref (2,−4,0.75)）。
  const initT = new Map<number, Vec3>()
  const initQ = new Map<number, [number, number, number, number]>()
  if (opts?.initialPoses) {
    opts.initialPoses.forEach((ip, i) => {
      if (!ip) return
      initT.set(i, [ip.translation[0], ip.translation[1], ip.translation[2]])
      initQ.set(i, [ip.rotation[0], ip.rotation[1], ip.rotation[2], ip.rotation[3]])
    })
  }

  const stateOf = (xx: number[], i: number): { T: Vec3; R: Vec3 } => {
    // 世界哨兵 i = -1：identity（世界系 marker 已存字面坐标，不再施加成员变换）
    if (i < 0) return { T: [0, 0, 0], R: [0, 0, 0] }
    if (lockedSet.has(i)) return { T: [0, 0, 0], R: [0, 0, 0] }
    const k = blockOf.get(i)
    if (k === undefined) return { T: [0, 0, 0], R: [0, 0, 0] }
    const dT: Vec3 = [xx[6 * k], xx[6 * k + 1], xx[6 * k + 2]]
    const dR: Vec3 = [xx[6 * k + 3], xx[6 * k + 4], xx[6 * k + 5]]
    const it = initT.get(i)
    const iq = initQ.get(i)
    if (!it || !iq) return { T: dT, R: dR }
    // absolute = initial ∘ delta：先转 delta 再平移初 loc。
    const qd = quatFromR(dR[0], dR[1], dR[2])
    const at = vadd(it, quatRotate(iq, dT))
    const aq = quatMultiply(iq, qd)
    // 绝对四元数 → 旋转向量（pose-from-delta 的 R 约定），供 markerPoint 复用。
    const Rm = quatToRvec(aq)
    return { T: at, R: Rm }
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
      break
    }
    if (Math.abs(objBefore - obj) < LM_TOL_OBJ * Math.max(1, Math.abs(objBefore))) {
      break
    }
  }

  // ── 组装结果 ──
  const transforms: AssemblyTransform[] = []
  // P8 方案 A：发射绝对位姿 = initial ∘ delta（stateOf 终态），不再裸发 delta。
  for (let k = 0; k < freeIdx.length; k++) {
    const i = freeIdx[k]
    const st = stateOf(x, i)
    const pose: SolverPose = { position: st.T, rotation: quatFromR(st.R[0], st.R[1], st.R[2]) }
    transforms.push(poseToAssemblyTransform(pose, [0, 0, 0], i))
  }
  // P8 刚体分组：跟随成员与组代表共享同一刚体位姿——为每个跟随者补一条
  // 同 pose 的 transform（index=跟随者），否则 solve-tree 的 recompose 拿不到
  // 组员的变换（nested_assy 的 b3 叶会缺条目）。
  for (const [member, rep] of groupOf) {
    if (member === rep) continue
    if (lockedSet.has(member)) continue
    const st = stateOf(x, rep)
    const pose: SolverPose = { position: st.T, rotation: quatFromR(st.R[0], st.R[1], st.R[2]) }
    transforms.push(poseToAssemblyTransform(pose, [0, 0, 0], member))
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

  // P7/D1-2/D1-4：欠定自由度诊断 + 零空间自由方向（变量系 6 维块 [tx,ty,tz,rx,ry,rz]）
  const freeDirs: number[][] = []
  const underdeterminedDof = computeUnderdeterminedDof(terms, scale, n, x, stateOf, freeDirs)

  return {
    transforms,
    dof: 0,
    // P7/D1-3：旧 `dof` 字段语义不变（unsupported 合计的占位），欠定信息走新字段。
    underdetermined:
      underdeterminedDof > 0
        ? { dof: underdeterminedDof, freeDirs: freeDirs.map((v) => v.map((c) => Math.abs(c) < 1e-12 ? 0 : +c.toFixed(12))) }
        : undefined,
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
