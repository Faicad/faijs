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
 * Compute a library's content identity.
 *
 * @param binding - the registration binding name (part of the identity).
 * @param ns - the library namespace (exported function sources + resource objects).
 * @returns the content-hash libId (stable across registrations of the same code,
 * changes whenever any export's source changes).
 */
export function computeLibId(binding: string, ns: Record<string, unknown>): string {
  const names = Object.keys(ns).sort()
  const parts: string[] = [binding, ...names]
  for (const n of names) {
    const v = ns[n]
    parts.push(typeof v === 'function' ? v.toString() : String(v))
  }
  return hashString(parts.join('#'))
}