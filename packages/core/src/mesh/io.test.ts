/**
 * mesh/io.test.ts — the headless `importFile` for STL/3MF.
 *
 * Covers the unit-system §5.2 / §7 requirements:
 * - STL with `opts.unit = inch` scales coordinates ×25.4.
 * - 3MF `<model unit>`: the six legal enums (incl. micron) are parsed into mm
 *   base; an unknown unit throws (never silently falls back to millimeter).
 * - `cad.load` (alias of importFile) through the S3MF format.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { zipSync, strToU8 } from 'fflate'
import { importFile } from './io'
import { inch, mm } from '../units'

// ── in-memory 3MF builders ────────────────────────────────────────────────

/** Minimal, valid 3dmodel.model XML carrying one box mesh at a given length. */
function modelXml(unit: string, size: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="${size}" y="0" z="0"/>
          <vertex x="0" y="${size}" z="0"/>
          <vertex x="0" y="0" z="${size}"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
          <triangle v1="0" v2="2" v3="3"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
  </build>
</model>`
}

function threemfBytes(unit: string, size: number): ArrayBuffer {
  const xml = modelXml(unit, size)
  const zip = zipSync({ '3D/3dmodel.model': strToU8(xml) })
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
}

/** Largest x of a returned Shape's positions. */
function maxX(positions: ArrayLike<number>): number {
  let mx = -Infinity
  for (let i = 0; i < positions.length; i += 3) mx = Math.max(mx, positions[i])
  return mx
}

describe('importFile — STL unit scale (D5)', () => {
  it('default unit is mm (unchanged)', async () => {
    // A 10mm ASCII STL cube built inline.
    const stl = asciiStl(10)
    const { shape } = await importFile(stl, 'stl')
    expect(maxX(shape.positions)).toBeCloseTo(10, 5)
  })

  it('opts.unit = inch scales coordinates ×25.4', async () => {
    const stl = asciiStl(10)
    const { shape } = await importFile(stl, 'stl', { unit: inch })
    expect(maxX(shape.positions)).toBeCloseTo(254, 5)
  })

  it('opts.unit = mm keeps coordinates unchanged', async () => {
    const stl = asciiStl(10)
    const { shape } = await importFile(stl, 'stl', { unit: mm })
    expect(maxX(shape.positions)).toBeCloseTo(10, 5)
  })
})

describe('importFile 3MF unit conversion (D5)', () => {
  const cases: Array<[string, number, number]> = [
    ['millimeter', 10, 10],
    ['micron', 1000, 1], // 1000 micron = 1 mm
    ['centimeter', 2, 20], // 2 cm = 20 mm
    ['inch', 2, 50.8], // 2 in = 50.8 mm
    ['foot', 1, 304.8],
    ['meter', 0.5, 500],
  ]
  it.each(cases)('3MF unit %s (size %s) → mm boundary', async (unit, size, expected) => {
    const { shape } = await importFile(threemfBytes(unit, size), '3mf')
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)
    expect(maxX(shape.positions)).toBeCloseTo(expected, 3)
  })

  it('unknown 3MF unit throws (no silent millimeter fallback) (GOTCHA 2026-09-28)', async () => {
    const buf = threemfBytes('weird_unit', 10)
    await expect(importFile(buf, '3mf')).rejects.toThrow(/unsupported.*unit/)
  })
})

describe('importFile real fixture (cube334.3mf)', () => {
  let buf: ArrayBuffer
  beforeAll(() => {
    const p = fileURLToPath(new URL('../../../fixtures/data/cube334.3mf', import.meta.url))
    const data = readFileSync(p)
    buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  })
  it('loads a non-empty mesh from a real 3mf file', async () => {
    const { shape } = await importFile(buf, '3mf')
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)
  })
  it('loads a non-empty mesh through format "threemf"', async () => {
    const { shape } = await importFile(buf, 'threemf')
    expect(shape.positions.length).toBeGreaterThan(0)
  })
})

// A minimal 3-triangle ASCII STL spanning [0, size].
function asciiStl(size: number): ArrayBuffer {
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number): string => `facet normal 0 0 1
  outer loop
    vertex ${ax} ${ay} ${az}
    vertex ${bx} ${by} ${bz}
    vertex ${cx} ${cy} ${cz}
  endloop
endfacet
`
  const max = size
  const body =
    tri(0, 0, 0, max, 0, 0, 0, max, 0) +
    tri(0, 0, 0, 0, max, 0, 0, 0, max) +
    tri(0, 0, 0, max, 0, 0, max, 0, max)
  const text = `solid test\n${body}endsolid test\n`
  return new TextEncoder().encode(text).buffer
}