/**
 * export-model.test.ts — unit-aware export invariants (unit-system §10.6).
 *
 * Invariant under test (§10.3): the declared unit in the written file equals
 * the unit exportModel was asked for, and the coordinate scale equals
 * base / unitScale(unit). readDeclaredUnit is the round-trip checker.
 */
import { describe, expect, it } from 'vitest'
import { exportModelSync, readDeclaredUnit, UNIT_NAME_TO_3MF, type ExportEntry } from './export-model'
import { UNIT_SCALE } from '../../units'
import { detectStepUnit, importFile } from '../../mesh/io'
import { readZipEntries } from '../../io/zip'

/** Two-triangle quad spanning [0, size] on X/Y (z=0), base-unit coordinates. */
function quadEntry(size: number, name?: string, color?: readonly [number, number, number]): ExportEntry {
  return {
    mesh: {
      positions: new Float32Array([
        0, 0, 0, size, 0, 0, size, size, 0,
        0, 0, 0, size, size, 0, 0, size, 0,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    },
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
  }
}

/** Max coordinate of the interleaved positions in a binary STL buffer. */
function stlMaxCoord(buf: ArrayBuffer): number {
  const dv = new DataView(buf)
  const triCount = dv.getUint32(80, true)
  let max = 0
  for (let t = 0; t < triCount; t++) {
    const base = 84 + t * 50
    for (let v = 0; v < 3; v++) {
      for (let c = 0; c < 3; c++) {
        const val = Math.abs(dv.getFloat32(base + 12 + v * 12 + c * 4, true))
        if (val > max) max = val
      }
    }
  }
  return max
}

describe('exportModel — STL (no declared unit)', () => {
  it('scales coordinates to the target unit (10mm → 0.3937 in)', () => {
    const buf = exportModelSync([quadEntry(10)], 'stl', { unit: 'inch' })
    expect(stlMaxCoord(buf)).toBeCloseTo(10 / UNIT_SCALE.inch, 4)
  })

  it('mm export keeps base coordinates byte-identical in scale', () => {
    const buf = exportModelSync([quadEntry(10)], 'stl', { unit: 'mm' })
    expect(stlMaxCoord(buf)).toBeCloseTo(10, 5)
  })

  it('readDeclaredUnit returns null (format cannot declare)', () => {
    const buf = exportModelSync([quadEntry(10)], 'stl')
    expect(readDeclaredUnit(buf, 'stl')).toBeNull()
  })
})

describe('UNIT_NAME_TO_3MF', () => {
  it('has no yard entry (3MF enum lacks it → forced pair-fallback to mm)', () => {
    expect(UNIT_NAME_TO_3MF.yard).toBeUndefined()
    expect(UNIT_NAME_TO_3MF.mm).toBe('millimeter')
    expect(UNIT_NAME_TO_3MF.inch).toBe('inch')
  })
})

describe('exportModel — 3MF basematerials (P3, v2 §8 3MF row, Core spec)', () => {
  it('writes basematerials inside <resources> and references pid/pindex from the object', () => {
    const buf = exportModelSync([quadEntry(10, 'red-part', [1, 0, 0])], '3mf', { unit: 'mm' })
    const model = readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')
    expect(model).toBeDefined()
    const xml = new TextDecoder().decode(model)
    // Core 规范：basematerials 声明在 <resources>，object 用 pid/pindex 引用。
    // （此前内联在 <object> 内的写法 parseThreemf 不识别 → 导入→导出→导入丢色。）
    expect(xml).toMatch(/<resources><basematerials id="1"><base name="red-part" displaycolor="#ff0000"\/><\/basematerials><object id="1" type="model" name="red-part" pid="1" pindex="0"><mesh>/)
    expect(xml).not.toMatch(/<object[^>]*><basematerials/)
  })

  it('omits basematerials and pid/pindex when the entry has no color', () => {
    const buf = exportModelSync([quadEntry(10)], '3mf', { unit: 'mm' })
    const model = readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')
    expect(model).toBeDefined()
    const xml = new TextDecoder().decode(model)
    expect(xml).not.toContain('basematerials')
    expect(xml).toMatch(/<object id="1" type="model" name="part1"><mesh>/)
  })

  it('materialGroups → 独立 basematerials（id 与对象错开）+ 三角形 pid 引用（P4）', () => {
    const entry: ExportEntry = {
      ...quadEntry(10, 'two-tone'),
      materialGroups: [
        { start: 0, count: 1, appearance: { color: [1, 0, 0] } },
        { start: 1, count: 1, appearance: { color: [0, 0, 1] } },
      ],
    }
    const buf = exportModelSync([entry], '3mf', { unit: 'mm' })
    const xml = new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)
    // 两个 basematerials 资源（id=2,3，从 entries.length+1 起，与对象 id=1 错开）。
    expect(xml).toMatch(/<basematerials id="2"><base name="two-tone_g1" displaycolor="#ff0000"\/><\/basematerials>/)
    expect(xml).toMatch(/<basematerials id="3"><base name="two-tone_g2" displaycolor="#0000ff"\/><\/basematerials>/)
    // 三角形按区间引用：tri0 → pid 2，tri1 → pid 3；对象本身无对象级 pid（未分组三角形无材质）。
    expect(xml).toMatch(/<triangle v1="0" v2="1" v3="2" pid="2" p1="0" p2="0" p3="0"\/>/)
    expect(xml).toMatch(/<triangle v1="3" v2="4" v3="5" pid="3" p1="0" p2="0" p3="0"\/>/)
    expect(xml).toMatch(/<object id="1" type="model" name="two-tone"><mesh>/)
  })

  it('materialGroups 无 color 的组跳过（3MF 只支持 displaycolor）', () => {
    const entry: ExportEntry = {
      ...quadEntry(10, 'metal-only'),
      materialGroups: [{ start: 0, count: 2, appearance: { metalness: 0.9 } }],
    }
    const buf = exportModelSync([entry], '3mf', { unit: 'mm' })
    const xml = new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)
    expect(xml).not.toContain('basematerials')
    expect(xml).not.toMatch(/pid="/)
  })

  it('对象级 color 与 materialGroups 并存：对象 pid + 分组三角形 pid 各自生效', () => {
    const entry: ExportEntry = {
      ...quadEntry(10, 'mixed', [0, 1, 0]),
      materialGroups: [{ start: 0, count: 1, appearance: { color: [1, 0, 0] } }],
    }
    const buf = exportModelSync([entry], '3mf', { unit: 'mm' })
    const xml = new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)
    expect(xml).toMatch(/<basematerials id="1"><base name="mixed" displaycolor="#00ff00"\/><\/basematerials>/)
    expect(xml).toMatch(/<basematerials id="2"><base name="mixed_g1" displaycolor="#ff0000"\/><\/basematerials>/)
    expect(xml).toMatch(/<object id="1" type="model" name="mixed" pid="1" pindex="0"><mesh>/)
    expect(xml).toMatch(/<triangle v1="0" v2="1" v3="2" pid="2" p1="0" p2="0" p3="0"\/>/)
    expect(xml).toMatch(/<triangle v1="3" v2="4" v3="5"\/>/)
  })

  it('往返：materialGroups → 3MF → 读回（导入→导出→导入颜色不丢，P4）', async () => {
    const entry: ExportEntry = {
      ...quadEntry(10, 'two-tone'),
      materialGroups: [
        { start: 0, count: 1, appearance: { color: [1, 0, 0] } },
        { start: 1, count: 1, appearance: { color: [0, 0, 1] } },
      ],
    }
    const buf = exportModelSync([entry], '3mf', { unit: 'mm' })
    const res = await importFile(buf, '3mf')
    const s = res.shape
    expect(s.materialGroups).toEqual([
      { start: 0, count: 1, appearance: { color: [1, 0, 0] } },
      { start: 1, count: 1, appearance: { color: [0, 0, 1] } },
    ])
    // 未分组三角形（对象无 pid）不误归到第一个材质色。
    expect(s.appearance).toBeUndefined()
  })

  it('往返：单色对象仍走 baseColor（对象级 pid + 三角形无 pid，P3 兼容）', async () => {
    const buf = exportModelSync([quadEntry(10, 'red-part', [1, 0, 0])], '3mf', { unit: 'mm' })
    const res = await importFile(buf, '3mf')
    const s = res.shape
    expect(s.appearance).toEqual({ color: [1, 0, 0] })
    expect(s.materialGroups).toBeUndefined()
  })
})

describe('detectStepUnit — fixture-backed parsing', () => {
  it('parses SI_UNIT(.MILLI.,.METRE.) as mm', () => {
    const step = `DATA;
#35=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
ENDSEC;`
    expect(detectStepUnit(step)).toBe('mm')
  })

  it('parses CONVERSION_BASED_UNIT METRE as m', () => {
    const step = `DATA;
#65=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0),#66);
#66=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
#67=(CONVERSION_BASED_UNIT('METRE',#65)LENGTH_UNIT()NAMED_UNIT(#68));
ENDSEC;`
    expect(detectStepUnit(step)).toBe('m')
  })

  it('parses CONVERSION_BASED_UNIT INCH as inch', () => {
    const step = `DATA;
#67=(CONVERSION_BASED_UNIT('INCH',#65)LENGTH_UNIT()NAMED_UNIT(#68));
ENDSEC;`
    expect(detectStepUnit(step)).toBe('inch')
  })

  it('returns null when no length-unit declaration exists', () => {
    expect(detectStepUnit('DATA;\n#1=POINT(0,0,0);\nENDSEC;')).toBeNull()
  })

  it('ignores HEADER section position — entity found past 8 lines', () => {
    const lines = ['ISO-10303-21;', 'HEADER;', 'ENDSEC;', 'DATA;']
    for (let i = 0; i < 30; i++) lines.push('#' + (i + 1) + '=DUMMY();')
    lines.push('#99=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));', 'ENDSEC;')
    expect(detectStepUnit(lines.join('\n'))).toBe('mm')
  })
})
