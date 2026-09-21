/**
 * `brepTextHasSolid` — the static solid verdict for a frozen `.brp`.
 *
 * The predicate is the basis for choosing the import contract STATICALLY (the
 * conversion layer must not run OCCT just to classify an asset, and this repo
 * forbids "try as a solid, relax on failure"). Its correctness is not argued
 * from theory: on the 56-sample FCStd corpus it was checked against the kernel
 * on every loadable site — 681/681 agree, 0 disagreements
 * (fcstd-port `out/probe-brp-predicate.mjs`). These cases pin the shape of the
 * CASCADE table so a future edit cannot silently flip the verdict.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { brepTextHasSolid } from './brep-topology-text'

/** Records only their type code; the data lines after them are irrelevant. */
function table(codes: string[], declared = codes.length): string {
  return [
    'CASCADE Topology V1, (c) Matra-Datavision',
    `Locations 0`,
    `TShapes ${declared}`,
    ...codes.flatMap((c) => [c, '0 0 0', '']),
  ].join('\n')
}

describe('brepTextHasSolid', () => {
  it('reads a real frozen Draft wire as non-solid', () => {
    // Wire169002031.Shape.brp out of ArchDetail.FCStd: TShapes 6, codes
    // `Ve Ve Ed Ve Ed Wi` — a wireframe with no solid anywhere in the table.
    const text = readFileSync(
      fileURLToPath(new URL('../../../fixtures/data/brp/draft-wire.brp', import.meta.url)),
      'utf-8',
    )
    expect(brepTextHasSolid(text)).toBe(false)
  })

  it('accepts a table with a solid record', () => {
    expect(brepTextHasSolid(table(['Ve', 'Ed', 'Wi', 'Fa', 'Sh', 'So']))).toBe(true)
  })

  it('treats a compound of faces and wires as non-solid', () => {
    // ArchDetail's Array001 asset is exactly this: `Co` wrapping `Fa` + `Wi`.
    expect(brepTextHasSolid(table(['Ve', 'Ve', 'Ed', 'Ed', 'Wi', 'Fa', 'Co']))).toBe(false)
  })

  it('honours the declared count instead of scanning to the end of the file', () => {
    // A truncated/lying header must not let a later record claim a solid.
    expect(brepTextHasSolid(table(['Ve', 'So'], 1))).toBe(false)
  })

  it('reports an empty table as non-solid', () => {
    expect(brepTextHasSolid(table([], 0))).toBe(false)
  })

  it('abstains on text that is not a CASCADE topology', () => {
    // A STEP file (or a corrupt member) is a different failure than a wireframe
    // asset; the caller must not read null as "no solid".
    expect(brepTextHasSolid('ISO-10303-21;\nHEADER;\n')).toBeNull()
    expect(brepTextHasSolid('')).toBeNull()
  })

  it('survives CRLF line endings and a leading BOM', () => {
    const crlf = '\uFEFF' + table(['Ve', 'Wi', 'So']).replace(/\n/g, '\r\n')
    expect(brepTextHasSolid(crlf)).toBe(true)
  })
})
