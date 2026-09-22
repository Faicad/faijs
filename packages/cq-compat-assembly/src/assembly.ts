/**
 * @faicad/cq-compat-assembly — CadQuery-compatible assembly layer for faijs.
 *
 * Maps CadQuery Assembly.constrain DSL ("part@faces@>Z[-2]", "Plane"/"Axis") to
 * faijs AssemblyConstraint objects with EntityRef geometry snapshots, and wraps
 * the faijs core solver behind the CadQuery grammar:
 *
 *   let asm = cq.buildAssembly('name', members, constraints)
 *   let solved = asm.solve()          // CQ Assembly.solve()：封装底层求解器
 *   let result = solved.toCompound()  // CQ Assembly.toCompound()
 *   cq.save(asm, 'out.step')          // CQ Assembly.save()（Node 侧，见 save.ts）
 *
 * Consumers MUST use the CadQuery solve-related API (solve()/toCompound()/save())
 * and MUST NOT probe core internals (e.g. getSlot(compound).behavior.solveDetailed)
 * — the point of this package is to encapsulate the solver behind the CQ grammar.
 *
 * Constraint mapping (verified against faijs api/assembly/lower.ts):
 * - "Plane" → mate (face-to-face: normal reversed + center coincident)
 * - "Axis"  → angle:180 (pure-direction anti-parallel, CQ 2.8.0 solver.py semantics)
 * - "Point" → coincident (selector is literal "x,y,z")
 * - "Cylinder" → [concentric, coincident] (circular-edge axis resolution)
 * - "Distance" → distance(value) (point-point or plane-plane)
 * - "Fixed" → fixed
 * - "Revolute" → fixed (placeholder until joints mechanism lands)
 */

import { createApiNamespace } from '@faicad/faijs/api/api-namespace'
import type { Shape } from '@faicad/faijs/mesh/types'
import type {
  AssemblyConstraint,
  EntityRef,
} from '@faicad/faijs/api/assembly/types'
import type { CompoundShape } from '@faicad/faijs/shape'
import { getSlot, brepOf, ensureSlot } from '@faicad/faijs/shape'
import { getBackends } from '@faicad/faijs/runtime-state'
import { applyTransform } from '@faicad/faijs/mesh/rigid-transform'
import { applyTransformBrep } from '@faicad/faijs/brep/brep-ops'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import type { AssemblyTransform } from '@faicad/faijs/runtime-state'
import type { RGB } from '@faicad/cq-compat'
import { resolveFaceSelector, asBrepShape } from '@faicad/cq-compat'

/**
 * 装配输入归一：Workplane 载体（{ shape }，cq.box 等产物）→ 内部 Shape，
 * 再经 asBrepShape 处理借用视图。CadQuery 上游装配 API 接受 Workplane 或 Shape
 * 两种形态（「.face(选择器)」模式），此处对齐——否则传 Workplane 时
 * asBrepShape 原样透传，faceRef 内 brepOf(shape) 为 undefined 崩溃。
 */
function resolveAssemblyShape(v: unknown): Shape {
  const s =
    v !== null && typeof v === 'object' && 'shape' in v
      ? (v as { shape?: unknown }).shape
      : v
  return asBrepShape(s) as Shape
}

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
  if (!handle || !kernel) throw new Error(`[cq-compat-assembly] axisRef: BREP unavailable for part "${part}"`)
  // 整形状一次 wireframe，按 edgeGroups 逐边取折线区间。
  // 依据 topologyExt.ts：wireframe() 与 getSubShapes 同用 TopExp::MapShapes +
  // IndexedMap，故 edge 枚举顺序一致——第 i 条 edge 对应 edgeGroups[i*3..]。
  const wf = kernel.wireframe(handle as never, 0.01)
  const groups = wf.edgeGroups
  if (!groups || groups.length < 3) throw new Error(`[cq-compat-assembly] axisRef: wireframe returned no edge groups for part "${part}"`)
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
  throw new Error(`[cq-compat-assembly] axisRef: no circular edge found in part "${part}"`)
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
      const a = await faceRef(aPart, aSelector, resolveAssemblyShape(aShape))
      const b = await faceRef(bPart, bSelector, resolveAssemblyShape(bShape))
      return [{ type: 'mate', a, b } as AssemblyConstraint]
    }
    case 'Axis': {
      if (!aShape || !bShape) throw new Error(`constraintEx Axis: shapes required`)
      const a = await faceRef(aPart, aSelector, resolveAssemblyShape(aShape))
      const b = await faceRef(bPart, bSelector, resolveAssemblyShape(bShape))
      // GOTCHA (2026-09-17，对照 CQ 2.8.0 `occ_impl/solver.py` 标定)：CQ 独立 Axis 约束是
      // **纯方向约束**——`ConstraintInvariants["Axis"]` 只收两个 gp_Dir（无点项），
      // `axis_cost` 缺省 `val = pi`（反平行）。此前误映射为 'align'（同向 val=0 + 面心
      // 重合）属双重分歧：真实 e2e 的 c4 被拖向 mb z=-1（参考 +6.1），且凭空多出一
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

/** 装配成员（CQ Assembly.objects 语义）。 */
export interface CqAssemblyMember {
  name: string
  shape: Shape
  color?: RGB
}

/**
 * CQ 风格装配对象（CQ Assembly 兼容面）。
 *
 * buildAssembly 返回本对象；求解封装底层 faijs 求解器，消费方只允许经
 * solve()/toCompound()/save() 访问——禁止直调 core 内部
 * （getSlot(compound).behavior.solveDetailed 等）。
 */
export interface CqAssembly {
  /** 装配名。 */
  name: string
  /** 成员表（name + shape；solve() 后 shape 为已烘焙位姿）。 */
  members: CqAssemblyMember[]
  /** 求解器选择：'global'（默认，CQ 语义）| 'chain'（legacy 链式）。 */
  solver: 'chain' | 'global'
  /** solve() 后填充：逐约束终态残差（global 路径；chain 路径不填）。 */
  residuals?: number[]
  /** 未支持约束的自由度合计（诊断量；收敛时为 0）。 */
  dof: number
  /** 是否全部约束可解。 */
  converged: boolean
  /** 无法求解的约束明细（entity 类型不匹配 / 参考不可达）。 */
  unsupported: string[]
  /** solve() 后填充：per-member 终态变换（index = 成员下标；恒等位姿不输出）。 */
  transforms: AssemblyTransform[]
  /** 装配体（compound；solve() 后成员位姿已烘焙进 children）。 */
  compound: CompoundShape
  /** 是否已调用 solve()。 */
  solved: boolean
  /**
   * 求解装配（CQ Assembly.solve()）。封装底层求解器：
   * 求解 → 位姿烘焙进成员（mesh 顶点原地变换 + BREP slot.solid 刚体变换）→
   * 记录 residuals/dof/converged/unsupported/transforms → 返回自身。
   * 幂等：重复调用直接返回（成员已烘焙，避免双重变换）。
   */
  solve(): CqAssembly
  /** 取已求解装配体（CQ Assembly.toCompound()）。 */
  toCompound(): CompoundShape
}

/** solveDetailed 返回面（core AssemblySolveResult 的运行时形态；residuals 仅 global 路径填）。 */
type AssemblySolveResultLike = {
  transforms: AssemblyTransform[]
  dof: number
  converged: boolean
  unsupported: string[]
  residuals?: number[]
}

/**
 * buildAssembly — 构造 CQ 风格装配对象（不求解；位姿求解在 solve()）。
 * @param name - string
 * @param members - Array<{ name: string; shape: Shape; color?: RGB }>
 * @param constraints - AssemblyConstraint[]
 * @param opts - optional: { solver?: 'chain' | 'global' }；默认 'global'（CQ 语义）
 * @returns CqAssembly
 */
export function buildAssembly(
  name: string,
  members: Array<{ name: string; shape: Shape; color?: RGB }>,
  constraints: AssemblyConstraint[],
  opts?: { solver?: 'chain' | 'global' },
): CqAssembly {
  // 提升边界归一：经 runtime.execute 时 members[].shape 是借用 brepjs 视图
  // （borrowDeep 产物），不是 faijs Shape。compound 的 children 必须持有 mesh
  // （引擎 applyTransform 做顶点烘焙）+ BREP 身份槽（STEP 导出/刚体变换读
  // slot.solid），借用视图两者皆无 → 必须还原为真实 Shape 再进 assembly。
  const shapes = members.map((m) => resolveAssemblyShape(m.shape))
  const memberNames = members.map((m) => m.name)
  const memberColors: Record<string, [number, number, number]> = {}
  for (const m of members) {
    if (m.color) memberColors[m.name] = m.color
  }

  // cq-compat-assembly 是 CadQuery 兼容层：默认走 global 求解器（语义对齐 CQ
  // solver.py）。需要旧 chain 行为时可显式 opts.solver='chain'。
  const solver = opts?.solver ?? 'global'

  const compound = cad.assembly({
    name,
    members: shapes,
    memberNames,
    constraints,
    memberColors,
    solver,
  }) as unknown as CompoundShape

  const asm: CqAssembly = {
    name,
    members: members.map((m, i) => ({ name: m.name, shape: shapes[i], color: m.color })),
    solver,
    residuals: undefined,
    dof: 0,
    converged: true,
    unsupported: [],
    transforms: [],
    compound,
    solved: false,
    solve() {
      // 幂等守卫：成员位姿已在首次 solve() 烘焙，重复求解会二次变换。
      if (this.solved) return this

      // CadQuery's Assembly.solve() solves constraints before export — the faijs
      // solver itself is wrapped here so consumers never touch core internals.
      // GOTCHA (2026-09-18)：引擎只有 direct-executor 路径消费 pending transforms
      // （applyPendingAssemblyTransforms）；CLI brep 模块路径无人消费 → 登记 pending
      // 也没用，成员停在恒等位姿。因此这里直接 solveDetailed() 拿到 transforms，
      // 在库侧把位姿烘焙进成员：mesh 顶点原地变换 + BREP slot.solid 刚体变换
      // （与 direct-executor 同语义）。behavior.solve/compound.solve 的 pending 登记
      // 保留（direct 路径仍走引擎烘焙），但本封装不再依赖它。
      const behavior = getSlot(this.compound)?.behavior as
        | { memberNames?: string[]; solveDetailed?: () => AssemblySolveResultLike }
        | undefined
      const result: AssemblySolveResultLike = behavior?.solveDetailed?.() ?? { transforms: [], dof: 0, converged: true, unsupported: [] }
      this.transforms = result.transforms
      this.residuals = result.residuals
      this.dof = result.dof
      this.converged = result.converged
      this.unsupported = result.unsupported
      if (!result.converged) {
        throw new Error(
          `[cq-compat-assembly] solve() did not converge (dof=${result.dof}); unsupported: ` +
            (result.unsupported.length > 0 ? result.unsupported.join(', ') : '(no detail)'),
        )
      }

      // CQ 语义对齐：无约束成员（如 assemb.py 里仅 .add 的 slide_top）在 CQ 求解器
      // 中固定在初始位姿（不被拉入最小化）；我方 global 求解器会给自由成员漂移解，
      // 烘焙前按「是否被约束引用」过滤，未引用成员保持恒等。
      const referenced = new Set<string>()
      for (const c of constraints) {
        // StructuralConstraint 形态是 { a: EntityRef, b: EntityRef }（EntityRef.part
        // = 成员名）；cq-compat 的 constraint() 只产出该形态。FaceMateConstraint 无
        // a/b，用 in 收窄跳过。
        if ('a' in c && 'b' in c) {
          for (const ref of [c.a, c.b] as Array<{ part?: string }>) {
            if (ref && typeof ref.part === 'string') referenced.add(ref.part)
          }
        }
      }
      const baked = result.transforms.filter((t) => referenced.has(behavior?.memberNames?.[t.index] ?? ''))
      if (baked.length > 0) {
        const kernel = getBackends().kernel.brep as BrepEngineApi | null
        const children = (this.compound as unknown as { children?: Shape[] }).children ?? []
        for (const t of baked) {
          const member = children[t.index]
          if (!member || typeof member !== 'object') continue
          // mesh 顶点原地变换（保留对象引用，ctx 与 compound.children 同步看到变更）
          Object.assign(member, applyTransform(member, t.quaternion, t.pivot, t.translation, t.rotationMatrix))
          // BREP 刚体变换：新 solid 写回身份槽（STEP 导出读 slot.solid）。
          // GOTCHA：旧 solid 句柄**不能 release**——solidCache（partName 键）仍指向
          // 它，库侧无法同步该缓存（setSolidHook 是宿主注入），release 后拓扑构建
          // 读到悬空句柄报 INVALID_SHAPE_ID；保留旧句柄仅浪费少量内存。
          if (kernel) {
            const solid = brepOf(member) as BrepHandle | undefined
            if (solid) {
              const transformed = applyTransformBrep(kernel, solid, t.quaternion, t.pivot, t.translation)
              ensureSlot(member).solid = transformed
            }
          }
        }
      }
      this.solved = true
      return this
    },
    toCompound() {
      return this.compound
    },
  }
  return asm
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
