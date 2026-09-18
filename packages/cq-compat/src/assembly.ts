/**
 * cq-compat assembly helpers — CadQuery Assembly.constrain → faijs cad.assembly.
 *
 * Maps CadQuery constraint DSL ("part@faces@>Z[-2]", "Plane"/"Axis") to faijs
 * AssemblyConstraint objects with EntityRef geometry snapshots.
 *
 * Constraint mapping (verified against faijs api/assembly/lower.ts):
 * - "Plane" → mate (face-to-face: normal reversed + center coincident)
 * - "Axis"  → align (normal same direction + center coincident; plane face refs
 *             are encoded as axis via axisFromFace — concentric would reject
 *             plane faces because faceGeometryToSolverEntity maps plane→plane
 *             entity, not axis)
 */

import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import type {
  AssemblyConstraint,
  EntityRef,
} from '@faicad/faijs-core/api/assembly/types'
import type { CompoundShape } from '@faicad/faijs-core/shape'
import { getSlot, brepOf } from '@faicad/faijs-core/shape'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'
import type { RGB } from './workplane'
import { resolveFaceSelector, asBrepShape } from './workplane'

const cad = createApiNamespace() as Record<string, (...args: unknown[]) => Promise<unknown>>

/**
 * faceRef
 * @param partName - string
 * @param selector - string
 * @param shape - Shape
 * @returns Promise<EntityRef>
 */
export async function faceRef(
  partName: string,
  selector: string,
  shape: Shape,
): Promise<EntityRef> {
  // Resolve via the same face enumeration as the Workplane API — this is
  // required for CadQuery-style indexed selectors like "bp@faces@>Z[-2]"
  // (second-highest Z face, e.g. a recess floor instead of the top annulus).
  // The returned center is the face's area centroid (CadQuery face Center)
  // and the normal is the outward direction.
  const { center: faceCenter, normal } = await resolveFaceSelector(shape, selector)
  return {
    part: partName,
    face: {
      surfaceType: 'plane',
      center: faceCenter,
      normal,
    },
  } as EntityRef
}

/**
 * constraint
 * @param aPart - string
 * @param aSelector - string
 * @param aShape - Shape
 * @param bPart - string
 * @param bSelector - string
 * @param bShape - Shape
 * @param type - 'Plane' | 'Axis'
 * @returns Promise<AssemblyConstraint>
 */
export async function constraint(
  aPart: string,
  aSelector: string,
  aShape: Shape,
  bPart: string,
  bSelector: string,
  bShape: Shape,
  type: 'Plane' | 'Axis',
): Promise<AssemblyConstraint> {
  const out = await constraintEx(aPart, aSelector, aShape, bPart, bSelector, bShape, type)
  return out[0]
}

/**
 * pointRef — 字面坐标点引用（无需几何解析）。
 * @param part - 部件名
 * @param coords - [x,y,z]（本地系 mm）
 * @returns EntityRef（point）
 */
export function pointRef(part: string, coords: [number, number, number]): EntityRef {
  return { part, point: [coords[0], coords[1], coords[2]] } as EntityRef
}

/**
 * axisRef — 字面轴引用（无需几何解析）。
 * @param part - 部件名
 * @param origin - 轴上一点 [x,y,z]（本地系 mm）
 * @param direction - 单位方向 [x,y,z]
 * @returns EntityRef（edge.axis）
 */
export function axisRef(
  part: string,
  origin: [number, number, number],
  direction: [number, number, number],
): EntityRef {
  return { part, edge: { axis: { origin: [origin[0], origin[1], origin[2]], direction } } } as EntityRef
}

type AssemblyKind =
  | 'Plane'
  | 'Axis'
  | 'Point'
  | 'Cylinder'
  | 'Distance'
  | 'Fixed'
  | 'Revolute'

function parseCoords(sel: string): [number, number, number] | null {
  const m = sel.replace(/[[\]()]/g, '').trim().split(/[\s,]+/).filter(Boolean)
  if (m.length !== 3) return null
  const x = Number(m[0])
  const y = Number(m[1])
  const z = Number(m[2])
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [x, y, z]
}

/**
 * resolveAxisRef — 从形状里解析出一条轴（用于 Cylinder 配合）。
 * 走 wireframe 取边折线，对闭合边做圆拟合（PCA 平面 + 2D 最小二乘圆），
 * 返回第一条足够圆的边的轴。无内核/无圆边时抛错。
 */
async function resolveAxisRef(part: string, shape: Shape): Promise<EntityRef> {
  shape = asBrepShape(shape) // 提升边界：实参可能是借用视图
  const handle = brepOf(shape)
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!handle || !kernel) throw new Error(`[cq-compat] axisRef: BREP unavailable for part "${part}"`)
  // 整形状一次 wireframe，按 edgeGroups 逐边取折线区间。
  // 依据 topologyExt.ts：wireframe() 与 getSubShapes 同用 TopExp::MapShapes +
  // IndexedMap，故 edge 枚举顺序一致——第 i 条 edge 对应 edgeGroups[i*3..]。
  const wf = kernel.wireframe(handle as never, 0.01)
  const groups = wf.edgeGroups
  if (!groups || groups.length < 3) throw new Error(`[cq-compat] axisRef: wireframe returned no edge groups for part "${part}"`)
  const edgeCount = groups.length / 3
  for (let ei = 0; ei < edgeCount; ei++) {
    const start = groups[ei * 3]
    const count = groups[ei * 3 + 1] // float units (3 floats / point)
    const pts: [number, number, number][] = []
    const numPts = Math.floor(count / 3)
    for (let i = 0; i < numPts; i++) {
      const o = start + i * 3
      pts.push([wf.points[o], wf.points[o + 1], wf.points[o + 2]])
    }
    const axis = fitCircleAxis(pts)
    if (axis) return axisRef(part, axis.origin, axis.direction)
  }
  throw new Error(`[cq-compat] axisRef: no circular edge found in part "${part}"`)
}

/** 对一组（应共面、闭合）的 XYZ 点拟合圆轴，返回原点(圆心投影)与方向(法向)，非圆/退化返回 null。 */
function fitCircleAxis(pts: [number, number, number][]): { origin: [number, number, number]; direction: [number, number, number] } | null {
  const n = pts.length
  if (n < 6) return null
  // 质心
  const c: [number, number, number] = [0, 0, 0]
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2] }
  c[0] /= n; c[1] /= n; c[2] /= n
  // 相邻段叉积之和 → 平面法向（闭环平面点稳定）
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const ax = a[0] - c[0], ay = a[1] - c[1], az = a[2] - c[2]
    const bx = b[0] - c[0], by = b[1] - c[1], bz = b[2] - c[2]
    nx += ay * bz - az * by
    ny += az * bx - ax * bz
    nz += ax * by - ay * bx
  }
  const nl = Math.hypot(nx, ny, nz)
  if (!(nl > 1e-9) || !Number.isFinite(nl)) return null
  nx /= nl; ny /= nl; nz /= nl
  // 平面正交基
  let up: [number, number, number] = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  let ux = ny * up[2] - nz * up[1], uy = nz * up[0] - nx * up[2], uz = nx * up[1] - ny * up[0]
  let ul = Math.hypot(ux, uy, uz)
  if (!(ul > 1e-9)) {
    up = [1, 0, 0]
    ux = ny * up[2] - nz * up[1]; uy = nz * up[0] - nx * up[2]; uz = nx * up[1] - ny * up[0]
    ul = Math.hypot(ux, uy, uz)
    if (!(ul > 1e-9)) return null
  }
  const u: [number, number, number] = [ux / ul, uy / ul, uz / ul]
  const v: [number, number, number] = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]]
  // 投影到 2D
  const xs: number[] = []
  const ys: number[] = []
  for (const p of pts) {
    const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2]
    xs.push(dx * u[0] + dy * u[1] + dz * u[2])
    ys.push(dx * v[0] + dy * v[1] + dz * v[2])
  }
  // 2D 最小二乘圆拟合（Kasa）： a·xi + b·yi + c = -(xi²+yi²)
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sR = 0, sRx = 0, sRy = 0
  for (let i = 0; i < n; i++) {
    const xi = xs[i], yi = ys[i], ri = xi * xi + yi * yi
    sxx += xi * xi; sxy += xi * yi; syy += yi * yi
    sx += xi; sy += yi; sR += ri
    sRx += ri * xi; sRy += ri * yi
  }
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ]
  const B = [-sRx, -sRy, -sR]
  const det = det3(A)
  if (!(Math.abs(det) > 1e-12)) return null
  const a = det3([[B[0], A[0][1], A[0][2]], [B[1], A[1][1], A[1][2]], [B[2], A[2][1], A[2][2]]]) / det
  const b = det3([[A[0][0], B[0], A[0][2]], [A[1][0], B[1], A[1][2]], [A[2][0], B[2], A[2][2]]]) / det
  const cc = det3([[A[0][0], A[0][1], B[0]], [A[1][0], A[1][1], B[1]], [A[2][0], A[2][1], B[2]]]) / det
  const r2 = a * a / 4 + b * b / 4 - cc
  if (!(r2 > 0) || !Number.isFinite(r2)) return null
  // 圆度校验：卡萨拟合有偏，用 RMS 过滤非圆边
  const R = Math.sqrt(r2)
  let rms = 0
  for (let i = 0; i < n; i++) {
    const dd = Math.hypot(xs[i] + a / 2, ys[i] + b / 2) - R
    rms += dd * dd
  }
  rms = Math.sqrt(rms / n)
  if (rms > R * 0.05) return null
  // 圆心回投到 3D
  const ox = c[0] + u[0] * (-a / 2) + v[0] * (-b / 2)
  const oy = c[1] + u[1] * (-a / 2) + v[1] * (-b / 2)
  const oz = c[2] + u[2] * (-a / 2) + v[2] * (-b / 2)
  if (![ox, oy, oz, nx, ny, nz].every(Number.isFinite)) return null
  return { origin: [ox, oy, oz], direction: [nx, ny, nz] }
}

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

/**
 * constraintEx — 统一约束构造，覆盖 CQ 公共种类并映射到 faijs 类型面。
 *
 * 映射（对齐 global 求解器 consuming 的 AssemblyConstraint）：
 * - 'Plane'    → [mate]（faceRef→plane）
 * - 'Axis'     → [angle:180]（纯方向反平行、无点项——CQ 2.8.0 `axis_cost` 缺省语义）
 * - 'Point'    → [coincident]（selector 为字面坐标 "x,y,z"）
 * - 'Cylinder' → [concentric, coincident(point_on_line)]（圆边解析轴）
 * - 'Distance' → [distance(value)]（point-point 或 plane-plane）
 * - 'Fixed'    → [fixed]（aPart 锁定）
 * - 'Revolute' → [fixed]（暂降级为锚定占位；旋转 DOF 后续走 joints 机制）
 *
 * @param aPart A 侧成员名。
 * @param aSelector A 侧面选择器字符串（如 ">Z[-2]"）。
 * @param aShape A 侧成员几何（真实 Shape 或借用视图）。
 * @param bPart B 侧成员名。
 * @param bSelector B 侧面选择器字符串。
 * @param bShape B 侧成员几何（真实 Shape 或借用视图）。
 * @param kind 约束种类（Plane/Axis/Point/Cylinder/Distance/Fixed/Revolute）。
 * @param param 可选参数（Distance 的距离值等）。
 * @returns AssemblyConstraint[]（Cylinder 拆两条，其余单条）
 */
export async function constraintEx(
  aPart: string,
  aSelector: string,
  aShape: Shape | null,
  bPart: string,
  bSelector: string,
  bShape: Shape | null,
  kind: AssemblyKind,
  param?: number,
): Promise<AssemblyConstraint[]> {
  switch (kind) {
    case 'Plane': {
      if (!aShape || !bShape) throw new Error(`constraintEx Plane: shapes required`)
      // 提升边界归一：实参可能是借用视图（见 asBrepShape 注释）。faceRef 内部
      // 亦归一，入口再归一保证直接调用路径（不经 compatOp 提升）行为一致。
      const a = await faceRef(aPart, aSelector, asBrepShape(aShape))
      const b = await faceRef(bPart, bSelector, asBrepShape(bShape))
      return [{ type: 'mate', a, b } as AssemblyConstraint]
    }
    case 'Axis': {
      if (!aShape || !bShape) throw new Error(`constraintEx Axis: shapes required`)
      const a = await faceRef(aPart, aSelector, asBrepShape(aShape))
      const b = await faceRef(bPart, bSelector, asBrepShape(bShape))
      // GOTCHA (2026-09-17，对照 CQ 2.8.0 `occ_impl/solver.py` 标定)：CQ 独立 Axis 约束是
      // **纯方向约束**——`ConstraintInvariants["Axis"]` 只收两个 gp_Dir（无点项），
      // `axis_cost` 缺省 `val = pi`（反平行）。此前误映射为 'align'（同向 val=0 + 面心
      // 重合）属双重分歧：mini_lathe e2e 的 c4 被拖向 mb z=-1（参考 +6.1），且凭空多出一
      // 个 CQ 没有的面心重合项。'angle' 在求解器里正是纯方向项（global-solver.ts
      // case 'angle'：axis 成本、无点项），value 单位 deg（180 = 反平行）。
      return [{ type: 'angle', value: 180, a, b } as AssemblyConstraint]
    }
    case 'Point': {
      const pa = parseCoords(aSelector)
      const pb = parseCoords(bSelector)
      if (!pa || !pb) throw new Error(`constraintEx Point: selectors must be coords "x,y,z"`)
      return [{ type: 'coincident', a: pointRef(aPart, pa), b: pointRef(bPart, pb) } as AssemblyConstraint]
    }
    case 'Cylinder': {
      if (!aShape || !bShape) throw new Error(`constraintEx Cylinder: shapes required`)
      const aAxis = await resolveAxisRef(aPart, aShape)
      const bAxis = await resolveAxisRef(bPart, bShape)
      return [
        { type: 'concentric', a: aAxis, b: bAxis } as AssemblyConstraint,
        { type: 'coincident', a: aAxis, b: bAxis } as AssemblyConstraint,
      ]
    }
    case 'Distance': {
      const pa = parseCoords(aSelector)
      const pb = parseCoords(bSelector)
      const a = pa
        ? pointRef(aPart, pa)
        : await faceRef(aPart, aSelector, aShape!)
      const b = pb
        ? pointRef(bPart, pb)
        : await faceRef(bPart, bSelector, bShape!)
      const value = param ?? 0
      return [{ type: 'distance', value, a, b } as AssemblyConstraint]
    }
    case 'Fixed':
      return [{ type: 'fixed', part: aPart } as AssemblyConstraint]
    case 'Revolute':
      // 暂降级为锚定占位（旋转 DOF 留待后续 joints 机制）
      return [{ type: 'fixed', part: aPart } as AssemblyConstraint]
  }
}

/**
 * buildAssembly
 * @param name - string
 * @param members - Array<{ name: string; shape: Shape; color?: RGB }>
 * @param constraints - AssemblyConstraint[]
 * @param opts - optional: { solver?: 'chain' | 'global' }；cq-compat = CadQuery 兼容，默认 'global'
 * @returns CompoundShape
 */
export function buildAssembly(
  name: string,
  members: Array<{ name: string; shape: Shape; color?: RGB }>,
  constraints: AssemblyConstraint[],
  opts?: { solver?: 'chain' | 'global' },
): CompoundShape {
  // 提升边界归一：经 runtime.execute 时 members[].shape 是借用 brepjs 视图
  // （borrowDeep 产物），不是 faijs Shape。compound 的 children 必须持有 mesh
  // （引擎 applyTransform 做顶点烘焙）+ BREP 身份槽（STEP 导出/刚体变换读
  // slot.solid），借用视图两者皆无 → 必须还原为真实 Shape 再进 assembly。
  const shapes = members.map((m) => asBrepShape(m.shape))
  const memberNames = members.map((m) => m.name)
  const memberColors: Record<string, [number, number, number]> = {}
  for (const m of members) {
    if (m.color) memberColors[m.name] = m.color
  }

  // cq-compat 是 CadQuery 兼容层：默认走 global 求解器（语义对齐 CQ solver.py）。
  // 需要旧 chain 行为时可显式 opts.solver='chain'。
  const solver = opts?.solver ?? 'global'

  const compound = cad.assembly({
    name,
    members: shapes,
    memberNames,
    constraints,
    memberColors,
    solver,
  }) as unknown as CompoundShape

  // CadQuery's Assembly.save() solves constraints implicitly before export —
  // mirror that here so CLI STEP export sees the solved part poses.
  // NOTE: cad.assembly attaches solve() to the slot BEHAVIOR, not to the
  // compound object itself — a plain compound.solve lookup is always
  // undefined and the solve silently never ran.
  const behavior = getSlot(compound)?.behavior as { solve?: () => unknown } | undefined
  if (typeof behavior?.solve === 'function') behavior.solve()
  return compound
}

/**
 * Color
 * @param r - number
 * @param g - number
 * @param b - number
 * @param _a - number
 * @returns RGB
 */
export function Color(r: number, g: number, b: number, _a?: number): RGB {
  return [r, g, b]
}
