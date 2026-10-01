/**
 * mesh/threemf-archive.test.ts — `parseThreemf` now returns a structured
 * archive: per-instance objects (mm base), the declared unit, and every
 * non-model entry as `extraEntries` (single unzip, two consumer chains — plan
 * D4). This is the contract the host's Bambu/metadata layer builds on.
 */
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { zipSync, strToU8 } from 'fflate'
import { parseThreemf } from './threemf-loader'
import { guessStlUnit } from './stl-unit'

const cubePath = fileURLToPath(new URL('../../../fixtures/data/cube334.3mf', import.meta.url))

function readCube(): ArrayBuffer {
  const data = readFileSync(cubePath)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

/** Fabricate a Bambu-style 3MF that carries model_settings.config + thumbnail. */
function bambuBytes(): ArrayBuffer {
  const model = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" name="PartA" type="model">
      <mesh><vertices>
        <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/>
        <vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>
      </vertices><triangles>
        <triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="3"/>
      </triangles></mesh>
    </object>
  </resources>
  <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build>
</model>`
  const zip = zipSync({
    '3D/3dmodel.model': strToU8(model),
    'Metadata/model_settings.config': strToU8('{"settings":true}'),
    'Metadata/thumbnail.png': strToU8('PNGDATA'),
  })
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
}

describe('parseThreemf — archive contract', () => {
  it('surface the declared unit and per-instance objects (cube334)', async () => {
    const arch = await parseThreemf(readCube())
    expect(arch.unit).toBe('mm') // cube334 declares millimeter
    expect(arch.objects.length).toBeGreaterThanOrEqual(1)
    const o = arch.objects[0]
    expect(o.positions.length % 3).toBe(0)
    expect(o.indices.length % 3).toBe(0)
    expect(o.positions.length / 3).toBeGreaterThan(0)
  })

  it('exposes extraEntries (one unzip, two consumer chains)', async () => {
    const arch = await parseThreemf(bambuBytes())
    expect(arch.unit).toBe('mm')
    expect(arch.objects).toHaveLength(1) // one build item
    // The non-model entries surface for the Bambu layer.
    const cfg = arch.extraEntries.get('Metadata/model_settings.config')
    expect(cfg).toBeDefined()
    expect(strFromU8Checked(cfg!)).toBe('{"settings":true}')
    expect(strFromU8Checked(arch.extraEntries.get('Metadata/thumbnail.png')!)).toBe('PNGDATA')
  })
})

/** Fabricate a 3MF carrying a single basematerials entry (one base per object). */
function basematerialBytes(): ArrayBuffer {
  const model = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="99"><base name="orange" displaycolor="#FF8000"/></basematerials>
    <object id="1" name="ColoredPart" type="model" pid="99">
      <mesh><vertices>
        <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/>
        <vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>
      </vertices><triangles>
        <triangle v1="0" v2="1" v3="2" p1="0"/><triangle v1="0" v2="2" v3="3" p1="0"/>
      </triangles></mesh>
    </object>
  </resources>
  <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build>
</model>`
  const zip = zipSync({ '3D/3dmodel.model': strToU8(model) })
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
}

/** Fabricate a 3MF referencing a colorgroup (per-triangle vertex colors). */
function colorgroupBytes(): ArrayBuffer {
  const model = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <colorgroup id="7"><color color="#FF0000"/><color color="#00FF00"/><color color="#0000FF"/></colorgroup>
    <object id="1" name="Rainbow" type="model">
      <mesh><vertices>
        <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/>
        <vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>
      </vertices><triangles>
        <triangle v1="0" v2="1" v3="2" pid="7" p1="0" p2="1" p3="2"/>
        <triangle v1="0" v2="2" v3="3" pid="7" p1="0" p2="2" p3="0"/>
      </triangles></mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`
  const zip = zipSync({ '3D/3dmodel.model': strToU8(model) })
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
}

describe('parseThreemf — basematerials / colorgroup colors (plan B2)', () => {
  it('object-level pid + single base → baseColor from displaycolor', async () => {
    const arch = await parseThreemf(basematerialBytes())
    expect(arch.objects).toHaveLength(1)
    const o = arch.objects[0]
    expect(o.baseColor).toEqual([0xff / 255, 0x80 / 255, 0])
    expect(o.vertexColors).toBeUndefined()
    // compact geometry preserved (no color expansion)
    expect(o.indices.length).toBe(6)
  })

  it('colorgroup → expanded geometry with per-triangle vertexColors', async () => {
    const arch = await parseThreemf(colorgroupBytes())
    expect(arch.objects).toHaveLength(1)
    const o = arch.objects[0]
    expect(o.vertexColors).toBeDefined()
    expect(o.baseColor).toBeUndefined()
    expect(o.positions.length).toBe(2 * 9) // 2 triangles × 3 vertices
    expect(o.indices).toEqual(new Uint32Array([0, 1, 2, 3, 4, 5]))
    const c = o.vertexColors!
    expect(c.length).toBe(18)
    expect(c[0]).toBe(1); expect(c[1]).toBe(0); expect(c[2]).toBe(0)   // t0 v1 → color[0]
    expect(c[3]).toBe(0); expect(c[4]).toBe(1); expect(c[5]).toBe(0)   // t0 v2 → color[1]
    expect(c[6]).toBe(0); expect(c[7]).toBe(0); expect(c[8]).toBe(1)   // t0 v3 → color[2]
    expect(c[9]).toBe(1); expect(c[10]).toBe(0); expect(c[11]).toBe(0) // t1 v1 → color[0]
    expect(c[12]).toBe(0); expect(c[13]).toBe(0); expect(c[14]).toBe(1) // t1 v2 → color[2]
    expect(c[15]).toBe(1); expect(c[16]).toBe(0); expect(c[17]).toBe(0) // t1 v3 → color[0]
  })

  it('untextured object carries neither color field', async () => {
    const arch = await parseThreemf(readCube())
    expect(arch.objects[0].baseColor).toBeUndefined()
    expect(arch.objects[0].vertexColors).toBeUndefined()
  })
})

describe('parseThreemf — build transforms (16-value form / malformed tolerance)', () => {
  it('accepts the 16-value 4×4 form (trailing "0 0 0 1") and bakes translation', async () => {
    const model = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model"><mesh><vertices>
      <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
    </vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
  </resources>
  <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 30 0 0 0 1"/></build>
</model>`
    const zip = zipSync({ '3D/3dmodel.model': strToU8(model) })
    const arch = await parseThreemf(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength))
    expect(arch.objects).toHaveLength(1)
    const pos = Array.from(arch.objects[0].positions)
    // translation tokens are the last three of the 4×3 part (t[9], t[10], t[11])
    expect(pos[0]).toBeCloseTo(10, 5)
    expect(pos[1]).toBeCloseTo(20, 5)
    expect(pos[2]).toBeCloseTo(30, 5)
  })

  it('ignores a malformed transform (identity, no NaN poisoning)', async () => {
    const model = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model"><mesh><vertices>
      <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
    </vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
  </resources>
  <build><item objectid="1" transform="not-a-transform"/></build>
</model>`
    const zip = zipSync({ '3D/3dmodel.model': strToU8(model) })
    const arch = await parseThreemf(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength))
    const pos = Array.from(arch.objects[0].positions)
    expect(pos[0]).toBe(0)
    expect(pos[1]).toBe(0)
    expect(pos[2]).toBe(0)
    expect(pos.every((n) => Number.isFinite(n))).toBe(true)
  })
})

describe('parseThreemf — components recursion (Bambu-style assemblies)', () => {
  function modelWithComponents(resources: string, build: string): ArrayBuffer {
    const xml = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>${resources}</resources>
  <build>${build}</build>
</model>`
    const zip = zipSync({ '3D/3dmodel.model': strToU8(xml) })
    return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
  }

  const meshObject = (id: number, name: string): string => `
    <object id="${id}" name="${name}" type="model"><mesh><vertices>
      <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
    </vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`

  it('build item referencing a component container expands to one instance per component (transform composed)', async () => {
    const resources = `
      ${meshObject(1, 'part')}
      <object id="2" type="model"><components>
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/>
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 15 0 0"/>
      </components></object>`
    // build item 引用容器 2，并再平移 (10,0,0)：实例平移 = 10 + component 平移
    const arch = await parseThreemf(modelWithComponents(
      resources,
      '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 0 0"/>',
    ))
    expect(arch.objects).toHaveLength(2)
    // 实例 A: 10 + 5 = 15；实例 B: 10 + 15 = 25（手算判据）
    expect(arch.objects[0].positions[0]).toBeCloseTo(15, 5)
    expect(arch.objects[1].positions[0]).toBeCloseTo(25, 5)
    // 组件实例保留被实例化的对象名（Bambu 语义：同 object 多实例同名）
    expect(arch.objects[0].name).toBe('part')
    expect(arch.objects[1].name).toBe('part')
  })

  it('nested components compose transforms in child-first order (parent · child)', async () => {
    // 3 (mesh) ← 2 (components → 3, +z 平移) ← 1 (components → 2, +x 平移)
    // build item 引用 1，再加 (+100) 平移 → 最终 = R 单位阵下 (100+1, 0, 0+... )
    // 手算：外层 100+x，中层 1+x，末层 z=7 → 顶点 (0,0,0) → (100, 0, 7)？
    // 注意三处平移分别是 build(+100 x)、obj1 的 component(+1 x)、obj2 的 component(+0 x, +0 y, +7 z)。
    const resources = `
      ${meshObject(3, 'leaf')}
      <object id="2" type="model"><components>
        <component objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 7"/>
      </components></object>
      <object id="1" type="model"><components>
        <component objectid="2" transform="1 0 0 0 1 0 0 0 1 1 0 0"/>
      </components></object>`
    const arch = await parseThreemf(modelWithComponents(
      resources,
      '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 0 0"/>',
    ))
    expect(arch.objects).toHaveLength(1)
    const p = arch.objects[0].positions
    // 顶点 0 的原始 (0,0,0)：依次烘焙 +100x、+1x、+7z → (101, 0, 7)
    expect(p[0]).toBeCloseTo(101, 5)
    expect(p[1]).toBeCloseTo(0, 5)
    expect(p[2]).toBeCloseTo(7, 5)
  })

  it('component reference cycles terminate (path guard, no infinite recursion)', async () => {
    const resources = `
      ${meshObject(3, 'leaf')}
      <object id="1" type="model"><components>
        <component objectid="2"/>
      </components></object>
      <object id="2" type="model"><components>
        <component objectid="1"/>
        <component objectid="3"/>
      </components></object>`
    // 环 1→2→1 被 path 截断；2 的第二个 component（mesh 3）正常展开
    const arch = await parseThreemf(modelWithComponents(
      resources,
      '<item objectid="2"/>',
    ))
    expect(arch.objects).toHaveLength(1)
    expect(arch.objects[0].name).toBe('leaf')
  })

  it('empty <build>: component containers expand too (decision 8)', async () => {
    const resources = `
      ${meshObject(1, 'part')}
      <object id="9" type="model"><components>
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 3 0 0"/>
      </components></object>`
    const arch = await parseThreemf(modelWithComponents(resources, ''))
    // 无 build → 全部 resources 对象：mesh 1 直接产出 + 容器 9 展开出一个实例
    const names = arch.objects.map((o) => o.name).sort()
    expect(names).toEqual(['part', 'part'])
    const shifted = arch.objects.find((o) => o.positions[0] > 2)
    expect(shifted?.positions[0]).toBeCloseTo(3, 5)
  })
})

describe('guessStlUnit — moved-up volume heuristic', () => {
  it('meter for tiny volume', () => {
    expect(guessStlUnit({ min: [0, 0, 0], max: [0.1, 0.1, 0.1] })).toBe('m') // 1e-3
  })
  it('inch for mid volume', () => {
    expect(guessStlUnit({ min: [0, 0, 0], max: [1, 1, 1] })).toBe('inch') // 1 < 8
  })
  it('millimeter by default', () => {
    expect(guessStlUnit({ min: [0, 0, 0], max: [100, 100, 100] })).toBe('mm')
  })
  it('flat/zero volume falls to default', () => {
    expect(guessStlUnit({ min: [0, 0, 0], max: [0, 0, 0] })).toBe('mm')
  })
})

function strFromU8Checked(u8: Uint8Array): string {
  return new TextDecoder().decode(u8)
}