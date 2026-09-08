/**
 * content-key — mesh 内容哈希（statementKey / plan 增量判定共用）
 *
 * 从 runtime.ts 提取为独立模块，供 CadRuntime 与 DirectExecutor 共享。
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

/**
 * Compute the mesh content key (hash of positions and indices) used to decide
 * incremental execution.
 * @param positions - the mesh vertex positions.
 * @param indices - the mesh triangle indices.
 * @returns the content key string.
 */
export function computeContentKey(positions: Float32Array, indices: Uint32Array): string {
  const posHash = hashTypedArray(positions)
  const idxHash = hashTypedArray(indices)
  return `${posHash}_${idxHash}_${positions.length}_${indices.length}`
}

// ── stableFingerprint (P0-3) ──

/**
 * Compute a deterministic fingerprint for an arbitrary value, used by the
 * incremental update gates (G6/G7/G8) to detect whether params, libIds, or
 * partTransform have changed since the last successful execution.
 *
 * Design constraints:
 * - `undefined` and `null` are normalized to `null` (so "no params" and
 *   "empty object params" are not treated as different).
 * - Object keys are sorted before hashing (iteration order independent).
 * - Circular references are detected and represented stably (no infinite loop).
 * - Functions and Symbols have a deterministic degradation rule (type-tagged).
 * - Arrays preserve element order (position-sensitive).
 * @param value - the value to fingerprint (params / libIds / partTransform).
 * @returns a hex string fingerprint.
 */
export function stableFingerprint(value: unknown): string {
  const seen = new WeakSet<object>()
  let hash = 0x811c9dc5

  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
  }

  const visit = (v: unknown, depth: number): void => {
    if (depth > 50) { mix('!depth!'); return }

    // Normalize undefined/null to null
    if (v === undefined || v === null) { mix('null'); return }

    const t = typeof v

    if (t === 'boolean') { mix(v ? 'B1' : 'B0'); return }
    if (t === 'number') { mix('N:' + v); return }
    if (t === 'string') { mix('S:' + v); return }
    if (t === 'bigint') { mix('G:' + v.toString()); return }
    if (t === 'symbol') { mix('SYM:' + ((v as symbol).description ?? '')); return }
    if (t === 'function') { mix('FN'); return }

    // Object / array
    const obj = v as object
    if (seen.has(obj)) { mix('!cycle!'); return }
    seen.add(obj)

    if (Array.isArray(v)) {
      mix('A[' + v.length + ']')
      for (const el of v) visit(el, depth + 1)
      return
    }

    // Map: sort by key string for stable order
    if (v instanceof Map) {
      const entries = [...v.entries()].sort((a, b) =>
        String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0,
      )
      mix('M[' + entries.length + ']')
      for (const [k, val] of entries) {
        mix('K:' + String(k) + ':')
        visit(val, depth + 1)
      }
      return
    }

    // Set: sort members for stable order
    if (v instanceof Set) {
      const members = [...v].sort((a, b) =>
        String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
      )
      mix('SET[' + members.length + ']')
      for (const m of members) visit(m, depth + 1)
      return
    }

    // Plain object: sort keys
    const keys = Object.keys(obj).sort()
    mix('O{' + keys.length + '}')
    for (const k of keys) {
      mix('k:' + k + ':')
      visit((obj as Record<string, unknown>)[k], depth + 1)
    }
  }

  visit(value, 0)
  hash ^= 0xff
  hash = Math.imul(hash, 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}
