/**
 * stdlib compound — group/assembly 库函数（compound Shape + AssemblyBehavior）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.10 / §2.4
 *
 * 从 src/ops/assemble.ts 迁出并改写为 stdlib 形态：
 * - `group(params, exec)` → compound Shape（kind='compound'，children 为成员 Shape 引用）
 * - `assembly(params, exec)` → compound Shape + AssemblyBehavior（约束列表 + solve 方法）
 * - 装配三件套（solveFaceMate / executeDoAssemble / previewAssembly）迁移并挂到 AssemblyBehavior
 *
 * compound 自身无独立 mesh——几何由 children 承载，意义是结构（层级）。
 * do_assemble 编译为 `ctx.<asm>.do_assemble(exec)`：调用 compound 的 solve 方法，
 * 对 moving 成员施加 face_mate 变换（mesh 顶点烘焙 + BREP 刚体变换 + 下游传播）。
 */

import type { Shape, ReadonlyShape } from '../mesh/types'
import { compound as makeCompound, ensureSlot, type CompoundShape } from './shape'
import { applyTransformBrep } from '../brep/brep-ops'
import type { ExecContext } from '../cad-runtime/exec-context'
import type { PartName } from '../identity'

// ── 参数类型（设计文档 §4.6：members readonly 标注供符号表提取） ──

export interface GroupParams {
  name?: string
  /** Compound members: read-only references, never mutated by group/assembly. */
  members?: readonly ReadonlyShape[]
  memberNames?: string[]
}

export interface AssemblyParams extends GroupParams {
  constraints?: AssemblyConstraint[]
}

// ── 约束类型 ──

export interface FaceMateConstraint {
  type: 'face_mate'
  fixedPartName: PartName
  movingPartName: PartName
  fixedFace: {
    surfaceType: string
    center: [number, number, number]
    normal: [number, number, number]
  }
  movingFace: {
    surfaceType: string
    center: [number, number, number]
    normal: [number, number, number]
  }
}

export type AssemblyConstraint = FaceMateConstraint

// ── 向量数学（无 three.js 依赖，纯计算） ──

function vec3Normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  if (len < 1e-12) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

function vec3Sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function vec3Cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function vec3Dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** 从两个单位向量计算旋转四元数 (a → b)，Rodrigues 公式。 */
function quaternionFromUnitVectors(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number, number] {
  const cross = vec3Cross(a, b)
  const dot = vec3Dot(a, b)

  if (dot > 1 - 1e-9) {
    return [0, 0, 0, 1]
  }
  if (dot < -1 + 1e-9) {
    const axis = Math.abs(a[0]) < 0.9 ? [1, 0, 0] as [number, number, number] : [0, 1, 0] as [number, number, number]
    const perp = vec3Normalize(vec3Cross(a, axis))
    return [perp[0], perp[1], perp[2], 0]
  }

  const w = 1 + dot
  const len = Math.sqrt(cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2] + w * w)
  return [cross[0] / len, cross[1] / len, cross[2] / len, w / len]
}

/** 四元数 → 旋转矩阵 (3x3, row-major)。 */
function quaternionToMatrix3(q: [number, number, number, number]): number[] {
  const [x, y, z, w] = q
  const xx = x * x, yy = y * y, zz = z * z
  const xy = x * y, xz = x * z, yz = y * z
  const wx = w * x, wy = w * y, wz = w * z

  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]
}

/** 矩阵 × 向量 (3x3 * 3)。 */
function mat3MulVec(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

// ── 求解器 ──

export interface FaceMateTransform {
  quaternion: [number, number, number, number]
  pivot: [number, number, number]
  translation: [number, number, number]
  rotationMatrix: number[]
}

/**
 * 计算 face_mate 约束的变换（使 movingFace.normal → -fixedFace.normal + 中心重合）。
 */
export function solveFaceMate(
  fixedCenter: [number, number, number],
  fixedNormal: [number, number, number],
  movingCenter: [number, number, number],
  movingNormal: [number, number, number],
): FaceMateTransform {
  const n1 = vec3Normalize(fixedNormal)
  const p1 = fixedCenter
  const n2 = vec3Normalize(movingNormal)
  const p2 = movingCenter

  const targetNormal: [number, number, number] = [-n1[0], -n1[1], -n1[2]]
  const quaternion = quaternionFromUnitVectors(n2, targetNormal)
  const rotationMatrix = quaternionToMatrix3(quaternion)
  const translation = vec3Sub(p1, p2)

  return { quaternion, pivot: p2, translation, rotationMatrix }
}

/** 将变换应用到 Shape（绕 pivot 旋转后平移，顶点烘焙）。 */
export function applyTransform(
  shape: Shape,
  quaternion: [number, number, number, number],
  pivot: [number, number, number],
  translation: [number, number, number],
  rotationMatrix: number[],
): Shape {
  const positions = shape.positions
  const newPositions = new Float32Array(positions.length)

  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i] - pivot[0]
    const py = positions[i + 1] - pivot[1]
    const pz = positions[i + 2] - pivot[2]

    const rotated = mat3MulVec(rotationMatrix, [px, py, pz])

    newPositions[i] = rotated[0] + pivot[0] + translation[0]
    newPositions[i + 1] = rotated[1] + pivot[1] + translation[1]
    newPositions[i + 2] = rotated[2] + pivot[2] + translation[2]
  }

  return {
    positions: newPositions,
    indices: shape.indices,
  }
}

// ── AssemblyBehavior ──

export interface AssemblyBehavior {
  name?: string
  memberNames: string[]
  constraints: AssemblyConstraint[]
  /** 执行装配：对 moving 成员施加 face_mate 变换（mesh + BREP + 下游传播）。
   *  可选 exec：do_assemble 分次 append 时传入当前执行上下文（touch/变更声明
   *  必须落在当前 exec 上，collectResult 才读得到 touchedShapes）。 */
  solve(exec?: ExecContext): void
}

/**
 * 沿 inputs 链把装配变换传播到下游 mesh shape（并同步回 ctx 与 outputCache）。
 */
/** 执行装配变换（AssemblyBehavior.solve 的核心）。只使用 ExecContext 平台 API，不依赖引擎实现内部。 */
function solveAssembly(compound: CompoundShape, behavior: AssemblyBehavior, exec: ExecContext): void {
  const children = compound.children
  const kernel = exec.kernels.occt

  for (const constraint of behavior.constraints) {
    if (constraint.type !== 'face_mate') {
      throw new Error(`[compound] unsupported constraint type: ${constraint.type}`)
    }

    const movingIndex = behavior.memberNames.indexOf(constraint.movingPartName)
    if (movingIndex < 0) continue
    const movingShape = children[movingIndex]
    if (!movingShape) continue

    const transform = solveFaceMate(
      constraint.fixedFace.center,
      constraint.fixedFace.normal,
      constraint.movingFace.center,
      constraint.movingFace.normal,
    )

    // 1. Mesh 变换（原地修改：保留同一对象引用，ctx 与 compound.children 同步看到变更）
    Object.assign(movingShape, applyTransform(
      movingShape, transform.quaternion, transform.pivot, transform.translation, transform.rotationMatrix,
    ))

    // 2. BREP 刚体变换（可选）
    const movingSolid = exec.getSolid(movingShape)
    if (kernel && movingSolid) {
      const transformedSolid = applyTransformBrep(
        kernel, movingSolid, transform.quaternion, transform.pivot, transform.translation,
      )
      try { kernel.release(movingSolid) } catch { /* 已释放 */ }
      exec.setSolid(movingShape, transformedSolid)
    }

    // 3. 下游 mesh 传播（原地修改 + touch；下游 solid 由 setSolid 身份槽保留）
    for (const downstream of exec.dependentsOf(movingShape)) {
      if (downstream === movingShape) continue
      Object.assign(downstream, applyTransform(
        downstream, transform.quaternion, transform.pivot, transform.translation, transform.rotationMatrix,
      ))
      exec.touch(downstream)
    }

    // 4. 变更声明：moving 成员列入 ExecutionResult.changed
    exec.touch(movingShape)
  }
}

// ── group / assembly 库函数 ──

/**
 * 从当前语句的 args.members（VarRef 形态，编译产物 `members:[ctx.a,ctx.b]`）推导成员变量名。
 * 统一 ABI 后编译产物不再发射 memberNames 键（§5.2）；成员名由库函数从 IR 元数据自己解释。
 * 兼容旧手工构造 IR（字符串数组 / 显式 memberNames）。
 */
function deriveMemberNames(params: { memberNames?: unknown; members?: unknown }, exec: ExecContext): string[] {
  if (Array.isArray(params.memberNames) && params.memberNames.length > 0) {
    return params.memberNames as string[]
  }
  const members = params.members
  if (!Array.isArray(members)) return []
  const stmtMembers = (exec.currentStmt?.args?.members as unknown[] | undefined) ?? []
  if (stmtMembers.length !== members.length) return []
  const names: string[] = []
  for (const m of stmtMembers) {
    if (typeof m === 'string') names.push(m)
    else if (m && typeof m === 'object' && '$ref' in m) names.push((m as { $ref: string }).$ref)
    else return []
  }
  return names
}

/**
 * `cad.group({ name, members }, exec)` → compound Shape。
 * members 是成员 Shape（编译产物 ctx.<var> 引用），成员名从 IR 元数据推导。
 */
export function group(params: GroupParams, exec: ExecContext): CompoundShape {
  const members = (params.members as Shape[] | undefined) ?? []
  const memberNames = deriveMemberNames(params, exec)
  const c = makeCompound(members)
  // 挂最小 behavior（memberNames 供 ExecutionResult.compounds 结构输出；group 无约束）
  ensureSlot(c).behavior = { memberNames, constraints: [], solve: () => {} }
  return c
}

/**
 * `cad.assembly({ name, members, constraints }, exec)` → compound Shape + AssemblyBehavior。
 * 挂 do_assemble 方法（编译产物 `ctx.<asm>.do_assemble(exec)` 调用）。
 */
export function assembly(params: AssemblyParams, exec: ExecContext): CompoundShape {
  const members = (params.members as Shape[] | undefined) ?? []
  const memberNames = deriveMemberNames(params, exec)
  const constraints = (params.constraints as AssemblyConstraint[] | undefined) ?? []

  const c = makeCompound(members)
  const behavior: AssemblyBehavior = {
    name: params.name as string | undefined,
    memberNames,
    constraints,
    solve: (e?: ExecContext) => solveAssembly(c, behavior, e ?? exec),
  }
  ensureSlot(c).behavior = behavior
  ;(c as CompoundShape & { do_assemble?: (e: ExecContext) => void }).do_assemble = (e: ExecContext) => {
    // 用当前执行上下文求解：分次 append（3d_editor appendAndCommit）时
    // 每次 runtime.append 新建 exec，touch/变更声明必须落在当前 exec 上，
    // collectResult 才能反同步装配变换后的 solid 到 solidCache。
    behavior.solve(e)
  }
  // 统一成员调用 ABI：add_constraint 是 no-op（现状语义：约束由 assembly 语句 args.constraints 读取，
  // 编译产物机械发射 `ctx.<asm>.add_constraint({...}, exec)`，调用此方法不崩）
  ;(c as CompoundShape & { add_constraint?: (args: unknown, e: ExecContext) => void }).add_constraint = () => {
    // Phase 1 semantics: constraints are read from the assembly statement's args.constraints;
    // add_constraint is intentionally a no-op (kept for ABI uniformity).
  }
  return c
}
