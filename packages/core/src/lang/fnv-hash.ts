/**
 * fnv-hash — FNV-1a 32-bit 十六进制哈希（L0 零依赖；bodyHash 内容寻址用）
 *
 * 与 parser.ts 的 fnv1a32 同算法（无 IR 方案下由 metadata-extractor 复用；
 * 增量失效无需抗碰撞）。
 */

/**
 * FNV-1a 32-bit 十六进制哈希。
 * @param text - 待哈希的输入文本。
 * @returns 8 位小写十六进制串（0-pad；增量失效内容寻址用，无抗碰撞要求）。
 */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
