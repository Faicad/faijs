/**
 * io/zip.test.ts — the unified ZIP read/write contract.
 *
 * Locks the io/zip behaviour so no consumer (threemf-loader, export-model,
 * fcstd, demo, 3d_editor) ever reaches for fflate directly again.
 */
import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8 } from 'fflate'
import {
  readZipEntries,
  readZipEntriesAsync,
  writeZipEntries,
  writeZipEntriesAsync,
} from './zip'

describe('io/zip — readZipEntries', () => {
  it('round-trips write→read with identical content', () => {
    const bytes = writeZipEntries({
      '3D/3dmodel.model': strToU8('<model unit="millimeter"/>'),
      'Metadata/model_settings.config': strToU8('{"settings":1}'),
    })
    const entries = readZipEntries(bytes)
    expect(strFromU8(entries.get('3D/3dmodel.model')!)).toBe('<model unit="millimeter"/>')
    expect(strFromU8(entries.get('Metadata/model_settings.config')!)).toBe('{"settings":1}')
  })

  it('accepts an ArrayBuffer input and forward-slash keys', () => {
    const bytes = writeZipEntries({ 'a/b.txt': strToU8('hi') })
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const entries = readZipEntries(ab)
    expect(entries.has('a/b.txt')).toBe(true)
    expect(entries.has('a/')).toBe(false) // directory entries filtered
  })

  it('throws on non-zip bytes with the zip read failed prefix', () => {
    expect(() => readZipEntries(strToU8('definitely not a zip')))
      .toThrowError(/^zip read failed:/)
  })

  it('throws when the archive exceeds the size cap', () => {
    const big = new Uint8Array(300)
    big.fill(1)
    const bytes = writeZipEntries({ 'big.bin': big })
    expect(() => readZipEntries(bytes, { maxTotalBytes: 10 }))
      .toThrowError(/^zip read failed:/)
  })
})

describe('io/zip — writeZipEntries', () => {
  it('fundamentally rejects an empty entry table', async () => {
    expect(() => writeZipEntries({})).toThrowError(/^zip write failed:/)
    await expect(writeZipEntriesAsync({})).rejects.toThrowError(/^zip write failed:/)
  })

  it('accepts a plain-object with a data URI-ish key', () => {
    const back = readZipEntries(writeZipEntries({ '1.txt': strToU8('one') }))
    expect(strFromU8(back.get('1.txt')!)).toBe('one')
  })
})

describe('io/zip — async variants', () => {
  it('readZipEntriesAsync matches readZipEntries', async () => {
    const bytes = writeZipEntries({ 'x.txt': strToU8('hello') })
    const a = readZipEntries(bytes)
    const b = await readZipEntriesAsync(bytes)
    expect(strFromU8(b.get('x.txt')!)).toBe(strFromU8(a.get('x.txt')!))
    expect([...b.keys()]).toEqual([...a.keys()])
  })

  it('writeZipEntriesAsync produces a readable archive', async () => {
    const bytes = await writeZipEntriesAsync({ 'x.txt': strToU8('async') })
    const back = readZipEntries(bytes)
    expect(strFromU8(back.get('x.txt')!)).toBe('async')
  })
})