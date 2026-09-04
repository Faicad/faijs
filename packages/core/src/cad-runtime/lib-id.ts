/**
 * lib-id — content-addressable identity for a registered library (B2 fix).
 *
 * Design: docs/plans/2026-09-03-faijs-brepjs-compat-api.md §7.3
 *
 * computeLibId(ns) hashes 「binding name + sorted export names + each exported
 * fn.toString()」 — the same content-addressing idea as `local.${callee}#${bodyHash}`:
 * a library identity changes when its implementation changes (so the statement
 * key changes and downstream recomputes), and is stable when the library is
 * re-registered unchanged (so incremental execution skips zero work).
 *
 * Non-function exports (constants, nested namespaces) participate via a stable
 * per-value encoding — see `encodeValue`. It must never throw: a library may
 * carry arbitrary third-party surface (e.g. a module-namespace child export
 * whose primitive coercion throws), and a throwing encoder would break
 * registration itself. Cycle-safe: shared/self-referencing objects hash
 * deterministically (ancestor objects render as `[Circular]`).
 *
 * @module
 */

/** FNV-1a 32-bit string hash, rendered as an 8-hex-digit key suffix. */
function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Stable, non-throwing string form of a single namespace export.
 *
 * - functions → source text (`fn.toString()`).
 * - primitives → `String(v)`.
 * - objects (records, module-namespace exotic objects, arrays): expand own
 *   enumerable properties recursively so nested library namespaces also get
 *   content-hashed; `[Circular]` guards self-references.
 * - values without a safe coercion (e.g. a module-namespace Symbol cannot be
 *   turned into a string at all): fall back to `Object.prototype.toString`.
 *
 * @param v - the export value.
 * @param seen - object-identity set guarding return against cyclic structures.
 * @returns a deterministic, throw-free encoding of the value.
 */
function encodeValue(v: unknown, seen: Set<object>): string {
  if (typeof v === 'function') return `fn:${v.toString()}`
  if (v === null || v === undefined) return String(v)
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') {
    try {
      return String(v)
    } catch {
      return Object.prototype.toString.call(v)
    }
  }
  // object: expand own enumerable entries (arrays → indexed entries).
  if (typeof v === 'object') {
    if (seen.has(v)) return '[Circular]'
    seen.add(v)
    try {
      const keys = Object.keys(v as object).sort()
      const body = keys
        .map((k) => `${k}:${encodeValue((v as Record<string, unknown>)[k], seen)}`)
        .join(',')
      return Array.isArray(v) ? `arr[${body}]` : `obj{${body}}`
    } finally {
      seen.delete(v)
    }
  }
  return Object.prototype.toString.call(v)
}

/**
 * Compute a library's content identity.
 *
 * @param binding - the registration binding name (part of the identity).
 * @param ns - the library namespace (exported function sources + resource objects).
 * @returns the content-hash libId (stable across registrations of the same code,
 * changes whenever any export's source or shape changes).
 */
export function computeLibId(binding: string, ns: Record<string, unknown>): string {
  const names = Object.keys(ns).sort()
  const seen = new Set<object>()
  const parts: string[] = [binding, ...names]
  for (const n of names) {
    parts.push(encodeValue(ns[n], seen))
  }
  return hashString(parts.join('#'))
}