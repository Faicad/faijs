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
import { importFile } from '../../src/mesh/io'


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

/** A 3MF with `n` objects in the `<build>` declaration order, sized `size` each. */
function multiObjectXml(n: number, size: number): string {
  const objects = Array.from(
    { length: n },
    (_, i) => `<object id="${i + 1}" type="model">
      <mesh>
        <vertices>
          <vertex x="${i * size}" y="0" z="0"/>
          <vertex x="${i * size + size}" y="0" z="0"/>
          <vertex x="0" y="${size}" z="0"/>
          <vertex x="0" y="0" z="${size}"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
          <triangle v1="0" v2="2" v3="3"/>
        </triangles>
      </mesh>
    </object>`,
  ).join('');
  const buildItems = Array.from(
    { length: n },
    (_, i) => `<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>${objects}</resources>
  <build>${buildItems}</build>
</model>`
}

function multiThreemfBytes(n: number, size: number): ArrayBuffer {
  const xml = multiObjectXml(n, size)
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
    const { shape, unit } = await importFile(stl, 'stl', { unit: 'inch' })
    expect(maxX(shape.positions)).toBeCloseTo(254, 5)
    expect(unit).toBe('inch')
  })

  it('opts.unit = mm keeps coordinates unchanged', async () => {
    const stl = asciiStl(10)
    const { shape, unit } = await importFile(stl, 'stl', { unit: 'mm' })
    expect(maxX(shape.positions)).toBeCloseTo(10, 5)
    expect(unit).toBe('mm')
  })

  it('no opts.unit → heuristic guess (unified §6.1/§8: historical host behaviour moved into faijs)', async () => {
    // 0.1-unit cube → volume 0.001 → guessStlUnit 'm' → ×1000（历史 3d_editor 行为）
    const stl = asciiStl(0.1)
    const { shape, unit } = await importFile(stl, 'stl')
    expect(maxX(shape.positions)).toBeCloseTo(100, 3)
    expect(unit).toBe('m')
  })

  it('no opts.unit → heuristic guess keeps mm-sized files unchanged', async () => {
    // 10-unit cube → volume 1000 → guessStlUnit 'mm' → ×1
    const stl = asciiStl(10)
    const { shape, unit } = await importFile(stl, 'stl')
    expect(maxX(shape.positions)).toBeCloseTo(10, 5)
    expect(unit).toBe('mm')
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

  it('opts.unit 对所有格式一视同仁：millimeter 声明 + 强制 inch → 坐标 ×25.4（覆盖内部声明）', async () => {
    const { shape, unit } = await importFile(threemfBytes('millimeter', 10), '3mf', { unit: 'inch' })
    expect(maxX(shape.positions)).toBeCloseTo(254, 3)
    expect(unit).toBe('inch')
  })

  it('opts.unit 强制覆盖：inch 声明 + 指定 mm → 坐标保持原始数值（忽略文件声明）', async () => {
    const { shape, unit } = await importFile(threemfBytes('inch', 2), '3mf', { unit: 'mm' })
    expect(maxX(shape.positions)).toBeCloseTo(2, 3)
    expect(unit).toBe('mm')
  })

  it('opts.unit 强制时跳过非法文件声明（不抛错，按强制单位解析）', async () => {
    const { shape, unit } = await importFile(threemfBytes('weird_unit', 10), '3mf', { unit: 'mm' })
    expect(maxX(shape.positions)).toBeCloseTo(10, 3)
    expect(unit).toBe('mm')
  })
})

/** A 3MF whose single object references a basematerials base (object-level color). */
function coloredModelXml(unit: string, size: number, hex: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="100"><base name="color" displaycolor="${hex}"/></basematerials>
    <object id="1" type="model" pid="100">
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

function coloredThreemfBytes(hex: string, size = 10): ArrayBuffer {
  const xml = coloredModelXml('millimeter', size, hex)
  const zip = zipSync({ '3D/3dmodel.model': strToU8(xml) })
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
}

describe('importFile 3MF object color → shape.appearance (P2, plan §5 3MF row)', () => {
  it('maps basematerials displaycolor (#RRGGBB) to appearance.color in sRGB 0–1', async () => {
    const { shape } = await importFile(coloredThreemfBytes('#ff0000'), '3mf')
    expect(shape.appearance?.color).toEqual([1, 0, 0])
  })

  it('omits appearance when the object carries no basematerials color', async () => {
    const { shape } = await importFile(threemfBytes('millimeter', 10), '3mf')
    expect(shape.appearance).toBeUndefined()
  })

  it('tolerates non-#RRGGBB displaycolor gracefully (no appearance, no throw)', async () => {
    // 宽容兼容外部数据：displaycolor 非 6 位 hex 时 baseColor 缺省 → 不挂外观、不抛错。
    const { shape } = await importFile(coloredThreemfBytes('invalid'), '3mf')
    expect(shape.appearance).toBeUndefined()
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

describe('importFile 3MF multi-part (P0 §5.4: all objects returned)', () => {
  it('single object → parts length 1, shape = the only part, no multiPartCount', async () => {
    const { shape, parts, multiPartCount } = await importFile(multiThreemfBytes(1, 10), '3mf')
    expect(multiPartCount).toBeUndefined()
    expect(parts).toHaveLength(1)
    expect(parts[0]).toBe(shape)
    // 第一个（唯一）对象：x 方向覆盖 [0, 10]
    expect(maxX(shape.positions)).toBeCloseTo(10, 3)
  })

  it('multi-object → parts = all objects in declaration order; shape = parts[0]', async () => {
    const { shape, parts, multiPartCount } = await importFile(multiThreemfBytes(3, 10), '3mf')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe(shape)
    expect(multiPartCount).toBe(3)
    // 声明序：object 1 x∈[0,10]、object 2 x∈[10,20]、object 3 x∈[20,30]
    expect(maxX(parts[0].positions)).toBeCloseTo(10, 3)
    expect(maxX(parts[1].positions)).toBeCloseTo(20, 3)
    expect(maxX(parts[2].positions)).toBeCloseTo(30, 3)
    // 每个 object 的 mesh：4 顶点 × 3 分量
    for (const p of parts) expect(p.positions.length).toBe(12)
  })

  it('multi-object → importModel.parts 携带身份（index/name 回退 imported:N）', async () => {
    const { importModel } = await importFile(multiThreemfBytes(2, 10), '3mf')
    expect(importModel).toBeDefined()
    expect(importModel!.format).toBe('3mf')
    expect(importModel!.parts).toHaveLength(2)
    expect(importModel!.parts.map((p) => p.index)).toEqual([0, 1])
    expect(importModel!.parts.map((p) => p.name)).toEqual(['imported:0', 'imported:1'])
    // 无颜色/无 Bambu 元数据：字段省略
    expect(importModel!.parts[0].color).toBeUndefined()
    expect(importModel!.bambuViews).toBeUndefined()
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