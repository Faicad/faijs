/**
 * content-key — mesh 内容哈希（statementKey / plan 增量判定共用）
 *
 * 从 runtime.ts 提取为独立模块，供 CadRuntime 与 ModuleExecutor 共享，
 * 避免 runtime ↔ module-executor 循环依赖。
 */

/** FNV-1a 哈希（typed array 逐元素） */
function hashTypedArray(arr: Float32Array | Uint32Array): string {
  let hash = 0x811c9dc5
  const len = arr.length
  for (let i = 0; i < len; i++) {
    hash ^= arr[i]
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= len
  hash = Math.imul(hash, 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 计算 mesh 内容键（positions + indices 哈希），用于增量执行判定。 */
export function computeContentKey(positions: Float32Array, indices: Uint32Array): string {
  const posHash = hashTypedArray(positions)
  const idxHash = hashTypedArray(indices)
  return `${posHash}_${idxHash}_${positions.length}_${indices.length}`
}
