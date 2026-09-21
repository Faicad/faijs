/**
 * BREP topology-text predicate.
 *
 * A frozen `.brp` is OCCT's own CASCADE Topology text format. Its `TShapes <N>`
 * section is a FLAT table over the shape's sub-shapes: each record opens with a
 * bare two-letter type code (`Ve` vertex, `Ed` edge, `Wi` wire, `Fa` face,
 * `Sh` shell, `So` solid, `Co` compound), and a solid nested inside a compound
 * still gets its own `So` record. "Does this file contain a solid?" is
 * therefore answerable by scanning text — no kernel, no BREP import, which
 * matters because the conversion layer must not spin up OCCT just to classify
 * an asset, and because this repo decides BREP-vs-mesh statically, never by
 * run-time fallback.
 *
 * Measured 2026-09-21 against the OCCT kernel over the 56-sample FCStd corpus
 * (fcstd-port `out/probe-brp-predicate.mjs`, 698 `cad.load` sites, 681
 * loadable): 681 agree, 0 disagree — 335 solid, 346 zero-solid. The predicate
 * abstains (null) on the 2 corrupt files the kernel also refuses.
 */

/** The two-letter sub-shape type codes OCCT writes as a record opener. */
const TYPE_CODES = new Set(['Ve', 'Ed', 'Wi', 'Fa', 'Sh', 'So', 'Co'])

/** Section header carrying the sub-shape count the table must supply. */
const TSHAPES_HEADER = /^TShapes\s+(\d+)$/

/**
 * Does a frozen CASCADE BREP contain at least one solid?
 *
 * @param text - the decoded `.brp` text.
 * @returns true when a `So` record exists in the TShapes table, false when the
 *   table is present but holds no solid, and null when the text is not a
 *   CASCADE topology at all — the caller must NOT read null as "no solid",
 *   since an unreadable file is a different failure than a wireframe asset.
 */
export function brepTextHasSolid(text: string): boolean | null {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const header = TSHAPES_HEADER.exec(lines[i].trim())
    if (!header) continue
    // The declared count bounds the scan, so trailing sections or stray text
    // can never be mistaken for sub-shape records.
    const declared = Number(header[1])
    let seen = 0
    for (let k = i + 1; k < lines.length && seen < declared; k++) {
      const code = lines[k].trim()
      if (code.length !== 2 || !TYPE_CODES.has(code)) continue
      seen++
      if (code === 'So') return true
    }
    return false
  }
  return null
}
