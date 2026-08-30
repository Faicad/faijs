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
 * 收集形状所有面的 hash 列表（通过 subShapeHashes，高效，不分配句柄）。
 */
export function getFaceHashes(kernel: BrepEngineApi, shape: BrepHandle): number[] {
  return Array.from(kernel.subShapeHashes(shape, 'face', HASH_UPPER_BOUND))
}

/**
 * 收集两个形状的面 hash 并集（用于双形状布尔操作的 WithHistory 调用）。
 *
 * 分析文档 §4.2：fuse/cut/intersect 必须传 subShapeHashes(A) ∪ subShapeHashes(B)
 * 才能跟踪两个输入的面演化。
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
 * @param evo BrepEvolutionData（来自 *WithHistory API）
 * @param inputShape 输入形状（用于获取输入面 hash → ordinal 映射）
 * @param resultShape 结果形状（用于获取输出面 hash → ordinal 映射）
 * @returns FaceEvolution：inOrdinal → outOrdinal[]
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

/**
 * 解码 BrepEvolutionData 的 deleted 数组为被删除面的 ordinal 列表。
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
 * fuseWithHistory 封装：执行融合并返回结果 + 面演化映射。
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
 * intersectWithHistory 封装：执行交集并返回结果 + 面演化映射。
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
