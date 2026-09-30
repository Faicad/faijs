/**
 * `.fai.zip` write API tests (docs/fai-zip-format.md §10, Writer obligations).
 *
 * One negative case per obligation that `writeContainer` can check statically,
 * plus a round trip that proves the writer and the reader agree on the format
 * they both claim to implement.
 */
import { describe, it, expect } from 'vitest'
import { readZipEntries } from '../zip'
import {
  createManifest,
  writeContainer,
  type ContainerAssembly,
} from './container-write.js'
import {
  listModules,
  openContainer,
  readAssetEntries,
  readDataMember,
} from './container-read.js'

/** A minimal self-consistent assembly: one model, its module, no payload. */
function assembly(overrides: Partial<ContainerAssembly> = {}): ContainerAssembly {
  return {
    models: [{ id: 'plate', entry: 'model/plate.fai.js' }],
    modules: {
      'model/plate.fai.js': 'const part0 = cad.box(20, 20, 20)',
      'model/lib.fai.js': 'export const helper = 1',
    },
    dataMembers: {},
    files: {},
    assets: {},
    ...overrides,
  }
}

describe('createManifest — the single manifest constructor', () => {
  it('fixes format 3 and units mm, and carries display meta verbatim', () => {
    const manifest = createManifest({
      models: [{ id: 'main', entry: 'model/main.fai.js', label: 'Main', data: 'data/main.json' }],
      active: 'main',
      meta: {
        createdAt: '2026-09-30T00:00:00.000Z',
        appVersion: '0.22.4',
        label: 'Project',
        source: { file: 'Beds.FCStd', programVersion: '0.21.1', schemaVersion: 4 },
        requiresBrep: true,
      },
    })
    expect(manifest).toEqual({
      format: 3,
      units: 'mm',
      models: [{ id: 'main', entry: 'model/main.fai.js', label: 'Main', data: 'data/main.json' }],
      active: 'main',
      createdAt: '2026-09-30T00:00:00.000Z',
      appVersion: '0.22.4',
      label: 'Project',
      source: { file: 'Beds.FCStd', programVersion: '0.21.1', schemaVersion: 4 },
      requiresBrep: true,
    })
  })

  it('omits every absent optional field rather than writing null/undefined', () => {
    const manifest = createManifest({ models: [{ id: 'a', entry: 'model/a.fai.js' }] })
    expect(Object.keys(manifest).sort()).toEqual(['format', 'models', 'units'])
  })

  it('rejects an empty model list', () => {
    expect(() => createManifest({ models: [] })).toThrow(/models must be a non-empty array/)
  })

  it('rejects an id that is empty or contains a separator (spec §4.3)', () => {
    expect(() => createManifest({ models: [{ id: '', entry: 'model/a.fai.js' }] })).toThrow(/\.id must be a non-empty string/)
    expect(() => createManifest({ models: [{ id: 'a/b', entry: 'model/a.fai.js' }] })).toThrow(/must not contain/)
  })

  it('rejects duplicate ids and duplicate entries (spec §4.3)', () => {
    expect(() => createManifest({
      models: [
        { id: 'a', entry: 'model/a.fai.js' },
        { id: 'a', entry: 'model/b.fai.js' },
      ],
    })).toThrow(/models\[\]\.id must be unique/)
    expect(() => createManifest({
      models: [
        { id: 'a', entry: 'model/a.fai.js' },
        { id: 'b', entry: 'model/a.fai.js' },
      ],
    })).toThrow(/models\[\]\.entry must be unique/)
  })

  it('rejects an entry that is not a module path, and a data path that is not JSON', () => {
    expect(() => createManifest({ models: [{ id: 'a', entry: 'scripts/a.fai.js' }] })).toThrow(/must be under model\/ and end with \.fai\.js/)
    expect(() => createManifest({ models: [{ id: 'a', entry: 'model/a.fai.js', data: 'data/a.txt' }] })).toThrow(/must be under data\/ and end with \.json/)
    expect(() => createManifest({ models: [{ id: 'a', entry: 'model/a.fai.js', data: '../a.json' }] })).toThrow(/unsafe member path/)
  })

  it('rejects active that names no model (spec §4.4)', () => {
    expect(() => createManifest({ models: [{ id: 'a', entry: 'model/a.fai.js' }], active: 'nope' }))
      .toThrow(/active must equal some models\[\]\.id/)
  })
})

describe('writeContainer — must not emit what a reader cannot reconstruct', () => {
  it('rejects a models[].entry with no module in the assembly (spec §10.2)', () => {
    expect(() => writeContainer(assembly({ modules: { 'model/other.fai.js': 'x' } })))
      .toThrow(/models\[\]\.entry "model\/plate\.fai\.js" has no module in the assembly/)
  })

  it('rejects a models[].data with no member in the assembly (spec §10.2)', () => {
    expect(() => writeContainer(assembly({
      models: [{ id: 'plate', entry: 'model/plate.fai.js', data: 'data/plate.json' }],
    }))).toThrow(/models\[\]\.data "data\/plate\.json" has no member in the assembly/)
  })

  it('rejects a module key that is not under model/ (spec §5.1)', () => {
    expect(() => writeContainer(assembly({
      modules: { 'model/plate.fai.js': 'x', 'scripts/extra.fai.js': 'y' },
    }))).toThrow(/modules key must be under model\/ and end with \.fai\.js/)
  })

  it('rejects a data member whose content is not JSON (spec §6.1)', () => {
    expect(() => writeContainer(assembly({
      models: [{ id: 'plate', entry: 'model/plate.fai.js', data: 'data/plate.json' }],
      dataMembers: { 'data/plate.json': 'not json {' },
    }))).toThrow(/is not valid JSON/)
  })

  it('rejects a data member path outside data/ (spec §6.1)', () => {
    expect(() => writeContainer(assembly({ dataMembers: { 'meta/plate.json': '{}' } })))
      .toThrow(/dataMembers key must be under data\/ and end with \.json/)
  })

  it('rejects duplicate asset keys across files//assets/ (spec §7.1, §10.5)', () => {
    expect(() => writeContainer(assembly({
      files: { dup: new Uint8Array([1]) },
      assets: { 'assets/dup.brp': new Uint8Array([2]) },
    }))).toThrow(/duplicate asset key "dup"/)
  })

  it('rejects two assets whose base names collide, e.g. logo.svg + logo.png (spec §7.1)', () => {
    expect(() => writeContainer(assembly({
      assets: { 'assets/logo.svg': new Uint8Array([1]), 'assets/logo.png': new Uint8Array([2]) },
    }))).toThrow(/duplicate asset key "logo"/)
  })

  it('rejects a fileId that the base-name key rule would silently rename', () => {
    expect(() => writeContainer(assembly({ files: { 'a/b': new Uint8Array([1]) } })))
      .toThrow(/fileId must be a non-empty base name without separators/)
  })

  it('rejects an assets key outside assets/', () => {
    expect(() => writeContainer(assembly({ assets: { 'files/thing.brp': new Uint8Array([1]) } })))
      .toThrow(/assets key must be under assets\//)
  })

  it('rejects a producer member that would collide with a generated member path', () => {
    expect(() => writeContainer(assembly({ producerMembers: { 'manifest.json': new Uint8Array([1]) } })))
      .toThrow(/duplicate member path "manifest\.json"/)
  })

  it('counts producer members under files//assets/ towards the key uniqueness rule (spec §10.5)', () => {
    expect(() => writeContainer(assembly({
      assets: { 'assets/thing.brp': new Uint8Array([1]) },
      producerMembers: { 'assets/thing.step': new Uint8Array([2]) },
    }))).toThrow(/duplicate asset key "thing"/)
  })

  it('rejects unsafe member paths anywhere in the assembly (spec §2)', () => {
    expect(() => writeContainer(assembly({ producerMembers: { '../escape.bin': new Uint8Array([1]) } })))
      .toThrow(/unsafe member path/)
  })
})

describe('writeContainer — round trip through openContainer', () => {
  it('produces a container the reader reads back identically', async () => {
    const source = assembly({
      models: [
        { id: 'main', entry: 'model/main.fai.js', label: 'Main', data: 'data/main.json' },
        { id: 'Body', entry: 'model/Body.fai.js', label: 'Body', data: 'data/Body.json' },
      ],
      active: 'Body',
      meta: {
        createdAt: '2026-09-30T00:00:00.000Z',
        appVersion: '0.22.4',
        source: { file: 'Beds.FCStd', programVersion: '0.21.1', schemaVersion: 4 },
        requiresBrep: true,
      },
      modules: {
        'model/main.fai.js': 'import { Body_out } from "./Body.fai.js"',
        'model/Body.fai.js': 'const Body_out = cad.box(1, 1, 1)',
      },
      dataMembers: {
        'data/main.json': '{"sceneTree":[]}',
        'data/Body.json': '{"sceneTree":[1]}',
      },
      files: { '9f1c2a': new Uint8Array([1, 2, 3]) },
      assets: { 'assets/bracket.brp': new Uint8Array([9, 9]) },
      producerMembers: {
        'mapping.json': new Uint8Array([123, 125]),
        'freecad/Document.xml': new Uint8Array([60, 47, 62]),
      },
    })

    const { bytes, manifest } = writeContainer(source)
    const opened = openContainer(bytes)

    expect(opened.manifest).toEqual(manifest)
    expect(opened.activeModel.id).toBe('Body')
    expect(opened.loader.listModules()).toEqual(['Body.fai.js', 'main.fai.js'])
    expect(await opened.loader.readSource('Body.fai.js')).toBe('const Body_out = cad.box(1, 1, 1)')
    expect(readDataMember(bytes, 'data/Body.json')).toBe('{"sceneTree":[1]}')
    expect(listModules(bytes)).toEqual(['Body.fai.js', 'main.fai.js'])
    expect(Object.keys(opened.files)).toEqual(['9f1c2a'])
    expect(Object.keys(opened.assets)).toEqual(['bracket'])
    expect(readAssetEntries(bytes).assets.bracket).toEqual(new Uint8Array([9, 9]))
    // producer members survive byte-exactly and stay out of the payload tables
    expect(opened.files['mapping']).toBeUndefined()
    expect(opened.assets['Document']).toBeUndefined()
  })

  it('keeps the producer members byte-exact (freecad/ shadow, mapping.json)', () => {
    const shadow = new Uint8Array([0, 255, 17])
    const mapping = new TextEncoder().encode('{"objects":[]}')
    const { bytes } = writeContainer(assembly({
      producerMembers: { 'freecad/Box.brp': shadow, 'mapping.json': mapping },
    }))
    const members = readZipEntries(bytes)
    expect(members.get('freecad/Box.brp')).toEqual(shadow)
    expect(members.get('mapping.json')).toEqual(mapping)
    const opened = openContainer(bytes)
    // readAssetEntries only claims files//assets/, so freecad/ is not a payload key
    expect(Object.keys(opened.assets)).toEqual([])
    expect(readAssetEntries(bytes).assets).toEqual({})
  })

  it('writes files/<fileId>.bin so the fileId round-trips through the key rule', () => {
    const { bytes } = writeContainer(assembly({
      files: { '9f1c2a': new Uint8Array([7]), 'uuid-dotted.name': new Uint8Array([8]) },
    }))
    const opened = openContainer(bytes)
    expect(Object.keys(opened.files).sort()).toEqual(['9f1c2a', 'uuid-dotted.name'])
    expect(opened.files['9f1c2a']).toEqual(new Uint8Array([7]))
  })
})
