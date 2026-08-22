/**
 * 装配约束求解器 — E15.1
 *
 * 当 `do_assemble()` 脚本语句被执行时，从 `assemble` 定义和 `add_constraint` 约束
 * 中计算变换矩阵，应用到 movingPartName 对应的几何上。
 *
 * 现阶段只支持 face_mate 约束（面贴合），求解器可简化为直接计算。
 * 未来支持多约束联合求解（face_mate/coaxial/parallel/distance/angle 等）。
 *
 * 约束数据结构：
 * - type: 'face_mate'（现阶段唯一支持的类型）
 * - fixedPartName: 固定件 partName
 * - movingPartName: 活动件 partName
 * - fixedFace: { faceId, surfaceType, center, normal } — center/normal 从拓扑数据派生
 * - movingFace: { faceId, surfaceType, center, normal } — center/normal 从拓扑数据派生
 *
 * 数学（面贴合 + 中心重合）：
 * 1. 旋转 q1：使 movingFace.normal → -fixedFace.normal（法线反向平行，面贴合）
 * 2. 平移：fixedFace.center - movingFace.center（使中心点重合）
 */

import type { Shape } from './types'
import type { PartScript, CadStatement } from '../lang/types'
import type { BrepChainState } from '../brep/brep-chain'
import { applyTransformBrep } from '../brep/brep-ops'

// ── 约束类型 ──

export interface FaceMateConstraint {
  type: 'face_mate'
  fixedPartName: string
  movingPartName: string
  fixedFace: {
    faceId: string
    surfaceType: string
    center: [number, number, number]
    normal: [number, number, number]
  }
  movingFace: {
    faceId: string
    surfaceType: string
    center: [number, number, number]
    normal: [number, number, number]
  }
}

export type AssemblyConstraint = FaceMateConstraint

// ── 装配定义 ──

export interface AssemblyDefinition {
  name?: string
  members: string[]
  constraints: AssemblyConstraint[]
}

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

/**
 * 从两个单位向量计算旋转四元数 (a → b)。
 * 使用 Rodrigues 公式。
 */
function quaternionFromUnitVectors(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number, number] {
  // 叉积
  const cross = vec3Cross(a, b)
  // 点积
  const dot = vec3Dot(a, b)

  // 处理平行/反平行情况
  if (dot > 1 - 1e-9) {
    // a ≈ b，无旋转
    return [0, 0, 0, 1]
  }
  if (dot < -1 + 1e-9) {
    // a ≈ -b，绕任意垂直轴旋转 180°
    // 找一个不平行于 a 的轴
    const axis = Math.abs(a[0]) < 0.9 ? [1, 0, 0] as [number, number, number] : [0, 1, 0] as [number, number, number]
    const perp = vec3Normalize(vec3Cross(a, axis))
    return [perp[0], perp[1], perp[2], 0]
  }

  // 正常情况：四元数 = [cross, 1+dot] 归一化
  const w = 1 + dot
  const len = Math.sqrt(cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2] + w * w)
  return [cross[0] / len, cross[1] / len, cross[2] / len, w / len]
}

/**
 * 四元数 → 旋转矩阵 (3x3, row-major)
 */
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

/**
 * 矩阵 × 向量 (3x3 * 3)
 */
function mat3MulVec(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

// ── 求解器 ──

/**
 * 计算 face_mate 约束的变换。
 *
 * 返回 { quaternion, pivot, translation }：
 * - quaternion: 使 movingFace.normal → -fixedFace.normal 的旋转
 * - pivot: 旋转中心（movingFace.center）
 * - translation: 旋转后的平移量（使中心重合）
 */
export function solveFaceMate(
  fixedCenter: [number, number, number],
  fixedNormal: [number, number, number],
  movingCenter: [number, number, number],
  movingNormal: [number, number, number],
): {
  quaternion: [number, number, number, number]
  pivot: [number, number, number]
  translation: [number, number, number]
  rotationMatrix: number[]
} {
  const n1 = vec3Normalize(fixedNormal)
  const p1 = fixedCenter
  const n2 = vec3Normalize(movingNormal)
  const p2 = movingCenter

  // 旋转：使 n2 → -n1
  const targetNormal: [number, number, number] = [-n1[0], -n1[1], -n1[2]]
  const quaternion = quaternionFromUnitVectors(n2, targetNormal)

  // 旋转后的 movingCenter
  const rotationMatrix = quaternionToMatrix3(quaternion)
  // 绕 pivot(p2) 旋转后的中心位置 = R * (p2 - p2) + p2 = p2
  // 然后平移 p1 - p2
  const translation = vec3Sub(p1, p2)

  return { quaternion, pivot: p2, translation, rotationMatrix }
}

/**
 * 将变换应用到 Shape（旋转 + 平移）。
 *
 * 绕 pivot 旋转后，再平移。
 * 这是 do_assemble() 在引擎内部执行的变换逻辑。
 */
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
    // p' = R * (p - pivot) + pivot + translation
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

// ── 执行函数 ──

/**
 * executeDoAssemble 的可选上下文：BREP 链与脚本 DAG。
 *
 * 传入后，装配变换会同时施加到 BREP solidCache 中的 OCCT 实体（BREP 路径），
 * 并沿 inputs 链传播到下游 mesh shape。不传则只做 mesh 变换，不传播、不碰 BREP。
 */
export interface DoAssembleContext {
  /** BREP 链状态（含 solidCache / kernel）。传入则施加 BREP 刚体变换。 */
  brepChain?: BrepChainState
  /** 整场景 DAG，用于下游 mesh 传播。传入则沿 inputs 链传播变换到下游 shape。 */
  script?: PartScript
}

/**
 * 执行 do_assemble：从 assemble 定义和约束中计算变换，应用到活动件几何。
 *
 * 此函数是**装配执行的唯一真源**——runtime.executeAssemblyPass 与
 * executeScript.ts 的脚本导入路径都调用它，保证两入口行为一致。
 *
 * Mesh 路径：对 outputCache 中的 moving part 几何应用变换（顶点烘焙）。
 * BREP 路径（可选）：对 solidCache 中的 OCCT 实体施加 kernel.transform 刚体变换。
 * 下游传播（可选）：沿 inputs 链把同一变换传播到所有依赖 moving part 的下游 mesh shape。
 *
 * @param assemblyDef 装配定义（name/members/constraints）
 * @param outputCache 当前重放的输出缓存，用于查找 partName → Shape
 * @param ctx   可选上下文（brepChain + script），控制 BREP 变换与下游传播
 * @returns 变换后的 Shape Map（movingPartName → transformed Shape）
 */
export function executeDoAssemble(
  assemblyDef: AssemblyDefinition,
  outputCache: Map<string, Shape>,
  ctx?: DoAssembleContext,
): Map<string, Shape> {
  const results = new Map<string, Shape>()
  const script = ctx?.script
  const brepChain = ctx?.brepChain
  const kernel = brepChain?.kernel ?? null
  const solidCache = brepChain?.solidCache

  // 按约束逐个求解并应用变换
  // 现阶段每个约束独立处理（face_mate）
  // 未来：联合求解所有约束
  for (const constraint of assemblyDef.constraints) {
    if (constraint.type !== 'face_mate') {
      throw new Error(`[assemble] unsupported constraint type: ${constraint.type}`)
    }

    const movingPartName = constraint.movingPartName
    const movingShape = outputCache.get(movingPartName)
    if (!movingShape) {
      throw new Error(`[assemble] moving part not found in outputCache: ${movingPartName}`)
    }

    const { quaternion, pivot, translation, rotationMatrix } = solveFaceMate(
      constraint.fixedFace.center,
      constraint.fixedFace.normal,
      constraint.movingFace.center,
      constraint.movingFace.normal,
    )

    // 1. Mesh 变换
    const transformed = applyTransform(
      movingShape,
      quaternion,
      pivot,
      translation,
      rotationMatrix,
    )
    outputCache.set(movingPartName, transformed)
    results.set(movingPartName, transformed)

    // 2. BREP 变换（可选）：对 OCCT solid 施加同一刚体变换
    if (kernel && solidCache) {
      const movingSolid = solidCache.get(movingPartName)
      if (movingSolid) {
        const transformedSolid = applyTransformBrep(
          kernel, movingSolid, quaternion, pivot, translation,
        )
        // 顶替释放：释放旧 handle，替换 solidCache 条目（与 runtime 既有协议一致）
        try { kernel.release(movingSolid) } catch { /* 已释放 */ }
        solidCache.set(movingPartName, transformedSolid)
      }
    }

    // 3. 下游 mesh 传播（可选）：沿 inputs 链把变换传播到依赖该 moving part 的下游 shape
    if (script) {
      propagateTransformDownstream(
        outputCache, script, movingPartName,
        quaternion, pivot, translation, rotationMatrix,
      )
    }
  }

  return results
}

/**
 * 将装配变换沿 inputs 链传播到所有依赖于 sourceId 的下游 mesh shape。
 *
 * 例如：part1_v1 = translate(part1_v0, offset) 中，
 * 如果 part1_v0 被 do_assemble 变换了，part1_v1 也需要应用同样的变换。
 *
 * 只传播 mesh（outputCache 中的 Shape），不传播 BREP solid——
 * 下游 BREP 消费者（如布尔合并后的结果）是已固化 solid，简单再变换会重复叠加。
 * 在常见装配场景下 moving part 是终端、不被其它几何 op 消费，故只变换其自身 solid 即正确。
 */
function propagateTransformDownstream(
  outputCache: Map<string, Shape>,
  script: PartScript,
  sourceId: string,
  quaternion: [number, number, number, number],
  pivot: [number, number, number],
  translation: [number, number, number],
  rotationMatrix: number[],
  visited: Set<string> = new Set(),
): void {
  if (visited.has(sourceId)) return
  visited.add(sourceId)

  for (const stmt of script.statements) {
    if (stmt.inputs.includes(sourceId)) {
      const downstreamShape = outputCache.get(stmt.id)
      if (downstreamShape && downstreamShape.positions) {
        const transformed = applyTransform(
          downstreamShape, quaternion, pivot, translation, rotationMatrix,
        )
        outputCache.set(stmt.id, transformed)
        // 递归传播到更下游
        propagateTransformDownstream(
          outputCache, script, stmt.id,
          quaternion, pivot, translation, rotationMatrix, visited,
        )
      }
    }
  }
}

/**
 * 装配预览：给定约束，计算变换但不修改 outputCache。
 *
 * 返回每个 movingPartName 对应的变换矩阵，
 * 宿主可以用它来设置 mesh 矩阵（只改 mesh 矩阵，不烘焙顶点）。
 *
 * D 类预览 API。
 */
export function previewAssembly(
  constraints: AssemblyConstraint[],
): Map<string, {
  quaternion: [number, number, number, number]
  pivot: [number, number, number]
  translation: [number, number, number]
  rotationMatrix: number[]
}> {
  const results = new Map<string, {
    quaternion: [number, number, number, number]
    pivot: [number, number, number]
    translation: [number, number, number]
    rotationMatrix: number[]
  }>()

  for (const constraint of constraints) {
    if (constraint.type !== 'face_mate') {
      throw new Error(`[assemble] unsupported constraint type: ${constraint.type}`)
    }

    const { quaternion, pivot, translation, rotationMatrix } = solveFaceMate(
      constraint.fixedFace.center,
      constraint.fixedFace.normal,
      constraint.movingFace.center,
      constraint.movingFace.normal,
    )

    results.set(constraint.movingPartName, { quaternion, pivot, translation, rotationMatrix })
  }

  return results
}

/**
 * 从 do_assemble 语句执行装配变换 pass（独立函数，不依赖 CadRuntime 实例）。
 *
 * 这是 `CadRuntime.executeAssemblyPass` 的核心逻辑提取，供不经过 CadRuntime
 * 的执行路径（如 3d_editor 的 executeScript 循环）直接调用。
 *
 * 逻辑：
 * 1. 从 `doAssembleStmt.assemblyTarget` 找到对应的 `assembly` 语句
 * 2. 从 `assembly.args.constraints` 读取约束
 * 3. 构造 `AssemblyDefinition`
 * 4. 委托 `executeDoAssemble` 执行变换（mesh + BREP + 下游传播）
 *
 * @param doAssembleStmt do_assemble 语句（returnType='void'）
 * @param outputCache 输出缓存（被变换直接修改）
 * @param script 整场景 DAG（用于查找 assembly 语句 + 下游传播）
 * @param brepChain BREP 链状态（可选，传入则施加 BREP 刚体变换）
 * @returns 被变换的 part name 集合（moving parts + 下游传播的 parts）
 */
export function executeAssemblyPassForStmt(
  doAssembleStmt: CadStatement,
  outputCache: Map<string, Shape>,
  script: PartScript,
  brepChain?: BrepChainState,
): Set<string> {
  const target = doAssembleStmt.assemblyTarget
  if (!target) return new Set()

  // 找到 assemblyTarget 指向的 assembly 语句
  const assemblyStmt = script.statements.find(s => s.id === target)
  if (!assemblyStmt || assemblyStmt.op !== 'assembly') return new Set()

  // 从 assembly 语句的 args.constraints 中读取约束
  const constraints = (assemblyStmt.args?.constraints as unknown as AssemblyConstraint[]) ?? []
  if (!Array.isArray(constraints) || constraints.length === 0) return new Set()

  // 构造 AssemblyDefinition，委托 executeDoAssemble 执行
  const assemblyDef: AssemblyDefinition = {
    name: assemblyStmt.args?.name as string | undefined,
    members: (assemblyStmt.args?.members as string[]) ?? [],
    constraints,
  }

  // 传入 brepChain（含 solidCache / kernel）使 BREP 路径同步变换；
  // 传入 script 使下游 mesh 传播生效。
  const results = executeDoAssemble(assemblyDef, outputCache, {
    brepChain: brepChain ?? undefined,
    script,
  })

  // 收集被变换的 part names（executeDoAssemble 返回的直接变换结果）
  const transformedIds = new Set<string>(results.keys())
  // 下游传播的 part 也需要同步（propagateTransformDownstream 修改了 outputCache 但不返回哪些被改了）
  // 简单策略：assembly members + 其所有下游语句 id
  const members = (assemblyStmt.args?.members as string[]) ?? []
  for (const m of members) {
    transformedIds.add(m)
    // 沿 inputs 链找下游
    const visited = new Set<string>()
    const queue = [m]
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (visited.has(cur)) continue
      visited.add(cur)
      // 找以 cur 为 input 的语句
      for (const s of script.statements) {
        if (s.inputs?.includes(cur) && !visited.has(s.id)) {
          transformedIds.add(s.id)
          queue.push(s.id)
        }
      }
    }
  }

  return transformedIds
}
