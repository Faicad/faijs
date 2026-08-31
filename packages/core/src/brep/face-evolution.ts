/**
 * 面演化（face evolution）工具：hash 映射 ↔ ordinal 映射转换
 *
 * See docs/api-contract.md §11 (topology contract) for face evolution context.
 *
 * occt-wasm 的 *WithHistory API 返回 BrepEvolutionData，其中 modified/generated
 * 用面 hash（内存指针哈希）编码。本模块将其解码为 ordinal 映射（面枚举序号），
 * 可安全持久化进 faijs 文本。
 *
 * 核心原理（分析文档 §4.4）：
 * getSubShapes(shape,'face')[i] ↔ subShapeHashes(shape,'face',B)[i] 一一对应
 * 因此可以把 hash 映射无损转换为 ordinal 映射。
 */

import type { BrepHandle, BrepEvolutionData } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'

/** hash 上界（与 occt-wasm kernel.cpp 一致：`% 2147483647`） */
export const HASH_UPPER_BOUND = 2147483647

/**
 * 面演化映射：输入面 ordinal → 输出面 ordinal 列表
 *
 * - 1→1：面被修改但未被切割（如面带孔仍是单面）
 * - 1→N：面被切割成多个面
 * - 不在 map 中：面未被修改或被删除
 */
export type FaceEvolution = Map<number, number[]>

/**
 * Collect the hash list of all faces of a shape (via subShapeHashes; efficient, no handles allocated).
 * @param kernel - the OCCT kernel.
 * @param shape - the shape whose face hashes to collect.
 * @returns the array of face hashes.
 */
export function getFaceHashes(kernel: BrepEngineApi, shape: BrepHandle): number[] {
  return Array.from(kernel.subShapeHashes(shape, 'face', HASH_UPPER_BOUND))
}

/**
 * Collect the union of face hashes of two shapes (for WithHistory calls of binary boolean operations).
 *
 * Analysis doc §4.2: fuse/cut/intersect must pass subShapeHashes(A) ∪ subShapeHashes(B)
 * to track both inputs' face evolution.
 * @param kernel - the OCCT kernel.
 * @param shapeA - the first input shape.
 * @param shapeB - the second input shape.
 * @returns the union of the two shapes' face hashes.
 */
export function getUnionFaceHashes(
  kernel: BrepEngineApi,
  shapeA: BrepHandle,
  shapeB: BrepHandle,
): number[] {
  const hashesA = getFaceHashes(kernel, shapeA)
  const hashesB = getFaceHashes(kernel, shapeB)
  return [...new Set([...hashesA, ...hashesB])]
}

/**
 * 解码 BrepEvolutionData 的 modified 数组为 ordinal 映射。
 *
 * modified 分段编码格式：[inputHash, count, outHash1, outHash2, ...] × N
 *
 * @param kernel      the OCCT kernel.
 * @param evo         the BrepEvolutionData (from a *WithHistory API).
 * @param inputShape  the input shape (for the input face hash → ordinal mapping).
 * @param resultShape the result shape (for the output face hash → ordinal mapping).
 * @returns the FaceEvolution: inOrdinal → outOrdinal[].
 */
export function decodeEvolution(
  kernel: BrepEngineApi,
  evo: BrepEvolutionData,
  inputShape: BrepHandle,
  resultShape: BrepHandle,
): FaceEvolution {
  const inputHashes = getFaceHashes(kernel, inputShape)
  const resultHashes = getFaceHashes(kernel, resultShape)

  // 构建 hash → ordinal 查找表
  const resultHashToOrdinal = new Map<number, number>()
  for (let i = 0; i < resultHashes.length; i++) {
    resultHashToOrdinal.set(resultHashes[i], i)
  }
  const inputHashToOrdinal = new Map<number, number>()
  for (let i = 0; i < inputHashes.length; i++) {
    inputHashToOrdinal.set(inputHashes[i], i)
  }

  // 解码 modified 数组
  const evolution: FaceEvolution = new Map()
  const modified = evo.modified
  let idx = 0
  while (idx < modified.length) {
    const inHash = modified[idx]
    const count = modified[idx + 1]
    const outOrdinals: number[] = []
    for (let j = 0; j < count; j++) {
      const outHash = modified[idx + 2 + j]
      const outOrdinal = resultHashToOrdinal.get(outHash)
      if (outOrdinal !== undefined) {
        outOrdinals.push(outOrdinal)
      }
    }
    const inOrdinal = inputHashToOrdinal.get(inHash)
    if (inOrdinal !== undefined) {
      evolution.set(inOrdinal, outOrdinals)
    }
    idx += 2 + count
  }

  return evolution
}

// ─── hash 键演化解码（§2.4 of docs/plans/2026-08-31-topology-naming-port-v2.md）───

/**
 * Hash 键面演化：输入面 hash → 输出面 hash 列表（1→多分裂时多个）。
 *
 * 与序号键 FaceEvolution 并列、同源（同一次 *WithHistory 打包结果解出），
 * 一个供 role 传播（hash 键）、一个供选择器/文本（序号键），零额外 wasm 调用。
 */
export interface HashEvolution {
  /** 输入面 hash → 输出面 hash 列表（1→多分裂时多个）。 */
  readonly modified: ReadonlyMap<number, readonly number[]>
  /** 输入面中已不存在的面 hash。 */
  readonly deleted: ReadonlySet<number>
}

/**
 * 把 BrepEvolutionData 解码为 hash 键演化（§2.4）。
 *
 * modified 分段编码格式：[inHash, count, outHash1, ...] × N —— 本身就是
 * hash→hash[] 的 1→多映射，直接按同一格式解出 hash 键版本，不需要
 * getSubShapes 逐句柄 hashCode，也不分配任何句柄。
 *
 * generated 刻意不进 role 传播（§1.3 事实：occt 系 generated hash 指向中间形、
 * 对布尔实测 0 个存活），生成面改由 DerivedFaceTopoRef 以 lineage 命名。
 *
 * @param evo - the BrepEvolutionData (from a *WithHistory API).
 * @returns the hash-keyed evolution.
 */
export function decodeHashEvolution(evo: BrepEvolutionData): HashEvolution {
  const modified = new Map<number, number[]>()
  const m = evo.modified
  let idx = 0
  while (idx < m.length) {
    const inHash = m[idx]
    const count = m[idx + 1]
    const outHashes: number[] = []
    for (let j = 0; j < count; j++) {
      outHashes.push(m[idx + 2 + j])
    }
    modified.set(inHash, outHashes)
    idx += 2 + count
  }
  return { modified, deleted: new Set(evo.deleted) }
}

/**
 * 把一次双输入布尔（cut/fuse/intersect）的打包演化按「inHash 属于 A 还是 B」
 * 拆成 A、B 两张 hash 演化（§3.4 布尔合流，faijs 对 brepjs 的必要扩展）。
 *
 * 现有 *WithHistoryBrep 包装只用 getUnionFaceHashes 传入 A∪B 两边 hash、且只对
 * 基体 a 解码序号演化。本函数对同一份 evo 零额外内核调用：用 subShapeHashes(a)
 * / subShapeHashes(b) 两个集合判定每个 inHash 的归属，各自传播各自的 role 表。
 *
 * @param evo     - the BrepEvolutionData (from a binary boolean *WithHistory API).
 * @param hashesA - the face hashes of input A (target), via subShapeHashes.
 * @param hashesB - the face hashes of input B (tool), via subShapeHashes.
 * @returns the A/B split hash evolutions (faces from neither input are dropped).
 */
export function splitHashEvolutionByOrigin(
  evo: BrepEvolutionData,
  hashesA: readonly number[],
  hashesB: readonly number[],
): { a: HashEvolution; b: HashEvolution } {
  const raw = decodeHashEvolution(evo)
  const setA = new Set(hashesA)
  const setB = new Set(hashesB)

  const aModified = new Map<number, number[]>()
  const bModified = new Map<number, number[]>()
  for (const [inHash, outs] of raw.modified) {
    if (setA.has(inHash)) aModified.set(inHash, [...outs])
    else if (setB.has(inHash)) bModified.set(inHash, [...outs])
  }

  const aDeleted = new Set<number>()
  const bDeleted = new Set<number>()
  for (const h of raw.deleted) {
    if (setA.has(h)) aDeleted.add(h)
    else if (setB.has(h)) bDeleted.add(h)
  }

  return { a: { modified: aModified, deleted: aDeleted }, b: { modified: bModified, deleted: bDeleted } }
}

/**
 * Decode a BrepEvolutionData deleted array into the ordinal list of deleted faces.
 * @param kernel     - the OCCT kernel.
 * @param evo        - the BrepEvolutionData (from a *WithHistory API).
 * @param inputShape - the input shape (for the hash → ordinal mapping).
 * @returns the array of deleted face ordinals.
 */
export function decodeDeleted(
  kernel: BrepEngineApi,
  evo: BrepEvolutionData,
  inputShape: BrepHandle,
): number[] {
  const inputHashes = getFaceHashes(kernel, inputShape)
  const inputHashToOrdinal = new Map<number, number>()
  for (let i = 0; i < inputHashes.length; i++) {
    inputHashToOrdinal.set(inputHashes[i], i)
  }

  const deletedOrdinals: number[] = []
  for (const hash of evo.deleted) {
    const ordinal = inputHashToOrdinal.get(hash)
    if (ordinal !== undefined) {
      deletedOrdinals.push(ordinal)
    }
  }
  return deletedOrdinals
}

// ─── WithHistory 封装函数 ───

/**
 * cutWithHistory 封装：执行切割并返回结果 + 面演化映射。
 *
 * @param kernel OCCT 内核
 * @param a 基体
 * @param b 工具（从基体中减去）
 * @returns { result: 结果 BrepHandle, faceEvolution: 面演化映射 }
 */
export function cutWithHistoryBrep(
  kernel: BrepEngineApi,
  a: BrepHandle,
  b: BrepHandle,
): { result: BrepHandle; faceEvolution: FaceEvolution } {
  const inputHashes = getUnionFaceHashes(kernel, a, b)
  const evo = kernel.cutWithHistory(a, b, inputHashes, HASH_UPPER_BOUND)
  const faceEvolution = decodeEvolution(kernel, evo, a, evo.result)
  return { result: evo.result, faceEvolution }
}

/**
 * fuseWithHistory wrapper: performs the fuse and returns the result plus the face evolution mapping.
 * @param kernel - the OCCT kernel.
 * @param a - the base shape.
 * @param b - the tool shape to fuse into the base.
 * @returns the result BrepHandle plus the face evolution mapping.
 */
export function fuseWithHistoryBrep(
  kernel: BrepEngineApi,
  a: BrepHandle,
  b: BrepHandle,
): { result: BrepHandle; faceEvolution: FaceEvolution } {
  const inputHashes = getUnionFaceHashes(kernel, a, b)
  const evo = kernel.fuseWithHistory(a, b, inputHashes, HASH_UPPER_BOUND)
  const faceEvolution = decodeEvolution(kernel, evo, a, evo.result)
  return { result: evo.result, faceEvolution }
}

/**
 * intersectWithHistory wrapper: performs the intersection and returns the result plus the face evolution mapping.
 * @param kernel - the OCCT kernel.
 * @param a - the first input shape.
 * @param b - the second input shape.
 * @returns the result BrepHandle plus the face evolution mapping.
 */
export function intersectWithHistoryBrep(
  kernel: BrepEngineApi,
  a: BrepHandle,
  b: BrepHandle,
): { result: BrepHandle; faceEvolution: FaceEvolution } {
  const inputHashes = getUnionFaceHashes(kernel, a, b)
  const evo = kernel.intersectWithHistory(a, b, inputHashes, HASH_UPPER_BOUND)
  const faceEvolution = decodeEvolution(kernel, evo, a, evo.result)
  return { result: evo.result, faceEvolution }
}

// ─── 变换操作面演化 ───

/**
 * 构造恒等面演化映射（用于 translate/rotate/scale 等不改变拓扑的操作）。
 *
 * 变换操作不改变面的数量和顺序，每个面 ordinal i → [i]。
 * 避免调用 *WithHistory API（rotate/scale 的 WithHistory 签名与现有 Euler/Vec3 参数不兼容）。
 *
 * @param kernel OCCT 内核
 * @param shape 输入形状（用于获取面数量）
 * @returns 恒等 FaceEvolution
 */
export function identityEvolution(
  kernel: BrepEngineApi,
  shape: BrepHandle,
): FaceEvolution {
  const faceCount = getFaceHashes(kernel, shape).length
  const evolution: FaceEvolution = new Map()
  for (let i = 0; i < faceCount; i++) {
    evolution.set(i, [i])
  }
  return evolution
}
