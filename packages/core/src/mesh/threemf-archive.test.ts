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