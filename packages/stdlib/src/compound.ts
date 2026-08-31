/**
 * stdlib compound — group/assembly 库函数（compound Shape + AssemblyBehavior）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.10 / §2.4
 *
 * 从 src/ops/assemble.ts 迁出并改写为 stdlib 形态：
 * - `group(params)` → compound Shape（kind='compound'，children 为成员 Shape 引用）
 * - `assembly(params)` → compound Shape + AssemblyBehavior（约束列表 + solve 方法）
 * - 装配三件套（solveFaceMate / executeDoAssemble / previewAssembly）迁移并挂到 AssemblyBehavior
 *
 * compound 自身无独立 mesh——几何由 children 承载，意义是结构（层级）。
 * do_assemble 编译为 `await ctx.<asm>.do_assemble()`：调用 compound 的 solve 方法，
 * 对 moving 成员施加 face_mate 变换（mesh 顶点烘焙 + BREP 刚体变换 + 下游传播）。
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import { compound as makeCompound, ensureSlot, type CompoundShape } from '@faicad/faijs-core/shape'
import { keep, nameOf, getBackends, setPendingAssemblyTransforms, type AssemblyTransform } from '@faicad/faijs-core/runtime-state'
import type { PartName } from '@faicad/faijs-core/identity'
import type { FaceTopoRef } from '@faicad/faijs-core/topology/naming'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'
import { resolveFaceGeometry, type ResolvedFaceGeometry } from './topo-resolve'

// ── 参数类型（keep-syntax 设计 §2.5：成员保留由函数体 keep() 显式声明，不再靠类型标注） ──

/** Parameters for the `group` stdlib function: an optional name and ordered members. */
export interface GroupParams {
  name?: string
  /** Compound members: read-only references, never mutated by group/assembly. */
  members?: Shape[]
  memberNames?: string[]
}

/** Parameters for the `assembly` stdlib function: group params plus assembly constraints. */
export interface AssemblyParams extends GroupParams {
  constraints?: AssemblyConstraint[]
}

// ── 约束类型 ──

/**
 * 装配约束的一个面：`{ topoRef: FaceTopoRef }`（§6.2 新形态，执行期解析几何）或
 * 旧快照 `{ surfaceType, center, normal }`（兼容已持久化的历史脚本）。
 */
export type FaceMateFace = { topoRef: FaceTopoRef } | {
  surfaceType?: string
  center: [number, number, number]
  normal: [number, number, number]
}

/** A face-mate constraint aligning two faces so the moving face mates against the fixed face. */
export interface FaceMateConstraint {
  type: 'face_mate'
  fixedPartName: PartName
  movingPartName: PartName
  fixedFace: FaceMateFace
  movingFace: FaceMateFace
}

/** The union of supported assembly constraint types (currently only face_mate). */
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

// ── 求解器 ──

/** The rotation and translation that a face-mate constraint resolves to. */
export interface FaceMateTransform {
  quaternion: [number, number, number, number]
  pivot: [number, number, number]
  translation: [number, number, number]
  rotationMatrix: number[]
}

/**
 * Compute the transform that satisfies a face-mate constraint, rotating the
 * moving face so its normal opposes the fixed normal and aligning the centers.
 * @param fixedCenter - the world-space center of the fixed face.
 * @param fixedNormal - the world-space normal of the fixed face.
 * @param movingCenter - the world-space center of the moving face.
 * @param movingNormal - the world-space normal of the moving face.
 * @returns the resolved FaceMateTransform (quaternion, pivot, translation, matrix).
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

// 应用变换（mesh 顶点烘焙）下沉到引擎侧 src/mesh/rigid-transform.ts（E-b：
// module-executor 不得 import stdlib/compound；公共 API 经本 re-export 保持）。
export { applyTransform } from '@faicad/faijs-core/mesh/rigid-transform'

// ── AssemblyBehavior ──

/** Behavior attached to an assembly compound: its members, constraints, and solver. */
export interface AssemblyBehavior {
  name?: string
  memberNames: string[]
  constraints: AssemblyConstraint[]
  /** 只求解（P6）：返回"成员下标 → 变换"列表。不改写入参、不传播；可重复调用（幂等）。 */
  solve(): AssemblyTransform[]
}

/**
 * 纯求解（P6：求解 ≠ 传播）：复用 solveFaceMate 的纯计算，产出变换列表。
 * 不修改任何输入、不触碰引擎状态——引擎负责应用变换并让下游失效重算（F2）。
 *
 * 面参数支持两种形态（§6.2）：
 * - `{ topoRef: FaceTopoRef }`：执行期解析——按成员当前命名槽（BREP 现场/面行快照）
 *   解析出中心与法向，再喂给 solveFaceMate（接口不变，几何执行派生）；
 * - 旧 `{ center, normal }` 快照：直接使用（兼容已持久化的历史脚本）。
 */
function solveTransforms(members: Shape[], behavior: AssemblyBehavior): AssemblyTransform[] {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  const out: AssemblyTransform[] = []
  for (const constraint of behavior.constraints) {
    if (constraint.type !== 'face_mate') {
      throw new Error(`[compound] unsupported constraint type: ${constraint.type}`)
    }
    const movingIndex = behavior.memberNames.indexOf(constraint.movingPartName)
    if (movingIndex < 0) continue
    const movingShape = members[movingIndex]
    if (!movingShape) continue
    const fixedIndex = behavior.memberNames.indexOf(constraint.fixedPartName)
    const fixedShape = fixedIndex >= 0 ? members[fixedIndex] : undefined
    const fixedGeom = geometryOfFace(kernel, fixedShape, constraint.fixedFace)
    const movingGeom = geometryOfFace(kernel, movingShape, constraint.movingFace)
    if (!fixedGeom || !movingGeom) continue
    const transform = solveFaceMate(
      fixedGeom.center,
      fixedGeom.normal,
      movingGeom.center,
      movingGeom.normal,
    )
    out.push({ index: movingIndex, ...transform })
  }
  return out
}

/** 取当前给该行为供内核（null 表示 mesh 路径——解析走行快照）。 */
function geometryOfFace(
  kernel: BrepEngineApi | null,
  shape: Shape | undefined,
  face: FaceMateFace,
): ResolvedFaceGeometry | undefined {
  if (face && typeof face === 'object' && !Array.isArray(face) && (face as { topoRef?: unknown }).topoRef) {
    if (!shape) return undefined
    return resolveFaceGeometry(kernel, shape, (face as { topoRef: FaceTopoRef }).topoRef)
  }
  const snapshot = face as { center?: [number, number, number]; normal?: [number, number, number]; surfaceType?: string }
  if (!snapshot?.center || !snapshot?.normal) return undefined
  return {
    surfaceType: snapshot.surfaceType,
    center: snapshot.center,
    normal: snapshot.normal,
  }
}

// ── group / assembly 库函数 ──

/**
 * 成员名推导：显式 memberNames 兼容旧手工构造 IR；否则经 keep() 反查
 * （P3 起经 keep()/nameOfShapes 反查成员名——库不再访问执行上下文，F1）。
 */
function memberNamesOf(params: { memberNames?: unknown }, members: Shape[]): string[] {
  if (Array.isArray(params.memberNames) && params.memberNames.length > 0) {
    return params.memberNames as string[]
  }
  return members.map((m) => {
    // 兼容字符串形态的 members（历史 IR 直传 partName）：字符串本身就是名字
    if (typeof m === 'string') return m
    return String(nameOf(m) ?? '')
  })
}

/**
 * `cad.group({ name, members })` → compound Shape。
 * members 是成员 Shape（编译产物 ctx.<var> 引用），成员名经 keep() 反查。
 *
 * 函数体 keep 声明（keep-syntax 设计 §2.5）：group 保留其成员且可见（R6）。
 */
/**
 * 分组：零约束，保持当前布局。结构语句，无几何输出，成员用变量名引用。
 * @group 结构
 * @inputs 1
 * @async false
 * @qual ok
 * @name group
 * @returns CompoundShape 复合几何（kind='compound'，children 为成员 Shape 引用）。
 * @param params.name - 组名。type:string
 * @param params.members - 成员（编译产物 ctx.<var> 引用；结构语句里是裸变量引用，非字符串数组）。type:Shape[]
 * @note members 在 .faijs 里是裸变量引用（编译为 ctx.<var>），字符串数组形态的成员名经 keep() 反查兼容历史 IR。
 * @example
 * const part0 = cad.box({ size: [30, 20, 10] })
 * cad.group({ name: '底板组', members: [part0] })
  */
export function group(params: GroupParams): CompoundShape {
  const members = (params.members as Shape[] | undefined) ?? []
  if (members.length > 0) keep(...members)
  const memberNames = memberNamesOf(params, members)
  const c = makeCompound(members)
  // 挂最小 behavior（memberNames 供 ExecutionResult.compounds 结构输出；group 无约束）
  ensureSlot(c).behavior = { memberNames, constraints: [], solve: () => [] }
  return c
}

/**
 * `cad.assembly({ name, members, constraints })` → compound Shape + AssemblyBehavior。
 * 挂 do_assemble 方法（编译产物 `ctx.<asm>.do_assemble()` 调用）。
 *
 * 函数体 keep 声明（keep-syntax 设计 §2.5）：assembly 保留其成员且可见（R6）。
 */
/**
 * 装配：成员 + 面约束（face_mate）。结构语句，无几何输出，成员用变量名引用、约束用拓扑面引用。
 * @group 结构
 * @inputs 1
 * @async false
 * @qual warn
 * @name assembly
 * @returns CompoundShape + AssemblyBehavior（含 do_assemble 方法）。
 * @note 早期文档/示例曾用 `fixedPartId`/`movingPartId`/`faceRowIndex`/`faceId`/`invalid`——这些键在代码中不存在。真实契约是 `fixedPartName`/`movingPartName` + `fixedFace`/`movingFace`。支持两种形态：`{ topoRef: FaceTopoRef }`（§6.2 新形态，几何由 faijs 执行期从面行派生）或旧快照 `{ surfaceType, center, normal }`（兼容历史脚本）。`faceId` 字段随 §6.2 移除，不再写入。
 * @param params.name - 装配名。type:string
 * @param params.members - 成员（裸变量引用）。type:Shape[]
 * @param params.constraints - 面约束数组（type='face_mate'；fixedPartName/movingPartName + fixedFace/movingFace：`{topoRef: FaceTopoRef}` 或 `{surfaceType, center, normal}`）。type:AssemblyConstraint[]
 * @example
 * cad.assembly({ name: '装配1', members: [part0, part1], constraints: [{ type: 'face_mate', fixedPartName: part0, movingPartName: part1, fixedFace: { topoRef: { kind: 'face', origin: 'part0', role: 'box:top', hint: { kind: 'face', surfaceType: 'plane' } } }, movingFace: { topoRef: { kind: 'face', origin: 'part1', role: 'cylinder:bottom', hint: { kind: 'face', surfaceType: 'circle' } } } }] })
  */
export function assembly(params: AssemblyParams): CompoundShape {
  const members = (params.members as Shape[] | undefined) ?? []
  const constraints = (params.constraints as AssemblyConstraint[] | undefined) ?? []

  if (members.length > 0) keep(...members)
  const memberNames = memberNamesOf(params, members)
  const c = makeCompound(members)
  const behavior: AssemblyBehavior = {
    name: params.name as string | undefined,
    memberNames,
    constraints,
    solve: () => solveTransforms(members, behavior),
  }
  ensureSlot(c).behavior = behavior
  ;(c as CompoundShape & { do_assemble?: () => void }).do_assemble = () => {
    // P6：只求解并登记待应用变换；应用与下游失效由引擎做（F2：库不查询/修改 DAG）
    const transforms = behavior.solve()
    if (transforms.length > 0) setPendingAssemblyTransforms(c, transforms)
  }
  // 统一成员调用 ABI：add_constraint 是 no-op（现状语义：约束由 assembly 语句 args.constraints 读取，
  // 编译产物机械发射 `ctx.<asm>.add_constraint({...})`，调用此方法不崩）
  ;(c as CompoundShape & { add_constraint?: () => void }).add_constraint = () => {
    // Phase 1 semantics: constraints are read from the assembly statement's args.constraints;
    // add_constraint is intentionally a no-op (kept for ABI uniformity).
  }
  return c
}
