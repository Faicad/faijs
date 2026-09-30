/**
 * mesh/threemf-bambu.test.ts — Bambu private-extension parsing (moved up to
 * faijs, plan §8 decision 2) and view-mode deltas (plan §7 viewTransforms move).
 */
import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import {
  parseBambu3mfFromEntries,
  extractThumbnailBytes,
  type Bambu3mfMetadata,
} from './threemf-bambu'
import {
  computeViewDelta,
  hasViewData,
  mat4From12Values,
  mat4From16Values,
} from './threemf-view'

const decoder = new TextDecoder()

function projectSettingsJson(): string {
  return JSON.stringify({
    filament_colour: ['#FF0000', '#00FF00'],
    filament_type: ['PLA', 'PETG'],
    printable_area: ['0x0', '256x256'],
    printable_height: '256',
  })
}

function modelSettingsXml(): string {
  return `<?xml version="1.0"?>
<config>
  <object id="1">
    <metadata key="name" value="Base Plate E0"/>
    <metadata key="extruder" value="0"/>
    <part id="10">
      <metadata key="name" value="plate.stl"/>
      <metadata key="extruder" value="0"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 5 1"/>
      <metadata key="source_offset_x" value="1"/>
      <metadata key="source_offset_y" value="2"/>
      <metadata key="source_offset_z" value="3"/>
    </part>
    <part id="11">
      <metadata key="name" value="clip.stl"/>
      <metadata key="extruder" value="1"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="main"/>
    <model_instance>
      <metadata key="object_id" value="1"/>
    </model_instance>
  </plate>
  <assemble>
    <assemble_item object_id="1" transform="1 0 0 0 1 0 0 0 1 0 0 5" offset="0 0 0"/>
  </assemble>
</config>`
}

function threeDModelXml(): string {
  return `<?xml version="1.0"?>
<model unit="millimeter">
  <metadata name="Title">Bambu Part</metadata>
  <resources><object id="1" name="Base"><mesh/></object></resources>
  <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></build>
</model>`
}

function entries(): Map<string, Uint8Array> {
  return new Map([
    ['Metadata/model_settings.config', strToU8(modelSettingsXml())],
    ['Metadata/project_settings.config', strToU8(projectSettingsJson())],
    ['Metadata/thumbnail.png', strToU8('PNG')],
    ['3D/3dmodel.model', strToU8(threeDModelXml())],
  ])
}

describe('parseBambu3mfFromEntries — project + model settings', () => {
  it('parses filament + bed + parts + plates', () => {
    const m = parseBambu3mfFromEntries(entries())
    expect(m.filamentColors).toEqual(['#FF0000', '#00FF00'])
    expect(m.filamentTypes).toEqual(['PLA', 'PETG'])
    expect(m.plates.get(1)?.plateName).toBe('main')
    const obj = m.objects.get('1')
    expect(obj?.name).toBe('Base Plate E0')
    expect(obj?.plateId).toBe(1)
    const platePart = m.parts.find(p => p.partId === '10')
    expect(platePart?.name).toBe('plate')
    expect(platePart?.plateId).toBe(1)
  })

  it('extracts the thumbnail bytes (no Blob in faijs)', () => {
    const t = extractThumbnailBytes(entries())
    expect(decoder.decode(t!)).toBe('PNG')
  })

  it('surfaces assemble + import transforms', () => {
    const m = parseBambu3mfFromEntries(entries())
    expect(m.assembleTransforms?.size).toBe(1)
    expect(m.importTransforms?.get('1:10')?.matrix).toHaveLength(16)
  })

  it('reads model metadata + build items from the model xml', () => {
    const m = parseBambu3mfFromEntries(entries())
    expect(m.modelMeta?.title).toBe('Bambu Part')
    expect(m.buildItems?.[0].objectId).toBe('1')
    expect(m.buildItems?.[0].transform).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0])
  })
})

describe('threemf-view matrix math (env-agnostic)', () => {
  it('mat4From12Values lands on column-major elements', () => {
    const m = mat4From12Values([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(m.elements).toEqual([
      1, 2, 3, 0,
      4, 5, 6, 0,
      7, 8, 9, 0,
      10, 11, 12, 1,
    ])
  })

  it('mat4From16Values row-major → column-major', () => {
    const m = mat4From16Values([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expect(m.elements).toEqual([
      1, 5, 9, 13,
      2, 6, 10, 14,
      3, 7, 11, 15,
      4, 8, 12, 16,
    ])
  })

  it('computeViewDelta assembly ≠ print pose', () => {
    const meta = makeMeta()
    const print = mat4From12Values([1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0])
    const delta = computeViewDelta('assembly', meta, { objectId: '1' })
    expect(delta).not.toBeNull()
    expect(delta!.elements).not.toEqual(print.elements)
  })

  it('computeViewDelta is ≈ identity when build == assembly translation', () => {
    const meta = makeMeta()
    meta.buildItems = [{ objectId: '1', transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 5] }]
    const delta = computeViewDelta('assembly', meta, { objectId: '1' })
    expect(delta).not.toBeNull()
    for (let i = 0; i < 16; i++) {
      const want = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]
      // assembly transform carries the same translation, delta is homogeneous.
      expect(Math.abs(delta!.elements[i] - want)).toBeLessThan(1e-6)
    }
  })

  it('computeViewDelta import keyed by scopedId (default 0)', () => {
    const meta = makeMeta()
    const delta = computeViewDelta('import', meta, { objectId: '1' })
    expect(delta).not.toBeNull()
  })

  it('hasViewData gates assembly/import', () => {
    const meta = makeMeta()
    expect(hasViewData('print', meta)).toBe(true)
    expect(hasViewData('assembly', meta)).toBe(true)
    expect(hasViewData('import', meta)).toBe(true)
    const bare = { assembleTransforms: new Map(), importTransforms: new Map() }
    expect(hasViewData('assembly', bare)).toBe(false)
    expect(hasViewData('import', bare)).toBe(false)
  })

  it('returns null when build has no transform', () => {
    const meta = makeMeta()
    meta.buildItems = undefined
    expect(computeViewDelta('assembly', meta, { objectId: '1' })).toBeNull()
  })
})

function makeMeta(): Bambu3mfMetadata {
  return {
    filamentColors: [],
    filamentTypes: [],
    objects: new Map(),
    parts: [],
    plates: new Map(),
    metadataEntries: [],
    buildItems: [{ objectId: '1', transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0] }],
    assembleTransforms: new Map([
      ['1', { objectId: '1', transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 5], offset: [0, 0, 0] }],
    ]),
    importTransforms: new Map([
      ['1:0', { objectId: '1', partId: '0', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], sourceOffset: [0, 0, 0] }],
    ]),
  }
}