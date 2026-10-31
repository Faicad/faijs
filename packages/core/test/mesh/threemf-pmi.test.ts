/**
 * 3MF PMI metadata bridge tests.
 *
 * Verifies that:
 * 1. serializePmiFor3mf produces valid XML with faijs:pmi metadata.
 * 2. serializePmiFor3mf returns empty string for empty/undefined PMI.
 * 3. parsePmiFrom3mfMetadata round-trips PMI data correctly.
 * 4. parsePmiFrom3mfMetadata returns undefined for missing key.
 * 5. parsePmiFrom3mfMetadata returns undefined for invalid JSON.
 * 6. XML special characters are properly escaped and unescaped.
 */

import { describe, it, expect } from 'vitest'
import {
  serializePmiFor3mf,
  parsePmiFrom3mfMetadata,
  PMI_3MF_METADATA_NAME,
} from '../../src/mesh/threemf-pmi'
import type { PmiSet } from '../../src/api/pmi/types'
import { dimension, gdt, datum, note } from '../../src/api/pmi/types'
import type { FaceTopoRef } from '../../src/topology/naming/types'

const faceRef: FaceTopoRef = {
  kind: 'face',
  origin: 's1' as never,
  role: 'top',
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1] },
}

const samplePmi: PmiSet = {
  items: [
    dimension({ dimType: 'diameter', targets: [faceRef], upperTolerance: 0.021 }),
    gdt({ gdtType: 'flatness', target: faceRef, tolerance: 0.02 }),
    datum({ identifier: 'A', datumType: 'datumPlane', target: faceRef }),
    note({ text: 'test note' }),
  ],
  meta: { source: 'faijs' },
}

describe('serializePmiFor3mf', () => {
  it('produces valid XML metadata element', () => {
    const xml = serializePmiFor3mf(samplePmi)
    expect(xml).toContain('<metadata')
    expect(xml).toContain(`name="${PMI_3MF_METADATA_NAME}"`)
    expect(xml).toContain('preserve="1"')
    expect(xml).toContain('</metadata>')
  })

  it('returns empty string for undefined PMI', () => {
    expect(serializePmiFor3mf(undefined)).toBe('')
  })

  it('returns empty string for empty items', () => {
    expect(serializePmiFor3mf({ items: [] })).toBe('')
  })

  it('XML-escapes special characters in JSON content', () => {
    const pmiWithSpecial: PmiSet = {
      items: [note({ text: 'a < b & c > d' })],
    }
    const xml = serializePmiFor3mf(pmiWithSpecial)
    // The JSON content should be XML-escaped
    expect(xml).toContain('&lt;')
    expect(xml).toContain('&amp;')
    expect(xml).toContain('&gt;')
    // Should NOT contain raw special chars in content (only in tag/attribute)
    const contentMatch = xml.match(/>(.*)</s)
    if (contentMatch) {
      expect(contentMatch[1]).not.toContain('<')
      expect(contentMatch[1]).not.toContain('>')
    }
  })
})

describe('parsePmiFrom3mfMetadata', () => {
  it('round-trips PMI data correctly', () => {
    const xml = serializePmiFor3mf(samplePmi)
    // Simulate 3MF parser extracting metadata name → content
    const contentMatch = xml.match(/>(.*)</s)
    const content = contentMatch ? contentMatch[1]! : ''

    // Un-escape XML entities (simulating what a real 3MF parser does)
    const unescaped = content
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")

    const metadataMap = new Map<string, string>([[PMI_3MF_METADATA_NAME, unescaped]])
    const parsed = parsePmiFrom3mfMetadata(metadataMap)
    expect(parsed).toBeDefined()
    expect(parsed!.items).toHaveLength(4)
    expect(parsed!.items[0].kind).toBe('dimension')
    expect(parsed!.items[1].kind).toBe('gdt')
    expect(parsed!.items[2].kind).toBe('datum')
    expect(parsed!.items[3].kind).toBe('note')
    expect(parsed!.meta?.source).toBe('faijs')
  })

  it('returns undefined for missing key', () => {
    const metadataMap = new Map<string, string>([['other', 'value']])
    const parsed = parsePmiFrom3mfMetadata(metadataMap)
    expect(parsed).toBeUndefined()
  })

  it('returns undefined for invalid JSON', () => {
    const metadataMap = new Map<string, string>([[PMI_3MF_METADATA_NAME, 'not json{']])
    const parsed = parsePmiFrom3mfMetadata(metadataMap)
    expect(parsed).toBeUndefined()
  })

  it('returns undefined for empty map', () => {
    const metadataMap = new Map<string, string>()
    const parsed = parsePmiFrom3mfMetadata(metadataMap)
    expect(parsed).toBeUndefined()
  })

  it('works with plain object map (not Map)', () => {
    const xml = serializePmiFor3mf(samplePmi)
    const contentMatch = xml.match(/>(.*)</s)
    const content = contentMatch ? contentMatch[1]! : ''
    const unescaped = content
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")

    const metadataMap: Record<string, string> = { [PMI_3MF_METADATA_NAME]: unescaped }
    const parsed = parsePmiFrom3mfMetadata(metadataMap)
    expect(parsed).toBeDefined()
    expect(parsed!.items).toHaveLength(4)
  })
})
